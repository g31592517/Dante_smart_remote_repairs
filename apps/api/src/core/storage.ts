import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

/**
 * Local-disk storage. `private/` holds customer uploads and is never web-served; files are streamed
 * only after an authorisation check. `public/` holds catalogue images served at /media.
 * To move to S3-compatible storage, re-implement these four functions; callers only see storage keys.
 */
const root = () => path.resolve(env.STORAGE_DIR);
export const privateStorageDir = () => path.join(root(), 'private');
export const publicStorageDir = () => path.join(root(), 'public');

export async function ensureStorageDirs() {
  await mkdir(privateStorageDir(), { recursive: true });
  await mkdir(path.join(publicStorageDir(), 'products'), { recursive: true });
}

/** Allow-list by detected content (magic bytes), not by the client-supplied name or MIME type. */
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface StoredFile {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

function looksLikePlainText(buf: Buffer) {
  if (buf.includes(0)) return false;
  const text = buf.toString('utf8');
  return !text.includes('�') && !/<\s*(script|html|svg|iframe)/i.test(text);
}

async function detect(buf: Buffer, originalName: string, imagesOnly: boolean): Promise<{ mime: string; ext: string }> {
  const ft = await fileTypeFromBuffer(buf);
  if (ft && ALLOWED[ft.mime] && (!imagesOnly || IMAGE_TYPES.has(ft.mime))) return { mime: ft.mime, ext: ALLOWED[ft.mime]! };
  // Plain-text logs/error dumps have no magic bytes: accept .txt/.log only if the content really is text.
  if (!imagesOnly && !ft && /\.(txt|log)$/i.test(originalName) && looksLikePlainText(buf)) return { mime: 'text/plain', ext: 'txt' };
  throw new AppError(
    415,
    'UNSUPPORTED_MEDIA_TYPE',
    imagesOnly ? 'Only JPEG, PNG or WebP images are accepted' : 'Unsupported file type. Upload images (JPEG/PNG/WebP/GIF), PDF, Word/Excel documents or .txt logs.',
  );
}

export async function savePrivateFile(buf: Buffer, originalName: string, opts: { imagesOnly?: boolean } = {}): Promise<StoredFile> {
  const { mime, ext } = await detect(buf, originalName, !!opts.imagesOnly);
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
  const full = path.join(privateStorageDir(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { flag: 'wx' });
  return { storageKey: key, mimeType: mime, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

export async function savePublicProductImage(buf: Buffer, originalName: string): Promise<string> {
  const { ext } = await detect(buf, originalName, true);
  const key = `products/${randomUUID()}.${ext}`;
  await mkdir(path.join(publicStorageDir(), 'products'), { recursive: true });
  await writeFile(path.join(publicStorageDir(), key), buf, { flag: 'wx' });
  return key;
}

function safeJoin(base: string, key: string) {
  const full = path.resolve(base, key);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid storage key');
  return full;
}

export function readPrivateFile(key: string): Promise<Buffer> {
  return readFile(safeJoin(privateStorageDir(), key));
}

export async function deletePublicFile(key: string) {
  await unlink(safeJoin(publicStorageDir(), key)).catch(() => undefined);
}
