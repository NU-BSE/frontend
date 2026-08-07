export interface OAuthSession {
  id: string;
  provider: string;
  state: string;
  codeVerifier?: string;
  requestedScopes: string[];
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
}

export interface OAuthSessionStore {
  save(session: OAuthSession): Promise<void>;
  consumeByState(state: string): Promise<OAuthSession | null>;
}

export class InMemoryOAuthSessionStore implements OAuthSessionStore {
  private readonly sessions = new Map<string, OAuthSession>();

  async save(session: OAuthSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async consumeByState(state: string): Promise<OAuthSession | null> {
    for (const [id, session] of this.sessions) {
      if (session.state === state) {
        this.sessions.delete(id);
        return session;
      }
    }
    return null;
  }
}
