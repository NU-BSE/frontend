import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { UIMessage } from '@tanstack/ai/client';

import { Text } from '@/components/Text';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

import { InlineBold } from './RichText';

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { content: string }).content)
    .join('');
}

export function MessageBubble({
  message,
  streaming = false,
}: {
  message: UIMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const text = messageText(message);

  // The gap between send and first token. Rendering an empty bubble here
  // reads as a bug, so the pending state is explicit.
  if (!text && !isUser) {
    return (
      <View style={[styles.bubble, styles.assistant]}>
        <Text variant="bodySmall" tone="muted">
          listening…
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
      <Text variant="body" tone={isUser ? 'inverse' : 'primary'}>
        {/* The user's own text is shown exactly as typed; only the model
            emits Markdown. */}
        {isUser ? text : <InlineBold>{text}</InlineBold>}
        {streaming ? <Text tone={isUser ? 'inverse' : 'brand'}>▍</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
  },
  user: {
    alignSelf: 'flex-end',
    backgroundColor: palette.brand,
    borderBottomRightRadius: radius.sm,
  },
  assistant: {
    alignSelf: 'flex-start',
    backgroundColor: palette.surface,
    borderBottomLeftRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    ...shadow.card,
  },
});
