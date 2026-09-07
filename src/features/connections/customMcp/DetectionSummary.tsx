import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { palette, radius, spacing, typography } from '@/theme/tokens';
import type { DetectedMcp } from '@/mcp/custom/types';

const RUNTIME_LABEL: Record<DetectedMcp['runtime'], string> = {
  NODE: 'Node.js',
  PYTHON: 'Python',
  JVM: 'JVM',
  OTHER: 'Unrecognised runtime',
};

/**
 * What the backend found and built, shown before anything is saved.
 *
 * The evidence list is the point of this card. A detector reports *why* it
 * matched — "package.json: bin.mcp-server", "pyproject.toml: project.scripts"
 * — and a user deciding whether to trust a repository they pasted is better
 * served by that than by a confidence number on its own. The number is shown
 * too, because a low-confidence match that happens to be right and a
 * high-confidence one both look identical without it.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DetectionSummary({ detected }: { detected: DetectedMcp }) {
  const percent = Math.round(detected.confidence * 100);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.runtime}>{RUNTIME_LABEL[detected.runtime]}</Text>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{percent}% match</Text>
        </View>
      </View>

      <Text style={styles.command} numberOfLines={2}>
        {detected.entrypoint ?? 'bundled'} → {formatBytes(detected.bytes)}
      </Text>

      <Text style={styles.note}>Translated to run on this device.</Text>

      {detected.evidence.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Why this matched</Text>
          {detected.evidence.map((line) => (
            <Text key={line} style={styles.evidence}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {detected.requiredEnvironmentVariables.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Needs</Text>
          {detected.requiredEnvironmentVariables.map((variable) => (
            <Text key={variable.name} style={styles.evidence}>
              {variable.name}
              {variable.required ? '' : ' (optional)'}
              {variable.description ? ` — ${variable.description}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  runtime: { ...typography.cardTitle, color: palette.textPrimary, flexShrink: 1 },
  chip: {
    backgroundColor: palette.brandWash,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: { ...typography.labelSmall, color: palette.brand },
  command: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    backgroundColor: palette.neutralWash,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  note: { ...typography.bodySmall, color: palette.textMuted },
  section: { gap: spacing.xs },
  sectionLabel: { ...typography.labelSmall, color: palette.textMuted },
  evidence: { ...typography.bodySmall, color: palette.textSecondary },
});
