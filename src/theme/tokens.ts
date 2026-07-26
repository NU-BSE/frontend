/**
 * Design tokens — derived from the Creepy.IM Figma file.
 *
 * The file publishes no Figma variables (`get_variable_defs` returns `{}`),
 * so these are lifted from the raw hex in the frames. The three screen
 * families disagreed with each other:
 *
 *   Home       #094cb2  Noto Serif   Public Sans
 *   History    #0055ff  Noto Serif   Public Sans
 *   Onboarding #0041c8  Source Serif JetBrains Mono
 *
 * Normalised to Home's palette by decision, since Home is the most-visited
 * screen and the most finished frame. Changing that decision means editing
 * `brand` and `fontFamily` here — nothing else.
 */

export const palette = {
  /** Page background (Figma: #faf9fa Home / #f7f9fb elsewhere — unified). */
  canvas: '#faf9fa',
  surface: '#ffffff',

  brand: '#094cb2',
  /** 10% brand — icon wells and tag chips on brand-coloured cards. */
  brandWash: 'rgba(9, 76, 178, 0.1)',
  /** 20% brand — the load-more underline. */
  brandHairline: 'rgba(9, 76, 178, 0.2)',

  textPrimary: '#1b1c1d',
  textSecondary: '#434653',
  textMuted: '#5a5f63',
  /** 60% of textSecondary — timestamps in History. */
  textFaint: 'rgba(67, 70, 83, 0.6)',

  border: '#c3c6d5',
  borderSoft: 'rgba(195, 198, 213, 0.5)',
  borderFaint: 'rgba(195, 198, 213, 0.3)',

  /** Neutral accent — "flat navigation" style tags and inactive chips. */
  neutralWash: 'rgba(223, 227, 232, 0.5)',
  neutralChip: '#e9e8e9',

  /** Gold accent — the "real-time" scenario. */
  gold: '#6d5e00',
  goldWash: 'rgba(191, 171, 73, 0.3)',

  white: '#ffffff',
  danger: '#b3261e',
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
  serif: 'NotoSerif_400Regular',
  serifSemiBold: 'NotoSerif_600SemiBold',
  serifBold: 'NotoSerif_700Bold',
  /** Labels, tabs, nav, tags — anything small and structural. */
  sansSemiBold: 'PublicSans_600SemiBold',
  sansBold: 'PublicSans_700Bold',
  /** Body copy and descriptions. */
  body: 'Inter_400Regular',
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
