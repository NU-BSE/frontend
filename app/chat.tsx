import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useAi } from '@/ai/AiProvider';
import { useAgentChatSession } from '@/agent/AgentChatProvider';
import type { AgentMessage, ChatSendInput } from '@/agent/types';
import { AgentMessageItem } from '@/features/chat/AgentMessageItem';
import { isInternalPrompt } from '@/agent/promptIntent';
import { Composer } from '@/features/chat/Composer';
import {
  composeMessageWithAttachments,
  extractAttachmentText,
} from '@/files/attachmentText';
import { isSupported as voiceIsSupported } from '@/voice/voice';

/*
 * Resolved once at import: whether the build carries the speech module cannot
 * change while the app is running, and re-checking per render would put a
 * NativeModules lookup in the composer's render path.
 */
const VOICE_SUPPORTED = voiceIsSupported();
import { DeepLinkBar } from '@/features/chat/DeepLinkBar';
import { SuggestionChips } from '@/features/chat/SuggestionChips';
import { toolActivityLabel } from '@/features/chat/toolLabels';
import { ApprovalSheet } from '@/features/approvals/ApprovalSheet';
import {
  GENERAL_SUGGESTIONS,
  getScenario,
} from '@/features/scenarios/registry';
import { appendHistory } from '@/storage/history';
import { gutter, palette, spacing } from '@/theme/tokens';

const ORIGIN_LABEL = {
  'on-device': 'On this device',
  remote: 'On a server',
  stub: 'Offline preview',
} as const;

export default function Chat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<AgentMessage>>(null);

  const { origin, status: engineStatus, degradedReason } = useAi();

  const { scenario: scenarioParam, prompt: promptParam, k: promptToken } =
    useLocalSearchParams<{ scenario?: string; prompt?: string; k?: string }>();
  const scenario = getScenario(scenarioParam);

  const {
    mode,
    messages,
    runState,
    pendingApproval,
    isRunning,
    mcpError,
    sendMessage,
    approvePendingApproval,
    rejectPendingApproval,
    cancel,
    retryInitialization,
    setChatVisible,
  } = useAgentChatSession();

  /*
   * The screen reports its own visibility so an approval only becomes a
   * notification when the user genuinely cannot see it. Tied to focus rather
   * than mount: this screen is a modal, and the one underneath stays mounted.
   */
  useFocusEffect(
    useCallback(() => {
      setChatVisible(true);
      return () => setChatVisible(false);
    }, [setChatVisible]),
  );

  // Text-only fallback persists here; agent runs persist through the
  // runtime's run records (which also capture tool/approval steps).
  const save = useMutation({
    mutationFn: appendHistory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['history'] }),
  });
  const savedIds = useRef(new Set<string>());
  useEffect(() => {
    if (mode !== 'text-only' || isRunning) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || savedIds.current.has(last.id)) {
      return;
    }
    const reply = last.content.trim();
    if (!reply) return;
    const prompt = [...messages].reverse().find((m) => m.role === 'user');
    savedIds.current.add(last.id);
    save.mutate({
      threadId: scenario?.id ?? 'general',
      category: scenario?.title ?? 'General',
      prompt: prompt && prompt.role === 'user' ? prompt.content : '',
      reply,
      engine: origin,
    });
  }, [isRunning, messages, mode, origin, save, scenario]);

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  /**
   * Sends a turn, reading any attached files on the device first.
   *
   * The file's text is folded into the message rather than uploaded, so an
   * attachment costs no network and works against a local model. The
   * attachments stay on the input message too, so the bubble still shows what
   * was attached — only their bytes are absent from what the model receives.
   */
  const handleSend = useCallback(
    (input: ChatSendInput) => {
      if (input.attachments.length === 0) {
        sendMessage(input);
        requestAnimationFrame(scrollToEnd);
        return;
      }

      void (async () => {
        const files = await Promise.all(
          input.attachments.map(async (attachment) => ({
            name: attachment.name,
            outcome: await extractAttachmentText(attachment),
          })),
        );
        sendMessage({
          ...input,
          text: composeMessageWithAttachments(input.text, files),
        });
        requestAnimationFrame(scrollToEnd);
      })();
    },
    [scrollToEnd, sendMessage],
  );

  /** Text-only convenience wrapper for suggestion chips and deep links. */
  const handleSendText = useCallback(
    (text: string) => {
      handleSend({ text, attachments: [] });
    },
    [handleSend],
  );


  /*
   * A guide tapped in the Settings feed arrives as `?prompt=` and is sent once
   * on mount, so the chat opens with the question already asked.
   *
   * Only when the link came from inside the app. MainActivity is exported and
   * owns the creepyim:// scheme, so any installed app can open this screen
   * with parameters of its choosing; auto-sending them would make the model,
   * the connected accounts and the tool permissions available to any caller
   * that knows the URL. A prompt without the session token is put in the
   * composer instead, where the user decides whether it runs.
   *
   * The ref guards against a re-send when the screen re-renders or the params
   * object is re-created; `sendMessage` is deliberately not a dependency for
   * the same reason.
   */
  const trustedPrompt = isInternalPrompt(promptToken);
  /*
   * Derived, not stored: an untrusted prompt is a pure function of the route
   * params, and holding it in state would mean setting that state from an
   * effect — a cascading render for a value that was already known during the
   * first one.
   */
  const suggestedText =
    !trustedPrompt && promptParam?.trim() ? promptParam.trim() : undefined;

  const sentInitialPrompt = useRef(false);
  useEffect(() => {
    if (sentInitialPrompt.current) return;
    const initial = promptParam?.trim();
    if (!initial || !trustedPrompt) return;
    sentInitialPrompt.current = true;
    handleSendText(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptParam, trustedPrompt]);

  /*
   * Settings shows no opening chips.
   *
   * Its prompts are the Android guide titles — full questions, six of them,
   * wrapping to two lines each. They filled the conversation area and pushed
   * the actual replies off screen. The Settings feed is now the browsable
   * library for exactly these, so repeating them here costs the whole screen
   * and adds nothing.
   */
  const suggestions = useMemo(
    () =>
      scenario?.id === 'settings'
        ? []
        : (scenario?.suggestions ?? GENERAL_SUGGESTIONS),
    [scenario],
  );

  const agentStatusLine = useMemo(() => {
    switch (runState.type) {
      case 'thinking':
        return 'Thinking…';
      case 'calling_tool':
        return `${toolActivityLabel(runState.toolName)}…`;
      case 'executing_tool':
        return `${toolActivityLabel(runState.toolName)}…`;
      case 'awaiting_approval':
        return 'Waiting for your confirmation…';
      case 'responding':
        return 'Replying…';
      case 'failed':
        return runState.error.message;
      default:
        return null;
    }
  }, [runState]);

  const statusLine =
    engineStatus === 'preparing'
      ? 'Waking up…'
      : mcpError && mode === 'agent'
        ? 'Tools unavailable — continuing as text chat'
        : (agentStatusLine ??
          (engineStatus === 'degraded'
            ? (degradedReason ?? 'Fell back to offline preview')
            : ORIGIN_LABEL[origin]));

  const statusTone =
    engineStatus === 'degraded' ||
    runState.type === 'failed' ||
    (mcpError != null && mode === 'agent')
      ? 'danger'
      : 'faint';

  const isEmpty = messages.length === 0;
  const awaitingApproval = pendingApproval !== null;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="headline">
            {scenario ? scenario.title : 'Ask Creepy'}
          </Text>
          <Text
            variant="tag"
            tone={statusTone}
            uppercase
          >
            {statusLine}
          </Text>
          {mcpError && mode === 'agent' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading tools"
              onPress={retryInitialization}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text variant="label" tone="brand">
                Retry tools
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close chat"
            hitSlop={12}
            onPress={() => router.back()}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text variant="label" tone="brand">
              Close
            </Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={[...messages]}
          keyExtractor={(message) => message.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <AgentMessageItem
              message={item}
              streaming={
                isRunning &&
                index === messages.length - 1 &&
                item.role === 'assistant'
              }
            />
          )}
          ListHeaderComponent={
            isEmpty && scenario ? (
              <View style={styles.intro}>
                <Text variant="bodyLarge" tone="secondary">
                  {scenario.cardDescription}
                </Text>
              </View>
            ) : null
          }
        />

        <View style={styles.tray}>
          {awaitingApproval && pendingApproval ? (
            <ApprovalSheet
              approval={pendingApproval}
              busy={runState.type === 'executing_tool'}
              onApprove={approvePendingApproval}
              onReject={rejectPendingApproval}
            />
          ) : (
            <>
              <SuggestionChips
                suggestions={suggestions}
                onSelect={handleSendText}
                disabled={isRunning || engineStatus === 'preparing'}
              />
              {scenario ? <DeepLinkBar links={scenario.deepLinks} /> : null}
            </>
          )}
        </View>

        <View style={{ paddingBottom: insets.bottom }}>
          <Composer
            onSend={handleSend}
            onStop={cancel}
            busy={isRunning}
            disabled={engineStatus === 'preparing' || awaitingApproval}
            {...(VOICE_SUPPORTED ? { onVoice: () => router.push('/voice') } : {})}
            // Keyed so a newly arrived suggestion re-initialises the field
            // rather than being synced in from an effect.
            key={suggestedText ?? ''}
            {...(suggestedText !== undefined ? { initialText: suggestedText } : {})}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    // Top, not centre: the status line under the title can run to four lines
    // when it carries an engine failure, and a vertically centred "Close"
    // floats down the middle of that block instead of sitting level with the
    // title it belongs to.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: gutter.home,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderFaint,
  },
  // `flex: 1` is what keeps "Close" on screen. Without it the text column is
  // sized by its content, so a long status line — an on-device engine failure
  // is a full sentence — grows the column past the available width and pushes
  // the actions off the right edge. `flexShrink: 0` then stops the row from
  // resolving that overflow by shrinking the button instead.
  headerText: { flex: 1, gap: spacing.xs },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing.md,
    // Level with the title, which the tighter line height of `headline` would
    // otherwise leave a few points below the top of the row.
    paddingLeft: spacing.md,
  },
  listContent: { padding: gutter.home, flexGrow: 1 },
  gap: { height: spacing.md },
  intro: { paddingBottom: spacing.lg },
  tray: {
    paddingHorizontal: gutter.home,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  pressed: { opacity: 0.6 },
});
