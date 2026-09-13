import { createHash, createPrivateKey, sign } from 'node:crypto';

/**
 * The signed-playback arithmetic, kept apart from the HTTP so it can be
 * tested with a throwaway key. Cloudflare Stream and Mux both want an
 * RS256 JWT; Bunny wants a SHA-256 of key, id and expiry.
 */

export type StreamState = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The providers hand out the private key as base64 of a PEM. Accept that,
 * or the PEM itself, or a PEM with the newlines flattened by a form field.
 */
export function pemFrom(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.includes('-----BEGIN')) return Buffer.from(trimmed, 'base64').toString('utf8');
  if (trimmed.includes('\n')) return trimmed;
  // Flattened by a form field: put the lines back.
  const m = /-----BEGIN ([A-Z ]+)-----\s*(.*?)\s*-----END ([A-Z ]+)-----/.exec(trimmed);
  if (!m) return trimmed;
  const body = m[2].replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${m[1]}-----\n${lines.join('\n')}\n-----END ${m[3]}-----\n`;
}

/** A compact JWS, RS256, the way both Stream and Mux verify it. */
export function rs256Jwt(header: Record<string, unknown>, payload: Record<string, unknown>, pem: string): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), createPrivateKey(pemFrom(pem)));
  return `${head}.${body}.${b64url(signature)}`;
}

/** Cloudflare Stream: kid in the header, the video uid as sub. */
export function cloudflareStreamToken(input: { keyId: string; pem: string; videoId: string; expiresAt: Date; downloadable?: boolean }): string {
  return rs256Jwt(
    { kid: input.keyId },
    {
      sub: input.videoId,
      kid: input.keyId,
      exp: Math.floor(input.expiresAt.getTime() / 1000),
      accessRules: [{ type: 'any', action: 'allow' }],
      ...(input.downloadable ? { downloadable: true } : {}),
    },
    input.pem,
  );
}

/** Mux: the playback id as sub, aud v for video, t for thumbnails. */
export function muxToken(input: { keyId: string; pem: string; playbackId: string; expiresAt: Date; audience: 'v' | 't' | 'g' }): string {
  return rs256Jwt(
    { kid: input.keyId },
    { sub: input.playbackId, aud: input.audience, exp: Math.floor(input.expiresAt.getTime() / 1000), kid: input.keyId },
    input.pem,
  );
}

/** Bunny Stream token authentication: sha256(key + videoId + expires), hex. */
export function bunnyToken(input: { securityKey: string; videoId: string; expires: number }): string {
  return createHash('sha256').update(`${input.securityKey}${input.videoId}${input.expires}`).digest('hex');
}

/** The provider's words for where a video is, folded into ours. */
export function cloudflareState(state: string | undefined, readyToStream: boolean | undefined): StreamState {
  if (readyToStream || state === 'ready') return 'READY';
  if (state === 'error') return 'FAILED';
  if (state === 'inprogress' || state === 'queued' || state === 'downloading') return state === 'downloading' || state === 'queued' ? 'QUEUED' : 'PROCESSING';
  if (state === 'pendingupload') return 'QUEUED';
  return 'PROCESSING';
}

export function muxState(status: string | undefined): StreamState {
  if (status === 'ready') return 'READY';
  if (status === 'errored') return 'FAILED';
  if (status === 'preparing') return 'PROCESSING';
  return 'QUEUED';
}

/** Bunny: 0 queued, 1 processing, 2 encoding, 3 finished, 4 resolution finished, 5 failed, 6 presigned upload started. */
export function bunnyState(status: number | undefined): StreamState {
  if (status === 3 || status === 4) return 'READY';
  if (status === 5) return 'FAILED';
  if (status === 1 || status === 2) return 'PROCESSING';
  return 'QUEUED';
}

/** How long a playback link lives: long enough for a class, short enough that a copied link dies. */
export function playbackExpiry(minutes: number, now = new Date()): Date {
  const m = Math.max(30, Math.min(24 * 60, Math.round(minutes) || 240));
  return new Date(now.getTime() + m * 60_000);
}

/** Whether a page should ask the provider again, or trust what it knows. */
export function dueForCheck(status: string | null, checkedAt: Date | null, now = new Date()): boolean {
  if (status !== 'QUEUED' && status !== 'PROCESSING') return false;
  if (!checkedAt) return true;
  return now.getTime() - checkedAt.getTime() > 45_000;
}
