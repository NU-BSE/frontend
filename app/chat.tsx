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
import type { UIMessage } from '@tanstack/ai/client';

import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useCreepyChat } from '@/ai/useCreepyChat';
import { Composer } from '@/features/chat/Composer';
import { DeepLinkBar } from '@/features/chat/DeepLinkBar';
import { MessageBubble, messageText } from '@/features/chat/MessageBubble';
import { SuggestionChips } from '@/features/chat/SuggestionChips';
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
  const listRef = useRef<FlatList<UIMessage>>(null);

  const { scenario: scenarioParam } = useLocalSearchParams<{
    scenario?: string;
  }>();
  const scenario = getScenario(scenarioParam);

  const {
    messages,
    sendMessage,
    stop,
    isLoading,
    error,
    engineOrigin,
    engineStatus,
    degradedReason,
  } = useCreepyChat({ threadId: scenario?.id });

  const save = useMutation({
    mutationFn: appendHistory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['history'] }),
  });

  // Persist each completed exchange once. Keyed on the assistant message id
  // so a re-render mid-stream cannot write a partial reply.
  const savedIds = useRef(new Set<string>());
  useEffect(() => {
    if (isLoading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || savedIds.current.has(last.id)) return;

    const reply = messageText(last).trim();
    if (!reply) return;

    const prompt = [...messages].reverse().find((m) => m.role === 'user');
    savedIds.current.add(last.id);
    save.mutate({
      threadId: scenario?.id ?? 'general',
      category: scenario?.title ?? 'General',
      prompt: prompt ? messageText(prompt) : '',
      reply,
      engine: engineOrigin,
    });
  }, [engineOrigin, isLoading, messages, save, scenario]);

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      void sendMessage(text);
      requestAnimationFrame(scrollToEnd);
    },
    [scrollToEnd, sendMessage],
  );

  const suggestions = useMemo(
    () => scenario?.suggestions ?? GENERAL_SUGGESTIONS,
    [scenario],
  );

  const statusLine =
    engineStatus === 'preparing'
      ? 'Waking up…'
      : engineStatus === 'degraded'
        ? (degradedReason ?? 'Fell back to offline preview')
        : ORIGIN_LABEL[engineOrigin];

  const isEmpty = messages.length === 0;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="headline">
            {scenario ? scenario.title : 'Ask Creepy'}
          </Text>
          <Text
            variant="tag"
            tone={engineStatus === 'degraded' ? 'danger' : 'faint'}
            uppercase
          >
            {statusLine}
          </Text>
        </View>

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

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(message) => message.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <MessageBubble
              message={item}
              streaming={
                isLoading &&
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
          {/* Suggestions stay available after the first exchange — a
              conversation that has started still benefits from a nudge. */}
          <SuggestionChips
            suggestions={suggestions}
            onSelect={handleSend}
            disabled={isLoading || engineStatus === 'preparing'}
          />

          {scenario ? <DeepLinkBar links={scenario.deepLinks} /> : null}

          {error ? (
            <Text variant="bodySmall" tone="danger">
              {error.message}
            </Text>
          ) : null}
        </View>

        <View style={{ paddingBottom: insets.bottom }}>
          <Composer
            onSend={handleSend}
            onStop={stop}
            busy={isLoading}
            disabled={engineStatus === 'preparing'}
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
