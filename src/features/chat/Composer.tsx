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
  uploadFile,
  onVoice,
}: {
  /** Called with the final payload after any required upload has completed. */
  onSend: (input: ChatSendInput) => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  /**
   * Uploads a local attachment and returns the backend file id. Provided only
   * in remote mode — local/text-only modes leave it undefined and never
   * upload anything to a server.
   */
  uploadFile?: (attachment: ChatAttachment) => Promise<{ id: string }>;
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
  const [sending, setSending] = useState(false);

  const trimmed = value.trim();
  const canSend =
    (trimmed.length > 0 || drafts.length > 0) && !busy && !disabled && !sending;

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

  const uploadDraft = useCallback(
    async (draft: DraftAttachment): Promise<DraftAttachment> => {
      if (!uploadFile || draft.attachment.remoteId) return draft;
      setDrafts((current) =>
        current.map((d) =>
          d.attachment.id === draft.attachment.id
            ? { ...d, status: 'uploading' }
            : d,
        ),
      );
      // Privacy: dev logs carry name + size only — never file content, base64
      // or an authorization token.
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log(
          `[attachments] uploading name=${draft.attachment.name} size=${draft.attachment.size}`,
        );
      }
      try {
        const uploaded = await uploadFile(draft.attachment);
        if (typeof __DEV__ === 'boolean' && __DEV__) {
          console.log(`[attachments] uploaded id=${uploaded.id}`);
        }
        return {
          attachment: { ...draft.attachment, remoteId: uploaded.id },
          status: 'uploaded',
        };
      } catch {
        return { ...draft, status: 'failed' };
      }
    },
    [uploadFile],
  );

  const retry = useCallback(
    async (id: string) => {
      if (!uploadFile) return;
      const target = drafts.find((d) => d.attachment.id === id);
      if (!target) return;
      const next = await uploadDraft({ ...target, status: 'ready' });
      setDrafts((current) =>
        current.map((d) => (d.attachment.id === id ? next : d)),
      );
    },
    [drafts, uploadDraft, uploadFile],
  );

  const send = useCallback(async () => {
    if (!canSend) return;
    setNotice(null);

    if (drafts.length === 0) {
      onSend({ text: trimmed, attachments: [] });
      setValue('');
      return;
    }

    if (!uploadFile) {
      // Local/text-only runtime: hand over the local attachments unchanged.
      // The agent layer decides whether the model can actually read them and
      // surfaces a clear error when it cannot — it never silently drops them.
      onSend({
        text: trimmed,
        attachments: drafts.map((d) => d.attachment),
      });
      setValue('');
      setDrafts([]);
      return;
    }

    setSending(true);
    const uploaded: DraftAttachment[] = [];
    for (const draft of drafts) {
      uploaded.push(await uploadDraft(draft));
    }
    setDrafts(uploaded);
    setSending(false);

    const failed = uploaded.some((d) => d.status === 'failed');
    if (failed) {
      setNotice('Some files could not be uploaded. Retry or remove them.');
      return;
    }

    onSend({ text: trimmed, attachments: uploaded.map((d) => d.attachment) });
    setValue('');
    setDrafts([]);
  }, [canSend, drafts, onSend, trimmed, uploadDraft, uploadFile]);

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
              onRetry={
                uploadFile && draft.status === 'failed'
                  ? () => void retry(draft.attachment.id)
                  : undefined
              }
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
            disabled={disabled || sending}
            style={({ pressed }) => [
              styles.attach,
              (disabled || sending) && styles.actionDisabled,
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
          disabled={disabled || sending}
          style={({ pressed }) => [
            styles.attach,
            (disabled || sending) && styles.actionDisabled,
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
