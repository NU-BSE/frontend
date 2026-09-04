import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { LocalQrCode } from '@/components/LocalQrCode';
import { gutter, palette, radius, spacing } from '@/theme/tokens';
import { TELEGRAM_CAPABILITY_DESCRIPTIONS } from '@/connections/telegram/scopeCopy';
import { formatInternationalPhone } from '@/connections/telegram/phoneFormat';
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
  const [termsAcceptedKey, setTermsAcceptedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  /*
   * Consent gates initialization, not just the UI. Mounting this screen used
   * to call `adapter.initialize()` immediately, so merely opening it started a
   * real TDLib session before the user had been told anything. Nothing native
   * runs until Continue is pressed.
   */
  const [consented, setConsented] = useState(false);

  /*
   * "Use a different number", which is the only way out of `wait_code`.
   *
   * TDLib keeps its authorization state, so a mistyped number left the session
   * in `wait_code` permanently: Cancel returned to the connectors list, and
   * reopening this screen re-read the same state and showed the same code
   * prompt. There was no path back to the phone field.
   *
   * TDLib itself allows the recovery — setAuthenticationPhoneNumber is
   * documented to work from `authorizationStateWaitCode` — so this shows the
   * phone form over the current state, and submitting re-sends the number.
   * The flag clears on every state change, so the moment Telegram accepts the
   * new number and re-issues `wait_code`, the code screen returns on its own.
   */
  const [changingNumber, setChangingNumber] = useState(false);

  // Acceptance belongs to a specific Terms document. When TDLib re-sends
  // `wait_registration` with changed terms (same state, new document), the key
  // changes and acceptance is derived to false, so it can never transfer to
  // new terms. Never persisted — in-memory only.
  const registrationTermsKey =
    authState.type === 'wait_registration'
      ? [
          authState.termsOfServiceText ?? '',
          authState.minUserAge ?? '',
          authState.showTermsPopup ?? '',
        ].join('|')
      : null;

  const termsAccepted =
    registrationTermsKey !== null &&
    termsAcceptedKey === registrationTermsKey;

  const toggleTermsAccepted = useCallback(() => {
    setTermsAcceptedKey(
      termsAccepted ? null : registrationTermsKey,
    );
  }, [termsAccepted, registrationTermsKey]);

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
    if (!consented) return;

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
          // A new state answers the question the phone form was asking.
          setChangingNumber(false);

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
      setChangingNumber(false);
      setCode('');
      setEmailCode('');
      setPassword('');
    };

    return () => {
      mountedRef.current = false;
      cleanupRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consented]);

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

  /*
   * Show the phone form again without touching TDLib.
   *
   * Nothing is sent until the user submits a number: `requestPhoneNumber`
   * carries the change, and TDLib replies with a fresh `wait_code` for the new
   * number. Seeding the field with the number currently being verified means
   * the common case — one wrong digit — is an edit rather than a retype.
   */
  const handleChangeNumber = useCallback(() => {
    if (authState.type === 'wait_code' && authState.phoneNumber && !phone) {
      setPhone(authState.phoneNumber);
    }
    setCode('');
    setError(null);
    setChangingNumber(true);
  }, [authState, phone]);

  const formattedPhone =
    authState.type === 'wait_code'
      ? formatInternationalPhone(authState.phoneNumber)
      : null;

  if (!consented) {
    return (
      <ScrollView contentContainerStyle={styles.consentContent}>
        <Text variant="display" style={styles.title}>
          Connect Telegram
        </Text>
        <Text variant="bodyLarge" tone="secondary" style={styles.description}>
          Signing in gives Creepy a Telegram session on this device. The session
          stays on the phone and is never sent to our servers.
        </Text>

        <View style={styles.scopes}>
          {TELEGRAM_CAPABILITY_DESCRIPTIONS.map((entry) => (
            <View key={entry.scope} style={styles.scopeRow}>
              <Text variant="label">{entry.title}</Text>
              <Text variant="bodySmall" tone="secondary">
                {entry.detail}
              </Text>
            </View>
          ))}
        </View>

        <Text variant="bodySmall" tone="secondary" style={styles.description}>
          Telegram has no permission screen: signing in authorizes your whole
          account, and the limits above are the ones Creepy imposes on itself.
          Sign out any time from Account → Connectors.
        </Text>

        <Button label="Continue" onPress={() => setConsented(true)} />
        <View style={styles.cancelWrap}>
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>
      </ScrollView>
    );
  }

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
          {changingNumber
            ? getStepTitle('wait_phone_number')
            : getStepTitle(authState.type)}
        </Text>

        {__DEV__ ? (
          <Text variant="tag" tone="secondary" style={styles.title}>
            TDLib: {adapter.kind}
          </Text>
        ) : null}

        {authState.type === 'wait_phone_number' || changingNumber ? (
          <>
            <Text variant="body" tone="secondary" style={styles.description}>
              {changingNumber
                ? 'Enter the number to use instead, in international format. ' +
                  'Telegram will send a new code.'
                : 'Enter your phone number in international format.'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="+7 701 234 5678"
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
              {formattedPhone
                ? 'Enter the code Telegram sent to this number'
                : 'Enter the verification code sent to your Telegram account'}
              {authState.codeLength ? ` (${authState.codeLength} digits)` : ''}.
            </Text>
            {/*
              * The number is the one thing on this screen that tells the user
              * whether they typed it correctly, and it was not shown at all.
              * TDLib hands it back in E.164; formatted so it can be checked at
              * a glance rather than counted digit by digit.
              */}
            {formattedPhone ? (
              <Text variant="optionValue" style={styles.phone}>
                {formattedPhone}
              </Text>
            ) : null}
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
            <Button
              label="Use a different number"
              variant="ghost"
              onPress={handleChangeNumber}
              disabled={loading}
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
                <ScrollView
                  style={styles.termsBox}
                  nestedScrollEnabled
                >
                  <Text variant="bodySmall" tone="secondary">
                    {authState.termsOfServiceText}
                  </Text>
                </ScrollView>
                <View style={styles.checkRow}>
                  <Button
                    label={termsAccepted ? '☑ I accept the Terms of Service' : '☐ I accept the Terms of Service'}
                    variant="ghost"
                    onPress={toggleTermsAccepted}
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
            {authState.link ? (
              <>
                <LocalQrCode value={authState.link} size={220} />
                <Text variant="bodySmall" tone="secondary" style={styles.description}>
                  Scan this code with Telegram, or open the link below on your
                  signed-in device.
                </Text>
              </>
            ) : (
              <Text variant="body" tone="danger" style={styles.description}>
                Telegram did not provide a confirmation link. Please go back and
                try again.
              </Text>
            )}
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
          {/*
            * While changing the number, Cancel undoes the change rather than
            * leaving the flow — the code Telegram already sent is still valid,
            * so abandoning the sign-in is not what "cancel" means here.
            */}
          <Button
            label={changingNumber ? 'Keep the current number' : 'Cancel'}
            variant="ghost"
            onPress={
              changingNumber ? () => setChangingNumber(false) : handleCancel
            }
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
  phone: { textAlign: 'center', marginBottom: spacing.sm },
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
  consentContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: gutter.screen,
    paddingVertical: spacing.xxl,
    backgroundColor: palette.canvas,
  },
  scopes: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  scopeRow: { gap: spacing.xs },
});
