import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import type { AttachmentStatus, ChatAttachment, ChatSendInput } from '@/agent/types';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/files/attachmentPolicy';
import { pickAttachments } from '@/files/attachments';
import { AttachmentCard } from './AttachmentCard';
import {
  MIN_TOUCH_TARGET,
  palette,
  radius,
  shadow,
  spacing,
  typography,
} from '@/theme/tokens';

interface DraftAttachment {
  attachment: ChatAttachment;
  status: AttachmentStatus;
}

export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
  onVoice,
}: {
  /** Called with the final payload after any required upload has completed. */
  onSend: (input: ChatSendInput) => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  /**
   * Opens the spoken conversation. Omitted when this build has no speech
   * recognition, in which case no mic is shown at all — an inert mic button
   * is worse than none.
   */
  onVoice?: () => void;
}) {
  const [value, setValue] = useState('');
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const trimmed = value.trim();
  const canSend =
    (trimmed.length > 0 || drafts.length > 0) && !busy && !disabled;

  const pick = useCallback(async () => {
    setNotice(null);
    const result = await pickAttachments();
    if (result.error) setNotice(result.error);

    const room = MAX_ATTACHMENTS_PER_MESSAGE - drafts.length;
    if (result.attachments.length === 0 || room <= 0) {
      if (room <= 0) {
        setNotice(
          `You can attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`,
        );
      }
      return;
    }

    const added = result.attachments.slice(0, room).map((attachment) => ({
      attachment,
      status: 'ready' as AttachmentStatus,
    }));
    if (result.attachments.length > room) {
      setNotice(
        `Only ${room} more file${room === 1 ? '' : 's'} can be added.`,
      );
    }
    setDrafts((current) => [...current, ...added]);
  }, [drafts.length]);

  const remove = useCallback((id: string) => {
    setDrafts((current) => current.filter((d) => d.attachment.id !== id));
  }, []);

  /**
   * Hands the typed text and the local attachments to the chat layer.
   *
   * Nothing is uploaded. The chat layer reads each file on the device and
   * folds its text into the message, so there is no upload to await, fail or
   * retry here — which is why this is synchronous where it used to have an
   * upload phase, a failure notice and a per-file Retry.
   */
  const send = useCallback(() => {
    if (!canSend) return;
    setNotice(null);
    onSend({ text: trimmed, attachments: drafts.map((d) => d.attachment) });
    setValue('');
    setDrafts([]);
  }, [canSend, drafts, onSend, trimmed]);

  return (
    <View style={styles.root}>
      {drafts.length > 0 ? (
        <View style={styles.chips}>
          {drafts.map((draft) => (
            <AttachmentCard
              key={draft.attachment.id}
              attachment={draft.attachment}
              status={draft.status}
              onRemove={() => remove(draft.attachment.id)}
            />
          ))}
        </View>
      ) : null}

      {notice ? (
        <Text variant="bodySmall" tone="danger" style={styles.notice}>
          {notice}
        </Text>
      ) : null}

      <View style={styles.row}>
        {onVoice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Speak to Creepy"
            onPress={onVoice}
            disabled={disabled}
            style={({ pressed }) => [
              styles.attach,
              disabled && styles.actionDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="headline" tone="brand">
              ◉
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach files"
          onPress={() => void pick()}
          disabled={disabled}
          style={({ pressed }) => [
            styles.attach,
            disabled && styles.actionDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text variant="headline" tone="brand">
            +
          </Text>
        </Pressable>

        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Say something…"
          placeholderTextColor={palette.textMuted}
          multiline
          maxLength={2000}
          editable={!disabled}
          onSubmitEditing={() => void send()}
          submitBehavior="submit"
          returnKeyType="send"
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Stop generating' : 'Send message'}
          onPress={busy ? onStop : () => void send()}
          disabled={!busy && !canSend}
          style={({ pressed }) => [
            styles.action,
            busy ? styles.stop : styles.send,
            !busy && !canSend && styles.actionDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text variant="labelSmall" tone="inverse">
            {busy ? 'Stop' : 'Send'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.borderFaint,
    paddingTop: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  notice: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
  },
  attach: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandWash,
  },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    // Caps growth at roughly five lines so the transcript is never squeezed out.
    maxHeight: 132,
    color: palette.textPrimary,
    backgroundColor: palette.canvas,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderFaint,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
  },
  action: {
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  send: { backgroundColor: palette.brand },
  stop: { backgroundColor: palette.textSecondary },
  actionDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
