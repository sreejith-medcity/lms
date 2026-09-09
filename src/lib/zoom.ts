import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveIntegration } from '@/lib/integration-store';

/**
 * Zoom, server to server.
 *
 * Server-to-server OAuth rather than the old JWT apps, which Zoom retired, and
 * rather than a user-authorised app, which would tie every class to one person's
 * login and break the week they leave.
 *
 * The token lasts an hour and is cached in the process. Asking Zoom for a fresh
 * token on every call is a rate limit waiting to happen on a morning when forty
 * classes are created at once.
 */

interface Token {
  value: string;
  expiresAt: number;
}

const tokens = new Map<string, Token>();

export interface ZoomClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  accountId: string;
}

export class ZoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when trying again will not help: a wrong scope, a deleted meeting. */
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'ZoomError';
  }
}

export async function zoomFor(organizationId: string): Promise<ZoomClient | null> {
  const resolved = await resolveIntegration(organizationId, 'zoom');
  if (!resolved?.complete) return null;

  const { accountId, clientId, clientSecret } = resolved.values;

  async function token(): Promise<string> {
    const cached = tokens.get(organizationId);
    // Sixty seconds of headroom, so a token does not expire between being read
    // and being used.
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
      { method: 'POST', headers: { authorization: `Basic ${auth}` }, cache: 'no-store' },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new ZoomError(
        `Zoom refused the credentials (${response.status}). ${text.slice(0, 160)}`,
        response.status,
        response.status === 400 || response.status === 401,
      );
    }

    const parsed = JSON.parse(text) as { access_token: string; expires_in: number };
    tokens.set(organizationId, {
      value: parsed.access_token,
      expiresAt: Date.now() + parsed.expires_in * 1000,
    });
    return parsed.access_token;
  }

  return {
    accountId,
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const access = await token();
      const response = await fetch(`https://api.zoom.us/v2${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${access}`,
          'content-type': 'application/json',
        },
        cache: 'no-store',
      });

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      if (!response.ok) {
        throw new ZoomError(
          `Zoom answered ${response.status}. ${text.slice(0, 200)}`,
          response.status,
          response.status >= 400 && response.status < 500 && response.status !== 429,
        );
      }
      return JSON.parse(text) as T;
    },
  };
}

export interface CreatedMeeting {
  meetingId: string;
  joinUrl: string;
  hostUrl: string;
  hostId: string;
}

export async function createMeeting(
  client: ZoomClient,
  input: {
    hostEmail?: string;
    topic: string;
    startsAt: Date;
    minutes: number;
    timezone: string;
    autoRecord: boolean;
    agenda?: string;
  },
): Promise<CreatedMeeting> {
  // "me" is the account owner. A named host email is better where the trainer
  // has a licensed Zoom seat, because the meeting then appears in their own app.
  const host = input.hostEmail || 'me';

  const created = await client.request<{
    id: number;
    join_url: string;
    start_url: string;
    host_id: string;
  }>(`/users/${encodeURIComponent(host)}/meetings`, {
    method: 'POST',
    body: JSON.stringify({
      topic: input.topic.slice(0, 200),
      type: 2, // scheduled
      start_time: input.startsAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      duration: Math.max(1, input.minutes),
      timezone: input.timezone,
      agenda: input.agenda?.slice(0, 2000),
      settings: {
        join_before_host: false,
        waiting_room: true,
        // Cloud recording needs a paid plan. Where it is not available Zoom
        // ignores this rather than failing, so the class still happens.
        auto_recording: input.autoRecord ? 'cloud' : 'none',
        approval_type: 2,
        mute_upon_entry: true,
      },
    }),
  });

  return {
    meetingId: String(created.id),
    joinUrl: created.join_url,
    hostUrl: created.start_url,
    hostId: created.host_id,
  };
}

export async function updateMeeting(
  client: ZoomClient,
  meetingId: string,
  input: { topic?: string; startsAt?: Date; minutes?: number; timezone?: string },
): Promise<void> {
  await client.request(`/meetings/${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(input.topic ? { topic: input.topic.slice(0, 200) } : {}),
      ...(input.startsAt
        ? { start_time: input.startsAt.toISOString().replace(/\.\d{3}Z$/, 'Z') }
        : {}),
      ...(input.minutes ? { duration: Math.max(1, input.minutes) } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    }),
  });
}

export async function deleteMeeting(client: ZoomClient, meetingId: string): Promise<void> {
  try {
    await client.request(`/meetings/${meetingId}`, { method: 'DELETE' });
  } catch (err) {
    // A meeting somebody already deleted in Zoom is the state we wanted.
    if (err instanceof ZoomError && err.status === 404) return;
    throw err;
  }
}

export interface ZoomRecordingFile {
  id: string;
  fileType: string;
  fileSize: number;
  downloadUrl: string;
  recordingStart: string;
  playUrl: string | null;
}

export async function meetingRecordings(
  client: ZoomClient,
  meetingId: string,
): Promise<ZoomRecordingFile[]> {
  try {
    const data = await client.request<{
      recording_files?: {
        id: string;
        file_type: string;
        file_size: number;
        download_url: string;
        recording_start: string;
        play_url?: string;
      }[];
    }>(`/meetings/${meetingId}/recordings`);

    return (data.recording_files ?? [])
      .filter((file) => file.file_type === 'MP4')
      .map((file) => ({
        id: file.id,
        fileType: file.file_type,
        fileSize: file.file_size,
        downloadUrl: file.download_url,
        recordingStart: file.recording_start,
        playUrl: file.play_url ?? null,
      }));
  } catch (err) {
    if (err instanceof ZoomError && err.status === 404) return [];
    throw err;
  }
}

/**
 * Zoom's webhook signature.
 *
 * v0 HMAC over the timestamp and the raw body. The raw body matters: parsing
 * and re-serialising changes the bytes and the signature stops matching, which
 * is the single most common way this is got wrong.
 */
export function verifyZoomSignature(input: {
  secret: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
}): boolean {
  if (!input.signature || !input.timestamp) return false;

  // Reject anything older than five minutes, so a captured delivery cannot be
  // replayed indefinitely.
  const age = Math.abs(Date.now() / 1000 - Number(input.timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = `v0=${createHmac('sha256', input.secret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest('hex')}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Zoom's one-off endpoint validation handshake. */
export function validationResponse(secret: string, plainToken: string) {
  return {
    plainToken,
    encryptedToken: createHmac('sha256', secret).update(plainToken).digest('hex'),
  };
}
