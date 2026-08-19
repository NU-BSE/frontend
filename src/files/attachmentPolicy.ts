/**
 * Pure attachment policy: limits, classification and validation.
 *
 * Deliberately free of any platform import so it can be unit-tested in Node
 * and reused by the picker, the composer and the transport. Keeps the MIME /
 * extension rules in one place, oriented primarily on MIME type rather than a
 * hardcoded extension list.
 */
import type { ChatAttachmentKind } from '@/agent/types';

/** Max files attached to a single message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
/** Max size of a single file (10 MB). */
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

/** Extensions that are always rejected regardless of MIME type. */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'apk', 'bat', 'cmd', 'com', 'msi', 'scr', 'cpl', 'pif', 'gadget',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'wsh',
  'dll', 'so', 'dylib', 'jar', 'bin', 'elf', 'dex',
]);

/** MIME types/prefixes that are treated as executables / unsafe. */
const BLOCKED_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'application/x-shellscript',
  'application/vnd.android.package-archive',
  'application/x-dosexec',
  'application/x-elf',
  'application/x-mach-binary',
  'application/java-archive',
];

const IMAGE_MIME = /^image\//u;
const AUDIO_MIME = /^audio\//u;
const VIDEO_MIME = /^video\//u;
const TEXT_MIME = /^text\//u;
const DOCUMENT_MIME =
  /^(application\/(pdf|json|msword|rtf|csv|x-csv)|application\/vnd\.(oasis\.opendocument|openxmlformats-officedocument|ms-(excel|powerpoint|word))|application\/x-(pdf|msword))/u;

export function classifyAttachmentKind(mimeType: string): ChatAttachmentKind {
  if (IMAGE_MIME.test(mimeType)) return 'image';
  if (AUDIO_MIME.test(mimeType)) return 'audio';
  if (VIDEO_MIME.test(mimeType)) return 'video';
  if (TEXT_MIME.test(mimeType) || DOCUMENT_MIME.test(mimeType)) {
    return 'document';
  }
  return 'other';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** True when the file is an executable or otherwise unsafe to attach. */
export function isUnsafeAttachment(name: string, mimeType: string): boolean {
  const ext = extensionOf(name);
  if (ext && BLOCKED_EXTENSIONS.has(ext)) return true;
  return BLOCKED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

/** Returns a human-readable reason to reject, or null when the file is fine. */
export function attachmentValidationError(
  name: string,
  mimeType: string,
  size: number,
): string | null {
  if (size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `${name} is ${formatFileSize(size)} — larger than the ${formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)} limit.`;
  }
  if (isUnsafeAttachment(name, mimeType)) {
    return `${name} can't be attached: executable files are not supported.`;
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
