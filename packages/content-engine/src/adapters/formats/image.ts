import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for future image metadata/content adapters. */
export interface ImageFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'image';
  readonly formats: readonly ['image'];
}
