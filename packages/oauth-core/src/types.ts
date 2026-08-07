export interface AccessTokenProvider {
  getValidAccessToken(connectionId: string): Promise<string>;
}
