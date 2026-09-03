import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { McpSandbox } from '@/mcp/custom/sandbox/McpSandbox';
import { useSandboxedServer } from '@/mcp/custom/sandbox/useSandboxedServer';
import { missingEnvironment, type CustomMcpServer } from '@/mcp/custom/types';
import { palette, radius, spacing, typography } from '@/theme/tokens';

const PHASE_COPY = {
  idle: 'Not running',
  loading: 'Fetching and verifying the bundle…',
  starting: 'Starting in the sandbox…',
  ready: 'Running',
  failed: 'Failed to start',
} as const;

/**
 * Starts one translated server and reports what it can do.
 *
 * Running is opt-in rather than automatic. A translated server is third-party
 * code, and starting every configured one at launch would evaluate all of them
 * before the user had any reason to. It is also the honest default given where
 * the sandbox lives: a WebView that must be mounted, so a server runs while
 * this screen holds it and stops when the screen goes away.
 */
export function ServerRunner({ server }: { server: CustomMcpServer }) {
  const [requested, setRequested] = useState(false);
  const { state, onReady, onLog, onError } = useSandboxedServer(requested ? server : null);
  const [tools, setTools] = useState<string[] | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);

  const missing = missingEnvironment(server);

  useEffect(() => {
    if (state.phase !== 'ready' || !state.client) return;
    let cancelled = false;
    void state.client
      .listTools()
      .then((listed) => {
        if (!cancelled) setTools(listed.map((tool) => tool.name));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setToolError(error instanceof Error ? error.message : 'Could not list tools');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.client]);

  const stop = useCallback(() => {
    setRequested(false);
    setTools(null);
    setToolError(null);
  }, []);

  if (!server.detected) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Sandbox</Text>
        <Text style={styles.phase}>{PHASE_COPY[state.phase]}</Text>
      </View>

      {missing.length > 0 ? (
        <Text style={styles.note}>
          {missing.map((variable) => variable.name).join(', ')} still needed. The server
          will start, but is likely to fail when it runs.
        </Text>
      ) : null}

      {state.error ? <Text style={styles.error}>{state.error.message}</Text> : null}

      {tools ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {tools.length === 1 ? '1 tool' : `${tools.length} tools`}
          </Text>
          {tools.map((name) => (
            <Text key={name} style={styles.tool}>
              {name}
            </Text>
          ))}
        </View>
      ) : null}

      {toolError ? <Text style={styles.error}>{toolError}</Text> : null}

      {state.logs.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Server output</Text>
          {state.logs.slice(-5).map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.log} numberOfLines={2}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {state.phase === 'loading' || state.phase === 'starting' ? (
        <ActivityIndicator color={palette.brand} />
      ) : null}

      <Button
        label={requested ? 'Stop' : 'Start'}
        variant="secondary"
        onPress={() => (requested ? stop() : setRequested(true))}
      />

      {/*
        The sandbox itself: zero-sized, and only mounted once the bundle has
        been fetched and its digest checked. Rendering it earlier would mean
        evaluating code that had not been verified.
      */}
      {requested && state.bundleBase64 ? (
        <McpSandbox
          bundleBase64={state.bundleBase64}
          environment={state.environment}
          onReady={onReady}
          onLog={onLog}
          onError={onError}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.canvas,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { ...typography.label, color: palette.textPrimary },
  phase: { ...typography.bodySmall, color: palette.textMuted },
  note: { ...typography.bodySmall, color: palette.gold },
  error: { ...typography.bodySmall, color: palette.danger },
  section: { gap: spacing.xs },
  sectionLabel: { ...typography.labelSmall, color: palette.textMuted },
  tool: { ...typography.bodySmall, color: palette.textSecondary },
  log: { ...typography.bodySmall, color: palette.textFaint },
});
