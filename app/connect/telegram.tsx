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
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
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
      setEmailCode('');
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

  const handleSubmitEmail = useCallback(async () => {
    if (!adapter) return;
    setError(null);
    setLoading(true);
    try {
      await adapter.submitEmailAddress(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit email.');
      setLoading(false);
    }
  }, [adapter, email]);

  const handleSubmitEmailCode = useCallback(async () => {
    if (!adapter) return;
    setError(null);
    setLoading(true);
    try {
      await adapter.submitEmailCode(emailCode);
      setEmailCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email code.');
      setLoading(false);
    }
  }, [adapter, emailCode]);

  const handleSubmitRegistration = useCallback(async () => {
    if (!adapter) return;
    setError(null);
    setLoading(true);
    try {
      await adapter.submitRegistration(firstName, lastName);
      setFirstName('');
      setLastName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete registration.');
      setLoading(false);
    }
  }, [adapter, firstName, lastName]);

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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.form}>
        <Text variant="headline" style={styles.title}>
          {getStepTitle(authState.type)}
        </Text>

        {authState.type === 'wait_phone_number' ? (
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
              placeholder={authState.codeLength
                ? Array.from({ length: authState.codeLength }).fill('0').join('')
                : '00000'}
              placeholderTextColor={palette.textFaint}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
              maxLength={authState.codeLength ?? 16}
              autoFocus
              editable={!loading}
            />
            <Button
              label={loading ? 'Verifying…' : 'Verify'}
              onPress={handleSubmitCode}
              disabled={
                loading ||
                (authState.codeLength !== undefined
                  ? code.length !== authState.codeLength
                  : code.length === 0)
              }
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
        ) : authState.type === 'wait_email_address' ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              Verify your email address to continue.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="name@example.com"
              placeholderTextColor={palette.textFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              autoFocus
              editable={!loading}
            />
            <Button
              label={loading ? 'Sending…' : 'Continue'}
              onPress={handleSubmitEmail}
              disabled={loading || !email.includes('@')}
            />
          </>
        ) : authState.type === 'wait_email_code' ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              Check your email
              {authState.emailAddressPattern
                ? ` (${authState.emailAddressPattern})`
                : ''}{' '}
              for a verification code
              {authState.codeLength ? ` (${authState.codeLength} digits)` : ''}.
            </Text>
            <TextInput
              style={styles.input}
              placeholder={authState.codeLength
                ? Array.from({ length: authState.codeLength }).fill('0').join('')
                : '000000'}
              placeholderTextColor={palette.textFaint}
              keyboardType="number-pad"
              value={emailCode}
              onChangeText={setEmailCode}
              maxLength={authState.codeLength ?? 16}
              autoFocus
              editable={!loading}
            />
            <Button
              label={loading ? 'Verifying…' : 'Verify'}
              onPress={handleSubmitEmailCode}
              disabled={
                loading ||
                (authState.codeLength !== undefined
                  ? emailCode.length !== authState.codeLength
                  : emailCode.length === 0)
              }
            />
          </>
        ) : authState.type === 'wait_registration' ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              Create your Telegram account.
            </Text>
            {authState.minUserAge ? (
              <Text variant="bodySmall" tone="secondary" style={styles.description}>
                Minimum age required: {authState.minUserAge}
              </Text>
            ) : null}
            {authState.termsOfServiceText ? (
              <>
                <View style={styles.termsBox}>
                  <Text variant="bodySmall" tone="secondary">
                    {authState.termsOfServiceText}
                  </Text>
                </View>
                <View style={styles.checkRow}>
                  <Button
                    label={termsAccepted ? '☑ I accept the Terms of Service' : '☐ I accept the Terms of Service'}
                    variant="ghost"
                    onPress={() => setTermsAccepted(!termsAccepted)}
                  />
                </View>
              </>
            ) : null}
            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor={palette.textFaint}
              value={firstName}
              onChangeText={setFirstName}
              maxLength={64}
              autoFocus
              editable={!loading}
            />
            <TextInput
              style={styles.input}
              placeholder="Last name (optional)"
              placeholderTextColor={palette.textFaint}
              value={lastName}
              onChangeText={setLastName}
              maxLength={64}
              editable={!loading}
            />
            <Button
              label={loading ? 'Creating…' : 'Create account'}
              onPress={handleSubmitRegistration}
              disabled={
                loading ||
                firstName.trim().length === 0 ||
                (!!authState.termsOfServiceText && !termsAccepted)
              }
            />
          </>
        ) : authState.type === 'wait_other_device_confirmation' ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              Open Telegram on a device where you are already signed in
              and confirm this login attempt.
            </Text>
          </>
        ) : authState.type === 'wait_premium_purchase' ? (
          <>
            <Text variant="body" tone="danger" style={styles.description}>
              This Telegram account requires a Premium purchase to log in.
              Creepy.IM does not support this authorization method.
            </Text>
            <Button label="Back" onPress={handleCancel} />
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
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={palette.brand} />
            <Text variant="body" tone="secondary" style={styles.status}>
              {authState.type === 'initializing'
                ? 'Initializing Telegram…'
                : authState.type === 'logging_out'
                  ? 'Logging out…'
                  : authState.type === 'closed'
                    ? 'Session ended'
                    : 'Waiting for Telegram…'}
            </Text>
          </View>
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
    case 'wait_email_address':
      return 'Your email';
    case 'wait_email_code':
      return 'Email verification';
    case 'wait_password':
      return 'Two-factor password';
    case 'wait_registration':
      return 'Create account';
    case 'wait_other_device_confirmation':
      return 'Confirm on another device';
    case 'wait_premium_purchase':
      return 'Premium required';
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
  termsBox: {
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
    maxHeight: 200,
    overflow: 'hidden' as const,
  },
  checkRow: { alignItems: 'center' },
});
