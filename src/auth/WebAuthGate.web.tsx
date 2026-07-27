import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/Text';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

const SESSION_KEY = 'creepyim:web-authenticated';
const EXPECTED_LOGIN = 'test';
const EXPECTED_PASSWORD_SHA256 =
  'cfd4340b5d2a8eb163683e8c0fb2f37c7baaf01751080d0b94c6fd5d54759e55';

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hasSession(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function WebAuthGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(hasSession);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (authenticated) return <>{children}</>;

  const submit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const passwordHash = await sha256(password);
      const valid =
        login.trim() === EXPECTED_LOGIN &&
        passwordHash === EXPECTED_PASSWORD_SHA256;

      if (!valid) {
        setError('Incorrect login or password.');
        return;
      }

      globalThis.sessionStorage?.setItem(SESSION_KEY, '1');
      setAuthenticated(true);
    } catch {
      setError('Authentication is unavailable in this browser.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text variant="display">Creepy.IM</Text>
        <Text variant="body" tone="secondary">
          Sign in to continue to the web app.
        </Text>

        <View style={styles.form}>
          <TextInput
            autoCapitalize="none"
            autoComplete="username"
            placeholder="Login"
            placeholderTextColor={palette.textMuted}
            value={login}
            onChangeText={setLogin}
            onSubmitEditing={() => undefined}
            style={styles.input}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="current-password"
            placeholder="Password"
            placeholderTextColor={palette.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            style={styles.input}
          />

          {error ? (
            <Text variant="bodySmall" tone="danger">
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.pressed,
              submitting && styles.disabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={palette.white} />
            ) : (
              <Text variant="button" tone="inverse">
                Sign in
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.canvas,
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    padding: spacing.xxl,
    ...shadow.card,
  },
  form: { gap: spacing.md, marginTop: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.textPrimary,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: palette.brand,
    paddingHorizontal: spacing.xl,
    ...shadow.raised,
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.6 },
});
