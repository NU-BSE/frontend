/**
 * Registry of devices the attestation server has seen.
 *
 * This lived under `marketplace/deviceregistry` alongside a stock-selling
 * feature that has since been removed. It was never part of that feature:
 * `verify.ts` depends on it for WebAuthn assertion-counter tracking, which is
 * the replay protection at the centre of the attestation flow. It is kept here,
 * next to its only callers, so the two cannot be mistaken for one another
 * again.
 */

export type RegisteredDevice = {
  deviceId: string;
  userId: string;
  platform: 'android' | 'ios';
  keyId?: string;
  publicKeyPem?: string;
  lastCounter?: number;
  firstSeenAtMs: number;
  strongIntegritySinceMs?: number;
  modelFamily?: string;
};

export interface DeviceRegistry {
  get(deviceId: string): Promise<RegisteredDevice | undefined>;
  upsert(device: RegisteredDevice): Promise<RegisteredDevice>;

  /**
   * Persist the highest WebAuthn signature counter seen for this device.
   *
   * Authenticators increment this monotonically; a value that fails to advance
   * indicates a cloned credential, so losing this store would silently disable
   * replay detection rather than fail loudly.
   */
  updateCounter(deviceId: string, counter: number): Promise<void>;
}

export class InMemoryDeviceRegistry implements DeviceRegistry {
  private readonly devices = new Map<string, RegisteredDevice>();

  async get(deviceId: string): Promise<RegisteredDevice | undefined> {
    return this.devices.get(deviceId);
  }

  async upsert(device: RegisteredDevice): Promise<RegisteredDevice> {
    const existing = this.devices.get(device.deviceId);
    const merged = { ...existing, ...device };
    this.devices.set(device.deviceId, merged);
    return merged;
  }

  async updateCounter(deviceId: string, counter: number): Promise<void> {
    const existing = this.devices.get(deviceId);
    if (existing) {
      this.devices.set(deviceId, { ...existing, lastCounter: counter });
    }
  }
}
