import type {
  RecentWebAuthnResult,
  RecentWebAuthnStore,
} from './verify';

export class InMemoryRecentWebAuthnStore implements RecentWebAuthnStore {
  private readonly results = new Map<string, RecentWebAuthnResult>();

  async put(userId: string, result: RecentWebAuthnResult): Promise<void> {
    this.results.set(userId, result);
  }

  async get(userId: string): Promise<RecentWebAuthnResult | undefined> {
    const result = this.results.get(userId);
    if (!result || Date.now() - result.verifiedAtMs > 5 * 60 * 1000) {
      this.results.delete(userId);
      return undefined;
    }
    return result;
  }
}
