import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import type { AgentMessage } from '@/agent/types';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

import { toolActivityLabel } from './toolLabels';

/**
 * Renders one agent conversation entry. User and assistant text become
 * bubbles; tool calls/results become compact status rows so the timeline
 * shows what the agent actually did ("Searching Telegram chats… done").
 */
export function AgentMessageItem({
  message,
  streaming = false,
}: {
  message: AgentMessage;
  streaming?: boolean;
}) {
  if (message.role === 'user') {
    return (
      <View style={[styles.bubble, styles.user]}>
        <Text variant="body" tone="inverse">
          {message.content}
        </Text>
      </View>
    );
  }

  if (message.role === 'assistant') {
    // Tool-call-only assistant turns are represented by their tool rows.
    if (!message.content) return null;
    return (
      <View style={[styles.bubble, styles.assistant]}>
        <Text variant="body" tone="primary">
          {message.content}
          {streaming ? <Text tone="brand">▍</Text> : null}
        </Text>
      </View>
    );
  }

  // role === 'tool'
  const { result } = message;
  const label = toolActivityLabel(message.toolName);

  if (result.status === 'success') {
    return (
      <View style={styles.stepRow}>
        <Text variant="bodySmall" tone="muted">
          {label} — done
        </Text>
      </View>
    );
  }

  if (result.status === 'user_denied') {
    return (
      <View style={styles.stepRow}>
        <Text variant="bodySmall" tone="muted">
          {label} — cancelled by you
        </Text>
      </View>
    );
  }

  if (result.status === 'error') {
    return (
      <View style={styles.stepRow}>
        <Text variant="bodySmall" tone="danger">
          {label} — failed
        </Text>
      </View>
    );
  }

  return null;
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
  stepRow: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.xs,
  },
});
