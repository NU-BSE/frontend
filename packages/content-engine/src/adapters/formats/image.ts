import type { DocumentFormatAdapter } from '../../contracts/adapters';

/**
 * Placeholder contract for future image metadata/content adapters.
 *
 * Images are not turned into a large generic JS object; the adapter exposes
 * metadata (width/height/mime/orientation) and, on request, OCR / resize /
 * crop / rotate / extract-metadata. Preprocessing via expo-image-manipulator,
 * OCR via on-device ML Kit.
 */
export interface ImageFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'image';
}
