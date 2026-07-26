import type React from 'react';
import type { SvgProps } from 'react-native-svg';

import CatDataviz from '@assets/icons/cat-dataviz.svg';
import CatFinance from '@assets/icons/cat-finance.svg';
import CatJourney from '@assets/icons/cat-journey.svg';
import CatMessaging from '@assets/icons/cat-messaging.svg';
import CatSettings from '@assets/icons/cat-settings.svg';
import CatSports from '@assets/icons/cat-sports.svg';
import { palette } from '@/theme/tokens';

/**
 * One registry drives four surfaces: the onboarding category grid, the Home
 * tab selector, the Home card list, and the chat's suggestion chips and deep
 * links. Adding a scenario is a single entry here — no screen changes.
 */
export type ScenarioId =
  | 'settings'
  | 'messaging'
  | 'sports'
  | 'finance'
  | 'journey'
  | 'dataviz';

/** Card accent. The Figma cards use three distinct treatments. */
export type Accent = 'brand' | 'neutral' | 'gold';

export interface DeepLink {
  label: string;
  /**
   * App scheme tried first. STUBBED — these are plausible schemes, not
   * verified targets. `openDeepLink` probes with canOpenURL and reports
   * failure to the user rather than throwing.
   */
  url: string;
  /** Opened when the scheme is unavailable. Empty means no web fallback. */
  webUrl?: string;
}

export interface Scenario {
  id: ScenarioId;
  /** Tab label and onboarding category label. */
  title: string;
  /** Card heading — the Figma copy, verbatim. */
  cardTitle: string;
  /** Card sub-line — the Figma copy, verbatim. */
  cardDescription: string;
  /** Uppercase pill on the card. */
  tag: string;
  accent: Accent;
  Icon: React.FC<SvgProps>;
  /** Chips offered when the chat opens in this scenario. */
  suggestions: string[];
  deepLinks: DeepLink[];
}

export const ACCENT_STYLE: Record<
  Accent,
  { wash: string; ink: string }
> = {
  brand: { wash: palette.brandWash, ink: palette.brand },
  neutral: { wash: palette.neutralWash, ink: palette.textMuted },
  gold: { wash: palette.goldWash, ink: palette.gold },
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'settings',
    title: 'Settings',
    cardTitle: 'Manage complex system preferences',
    cardDescription: 'Nested settings and system-level configurations.',
    tag: 'Hierarchical',
    accent: 'brand',
    Icon: CatSettings,
    suggestions: [
      'What changed in my settings recently?',
      'Explain the memory allocation options',
      'Reset everything to defaults',
    ],
    deepLinks: [
      { label: 'Android Settings', url: 'android-app://com.android.settings' },
    ],
  },
  {
    id: 'messaging',
    title: 'Messaging',
    cardTitle: 'Stay connected with your team',
    cardDescription: 'Switching between chats and contact lists.',
    tag: 'Flat navigation',
    accent: 'neutral',
    Icon: CatMessaging,
    suggestions: [
      'Summarise what I missed today',
      'Who has been quiet this week?',
      'Draft a reply for me',
    ],
    deepLinks: [
      { label: 'Telegram', url: 'tg://resolve', webUrl: 'https://t.me' },
      {
        label: 'WhatsApp',
        url: 'whatsapp://send',
        webUrl: 'https://web.whatsapp.com',
      },
    ],
  },
  {
    id: 'sports',
    title: 'Sports',
    cardTitle: 'Track live match data',
    cardDescription: 'Real-time updates and interactive scoreboards.',
    tag: 'Real-time',
    accent: 'gold',
    Icon: CatSports,
    suggestions: [
      'Score right now',
      'How did the last five games go?',
      'Who is most likely to lose?',
    ],
    deepLinks: [
      { label: 'Open scoreboard', url: 'creepyim://scoreboard' },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    cardTitle: 'Track portfolio performance',
    cardDescription: 'Market analytics and asset growth visualization.',
    tag: 'Data viz',
    accent: 'brand',
    Icon: CatFinance,
    suggestions: [
      'How is my portfolio doing?',
      'What moved the most today?',
      'Explain this drawdown',
    ],
    deepLinks: [{ label: 'Open portfolio', url: 'creepyim://portfolio' }],
  },
  {
    id: 'journey',
    title: 'Journey',
    cardTitle: 'Plan where you are going',
    cardDescription: 'Routes, timings and the places along the way.',
    tag: 'Wayfinding',
    accent: 'neutral',
    Icon: CatJourney,
    suggestions: [
      'Fastest way home right now',
      'What is on the way?',
      'Avoid the route I took yesterday',
    ],
    deepLinks: [
      { label: 'Maps', url: 'geo:0,0', webUrl: 'https://maps.google.com' },
    ],
  },
  {
    id: 'dataviz',
    title: 'Data',
    cardTitle: 'See the shape of your data',
    cardDescription: 'Charts assembled from whatever it has been watching.',
    tag: 'Data viz',
    accent: 'gold',
    Icon: CatDataviz,
    suggestions: [
      'Chart the last thirty days',
      'What pattern repeats here?',
      'Show me the outlier',
    ],
    deepLinks: [{ label: 'Open dashboard', url: 'creepyim://dashboard' }],
  },
];

export function getScenario(id: string | undefined): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/** Chips offered when the chat is opened from "Ask Creepy" with no scenario. */
export const GENERAL_SUGGESTIONS = [
  'What have you been watching?',
  'Tell me something I have not noticed',
  'Who else is reading this?',
];
