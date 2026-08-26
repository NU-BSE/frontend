import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAgentChatSession } from '@/agent/AgentChatProvider';

import * as tts from './tts';
import {
  addListeners,
  cancel as cancelRecognition,
  isSilence,
  isSupported,
  requestPermission,
  startListening,
  stopListening,
  type Transcript,
  type VoiceError,
} from './voice';

/**
 * One spoken turn: listen, send, wait, speak.
 *
 * The loop is a state machine rather than a chain of awaits because every
 * stage can be interrupted — the user can cancel mid-utterance, the agent can
 * stop to ask for approval, and the reply can arrive while the recogniser is
 * still finishing. A promise chain would have to unwind all of that; an
 * explicit phase can simply move.
 */
export type VoicePhase =
  | 'idle'
  | 'requesting-permission'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface VoiceSession {
  phase: VoicePhase;
  /** Live transcript while listening; the final one once sent. */
  transcript: string;
  /** The last thing the assistant said. */
  reply: string;
  error: string | null;
  supported: boolean;
  /** Speak the reply aloud when it arrives. */
  speechEnabled: boolean;
  setSpeechEnabled(enabled: boolean): void;
  start(): void;
  stop(): void;
  reset(): void;
}

export function useVoiceSession(): VoiceSession {
  const chat = useAgentChatSession();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speechEnabled, setSpeechEnabled] = useState(true);

  const supported = useMemo(() => isSupported(), []);

  /*
   * The turn we are waiting on. Set when a transcript is sent, cleared when
   * the assistant's answer to *that* turn arrives. Without it, an assistant
   * message already on screen from an earlier turn would be read out the
   * moment a voice session opened.
   */
  const awaitingReplyAfter = useRef<number | null>(null);
  /*
   * The phase, readable from callbacks and from async continuations without
   * closing over a stale value. Written in an effect rather than during
   * render: a ref write during render is a React violation, and it would also
   * be undone if the render were thrown away. Callbacks here all run after a
   * commit, so the one-commit lag is not observable.
   */
  const phaseRef = useRef<VoicePhase>('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setPhase('idle');
        return;
      }
      awaitingReplyAfter.current = chat.messages.length;
      setPhase('thinking');
      chat.sendMessage({ text: trimmed, attachments: [] });
    },
    [chat],
  );

  // Recognition events. Re-subscribed when `send` changes so the handler never
  // closes over a stale message count.
  useEffect(() => {
    if (!supported) return undefined;

    return addListeners({
      onSpeechStart: () => setError(null),
      onPartial: (result: Transcript) => setTranscript(result.transcript),
      onResult: (result: Transcript) => {
        setTranscript(result.transcript);
        send(result.transcript);
      },
      onError: (failure: VoiceError) => {
        if (isSilence(failure)) {
          // Nothing was said. Returning to idle is the honest outcome; an
          // error banner for a pause makes the assistant feel broken.
          setPhase('idle');
          setTranscript('');
          return;
        }
        setError(failure.message);
        setPhase('error');
      },
    });
  }, [supported, send]);

  // Watch for the answer to the turn we sent.
  useEffect(() => {
    const from = awaitingReplyAfter.current;
    if (from === null) return;

    const answer = chat.messages
      .slice(from)
      .find((message) => message.role === 'assistant' && message.content);
    if (!answer || answer.role !== 'assistant' || !answer.content) return;

    awaitingReplyAfter.current = null;
    setReply(answer.content);

    if (!speechEnabled) {
      setPhase('idle');
      return;
    }

    setPhase('speaking');
    let cancelled = false;
    void tts
      .speak(answer.content)
      .catch(() => {
        /*
         * Speech failing does not fail the turn — the answer is already on
         * screen. Reporting it as an error would hide a good reply behind a
         * complaint about the speaker.
         */
      })
      .finally(() => {
        if (!cancelled && phaseRef.current === 'speaking') setPhase('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [chat.messages, speechEnabled]);

  // An approval interrupts the turn: the agent is waiting on the user, and
  // continuing to sit in "thinking" would misdescribe what is happening.
  useEffect(() => {
    if (chat.pendingApproval && phaseRef.current === 'thinking') {
      awaitingReplyAfter.current = null;
      setPhase('idle');
    }
  }, [chat.pendingApproval]);

  const start = useCallback(() => {
    if (!supported) {
      setError('Speech recognition is not available in this build.');
      setPhase('error');
      return;
    }
    setError(null);
    setReply('');
    setTranscript('');
    tts.stop();

    setPhase('requesting-permission');
    void (async () => {
      const granted = await requestPermission();
      if (!granted) {
        setError('Creepy needs the microphone to listen.');
        setPhase('error');
        return;
      }
      try {
        /*
         * Offline is preferred but never demanded: the native side drops the
         * request on a device without an on-device recogniser, because asking
         * for it there fails the utterance rather than falling back. Sending
         * it unconditionally is what produced "Recognition failed" on a Xiaomi
         * that transcribes over the network perfectly well.
         */
        await startListening({ preferOffline: true });
        setPhase('listening');
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not start listening.');
        setPhase('error');
      }
    })();
  }, [supported]);

  /** Stop whatever is happening, without discarding what was already said. */
  const stop = useCallback(() => {
    if (phaseRef.current === 'listening') {
      // Transcribe what was heard rather than throwing it away.
      stopListening();
      return;
    }
    if (phaseRef.current === 'speaking') {
      tts.stop();
      setPhase('idle');
      return;
    }
    cancelRecognition();
    awaitingReplyAfter.current = null;
    setPhase('idle');
  }, []);

  const reset = useCallback(() => {
    cancelRecognition();
    tts.stop();
    awaitingReplyAfter.current = null;
    setTranscript('');
    setReply('');
    setError(null);
    setPhase('idle');
  }, []);

  // Leaving the screen must not leave the microphone open or the assistant
  // talking to an empty room.
  useEffect(
    () => () => {
      cancelRecognition();
      tts.stop();
    },
    [],
  );

  return {
    phase,
    transcript,
    reply,
    error,
    supported,
    speechEnabled,
    setSpeechEnabled,
    start,
    stop,
    reset,
  };
}
