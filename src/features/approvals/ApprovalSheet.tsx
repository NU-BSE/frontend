import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import type { PendingApproval } from '@/agent/types';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

import { ApprovalPreview } from './ApprovalPreview';
import { describeApproval } from './approvalText';

export interface ApprovalSheetProps {
  approval: PendingApproval;
  /** True while the approved payload is executing. */
  busy?: boolean;
  onApprove(): void;
  onReject(): void;
}

/**
 * The human-confirmation gate for external side effects.
 *
 * External side effects and destructive actions require explicit
 * confirmation; the approval is bound to the exact payload shown here, and
 * cancelling returns a `user_denied` tool result to the model. The LLM can
 * never approve its own action — only this sheet can.
 */
export function ApprovalSheet({
  approval,
  busy = false,
  onApprove,
  onReject,
}: ApprovalSheetProps) {
  const description = describeApproval(approval.toolName, approval.args);

  return (
    <View style={styles.sheet}>
      <Text variant="tag" tone="brand" uppercase>
        Needs your confirmation
      </Text>
      <Text variant="headline" style={styles.title}>
        {description.title}
      </Text>

      <ApprovalPreview fields={description.fields} />

      <View style={styles.actions}>
        <Button
          label="Cancel"
          variant="secondary"
          disabled={busy}
          onPress={onReject}
          style={styles.action}
        />
        <Button
          label={description.confirmLabel}
          variant="primary"
          loading={busy}
          onPress={onApprove}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  title: { marginTop: -spacing.xs },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  action: { flex: 1 },
});
