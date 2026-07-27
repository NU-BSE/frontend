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

export type StockSellingDeviceRecord = {
  submissionId: string;
  sellerUserId: string;
  deviceExternalId?: string;
  manufacturer: string;
  model: string;
  serialHash?: string;
  imeiHash?: string;
  condition: 'new' | 'good' | 'fair' | 'parts';
  askingPrice?: number;
  currency?: string;
  source: 'telegramMiniApp' | 'androidNative';
  status: 'submitted' | 'attestation_pending' | 'listed' | 'rejected';
  createdAtMs: number;
  updatedAtMs: number;
};

export interface DeviceRegistry {
  get(deviceId: string): Promise<RegisteredDevice | undefined>;
  upsert(device: RegisteredDevice): Promise<RegisteredDevice>;
  updateCounter(deviceId: string, counter: number): Promise<void>;
  submitStockSellingDevice(
    record: StockSellingDeviceRecord,
  ): Promise<StockSellingDeviceRecord>;
  listStockSellingDevices(
    sellerUserId?: string,
  ): Promise<StockSellingDeviceRecord[]>;
}

export class InMemoryDeviceRegistry implements DeviceRegistry {
  private readonly devices = new Map<string, RegisteredDevice>();
  private readonly stockSellingDevices = new Map<
    string,
    StockSellingDeviceRecord
  >();

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

  async submitStockSellingDevice(
    record: StockSellingDeviceRecord,
  ): Promise<StockSellingDeviceRecord> {
    this.stockSellingDevices.set(record.submissionId, record);
    return record;
  }

  async listStockSellingDevices(
    sellerUserId?: string,
  ): Promise<StockSellingDeviceRecord[]> {
    const records = Array.from(this.stockSellingDevices.values());
    return sellerUserId
      ? records.filter((record) => record.sellerUserId === sellerUserId)
      : records;
  }
}
