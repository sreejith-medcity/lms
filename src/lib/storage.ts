import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { $Enums } from '@prisma/client';

/**
 * Two storage drivers behind one shape.
 *
 *   local  files on the server's own disk, served through /media with a signed,
 *          cacheable path so Hostinger's CDN can hold the bytes at the edge.
 *          This is the demo footing: no external account, nothing to sign up for.
 *
 *   s3     any S3-compatible bucket, uploaded to directly by the browser with a
 *          presigned PUT. This is the production footing. Google Cloud Storage
 *          speaks the same XML API with HMAC keys, so the eventual GCP move is
 *          four environment variables and a file copy, not a rewrite.
 *
 * Everything above this file asks for "an upload target" and "a read URL" and
 * never learns which driver answered.
 */

export type StorageDriver = 'local' | 's3';

/* Configuration ----------------------------------------------------------- */

export interface S3Config {
  origin: string;
  basePath: string;
  host: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

let cachedS3: S3Config | null | undefined;

export function s3Config(): S3Config | null {
  if (cachedS3 !== undefined) return cachedS3;

  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKey = process.env.S3_ACCESS_KEY?.trim();
  const secretKey = process.env.S3_SECRET_KEY?.trim();

  if (!endpoint || !bucket || !accessKey || !secretKey) {
    cachedS3 = null;
    return null;
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    console.error('[storage] S3_ENDPOINT is not a valid URL');
    cachedS3 = null;
    return null;
  }

  cachedS3 = {
    origin: url.origin,
    basePath: url.pathname.replace(/\/+$/, ''),
    host: url.host,
    region: process.env.S3_REGION?.trim() || 'auto',
    bucket,
    accessKey,
    secretKey,
  };
  return cachedS3;
}

/**
 * Kept outside the deploy directory on purpose. Hostinger rebuilds the repo on
 * every push, and uploads that live inside it would be one bad deploy away from
 * gone.
 */
export function localRoot(): string {
  return resolve(process.env.STORAGE_DIR?.trim() || join(homedir(), 'lms-storage'));
}

export function storageDriver(): StorageDriver {
  const forced = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (forced === 's3') return 's3';
  if (forced === 'local') return 'local';
  return s3Config() ? 's3' : 'local';
}

/** Local disk always works, so storage is only unconfigured if S3 was asked for and is half-set. */
export function storageConfigured(): boolean {
  return storageDriver() === 'local' || s3Config() !== null;
}

function signingSecret(): string {
  return process.env.AUTH_SECRET || 'insecure-development-secret';
}

/* SigV4 ------------------------------------------------------------------- */

const ALGORITHM = 'AWS4-HMAC-SHA256';

/** RFC 3986, which is stricter than encodeURIComponent about these five. */
function enc(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function encodeKey(key: string): string {
  return key.split('/').map(enc).join('/');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

type Method = 'GET' | 'PUT' | 'HEAD' | 'DELETE';

/**
 * A presigned URL. The payload is unsigned so the browser can stream a 2 GB
 * recording straight to the bucket without hashing it first, and without the
 * bytes ever touching our Node process.
 */
export function presign(
  method: Method,
  key: string,
  expiresIn = 900,
  extraQuery: Record<string, string> = {},
): string {
  const c = s3Config();
  if (!c) throw new Error('STORAGE_NOT_CONFIGURED');

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${c.region}/s3/aws4_request`;

  const query: Record<string, string> = {
    ...extraQuery,
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${c.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join('&');

  const canonicalUri = `${c.basePath}/${c.bucket}/${encodeKey(key)}`;

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${c.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = hmac(
    hmac(hmac(hmac(hmac('AWS4' + c.secretKey, dateStamp), c.region), 's3'), 'aws4_request'),
    stringToSign,
  ).toString('hex');

  return `${c.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/* Local paths and signatures ---------------------------------------------- */

/** Refuses anything that could climb out of the storage root. */
export function localPathFor(key: string): string {
  const root = localRoot();
  const full = resolve(root, key);
  if (full !== root && !full.startsWith(root + sep)) throw new Error('BAD_KEY');
  return full;
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url').slice(0, 32);
}

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The public read path for a locally stored file.
 *
 * It carries no expiry, and that is deliberate: a URL that changes every five
 * minutes cannot be cached, and the whole point of putting a CDN in front is
 * that the second learner to open a recording never reaches the server. Access
 * is decided once, at /api/assets, before this URL is handed over. Rotating
 * AUTH_SECRET invalidates every one of them at once.
 */
export function mediaPath(key: string): string {
  return `/media/${sign(`media:${key}`)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function verifyMediaPath(signature: string, key: string): boolean {
  return sameSignature(signature, sign(`media:${key}`));
}

/** One-hour ticket that lets the browser write to exactly one object key. */
export function uploadToken(key: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${exp}.${sign(`upload:${key}:${exp}`)}`;
}

export function verifyUploadToken(token: string, key: string): boolean {
  const [expPart, signature] = token.split('.');
  const exp = Number(expPart);
  if (!exp || !signature || exp < Math.floor(Date.now() / 1000)) return false;
  return sameSignature(signature, sign(`upload:${key}:${exp}`));
}

/* The driver-agnostic surface --------------------------------------------- */

export interface UploadTarget {
  driver: StorageDriver;
  /** s3: a presigned PUT. local: /api/uploads/<assetId>, which takes the file in chunks. */
  url: string;
  token?: string;
}

export function uploadTargetFor(assetId: string, key: string): UploadTarget {
  if (storageDriver() === 's3') {
    return { driver: 's3', url: presign('PUT', key, 3600) };
  }
  return { driver: 'local', url: `/api/uploads/${assetId}`, token: uploadToken(key) };
}

/** Where a player should actually fetch the bytes from. */
export function readUrlFor(
  key: string,
  opts: { expiresIn?: number; mimeType?: string | null; downloadName?: string | null } = {},
): string {
  if (storageDriver() === 'local') {
    const base = mediaPath(key);
    return opts.downloadName ? `${base}?download=1` : base;
  }

  const extra: Record<string, string> = {};
  if (opts.mimeType) extra['response-content-type'] = opts.mimeType;
  if (opts.downloadName) {
    extra['response-content-disposition'] = `attachment; filename="${opts.downloadName.replace(/"/g, '')}"`;
  }
  return presign('GET', key, opts.expiresIn ?? 900, extra);
}

/** Confirms the upload actually landed, and returns the real size. */
export async function statObject(key: string): Promise<{ size: number; mimeType: string | null } | null> {
  if (storageDriver() === 'local') {
    try {
      const info = await stat(localPathFor(key));
      return info.isFile() ? { size: info.size, mimeType: null } : null;
    } catch {
      return null;
    }
  }

  try {
    const res = await fetch(presign('HEAD', key, 300), { method: 'HEAD' });
    if (!res.ok) return null;
    return {
      size: Number(res.headers.get('content-length') ?? 0),
      mimeType: res.headers.get('content-type'),
    };
  } catch (err) {
    console.error('[storage] head failed', err);
    return null;
  }
}

export async function deleteObject(key: string): Promise<boolean> {
  if (storageDriver() === 'local') {
    try {
      await rm(localPathFor(key), { force: true });
      await rm(localPathFor(`${key}.part`), { force: true });
      return true;
    } catch (err) {
      console.error('[storage] local delete failed', err);
      return false;
    }
  }

  try {
    const res = await fetch(presign('DELETE', key, 300), { method: 'DELETE' });
    return res.ok || res.status === 404;
  } catch (err) {
    console.error('[storage] delete failed', err);
    return false;
  }
}

/* Local chunked writes ---------------------------------------------------- */

/**
 * Appends one chunk to <key>.part, and reports the size so far.
 *
 * `Readable` and `pipeline` are imported at the top of this file rather than
 * dynamically inside here, which is not a style choice. `const { Readable } =
 * await import('node:stream')` works in development and yields undefined in
 * the production bundle, so uploads failed only once deployed, with a message
 * about a chunk that could not be written and a cause nowhere near it.
 */
export async function appendLocalChunk(key: string, body: ReadableStream<Uint8Array>): Promise<number> {
  const partPath = localPathFor(`${key}.part`);
  await mkdir(dirname(partPath), { recursive: true });

  await pipeline(
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(partPath, { flags: 'a' }),
  );

  const info = await stat(partPath);
  return info.size;
}

/** Bytes already written for an in-flight upload, or 0 if it has not started. */
export async function localPartSize(key: string): Promise<number> {
  try {
    const info = await stat(localPathFor(`${key}.part`));
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

export async function finishLocalUpload(key: string): Promise<number> {
  const partPath = localPathFor(`${key}.part`);
  const finalPath = localPathFor(key);
  await rename(partPath, finalPath);
  const info = await stat(finalPath);
  return info.size;
}

export function localReadStream(key: string, start?: number, end?: number) {
  return createReadStream(localPathFor(key), start != null ? { start, end } : undefined);
}

/* Keys and names ---------------------------------------------------------- */

/** Object keys are tenant-scoped and date-partitioned, so a bucket listing reads. */
export function buildObjectKey(organizationId: string, fileName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `org/${organizationId}/${yyyy}/${mm}/${randomUUID()}-${sanitiseFileName(fileName)}`;
}

export function sanitiseFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return (
    base
      .normalize('NFKD')
      .replace(/[^\w.\- ]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+/, '')
      .slice(-120) || 'file'
  );
}

/* File types -------------------------------------------------------------- */

/** Extension is what we trust; browsers disagree about MIME types constantly. */
const TYPE_BY_EXTENSION: Record<string, $Enums.MaterialType> = {
  mp4: 'VIDEO', mov: 'VIDEO', m4v: 'VIDEO', webm: 'VIDEO', mkv: 'VIDEO', avi: 'VIDEO',
  mp3: 'AUDIO', m4a: 'AUDIO', wav: 'AUDIO', aac: 'AUDIO', ogg: 'AUDIO',
  pdf: 'PDF',
  png: 'IMAGE', jpg: 'IMAGE', jpeg: 'IMAGE', gif: 'IMAGE', webp: 'IMAGE', svg: 'IMAGE', avif: 'IMAGE',
  doc: 'DOC', docx: 'DOC', rtf: 'DOC', txt: 'DOC', odt: 'DOC',
  xls: 'SHEET', xlsx: 'SHEET', csv: 'SHEET', ods: 'SHEET',
  ppt: 'SLIDE', pptx: 'SLIDE', key: 'SLIDE', odp: 'SLIDE',
  epub: 'EPUB',
  zip: 'ZIP',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg',
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  epub: 'application/epub+zip', zip: 'application/zip', csv: 'text/csv', txt: 'text/plain',
};

export function inferType(fileName: string): $Enums.MaterialType {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[ext] ?? 'ZIP';
}

export function inferMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** Per-type ceilings. A single PUT tops out near 5 GB on R2, so video sits under it. */
const MAX_BYTES: Partial<Record<$Enums.MaterialType, number>> = {
  VIDEO: 4 * 1024 ** 3,
  AUDIO: 1024 ** 3,
  ZIP: 2 * 1024 ** 3,
  SCORM: 2 * 1024 ** 3,
  PDF: 512 * 1024 ** 2,
  DOC: 256 * 1024 ** 2,
  SHEET: 256 * 1024 ** 2,
  SLIDE: 512 * 1024 ** 2,
  IMAGE: 32 * 1024 ** 2,
  EPUB: 256 * 1024 ** 2,
};

export function maxBytesFor(type: $Enums.MaterialType): number {
  return MAX_BYTES[type] ?? 256 * 1024 ** 2;
}

/* Presentation ------------------------------------------------------------ */

export function formatBytes(bytes: number | bigint): string {
  const n = Number(bytes);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
