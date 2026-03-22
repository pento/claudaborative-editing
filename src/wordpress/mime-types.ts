/**
 * MIME type detection for WordPress media uploads.
 *
 * Maps file extensions to MIME types for the media types WordPress accepts.
 * Uses a static lookup table — no external dependencies.
 */

import { extname } from 'node:path';

/** Media category derived from MIME type prefix. */
export type MediaCategory = 'image' | 'video' | 'audio' | 'application';

/** Map of file extensions to MIME types for WordPress-supported media. */
const MIME_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  // Video
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/avi',
  '.wmv': 'video/x-ms-wmv',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.3gp': 'video/3gpp',
  // Audio
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
};

/**
 * Get the MIME type for a file based on its extension.
 * Throws if the extension is not in the supported set.
 */
export function getMimeType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    throw new Error(
      `Unsupported file type: ${ext || '(no extension)'}. ` +
        `Supported types: ${Object.keys(MIME_TYPES).join(', ')}`,
    );
  }
  return mime;
}

/**
 * Derive the media category from a MIME type string.
 * Returns 'image', 'video', 'audio', or 'application'.
 */
export function getMediaCategory(mimeType: string): MediaCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'application';
}
