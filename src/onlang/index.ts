import AsyncStorage from '@react-native-async-storage/async-storage';
import { Onlang, type Consent } from '@onlang/react-native';

import { purchases } from './purchases';
import { registry } from './registry';
import { storeValues } from './store';

/*
 * Build-time switches, inlined by Metro like every other EXPO_PUBLIC_* (src/ai/config.ts).
 *
 * Without EXPO_PUBLIC_ONLANG_URL nothing here runs and the classic paywall is the only one.
 * Consent defaults to `pending`: events are kept on the phone (30 days) and nothing is sent.
 * Turning uploads on for real users waits on the privacy policy saying so and a setting to
 * opt out (onlang/README.md); pilot QA builds set EXPO_PUBLIC_ONLANG_CONSENT=granted.
 */
const DELIVERY_URL = process.env.EXPO_PUBLIC_ONLANG_URL?.trim() || '';
const INGEST_URL = process.env.EXPO_PUBLIC_ONLANG_INGEST_URL?.trim() || '';
const SDK_KEY = process.env.EXPO_PUBLIC_ONLANG_KEY?.trim() || '';
const CONSENT = process.env.EXPO_PUBLIC_ONLANG_CONSENT?.trim() || '';

export const ONLANG_ENABLED = DELIVERY_URL !== '';

let configured = false;

/** Once, at startup. A no-op unless the build enables Onlang. */
export function configureOnlang(): void {
  if (!ONLANG_ENABLED || configured) return;
  configured = true;
  void Onlang.configure({
    app: 'creepy_im',
    baseUrl: DELIVERY_URL,
    ingestUrl: INGEST_URL || undefined,
    // A publishable key (onl_pk_…): it identifies the app, it is not a secret.
    sdkKey: SDK_KEY || undefined,
    registry,
    purchases,
    store: storeValues,
    storage: AsyncStorage,
    defaultLocale: 'en',
    consent: (['granted', 'denied', 'pending'] as const).includes(CONSENT as Consent) ? (CONSENT as Consent) : 'pending',
    legalUrls: {
      privacy: 'https://creepy.im/policy',
      // Creepy has no terms page of its own yet; the purchase is under Google Play's terms.
      terms: 'https://play.google.com/about/play-terms/',
    },
    timeoutMs: 4000,
    log: __DEV__ ? (message) => console.log(`[Onlang] ${message}`) : () => {},
  });
}
