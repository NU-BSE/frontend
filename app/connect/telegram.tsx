import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { palette, radius, spacing } from '@/theme/tokens';
import { getCurrentRegistry, getLocalMcpRuntime } from '@/mcp/runtime-singleton';
import { useConnectConnector } from '@/connections/useConnections';
import type { TdlibAdapter, TdlibAuthState } from '@mobile-agent/connector-telegram';
import { getTelegramAdapter } from '@mobile-agent/connector-telegram';

export default function TelegramAuthScreen() {
  const [adapter, setAdapter] = useState<TdlibAdapter | null>(null);
  const [authState, setAuthState] = useState<TdlibAuthState>({ type: 'not_initialized' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const connect = useConnectConnector();
  const completingRef = useRef(false);
  const mountedRef = useRef(true);
  const cleanupRef = useRef<() => void>(() => {});

  const completeConnect = useCallback(
    async () => {
      if (completingRef.current) return;
      completingRef.current = true;
      try {
        await connect.mutateAsync('telegram-user');
        if (mountedRef.current) router.back();
      } catch (err) {
        completingRef.current = false;
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : 'Failed to create connection record.',
          );
        }
      }
    },
    [connect],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let unsub: (() => void) | undefined;

    void (async () => {
      try {
        // Ensure the MCP runtime exists before we try to get a connector.
        await getLocalMcpRuntime();
        if (cancelled) return;

        const registry = getCurrentRegistry();
        if (!registry) {
          throw new Error('MCP runtime did not provide a connector registry.');
        }

        const connector = registry.get('telegram-user');
        if (!connector) {
          throw new Error('Telegram connector is not available in this build.');
        }

        const adapter = getTelegramAdapter(connector);
        if (!adapter) {
          throw new Error('Telegram TDLib adapter is unavailable.');
        }

        if (cancelled) return;
        setAdapter(adapter);

        await adapter.initialize();

        if (cancelled) return;

        if (adapter.getAuthState().type === 'ready') {
          setInitializing(false);
          await completeConnect();
          return;
        }

        setInitializing(false);

        unsub = adapter.setAuthStateListener((state) => {
          setAuthState(state);
          setLoading(false);

          if (state.type === 'ready' && !cancelled) {
            void completeConnect();
          }
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to initialize Telegram.',
          );
          setInitializing(false);
          setLoading(false);
        }
      }
    })();

    cleanupRef.current = () => {
      cancelled = true;
      unsub?.();
      setCode('');
      setPassword('');
    };

    return () => {
      mountedRef.current = false;
      cleanupRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRequestPhone = useCallback(async () => {
    if (!adapter) return;
    setError(null);
    setLoading(true);
    try {
      await adapter.requestPhoneNumber(phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit phone number.');
      setLoading(false);
    }
  }, [adapter, phone]);

  const handleSubmitCode = useCallback(async () => {
    if (!adapter) return;
    setError(null);
    setLoading(true);
    try {
      await adapter.submitAuthCode(code);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code.');
      setLoading(false);
    }
  }, [adapter, code]);

  const handleSubmitPassword = useCallback(async () => {
    if (!adapter) return;
    setError(null);
    setLoading(true);
    try {
      await adapter.submitPassword(password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid password.');
      setLoading(false);
    }
  }, [adapter, password]);

  const handleCancel = useCallback(() => {
    cleanupRef.current();
    router.back();
  }, []);

  if (initializing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={palette.brand} />
        <Text variant="body" tone="secondary" style={styles.status}>
          Initializing Telegram…
        </Text>
      </View>
    );
  }

  if (!adapter) {
    return (
      <View style={styles.container}>
        <Text variant="body" tone="danger" style={styles.description}>
          {error ?? 'Telegram is not available.'}
        </Text>
        <Button label="Back" onPress={handleCancel} />
      </View>
    );
  }

  const expectedCodeLength =
    authState.type === 'wait_code'
      ? authState.codeLength ?? 5
      : 5;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.form}>
        <Text variant="headline" style={styles.title}>
          {getStepTitle(authState.type)}
        </Text>

        {authState.type === 'wait_phone_number' || authState.type === 'initializing' ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              Enter your phone number in international format.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="+7 701 234 56 78"
              placeholderTextColor={palette.textFaint}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              autoFocus
              editable={!loading}
            />
            <Button
              label={loading ? 'Sending…' : 'Continue'}
              onPress={handleRequestPhone}
              disabled={loading || phone.length < 5}
            />
          </>
        ) : authState.type === 'wait_code' ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              Enter the verification code sent to your Telegram account
              {authState.codeLength ? ` (${authState.codeLength} digits)` : ''}.
            </Text>
            <TextInput
              style={styles.input}
              placeholder={Array.from({ length: expectedCodeLength }).fill('0').join('')}
              placeholderTextColor={palette.textFaint}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
              maxLength={expectedCodeLength}
              autoFocus
              editable={!loading}
            />
            <Button
              label={loading ? 'Verifying…' : 'Verify'}
              onPress={handleSubmitCode}
              disabled={loading || code.length < expectedCodeLength}
            />
          </>
        ) : authState.type === 'wait_password' ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              Enter your Telegram two-factor authentication password
              {authState.passwordHint ? ` (hint: ${authState.passwordHint})` : ''}.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={palette.textFaint}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoFocus
              editable={!loading}
            />
            <Button
              label={loading ? 'Verifying…' : 'Verify'}
              onPress={handleSubmitPassword}
              disabled={loading || password.length === 0}
            />
          </>
        ) : authState.type === 'ready' ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={palette.brand} />
            <Text variant="body" tone="secondary" style={styles.status}>
              Creating connection…
            </Text>
          </View>
        ) : authState.type === 'error' ? (
          <>
            <Text variant="body" tone="danger" style={styles.description}>
              {authState.message}
            </Text>
            <Button label="Back" onPress={handleCancel} />
          </>
        ) : (
          <Text variant="body" tone="secondary" style={styles.description}>
            Waiting for Telegram…
          </Text>
        )}

        {error ? (
          <Text variant="bodySmall" tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <View style={styles.cancelWrap}>
          <Button
            label="Cancel"
            variant="ghost"
            onPress={handleCancel}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function getStepTitle(stateType: string): string {
  switch (stateType) {
    case 'not_initialized':
    case 'initializing':
      return 'Connect Telegram';
    case 'wait_phone_number':
      return 'Your phone number';
    case 'wait_code':
      return 'Verification code';
    case 'wait_password':
      return 'Two-factor password';
    case 'ready':
      return 'Connected!';
    case 'logging_out':
      return 'Logging out…';
    case 'closed':
      return 'Session ended';
    case 'error':
      return 'Connection error';
    default:
      return 'Telegram';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    backgroundColor: palette.canvas,
    padding: spacing.lg,
  },
  form: { gap: spacing.md },
  title: { textAlign: 'center' },
  description: { textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 18,
    color: palette.textPrimary,
    backgroundColor: palette.surface,
    textAlign: 'center',
  },
  error: { textAlign: 'center' },
  status: { textAlign: 'center', marginTop: spacing.md },
  centered: { alignItems: 'center', gap: spacing.sm },
  cancelWrap: { alignItems: 'center' },
});
