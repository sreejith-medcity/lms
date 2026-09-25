import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveIntegration } from '@/lib/integration-store';

/**
 * Medcity Meet, our own class platform (meet.medcitylms.in).
 *
 * It replaces Zoom for the reason Zoom was a problem: one Zoom seat runs one or
 * two meetings at a time, and an academy runs forty. Meet has no such limit.
 *
 * Each class here is one meeting there, found again by `lms-<session id>`, so
 * nothing but the Meet code needs storing. Learners never see a bare Meet
 * link: pressing Join mints a link for that person, which is how Meet knows
 * who they are without a second login and how attendance comes back tied to
 * the right learner.
 */

export class MeetError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'MeetError';
  }
  /** Retrying will not help: a bad key, a bad request. */
  get permanent() {
    return this.status === 401 || this.status === 403 || this.status === 400;
  }
}

export interface MeetClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  webhookSecret: string | null;
}

export const meetRef = (sessionId: string) => `lms-${sessionId}`;

export async function meetFor(organizationId: string): Promise<MeetClient | null> {
  const resolved = await resolveIntegration(organizationId, 'medcity_meet');
  if (!resolved) return null;
  const { apiUrl, apiKey, webhookSecret } = resolved.values;
  if (!apiKey) return null;
  const base = (apiUrl || 'https://meet.medcitylms.in/api/v1').replace(/\/+$/, '');

  return {
    webhookSecret: webhookSecret || null,
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      if (!response.ok) {
        throw new MeetError(data.error?.message ?? `Meet answered ${response.status}`, response.status, data.error?.code ?? 'error');
      }
      return data as T;
    },
  };
}

export interface MeetMeeting {
  code: string;
  externalId: string | null;
  joinUrl: string;
  status: string;
}

export async function createClass(
  client: MeetClient,
  input: {
    sessionId: string;
    title: string;
    topics?: string | null;
    hostEmail: string;
    hostName?: string;
    startsAt: Date;
    minutes: number;
    timezone: string;
    oneToOne: boolean;
    autoRecord: boolean;
  },
): Promise<MeetMeeting> {
  const res = await client.request<{ meeting: MeetMeeting }>('/meetings', {
    method: 'POST',
    body: JSON.stringify({
      externalId: meetRef(input.sessionId),
      title: input.title.slice(0, 120),
      description: input.topics ?? undefined,
      type: input.oneToOne ? 'ONE_ON_ONE' : 'GROUP',
      hostEmail: input.hostEmail,
      hostName: input.hostName,
      start: input.startsAt.toISOString(),
      durationMin: Math.max(5, Math.min(600, input.minutes)),
      timezone: input.timezone,
      // Only people sent from here get in: a leaked link opens nothing.
      settings: { allowGuests: false, muteOnEntry: true, waitingRoom: false, autoRecord: input.autoRecord },
      notify: false,
    }),
  });
  return res.meeting;
}

export async function moveClass(client: MeetClient, sessionId: string, input: { title: string; startsAt: Date; minutes: number }) {
  await client.request(`/meetings/${encodeURIComponent(meetRef(sessionId))}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: input.title.slice(0, 120), start: input.startsAt.toISOString(), durationMin: Math.max(5, Math.min(600, input.minutes)) }),
  });
}

export async function cancelClass(client: MeetClient, sessionId: string) {
  await client.request(`/meetings/${encodeURIComponent(meetRef(sessionId))}`, { method: 'DELETE' });
}

/** A link for one person, made at the moment they press Join. */
export async function joinLinkFor(
  client: MeetClient,
  sessionId: string,
  person: { id: string; name: string; email: string | null; host: boolean },
): Promise<string> {
  const res = await client.request<{ url: string }>(`/meetings/${encodeURIComponent(meetRef(sessionId))}/join-links`, {
    method: 'POST',
    body: JSON.stringify({
      role: person.host && person.email ? 'host' : 'participant',
      name: person.name.slice(0, 60) || 'Learner',
      externalUserId: person.id,
      ...(person.email ? { email: person.email } : {}),
    }),
  });
  return res.url;
}

export interface MeetRecording {
  id: string;
  status: string;
  playbackUrl: string | null;
  downloadUrl: string | null;
}

export async function recordingLinks(client: MeetClient, code: string, recordingId: string): Promise<MeetRecording | null> {
  const res = await client.request<{ recordings: MeetRecording[] }>(`/meetings/${encodeURIComponent(code)}/recordings`);
  return res.recordings.find((r) => r.id === recordingId) ?? null;
}

/** Meet signs with `t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. Ten minutes of clock drift allowed. */
export function verifyMeetSignature(secret: string, rawBody: string, header: string | null): boolean {
  const m = header?.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
  if (!m) return false;
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > 600) return false;
  const want = createHmac('sha256', secret).update(`${m[1]}.${rawBody}`).digest('hex');
  return timingSafeEqual(Buffer.from(want), Buffer.from(m[2]!));
}

/** Recordings stay in Meet's storage; the asset row points at them with this key. */
export const MEET_ASSET_PREFIX = 'medcity-meet:';
export const meetAssetKey = (code: string, recordingId: string) => `${MEET_ASSET_PREFIX}${code}:${recordingId}`;
export function parseMeetAssetKey(key: string): { code: string; recordingId: string } | null {
  if (!key.startsWith(MEET_ASSET_PREFIX)) return null;
  const [code, recordingId] = key.slice(MEET_ASSET_PREFIX.length).split(':');
  return code && recordingId ? { code, recordingId } : null;
}
