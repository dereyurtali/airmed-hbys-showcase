// C3 hasta foto arşivi — frontend constants.

export type PhotoTag =
  | 'preop'
  | 'postop'
  | 'intraop'
  | 'oct'
  | 'fundus'
  | 'topography'
  | 'device_output'
  | 'general';

export const PHOTO_TAGS: PhotoTag[] = [
  'preop',
  'postop',
  'intraop',
  'oct',
  'fundus',
  'topography',
  'device_output',
  'general',
];

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_PHOTO_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
