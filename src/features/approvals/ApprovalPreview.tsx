import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { palette, radius, spacing } from '@/theme/tokens';

import type { ApprovalField } from './approvalText';

/**
 * Renders the payload fields of a pending approval — recipient, message,
 * target — so the user confirms the exact action, not a vague one.
 */
export function ApprovalPreview({ fields }: { fields: ApprovalField[] }) {
  if (fields.length === 0) return null;

  return (
    <View style={styles.preview}>
      {fields.map((field) => (
        <View key={field.label} style={styles.field}>
          <Text variant="bodySmall" tone="muted">
            {field.label}
          </Text>
          <Text variant="body" tone="primary" style={styles.value}>
            {field.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    gap: spacing.sm,
    backgroundColor: palette.canvas,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderFaint,
    padding: spacing.md,
  },
  field: { gap: 2 },
  value: { flexWrap: 'wrap' },
});
