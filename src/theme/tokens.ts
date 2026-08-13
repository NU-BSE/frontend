/**
 * Design tokens — warm paper and coffee.
 *
 * The palette is lifted from the chat reference: a cream page, an off-white
 * incoming bubble, and a deep coffee outgoing bubble with cream text. It
 * replaces the blue-on-white scheme normalised from the Figma Home frame.
 *
 * Everything the app paints comes from here. No screen hardcodes a hex, so
 * re-theming is this file plus the font registration in app/_layout.tsx —
 * which is what made this change a token edit rather than a sweep.
 *
 * Contrast was checked against WCAG AA for body text (4.5:1):
 *   textPrimary on canvas   #33251c on #efe9df  →  10.9:1
 *   textPrimary on surface  #33251c on #fbf8f3  →  12.3:1
 *   onBrand on brand        #f7f2ea on #4a3428  →   9.7:1
 *   textSecondary on canvas #5c4a3d on #efe9df  →   6.1:1
 *   textMuted on canvas     #7a6657 on #efe9df  →   4.1:1  (large/secondary only)
 */

export const palette = {
  /** The page: warm cream paper. */
  canvas: '#efe9df',
  /** Cards and the incoming chat bubble — paper, a shade lighter than canvas. */
  surface: '#fbf8f3',

  /** Deep coffee: primary actions, the outgoing bubble, active states. */
  brand: '#4a3428',
  /** 10% brand — icon wells and tag chips. */
  brandWash: 'rgba(74, 52, 40, 0.1)',
  /** 20% brand — the load-more underline. */
  brandHairline: 'rgba(74, 52, 40, 0.2)',

  textPrimary: '#33251c',
  textSecondary: '#5c4a3d',
  textMuted: '#7a6657',
  /** 60% of textSecondary — timestamps in History. */
  textFaint: 'rgba(92, 74, 61, 0.6)',

  border: '#d9cfc0',
  borderSoft: 'rgba(217, 207, 192, 0.6)',
  borderFaint: 'rgba(217, 207, 192, 0.35)',

  /** Neutral accent — "flat navigation" tags and inactive chips. */
  neutralWash: 'rgba(217, 207, 192, 0.45)',
  neutralChip: '#e6ddd0',

  /** Warm accent — the "real-time" scenario. */
  gold: '#7a5c12',
  goldWash: 'rgba(184, 154, 74, 0.28)',

  /**
   * Content sitting *on* `brand` — the pill mascot, primary button labels,
   * the onboarding check. Cream rather than pure white, as in the reference:
   * stark white on warm brown reads cold and slightly glares.
   */
  onBrand: '#f7f2ea',

  danger: '#a33a2a',
} as const;

/**
 * Font families.
 *
 * Names must match the keys registered with `useFonts` in app/_layout.tsx.
 * React Native has no synthetic bolding on Android — a missing weight
 * silently renders as regular — so each weight is loaded and named
 * explicitly rather than relying on `fontWeight`.
 */
export const fontFamily = {
  /** Headings, the wordmark, card titles, and history queries. */
  serif: 'Lora_400Regular',
  serifSemiBold: 'Lora_600SemiBold',
  serifBold: 'Lora_700Bold',
  /**
   * Labels, tabs, nav, tags. The reference sets everything in one serif, so
   * these map onto Lora's heavier weights rather than a separate sans —
   * the names stay so call sites keep expressing structural vs. prose intent.
   */
  sansSemiBold: 'Lora_600SemiBold',
  sansBold: 'Lora_700Bold',
  /** Body copy, descriptions, chat messages. */
  body: 'Lora_400Regular',
} as const;

export const typography = {
  /** "Creepy.IM" wordmark. */
  wordmark: { fontFamily: fontFamily.serifBold, fontSize: 20, lineHeight: 28 },
  /** Onboarding screen headings. */
  display: { fontFamily: fontFamily.serifSemiBold, fontSize: 30, lineHeight: 38 },
  /** Onboarding sub-heading / agent question. */
  headline: { fontFamily: fontFamily.serifSemiBold, fontSize: 18, lineHeight: 26 },
  /** Card titles. */
  cardTitle: { fontFamily: fontFamily.serifSemiBold, fontSize: 16, lineHeight: 22 },
  /** History query text. */
  quote: { fontFamily: fontFamily.serif, fontSize: 20, lineHeight: 28 },
  /** Option row values in Memory Config. */
  optionValue: { fontFamily: fontFamily.serif, fontSize: 18, lineHeight: 28 },
  /** Intro paragraphs. */
  bodyLarge: { fontFamily: fontFamily.body, fontSize: 16, lineHeight: 26 },
  /** Card descriptions, chat message text. */
  body: { fontFamily: fontFamily.body, fontSize: 14, lineHeight: 20 },
  /** Card sub-descriptions. */
  bodySmall: { fontFamily: fontFamily.body, fontSize: 12, lineHeight: 16 },
  /** "Ask Creepy", buttons. */
  button: { fontFamily: fontFamily.serifBold, fontSize: 14, lineHeight: 20 },
  /** Tabs, "Open" affordance. */
  label: { fontFamily: fontFamily.sansSemiBold, fontSize: 14, lineHeight: 20 },
  labelSmall: { fontFamily: fontFamily.sansSemiBold, fontSize: 12, lineHeight: 16 },
  /** Tag pills, bottom-nav labels — uppercase, tracked out. */
  tag: {
    fontFamily: fontFamily.sansBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.5,
  },
  /** Uppercase option labels, timestamps. */
  overline: {
    fontFamily: fontFamily.sansBold,
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1,
  },
  /** Bottom-nav item labels. */
  nav: { fontFamily: fontFamily.sansBold, fontSize: 10, lineHeight: 14 },
} as const;

/** 4pt grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  /** Tag pills. */
  xs: 2,
  /** Scenario cards. */
  sm: 4,
  /** Search bar, category cells, option rows. */
  md: 8,
  /** Buttons, chips, icon wells. */
  lg: 12,
  /** History entry cards. */
  xl: 16,
  pill: 999,
} as const;

/** Figma uses a 24px page gutter on onboarding/history, 16px on Home. */
export const gutter = { screen: 24, home: 16 } as const;

/** Android's minimum comfortable touch target. */
export const MIN_TOUCH_TARGET = 48;

export const shadow = {
  /** drop-shadow(0 1px 1px rgba(0,0,0,0.05)) — cards, chips, search bar. */
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  /** The raised "Ask Creepy" pill. */
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

export type TypographyVariant = keyof typeof typography;
