/** Platform-neutral contract for Android outward-intent actions. */
export interface AndroidIntentBridge {
  openUri(uri: string): Promise<boolean>;
  openApp(packageName: string): Promise<boolean>;
  shareText(text: string, targetPackage?: string): Promise<boolean>;
  shareFile(
    fileUri: string,
    mimeType?: string,
    targetPackage?: string,
  ): Promise<boolean>;
  composeEmail(to?: string, subject?: string, body?: string): Promise<boolean>;
  openMap(
    query?: string,
    latitude?: number,
    longitude?: number,
  ): Promise<boolean>;
  openDialer(phoneNumber?: string): Promise<boolean>;
}
