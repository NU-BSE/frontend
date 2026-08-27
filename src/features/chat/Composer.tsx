import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
/*
 * The three arrow-right exports are byte-identical; the colour in each name is
 * historical, since every one paints with `currentColor`.
 */
import ArrowRight from '@assets/icons/arrow-right-gray.svg';
import Paperclip from '@assets/icons/paperclip.svg';
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
              styles.circle,
              styles.filled,
              disabled && styles.actionDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="headline" tone="inverse">
              ◉
            </Text>
          </Pressable>
        ) : null}

        {/*
          The field and the attach control share one bordered box, so "+" reads
          as part of the input rather than as a third button competing with the
          two round ones beside it.
        */}
        <View style={styles.field}>
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
            accessibilityLabel="Attach files"
            onPress={() => void pick()}
            disabled={disabled}
            // The glyph is small; the touch target must not be.
            hitSlop={8}
            style={({ pressed }) => [
              styles.attachInline,
              disabled && styles.actionDisabled,
              pressed && styles.pressed,
            ]}
          >
            {/*
              Not square: the export is 110.27 × 122.88, so width and height
              are both given rather than letting a square box squash it.
            */}
            <Icon source={Paperclip} size={16} height={18} color={palette.textMuted} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Stop generating' : 'Send message'}
          onPress={busy ? onStop : () => void send()}
          disabled={!busy && !canSend}
          style={({ pressed }) => [
            styles.circle,
            busy ? styles.stop : styles.filled,
            !busy && !canSend && styles.actionDisabled,
            pressed && styles.pressed,
          ]}
        >
          {busy ? (
            <Text variant="headline" tone="inverse">
              ■
            </Text>
          ) : (
            <Icon source={ArrowRight} size={18} color={palette.onBrand} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Vertical padding on the first line of the input.
 *
 * (MIN_TOUCH_TARGET - body line height) / 2 — so the field is exactly one
 * touch target tall with one line in it, and the first line's centre lands on
 * the centre of the "+" beside it.
 */
const FIRST_LINE_PADDING = (MIN_TOUCH_TARGET - typography.body.lineHeight) / 2;

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
  /**
   * Both round controls.
   *
   * A circle rather than a rounded rectangle so the two actions read as
   * controls attached to the field, not as a third and fourth box competing
   * with it. The radius is half the touch target, which is what makes it a
   * circle at any future size rather than a pill.
   */
  circle: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  filled: { backgroundColor: palette.brand },
  stop: { backgroundColor: palette.textSecondary },
  /** The bordered box that holds "+" and the text together. */
  field: {
    flex: 1,
    flexDirection: 'row',
    /*
     * Pinned to the top so "+" stays on the first line as the field grows,
     * rather than sliding down to sit beside the last line the user typed.
     */
    alignItems: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    maxHeight: 132,
    backgroundColor: palette.canvas,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.borderFaint,
    paddingLeft: spacing.md,
  },
  attachInline: {
    // Narrower than a full target, since hitSlop carries the touch area and a
    // 48pt column would push the text noticeably off-centre in the field.
    width: 36,
    /*
     * A full touch target tall, and the same height the first line occupies —
     * FIRST_LINE_HEIGHT below is the input's own first line, so the glyph and
     * the first character share a centre line instead of being a few pixels
     * apart.
     */
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    // Growth is capped by the field; the input itself must be free to fill it.
    maxHeight: 132,
    color: palette.textPrimary,
    /*
     * Chosen, not guessed: this plus half the body line height puts the first
     * line's centre exactly on the "+" glyph's centre, and twice this plus the
     * line height is the 48pt touch target the field starts at.
     */
    paddingVertical: FIRST_LINE_PADDING,
    ...typography.body,
  },
  actionDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
