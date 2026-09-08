import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { UIMessage } from '@tanstack/ai/client';

import { Text } from '@/components/Text';
import { palette, radius, spacing } from '@/theme/tokens';

/** Concatenates the text parts of a UIMessage; tool/thinking parts are not
 *  rendered in the feed. */
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

  // An assistant message with no text yet is the gap between send and first
  // token — render the pending state rather than an empty bubble.
  if (!text && !isUser) {
    return (
      <View style={[styles.bubble, styles.assistant, styles.pending]}>
        <Text variant="caption" tone="muted">
          listening…
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
      <Text variant="body" tone={isUser ? 'primary' : 'secondary'}>
        {text}
        {streaming ? <Text tone="accent">▍</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  user: {
    alignSelf: 'flex-end',
    backgroundColor: palette.accentMuted,
    borderBottomRightRadius: radius.sm,
  },
  assistant: {
    alignSelf: 'flex-start',
    backgroundColor: palette.surfaceRaised,
    borderBottomLeftRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
  },
  pending: { paddingVertical: spacing.md },
});
