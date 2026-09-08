/**
 * Design tokens — neo-green.
 *
 * Green as the working colour: a near-black green ground, a vivid green for
 * anything that acts or advances, and cool light text over both. It follows
 * the landing page rather than inventing a second identity for the app —
 * someone arriving from the site should recognise where they are.
 *
 * This replaces the warm cream-and-coffee scheme. That palette was calm and
 * said nothing about what the app does; green reads as utility and progress,
 * which is the whole claim.
 *
 * Everything the app paints comes from here. No screen hardcodes a hex, so
 * re-theming is this file — which is what made a full redesign a token edit
 * rather than a sweep across forty components.
 *
 * Every pair below is computed by `npm run verify:contrast` against WCAG AA,
 * not asserted here by hand. The previous version of this comment carried
 * hand-written ratios, which is a claim nothing checked; the script fails the
 * build instead. Worth noting that `textMuted` now passes AA for body text at
 * 5.73:1 where the warm palette had it at 4.1:1 and confined to large text.
 */

export const palette = {
  /** The page: near-black green. */
  canvas: '#0d1512',
  /**
   * Cards and the incoming chat bubble — one step up from the ground.
   *
   * Only one step. On paper a card separates by its shadow; on a near-black
   * ground a black shadow is invisible and Android's elevation draws almost
   * nothing, so separation has to come from lightness and edge instead. Pushed
   * further it separates better and starts crushing the muted text that sits
   * on it — `#1e3027` takes `textMuted` under AA — so the border carries the
   * edge and this carries only a hint. `verify:contrast` holds both ends.
   */
  surface: '#1b2b23',

  /**
   * Vivid green: primary actions, the outgoing bubble, active states.
   *
   * Bright enough to carry dark text on top of it (11.14:1), which is what
   * makes it usable as a button fill rather than only as an accent.
   */
  brand: '#35e08a',
  /** 10% brand — icon wells and tag chips. */
  brandWash: 'rgba(53, 224, 138, 0.1)',
  /** 20% brand — the load-more underline. */
  brandHairline: 'rgba(53, 224, 138, 0.2)',
  /**
   * `brandWash` flattened onto `canvas`, for anything that also has elevation.
   *
   * Android composites an elevation shadow *through* a translucent background
   * rather than behind it, so `brandWash` plus `shadow.card` renders as a flat
   * block with a lighter patch where the text sits — which is what the
   * deep-link button in chat looked like. An opaque colour has no such
   * interaction. Same appearance over the canvas, minus the artifact.
   */
  brandChip: '#11291e',

  textPrimary: '#e8f0ea',
  textSecondary: '#a9bdb2',
  /*
   * Lightened from the first attempt at this palette. At `#7e948a` it measured
   * 4.58:1 on the surface — over the AA line by a hundredth, which is not a
   * margin, it is a coincidence. This has room to survive a surface that moves
   * again.
   */
  textMuted: '#89a096',
  /** 60% of textSecondary — timestamps in History. */
  textFaint: 'rgba(169, 189, 178, 0.6)',

  /*
   * Lighter than the ground by enough to be seen.
   *
   * The first attempt at this palette reused the warm scheme's border weight
   * and came out at 1.43:1 against the canvas — a card with no visible edge.
   * On paper a border is darker than the page; on a dark ground it has to be
   * lighter, and by more than a straight inversion suggests.
   */
  border: '#415e4e',
  /*
   * 0.7 rather than 0.6. At 0.6 this landed on 1.49:1 over `surface` — a
   * hairline that is technically present and reads as absent. The check
   * caught it; the eye would have called the cards edgeless and left it
   * unexplained.
   */
  borderSoft: 'rgba(65, 94, 78, 0.7)',
  borderFaint: 'rgba(65, 94, 78, 0.4)',

  /** Neutral accent — "flat navigation" tags and inactive chips. */
  neutralWash: 'rgba(65, 94, 78, 0.45)',
  neutralChip: '#1e2d26',

  /** Warm accent — the "real-time" scenario. */
  gold: '#e0b64a',
  goldWash: 'rgba(224, 182, 74, 0.28)',

  /**
   * Content sitting *on* `brand` — the pill mascot, primary button labels,
   * the onboarding check. Near-black rather than pure black: the green is
   * bright, and true black on it reads harsher than the ground it sits over.
   */
  onBrand: '#06110c',

  /**
   * Warm red for failures. Kept warm rather than turned green-adjacent: a
   * palette where the working colour and the failure colour are neighbours is
   * one where a user cannot tell at a glance which happened.
   */
  danger: '#ff6b52',
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
