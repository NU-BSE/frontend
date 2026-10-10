# Onlang pilot: the onboarding paywall

The onboarding paywall (`app/onboarding/subscription.tsx`) can be served by
[Onlang](https://github.com/onlang-ai/onlang): the server picks the arrangement and the
marketing copy per install, runs the experiment, and the app renders it with its own components.
With Onlang off (the default) nothing changes: the classic screen is the only one.

## What Onlang controls, and what it doesn't

| From Onlang (`onlang/`) | Stays in the app (`src/onlang/`, `src/features/subscription/`) |
|---|---|
| Section order and which components appear | Prices: Play's, or the list prices, never mixed (`resolvePricing`) |
| Marketing copy: tag, headline, body, the trial CTA, card headlines | Plan facts: which plan has the trial, captions, billing terms |
| The price disclosure line and the legal row (with `{{price.*}}` from the app) | Billing: `purchase()` → backend `verifyPlayPurchase`; restore asks `/subscriptions/me` |
| | The skip link's copy (it has to be true about this phone) |

The components are the classic screen's pieces, registered in `src/onlang/registry.tsx` under the
names in `onlang/registry.json`. `src/onlang/__tests__` checks the two stay in step.

If no flow can load (first launch offline, Onlang down) or the placement's kill switch is on, the
classic screen is shown instead: `onlang kill paywall --reason "…"` turns it off for everyone
within seconds, `onlang kill paywall --lift` turns it back on.

## Switching it on

Build-time variables (Metro inlines them, like the rest of `EXPO_PUBLIC_*`):

```sh
EXPO_PUBLIC_ONLANG_URL=https://delivery.example        # off when unset
EXPO_PUBLIC_ONLANG_INGEST_URL=https://ingest.example   # defaults to the delivery URL
EXPO_PUBLIC_ONLANG_KEY=onl_pk_…                        # the app's publishable key (not a secret)
EXPO_PUBLIC_ONLANG_CONSENT=granted                     # QA builds only; see below
```

Locally, against the Onlang staging stack (`infra/staging` in the Onlang repo) on an emulator:
`adb reverse tcp:4321 tcp:4321 && adb reverse tcp:4322 tcp:4322`, then the URLs are
`http://localhost:4321` and `http://localhost:4322`.

Checking and publishing the project, with the Onlang CLI from this directory and the app's
secret token:

```sh
onlang lint
ONLANG_TOKEN=onl_sk_… onlang publish --target staging
```

The SDK is vendored (`vendor/onlang-react-native-*.tgz`) until it is published to a registry.

## Before real users see it

- **Privacy.** Onlang records UI events on the paywall (impressions, taps with coordinates,
  plan selections, the purchase outcome; no prompts, messages or account data). Consent defaults
  to `pending`: events stay on the phone for 14 days and nothing is sent. Uploads should only be
  turned on once the privacy policy (creepy.im/policy) says so and there is a setting to opt out
  (`Onlang.setConsent('denied')` deletes what is queued).
- **Terms.** The legal row needs a terms link; there is no Creepy terms page, so it points at
  Google Play's terms and is labelled "Play terms". A Creepy terms page would replace it.
- **Seen during the pilot, not introduced by it:** the annual card reads "$118.80 per month,
  billed annually" (`plans.ts` pairs the annual price with a per-month caption) on both paywalls.
