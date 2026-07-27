import Config from '../../../config/attestation.config';
import type {
  VelocityFlag,
  VelocitySignals,
} from '@attestation/shared/wire';

type VelocityEvent = {
  atMs: number;
  nonce: string;
  ip: string;
  asn: string;
  payloadHash: string;
};

export type RequestContext = {
  nowMs: number;
  nonce: string;
  ip: string;
  asn: string;
  payloadHash: string;
  firstSeen: boolean;
};

export interface AsnLookup {
  lookup(ip: string): Promise<string>;
}

export interface VelocityStore {
  append(deviceId: string, event: VelocityEvent): Promise<void>;
  list(deviceId: string, sinceMs: number): Promise<VelocityEvent[]>;
}

export interface RiskProvider {
  evaluateVelocity(
    deviceId: string,
    reqCtx: RequestContext,
  ): Promise<VelocitySignals>;
}

export class InMemoryVelocityStore implements VelocityStore {
  private readonly events = new Map<string, VelocityEvent[]>();

  async append(deviceId: string, event: VelocityEvent): Promise<void> {
    const list = this.events.get(deviceId) ?? [];
    const min = event.atMs - 24 * 60 * 60 * 1000;
    this.events.set(
      deviceId,
      [...list.filter((item) => item.atMs >= min), event],
    );
  }

  async list(deviceId: string, sinceMs: number): Promise<VelocityEvent[]> {
    return (this.events.get(deviceId) ?? []).filter(
      (event) => event.atMs >= sinceMs,
    );
  }
}

const shannonEntropy = (payloads: string[]): number => {
  const joined = payloads.join('');
  if (!joined) return 0;
  const counts = new Map<string, number>();
  for (const char of joined) counts.set(char, (counts.get(char) ?? 0) + 1);
  return Array.from(counts.values()).reduce((total, count) => {
    const p = count / joined.length;
    return total - p * Math.log2(p);
  }, 0);
};

export class DefaultRiskProvider implements RiskProvider {
  constructor(private readonly store: VelocityStore) {}

  async evaluateVelocity(
    deviceId: string,
    reqCtx: RequestContext,
  ): Promise<VelocitySignals> {
    await this.store.append(deviceId, {
      atMs: reqCtx.nowMs,
      nonce: reqCtx.nonce,
      ip: reqCtx.ip,
      asn: reqCtx.asn,
      payloadHash: reqCtx.payloadHash,
    });

    const oneMinute = reqCtx.nowMs - 60 * 1000;
    const oneHour = reqCtx.nowMs - 60 * 60 * 1000;
    const events1h = await this.store.list(deviceId, oneHour);
    const events24h = await this.store.list(
      deviceId,
      reqCtx.nowMs - 24 * 60 * 60 * 1000,
    );

    const requestsPerMinute = events1h.filter(
      (event) => event.atMs >= oneMinute,
    ).length;
    const requestsPerHour = events1h.length;
    const distinctIpCount1h = new Set(events1h.map((event) => event.ip)).size;
    const distinctAsnCount1h = new Set(events1h.map((event) => event.asn)).size;
    const payloadEntropy = shannonEntropy(
      events24h.slice(-100).map((event) => event.payloadHash),
    );

    const flags: VelocityFlag[] = [];
    if (requestsPerMinute > Config.velocity.burstRequestsPerMinute) {
      flags.push('BURST');
    }
    if (distinctIpCount1h > Config.velocity.ipHoppingDistinctIps1h) {
      flags.push('IP_HOPPING');
    }
    if (distinctAsnCount1h > Config.velocity.asnHoppingDistinctAsns1h) {
      flags.push('ASN_HOPPING');
    }
    if (
      payloadEntropy > 0 &&
      payloadEntropy < Config.velocity.lowEntropyBitsPerSymbol
    ) {
      flags.push('LOW_ENTROPY_PAYLOADS');
    }
    if (reqCtx.firstSeen) flags.push('NEW_DEVICE');

    return {
      requestsPerMinute,
      requestsPerHour,
      distinctIpCount1h,
      distinctAsnCount1h,
      payloadEntropy,
      flags,
    };
  }
}

export const evaluateVelocity = (
  provider: RiskProvider,
  deviceId: string,
  reqCtx: RequestContext,
): Promise<VelocitySignals> => provider.evaluateVelocity(deviceId, reqCtx);
