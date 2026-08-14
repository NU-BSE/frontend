import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useAgentChat } from '@/agent/useAgentChat';
import type { AgentMessage, ChatAttachment, ChatSendInput } from '@/agent/types';
import { uploadFile } from '@/api/files';
import { AgentMessageItem } from '@/features/chat/AgentMessageItem';
import { Composer } from '@/features/chat/Composer';
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

  const { scenario: scenarioParam, prompt: promptParam } =
    useLocalSearchParams<{ scenario?: string; prompt?: string }>();
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
  } = useAgentChat({
    threadId: scenario?.id,
    category: scenario?.title,
  });

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

  const handleSend = useCallback(
    (input: ChatSendInput) => {
      sendMessage(input);
      requestAnimationFrame(scrollToEnd);
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

  // Attachments are uploaded to the backend only when inference is remote;
  // local/text-only models never send file bytes off the device.
  const uploadFileForChat = useMemo(
    () =>
      origin === 'remote'
        ? (attachment: ChatAttachment): Promise<{ id: string }> => {
            if (!attachment.uri) {
              return Promise.reject(
                new Error('This attachment has no local file to upload.'),
              );
            }
            return uploadFile({
              uri: attachment.uri,
              name: attachment.name,
              mimeType: attachment.mimeType,
            });
          }
        : undefined,
    [origin],
  );

  /*
   * A guide tapped in the Settings feed arrives as `?prompt=`. It is sent once,
   * on mount, so the chat opens with the question already asked rather than
   * making the user re-type what they just tapped.
   *
   * The ref guards against a re-send when the screen re-renders or the params
   * object is re-created; `sendMessage` is deliberately not a dependency for
   * the same reason.
   */
  const sentInitialPrompt = useRef(false);
  useEffect(() => {
    if (sentInitialPrompt.current) return;
    const initial = promptParam?.trim();
    if (!initial) return;
    sentInitialPrompt.current = true;
    handleSendText(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptParam]);

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
            uploadFile={uploadFileForChat}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter.home,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderFaint,
  },
  headerText: { gap: spacing.xs },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
