import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { CreepyAndroidSettings, errorCodeOf } from 'creepy-android-settings';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { gutter, palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Manual test harness for the `creepy-android-settings` native module.
 *
 * Deliberately NOT part of the production UI. Reach it during development
 * (e.g. `/dev/android-settings`) to exercise reads, writes, permission flows,
 * navigation, Settings Panels and the content observer.
 */
export default function AndroidSettingsHarness() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [log, setLog] = useState<string[]>([]);
  const observerIdRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = CreepyAndroidSettings.addListener('onSettingChanged', (event) => {
      push(`[event] ${event.namespace}.${event.key} = ${String(event.value)}`);
    });
    return () => subscription.remove();
  }, []);

  function push(line: string) {
    setLog((prev) => [line, ...prev].slice(0, 100));
  }

  function run(label: string, fn: () => unknown) {
    try {
      const result = fn();
      push(`${label}: ${result === undefined ? 'ok' : JSON.stringify(result)}`);
    } catch (error) {
      push(`${label}: ERROR [${errorCodeOf(error)}] ${String((error as Error).message)}`);
    }
  }

  async function runAsync(label: string, fn: () => Promise<unknown>) {
    try {
      const result = await fn();
      push(`${label}: ${result === undefined ? 'ok' : JSON.stringify(result)}`);
    } catch (error) {
      push(`${label}: ERROR [${errorCodeOf(error)}] ${String((error as Error).message)}`);
    }
  }

  function startBrightnessObserver() {
    observerIdRef.current = CreepyAndroidSettings.watchSetting('system', 'screen_brightness');
    push(`observer started: ${observerIdRef.current}`);
  }

  function stopBrightnessObserver() {
    if (observerIdRef.current) {
      CreepyAndroidSettings.unwatchSetting(observerIdRef.current);
      push(`observer stopped: ${observerIdRef.current}`);
      observerIdRef.current = null;
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text variant="headline">Android settings harness</Text>
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        </View>

        <Section title="Capabilities">
          <Button
            label="Get capabilities"
            variant="secondary"
            onPress={() => run('capabilities', () => CreepyAndroidSettings.getCapabilities())}
          />
        </Section>

        <Section title="WRITE_SETTINGS">
          <Button
            label="Check WRITE_SETTINGS"
            variant="secondary"
            onPress={() => run('canWrite', () => CreepyAndroidSettings.canWriteSystemSettings())}
          />
          <Button
            label="Request WRITE_SETTINGS"
            variant="secondary"
            onPress={() =>
              runAsync('requestWrite', () =>
                CreepyAndroidSettings.requestWriteSystemSettingsPermission(),
              )
            }
          />
        </Section>

        <Section title="Brightness">
          <Button
            label="Get brightness"
            variant="secondary"
            onPress={() => run('brightness', () => CreepyAndroidSettings.getScreenBrightness())}
          />
          <Button
            label="Brightness 25%"
            variant="secondary"
            onPress={() => run('set 25%', () => CreepyAndroidSettings.setScreenBrightnessPercent(25))}
          />
          <Button
            label="Brightness 50%"
            variant="secondary"
            onPress={() => run('set 50%', () => CreepyAndroidSettings.setScreenBrightnessPercent(50))}
          />
          <Button
            label="Brightness 100%"
            variant="secondary"
            onPress={() => run('set 100%', () => CreepyAndroidSettings.setScreenBrightnessPercent(100))}
          />
        </Section>

        <Section title="Auto rotate">
          <Button
            label="Auto rotate ON"
            variant="secondary"
            onPress={() => run('rotate on', () => CreepyAndroidSettings.setAutoRotate(true))}
          />
          <Button
            label="Auto rotate OFF"
            variant="secondary"
            onPress={() => run('rotate off', () => CreepyAndroidSettings.setAutoRotate(false))}
          />
        </Section>

        <Section title="Screen timeout">
          <Button
            label="Screen timeout 30 sec"
            variant="secondary"
            onPress={() => run('timeout 30s', () => CreepyAndroidSettings.setScreenTimeout(30000))}
          />
          <Button
            label="Screen timeout 60 sec"
            variant="secondary"
            onPress={() => run('timeout 60s', () => CreepyAndroidSettings.setScreenTimeout(60000))}
          />
        </Section>

        <Section title="Navigation">
          <Button
            label="Open Wi-Fi"
            variant="secondary"
            onPress={() => runAsync('open wifi', () => CreepyAndroidSettings.openSettings('wifi'))}
          />
          <Button
            label="Open Bluetooth"
            variant="secondary"
            onPress={() => runAsync('open bluetooth', () => CreepyAndroidSettings.openSettings('bluetooth'))}
          />
          <Button
            label="Open Location"
            variant="secondary"
            onPress={() => runAsync('open location', () => CreepyAndroidSettings.openSettings('location'))}
          />
          <Button
            label="Open Accessibility"
            variant="secondary"
            onPress={() => runAsync('open accessibility', () => CreepyAndroidSettings.openSettings('accessibility'))}
          />
          <Button
            label="Open App Settings"
            variant="secondary"
            onPress={() => runAsync('open app settings', () => CreepyAndroidSettings.openSettings('appDetails'))}
          />
        </Section>

        <Section title="Settings Panels">
          <Button
            label="Open Internet Panel"
            variant="secondary"
            onPress={() => runAsync('open internet panel', () => CreepyAndroidSettings.openPanel('internet'))}
          />
          <Button
            label="Open Wi-Fi Panel"
            variant="secondary"
            onPress={() => runAsync('open wifi panel', () => CreepyAndroidSettings.openPanel('wifi'))}
          />
          <Button
            label="Open Volume Panel"
            variant="secondary"
            onPress={() => runAsync('open volume panel', () => CreepyAndroidSettings.openPanel('volume'))}
          />
        </Section>

        <Section title="Observer">
          <Button label="Start brightness observer" variant="secondary" onPress={startBrightnessObserver} />
          <Button label="Stop brightness observer" variant="secondary" onPress={stopBrightnessObserver} />
        </Section>

        <Section title="Log">
          {log.length === 0 ? (
            <Text variant="bodySmall" tone="muted">No results yet</Text>
          ) : (
            <Text variant="bodySmall" tone="secondary" style={styles.log}>
              {log.join('\n')}
            </Text>
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="headline">{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter.screen, paddingTop: spacing.xl, gap: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { gap: spacing.md },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  log: { lineHeight: 18 },
});
