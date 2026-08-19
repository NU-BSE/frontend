import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import type { AttachmentStatus, ChatAttachment } from '@/agent/types';
import { formatFileSize } from '@/files/attachmentPolicy';
import { palette, radius, spacing } from '@/theme/tokens';

const KIND_ICON: Record<ChatAttachment['kind'], string> = {
  image: '🖼',
  document: '📄',
  audio: '🎵',
  video: '🎬',
  other: '📎',
};

/**
 * Reusable attachment row/card.
 *
 * Used read-only inside the transcript (user bubble) and interactively inside
 * the composer draft (with `onRemove`/`onRetry` + upload `status`). Never
 * fetches or decodes content — it only shows metadata and, for images, a
 * thumbnail when a local URI is still available.
 */
export function AttachmentCard({
  attachment,
  status,
  onRemove,
  onRetry,
}: {
  attachment: ChatAttachment;
  status?: AttachmentStatus;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  const showThumbnail = attachment.kind === 'image' && Boolean(attachment.uri);

  const subtitle = status === 'uploading'
    ? 'Uploading…'
    : status === 'failed'
      ? 'Upload failed'
      : formatFileSize(attachment.size);

  return (
    <View style={styles.card}>
      {showThumbnail ? (
        <Image source={{ uri: attachment.uri }} style={styles.thumb} />
      ) : (
        <View style={styles.iconWell}>
          <Text variant="body">{KIND_ICON[attachment.kind]}</Text>
        </View>
      )}

      <View style={styles.meta}>
        <Text variant="labelSmall" numberOfLines={1} style={styles.name}>
          {attachment.name}
        </Text>
        <Text
          variant="bodySmall"
          tone={status === 'failed' ? 'danger' : 'muted'}
        >
          {subtitle}
        </Text>
      </View>

      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry uploading ${attachment.name}`}
          onPress={onRetry}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text variant="labelSmall" tone="brand">
            Retry
          </Text>
        </Pressable>
      ) : null}

      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${attachment.name}`}
          onPress={onRemove}
          hitSlop={8}
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
        >
          <Text variant="label" tone="muted">
            ×
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: palette.neutralWash,
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandWash,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  name: { color: palette.textPrimary },
  remove: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
