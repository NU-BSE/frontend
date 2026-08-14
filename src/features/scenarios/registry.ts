import type React from 'react';
import type { SvgProps } from 'react-native-svg';

import CatCalendar from '@assets/icons/cat-calendar.svg';
import CatDrive from '@assets/icons/cat-drive.svg';
import CatEmail from '@assets/icons/cat-email.svg';
import CatMessaging from '@assets/icons/cat-messaging.svg';
import CatSettings from '@assets/icons/cat-settings.svg';
import { ANDROID_GUIDE_LEAD_PROMPTS } from './androidGuides';
import { palette } from '@/theme/tokens';

/**
 * One registry drives four surfaces: the onboarding category grid, the Home
 * tab selector, the Home card list, and the chat's suggestion chips and deep
 * links. Adding a scenario is a single entry here — no screen changes.
 */
export type ScenarioId =
  | 'settings'
  | 'messaging'
  | 'email'
  | 'calendar'
  | 'drive';

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
    cardTitle: 'Fix the Android problem you actually have',
    cardDescription: 'Ordered paths through real Android settings.',
    tag: 'Guides',
    accent: 'brand',
    Icon: CatSettings,
    /*
     * One prompt per guide cluster from creepy.im rather than all thirty-six:
     * the chips wrap, and a wall of them is not browsable. The full library
     * lives in ./androidGuides and is what a dedicated guide surface should
     * render.
     */
    suggestions: ANDROID_GUIDE_LEAD_PROMPTS,
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
    id: 'email',
    title: 'Email',
    cardTitle: 'Get through the inbox faster',
    cardDescription: 'Find, summarise and draft without opening every thread.',
    tag: 'Gmail',
    accent: 'gold',
    Icon: CatEmail,
    suggestions: [
      'What needs a reply today?',
      'Summarise this thread',
      'Draft a short reply saying I will follow up Monday',
    ],
    deepLinks: [
      { label: 'Gmail', url: 'googlegmail://', webUrl: 'https://mail.google.com' },
    ],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    cardTitle: 'See what the week actually looks like',
    cardDescription: 'Events, conflicts and the gaps between them.',
    tag: 'Scheduling',
    accent: 'neutral',
    Icon: CatCalendar,
    suggestions: [
      'What is on today?',
      'Where do I have a free hour this week?',
      'Do any of my meetings clash?',
    ],
    deepLinks: [
      {
        label: 'Google Calendar',
        url: 'content://com.android.calendar/time',
        webUrl: 'https://calendar.google.com',
      },
    ],
  },
  {
    id: 'drive',
    title: 'Drive',
    cardTitle: 'Find the file you half remember',
    cardDescription: 'Search by what it was about, not what it was called.',
    tag: 'Files',
    accent: 'brand',
    Icon: CatDrive,
    suggestions: [
      'Find the document I edited last week',
      'What did I share with this person?',
      'Show me my largest files',
    ],
    deepLinks: [
      { label: 'Google Drive', url: 'googledrive://', webUrl: 'https://drive.google.com' },
    ],
  },
];

/**
 * The categories offered in onboarding.
 *
 * Settings is excluded. It is not a service you opt into — it is the Android
 * guide library, always present in the feed regardless of what you pick here,
 * so asking about it implies a choice that does not exist. Dropping it also
 * leaves four entries, which fill the two-column grid evenly instead of
 * stranding a fifth cell alone on its own row.
 */
export const ONBOARDING_SCENARIOS: Scenario[] = SCENARIOS.filter(
  (scenario) => scenario.id !== 'settings',
);

export function getScenario(id: string | undefined): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/** Chips offered when the chat is opened from "Ask Creepy" with no scenario. */
export const GENERAL_SUGGESTIONS = [
  'What have you been watching?',
  'Tell me something I have not noticed',
  'Who else is reading this?',
];
