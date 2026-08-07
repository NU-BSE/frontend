import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/Text';

import { runMcpSpike } from './run-mcp-spike';

/**
 * Development-only кнопка для проверки локального MCP runtime.
 *
 * В release-сборках __DEV__ === false, поэтому компонент
 * рендерит null и не выполняет никаких вызовов.
 */
export const McpDebugButton = () => {
  const [running, setRunning] = useState(false);

  if (!__DEV__) {
    return null;
  }

  const handlePress = async () => {
    if (running) return;

    setRunning(true);

    try {
      const result = await runMcpSpike();
      console.log('MCP SPIKE RESULT', result);
    } catch (error) {
      console.warn('MCP SPIKE FAILED', error);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Run local MCP spike"
      hitSlop={12}
      disabled={running}
      onPress={() => void handlePress()}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {running ? (
        <ActivityIndicator size="small" />
      ) : (
        <Text variant="label" tone="faint">
          MCP
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
