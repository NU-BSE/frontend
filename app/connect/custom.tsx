import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { DetectionSummary } from '@/features/connections/customMcp/DetectionSummary';
import { ServerRunner } from '@/features/connections/customMcp/ServerRunner';
import { CustomMcpError, hasResolverHost } from '@/mcp/custom/resolverClient';
import {
  missingEnvironment,
  statusOf,
  type CustomMcpServer,
  type CustomMcpSource,
  type DetectedMcp,
} from '@/mcp/custom/types';
import {
  useAddCustomServer,
  useCustomServers,
  useRemoveCustomServer,
  useReresolveServer,
  useResolveSource,
  useSetEnvironmentValue,
} from '@/mcp/custom/useCustomServers';
import { gutter, palette, radius, spacing, typography } from '@/theme/tokens';

const STATUS_COPY = {
  unresolved: 'Not translated yet',
  'needs-configuration': 'Needs configuration',
  ready: 'Ready',
} as const;

/**
 * Add an MCP server the app does not ship with.
 *
 * The user pastes a repository URL. The backend clones it, works out the
 * runtime and the environment it needs, and bundles it into a single
 * JavaScript file — the server then runs *here*, in the app's own runtime.
 * The backend is a compiler, not a host: once a bundle is downloaded the
 * server keeps working with the backend unreachable, and no tool call is ever
 * proxied off the phone.
 *
 * Translation is a separate step from adding on purpose. A URL that turns out
 * not to be an MCP server — or to be a Python one, which this device cannot
 * run whatever we do — should say so before it becomes a dead row in the list.
 */
export default function CustomMcpScreen() {
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [detected, setDetected] = useState<DetectedMcp | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: servers, isPending } = useCustomServers();
  const resolve = useResolveSource();
  const add = useAddCustomServer();
  const remove = useRemoveCustomServer();

  const hostConfigured = hasResolverHost();

  const source = useMemo<CustomMcpSource | null>(() => {
    const trimmed = url.trim();
    if (!trimmed) return null;
    const trimmedRef = ref.trim();
    return {
      type: 'repository',
      url: trimmed,
      ...(trimmedRef ? { ref: trimmedRef } : {}),
    };
  }, [url, ref]);

  const onDetect = useCallback(() => {
    if (!source) return;
    setDetected(null);
    resolve.mutate(
      { source },
      { onSuccess: (result) => setDetected(result) },
    );
  }, [resolve, source]);

  const onAdd = useCallback(() => {
    if (!source || !detected) return;
    add.mutate(
      { source, detected },
      {
        onSuccess: (server) => {
          setUrl('');
          setRef('');
          setDetected(null);
          resolve.reset();
          // Straight into configuration when the server needs values: the
          // whole point of detection is knowing what to ask for.
          if (missingEnvironment(server).length > 0) setExpanded(server.id);
        },
      },
    );
  }, [add, detected, resolve, source]);

  const failure = errorOf(resolve.error) ?? errorOf(add.error) ?? errorOf(remove.error);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Custom servers</Text>
        <Text style={styles.lede}>
          Point Creepy at an MCP server repository. It is translated once, then runs on
          this device.
        </Text>

        {!hostConfigured ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>No backend configured</Text>
            <Text style={styles.noticeBody}>
              Translating a server clones its repository and runs its package manager,
              which this device cannot do. Set EXPO_PUBLIC_API_URL. The translated
              server still runs here.
            </Text>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Repository URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://github.com/example/example-mcp"
            placeholderTextColor={palette.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            editable={!resolve.isPending}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Branch, tag or commit (optional)</Text>
          <TextInput
            value={ref}
            onChangeText={setRef}
            placeholder="main"
            placeholderTextColor={palette.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            editable={!resolve.isPending}
          />
        </View>

        <Button
          label={resolve.isPending ? 'Translating…' : 'Translate'}
          onPress={onDetect}
          loading={resolve.isPending}
          disabled={!source || !hostConfigured}
        />

        {failure ? (
          <View style={styles.error}>
            <Text style={styles.errorText}>{failure.message}</Text>
            {failure.hints.map((hint) => (
              <Text key={hint} style={styles.errorHint}>
                {hint}
              </Text>
            ))}
          </View>
        ) : null}

        {detected ? (
          <View style={styles.detected}>
            <DetectionSummary detected={detected} />
            <Button label="Add server" onPress={onAdd} loading={add.isPending} />
          </View>
        ) : null}

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Added</Text>
        {isPending ? (
          <ActivityIndicator color={palette.brand} />
        ) : (servers ?? []).length === 0 ? (
          <Text style={styles.empty}>Nothing added yet.</Text>
        ) : (
          (servers ?? []).map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              expanded={expanded === server.id}
              onToggle={() => setExpanded(expanded === server.id ? null : server.id)}
            />
          ))
        )}

        <Button label="Done" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** One stored server, with its configuration inline when opened. */
function ServerRow({
  server,
  expanded,
  onToggle,
}: {
  server: CustomMcpServer;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = statusOf(server);
  const missing = missingEnvironment(server);
  const reresolve = useReresolveServer();
  const remove = useRemoveCustomServer();

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{server.label}</Text>
          <Text style={styles.rowSource} numberOfLines={1}>
            {server.source.type === 'repository' ? server.source.url : server.source.path}
          </Text>
        </View>
        <View style={[styles.statusChip, status === 'ready' ? styles.statusReady : null]}>
          <Text style={[styles.statusText, status === 'ready' ? styles.statusTextReady : null]}>
            {STATUS_COPY[status]}
          </Text>
        </View>
      </View>

      <Button
        label={expanded ? 'Hide' : missing.length > 0 ? `Configure (${missing.length})` : 'Details'}
        variant="secondary"
        onPress={onToggle}
      />

      {expanded ? (
        <View style={styles.rowBody}>
          {server.detected ? <DetectionSummary detected={server.detected} /> : null}

          {server.detected ? <ServerRunner server={server} /> : null}

          {(server.detected?.requiredEnvironmentVariables ?? []).map((variable) => (
            <EnvironmentField
              key={variable.name}
              serverId={server.id}
              name={variable.name}
              required={variable.required}
              {...(variable.description !== undefined
                ? { description: variable.description }
                : {})}
              configured={server.configuredEnvironment.includes(variable.name)}
            />
          ))}

          <Button
            label={reresolve.isPending ? 'Translating…' : 'Translate again'}
            variant="secondary"
            loading={reresolve.isPending}
            onPress={() => reresolve.mutate({ id: server.id, source: server.source })}
          />
          <Button
            label="Remove"
            variant="ghost"
            loading={remove.isPending}
            onPress={() => remove.mutate(server.id)}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One environment variable.
 *
 * A stored value is never read back into the field. The vault can return it,
 * but putting a token into React state to render it means it lives in memory,
 * in any state inspector, and in a screenshot; "Saved" plus the ability to
 * replace it covers what a user actually needs.
 */
function EnvironmentField({
  serverId,
  name,
  required,
  description,
  configured,
}: {
  serverId: string;
  name: string;
  required: boolean;
  description?: string;
  configured: boolean;
}) {
  const [value, setValue] = useState('');
  const save = useSetEnvironmentValue();

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {name}
        {required ? '' : ' (optional)'}
        {configured ? ' — saved' : ''}
      </Text>
      {description ? <Text style={styles.fieldHint}>{description}</Text> : null}
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={configured ? 'Replace stored value' : 'Value'}
        placeholderTextColor={palette.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
      />
      <Button
        label={value.length === 0 && configured ? 'Clear' : 'Save'}
        variant="secondary"
        loading={save.isPending}
        disabled={value.length === 0 && !configured}
        onPress={() =>
          save.mutate({ id: serverId, name, value }, { onSuccess: () => setValue('') })
        }
      />
    </View>
  );
}

function errorOf(error: unknown): { message: string; hints: readonly string[] } | null {
  if (!error) return null;
  if (error instanceof CustomMcpError) return { message: error.message, hints: error.hints };
  if (error instanceof Error) return { message: error.message, hints: [] };
  return { message: 'Something went wrong.', hints: [] };
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: gutter.screen, gap: spacing.lg, paddingBottom: spacing.xxxl },
  title: { ...typography.display, color: palette.textPrimary },
  lede: { ...typography.body, color: palette.textSecondary },
  notice: {
    backgroundColor: palette.goldWash,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  noticeTitle: { ...typography.label, color: palette.textPrimary },
  noticeBody: { ...typography.bodySmall, color: palette.textSecondary },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.labelSmall, color: palette.textMuted },
  fieldHint: { ...typography.bodySmall, color: palette.textFaint },
  input: {
    ...typography.body,
    color: palette.textPrimary,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  error: {
    backgroundColor: palette.surface,
    borderLeftWidth: 3,
    borderLeftColor: palette.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorText: { ...typography.body, color: palette.danger },
  errorHint: { ...typography.bodySmall, color: palette.textSecondary },
  detected: { gap: spacing.md },
  divider: { height: 1, backgroundColor: palette.borderSoft },
  sectionTitle: { ...typography.headline, color: palette.textPrimary },
  empty: { ...typography.body, color: palette.textMuted },
  row: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowText: { flex: 1, gap: spacing.xs },
  rowTitle: { ...typography.cardTitle, color: palette.textPrimary },
  rowSource: { ...typography.bodySmall, color: palette.textMuted },
  statusChip: {
    backgroundColor: palette.neutralChip,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusReady: { backgroundColor: palette.brandWash },
  statusText: { ...typography.labelSmall, color: palette.textSecondary },
  statusTextReady: { color: palette.brand },
  rowBody: { gap: spacing.md },
});
