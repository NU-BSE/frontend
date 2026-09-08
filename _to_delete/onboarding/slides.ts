/**
 * Onboarding copy and sequence.
 *
 * Kept as data, not JSX, so the Figma-driven layout can change independently
 * of the content, and so slide count is not baked into the pager.
 */
export interface OnboardingSlide {
  id: string;
  title: string;
  body: string;
}

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    id: 'watch',
    title: 'Someone is already reading',
    body: 'Creepy.IM is a feed that reads back. Every post you open is opened alongside you.',
  },
  {
    id: 'private',
    title: 'It never leaves your phone',
    body: 'The model runs on this device. Your messages are not uploaded, not logged, and not for sale.',
  },
  {
    id: 'begin',
    title: 'Say something first',
    body: 'It responds to what you write. It also responds to how long you wait before writing it.',
  },
];
