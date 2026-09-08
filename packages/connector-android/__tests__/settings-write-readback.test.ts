import { ConnectorError } from '@mobile-agent/connector-core';

import { createAndroidSettingsTools } from '../src/android-settings-tools';
import { makeBridge } from './mcp-test-helpers';

async function setBrightness(
  percent: number,
  bridge: ReturnType<typeof makeBridge>,
): Promise<unknown> {
  const [tool] = createAndroidSettingsTools({ bridge }).filter(
    (candidate) => candidate.name === 'android.settings.set_brightness',
  );
  if (!tool) throw new Error('tool not found');
  return tool.execute({ connectionId: 'android-device', percent } as never);
}

describe('android.settings.set_brightness reliability', () => {
  it('disables adaptive brightness when automatic mode is on, and reports it', async () => {
    const modeCalls: string[] = [];
    const bridge = makeBridge({
      getBrightnessMode: () => 'automatic',
      setBrightnessMode: (mode) => {
        modeCalls.push(mode);
        return true;
      },
      setScreenBrightnessPercent: () => true,
      // Read back a value the "device" actually applied.
      getScreenBrightnessPercent: () => 25,
    });

    const result = (await setBrightness(25, bridge)) as {
      percent: number;
      brightnessMode: string;
      adaptiveDisabled: boolean;
    };

    expect(modeCalls).toEqual(['manual']);
    expect(result.adaptiveDisabled).toBe(true);
    expect(result.brightnessMode).toBe('automatic');
    // The result is the read-back value, not the requested number echoed.
    expect(result.percent).toBe(25);
  });

  it('does not touch brightness mode when already manual', async () => {
    const modeCalls: string[] = [];
    const bridge = makeBridge({
      getBrightnessMode: () => 'manual',
      setBrightnessMode: (mode) => {
        modeCalls.push(mode);
        return true;
      },
      setScreenBrightnessPercent: () => true,
      getScreenBrightnessPercent: () => 50,
    });

    const result = (await setBrightness(50, bridge)) as {
      adaptiveDisabled: boolean;
    };
    expect(modeCalls).toEqual([]);
    expect(result.adaptiveDisabled).toBe(false);
  });

  it('fails honestly when the OEM overrides the value (read-back mismatch)', async () => {
    const bridge = makeBridge({
      getBrightnessMode: () => 'manual',
      setScreenBrightnessPercent: () => true,
      // HyperOS-style: the write is accepted but the value does not stick.
      getScreenBrightnessPercent: () => 100,
    });

    await expect(setBrightness(25, bridge)).rejects.toThrow(ConnectorError);
    await expect(setBrightness(25, bridge)).rejects.toThrow(/did not stick/);
  });
});