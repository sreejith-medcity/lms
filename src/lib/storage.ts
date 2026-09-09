import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { $Enums } from '@prisma/client';

/**
 * S3 request signing, by hand.
 *
 * The AWS SDK is 20 MB of JavaScript to produce a signature that is 60 lines of
 * HMAC. On Hostinger's shared plan the install step is already the slowest part
 * of a deploy, so this stays dependency-free. It speaks plain SigV4 query
 * signing, which every S3-compatible store understands: Cloudflare R2 (what we
 * use, because egress is free and learners stream recordings all day), AWS S3,
 * Backblaze, MinIO. Swapping provider is four environment variables.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface StorageConfig {
  origin: string;
  basePath: string;
  host: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicBase?: string;
}

let cached: StorageConfig | null | undefined;

export function storageConfig(): StorageConfig | null {
  if (cached !== undefined) return cached;

  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKey = process.env.S3_ACCESS_KEY?.trim();
  const secretKey = process.env.S3_SECRET_KEY?.trim();

  if (!endpoint || !bucket || !accessKey || !secretKey) {
    cached = null;
    return null;
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    console.error('[storage] S3_ENDPOINT is not a valid URL');
    cached = null;
    return null;
  }

  cached = {
    origin: url.origin,
    basePath: url.pathname.replace(/\/+$/, ''),
    host: url.host,
    region: process.env.S3_REGION?.trim() || 'auto',
    bucket,
    accessKey,
    secretKey,
    publicBase: process.env.S3_PUBLIC_BASE_URL?.trim() || undefined,
  };
  return cached;
}

export function storageConfigured(): boolean {
  return storageConfig() !== null;
}

/* Signing ----------------------------------------------------------------- */

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
  const c = storageConfig();
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

/** Short-lived read URL. The content type and filename are forced by the store. */
export function signedReadUrl(
  key: string,
  opts: { expiresIn?: number; mimeType?: string | null; downloadName?: string | null } = {},
): string {
  const extra: Record<string, string> = {};
  if (opts.mimeType) extra['response-content-type'] = opts.mimeType;
  if (opts.downloadName) {
    extra['response-content-disposition'] = `attachment; filename="${opts.downloadName.replace(/"/g, '')}"`;
  }
  return presign('GET', key, opts.expiresIn ?? 900, extra);
}

/* Object helpers ---------------------------------------------------------- */

/** Object keys are tenant-scoped and date-partitioned, so a bucket listing reads. */
export function buildObjectKey(organizationId: string, fileName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safe = sanitiseFileName(fileName);
  return `org/${organizationId}/${yyyy}/${mm}/${randomUUID()}-${safe}`;
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

/** Confirms the browser's upload actually landed, and returns the real size. */
export async function headObject(key: string): Promise<{ size: number; mimeType: string | null } | null> {
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
  try {
    const res = await fetch(presign('DELETE', key, 300), { method: 'DELETE' });
    return res.ok || res.status === 404;
  } catch (err) {
    console.error('[storage] delete failed', err);
    return false;
  }
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

export function inferType(fileName: string): $Enums.MaterialType {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[ext] ?? 'ZIP';
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

/** Material types whose bytes we hold ourselves, rather than linking out. */
export const UPLOADABLE_TYPES: $Enums.MaterialType[] = [
  'VIDEO', 'AUDIO', 'PDF', 'IMAGE', 'DOC', 'SHEET', 'SLIDE', 'ZIP', 'SCORM', 'EPUB',
];

export function isUploadable(type: string): boolean {
  return (UPLOADABLE_TYPES as string[]).includes(type);
}
