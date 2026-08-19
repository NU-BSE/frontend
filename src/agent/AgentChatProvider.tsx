import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { useAgentChat, type AgentChat } from './useAgentChat';
import { approvalCard } from './approvalCard';
import {
  dismiss as dismissCard,
  hasPermission,
  showCard,
  onCardPress,
  APPROVE_ACTION_ID,
  REJECT_ACTION_ID,
} from '@/notifications/smartCards';

/**
 * One conversation for the whole app.
 *
 * The chat used to be created inside the chat screen, so leaving the screen
 * destroyed it — and the thread id was derived from the scenario, so arriving
 * from a category on the main screen started a different conversation again.
 * Between them, the history a user could see depended on how they had
 * navigated, which is not something a conversation should do.
 *
 * It lives at the root of the app now: one thread, created once, kept for as
 * long as the process. Closing the app ends it, which is the only boundary the
 * user has any reason to expect.
 *
 * The scenario a screen was opened with is still used — for the opening prompt
 * and the suggestions — but it no longer partitions the conversation.
 */

export const AGENT_THREAD_ID = 'general';

export interface AgentChatSession extends AgentChat {
  /**
   * Told by the chat screen whether it is on screen.
   *
   * An approval only needs a notification when the user cannot see the
   * request, so the screen reports its own visibility rather than this
   * guessing from navigation state.
   */
  setChatVisible(visible: boolean): void;
}

const AgentChatContext = createContext<AgentChatSession | null>(null);

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const chat = useAgentChat({ threadId: AGENT_THREAD_ID });
  const [chatVisible, setChatVisible] = useState(false);

  const { pendingApproval, approvePendingApproval, rejectPendingApproval } = chat;

  /*
   * Whether the user can currently see the approval.
   *
   * Backgrounded counts as not visible even when the chat screen is mounted:
   * the run continues while the app is away, and an approval nobody is looking
   * at is exactly the case a notification exists for.
   */
  const canSeeApproval = useCallback(
    () => chatVisible && AppState.currentState === 'active',
    [chatVisible],
  );

  // The approval the card is currently showing, so it is posted once and
  // cleared when the run moves on.
  const postedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function sync(): Promise<void> {
      if (!pendingApproval) {
        if (postedFor.current !== null) {
          postedFor.current = null;
          dismissCard();
        }
        return;
      }

      if (canSeeApproval()) {
        // Visible on screen: the card would be noise, and dismissing it keeps
        // the two surfaces from disagreeing if the user opens the chat.
        if (postedFor.current !== null) {
          postedFor.current = null;
          dismissCard();
        }
        return;
      }

      if (postedFor.current === pendingApproval.approvalId) return;

      // Never prompt for a permission from here — a background approval is not
      // the moment to interrupt with a system dialog. If notifications were
      // refused, the approval simply waits in the chat.
      if (!(await hasPermission()) || cancelled) return;

      postedFor.current = pendingApproval.approvalId;
      await showCard(approvalCard(pendingApproval));
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [canSeeApproval, pendingApproval]);

  /*
   * Approving from the notification.
   *
   * The press reaches JS only while the process is alive — which is exactly
   * when it can matter. An approval belongs to an agent run in memory, so if
   * the process is gone the run is gone with it and there is nothing left to
   * approve; the card is stale rather than actionable, and pressing it just
   * clears it.
   */
  useEffect(() => {
    return onCardPress((actionId) => {
      if (actionId === APPROVE_ACTION_ID) approvePendingApproval();
      else if (actionId === REJECT_ACTION_ID) rejectPendingApproval();
    });
  }, [approvePendingApproval, rejectPendingApproval]);

  // Clear the card if the app is closing on an unanswered approval, so it does
  // not survive as a button that can no longer do anything.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && chatVisible && postedFor.current !== null) {
        postedFor.current = null;
        dismissCard();
      }
    });
    return () => subscription.remove();
  }, [chatVisible]);

  const value = useMemo<AgentChatSession>(
    () => ({ ...chat, setChatVisible }),
    [chat],
  );

  return (
    <AgentChatContext.Provider value={value}>{children}</AgentChatContext.Provider>
  );
}

export function useAgentChatSession(): AgentChatSession {
  const value = useContext(AgentChatContext);
  if (!value) {
    throw new Error('useAgentChatSession must be used inside <AgentChatProvider>');
  }
  return value;
}
