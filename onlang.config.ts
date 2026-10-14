import { defineConfig } from '@onlang/cli';

/**
 * Onlang pilot: the onboarding paywall as a server-driven flow (see onlang/README.md).
 *
 * Only the arrangement and the marketing copy of the paywall come from Onlang. Prices come from
 * Play through `src/onlang/store.ts`, billing stays in `src/features/subscription/billing.ts`,
 * and the copy that has to be true about this phone (the skip link) stays in the app.
 */
export default defineConfig({
  app: 'creepy_im',
  locales: ['en'],
  // System text (price disclosure, legal links) in the app's own type and colours.
  theme: {
    caption: {
      font_size: 12,
      line_height: 16,
      text_color: '#A9BDB2',
      font_family: 'Lora_400Regular',
      text_alignment_horizontal: 'center',
      paddings: { left: 24, right: 24, top: 12, bottom: 4 },
    },
    link: {
      font_size: 12,
      text_color: '#89A096',
      font_family: 'Lora_600SemiBold',
      paddings: { left: 12, right: 12, top: 12, bottom: 12 },
    },
  },
  targets: {
    // services/control-api on the local staging stack (infra/staging in the Onlang repo).
    staging: { url: 'http://127.0.0.1:4320' },
  },
  // Play's list prices, for `onlang preview`; on the phone they come from Play.
  preview: {
    store: {
      price: { annual: '$118.80', monthly: '$12.90' },
      period: { annual: 'year', monthly: 'month' },
      trial: { annual: '7 days' },
    },
  },
  planner: {
    brief:
      'Creepy is an Android assistant that does tasks across the apps you connect (Telegram, Gmail, files) ' +
      'and can run its AI on the phone. Creepy Pro unlocks connected apps and local AI. The paywall appears ' +
      'once, after the first real task; skipping is always available.',
    voice: 'Plain and direct. Short sentences. No hype, no exclamation marks, no urgency.',
    avoid: ['unlimited', 'guaranteed', 'best', '#1', 'AI-powered', 'limited time', 'only today', 'risk-free'],
    // Billing facts are not copy to experiment with.
    frozen: ['legal.', 'cta.paid', 'card.paid'],
  },
});
