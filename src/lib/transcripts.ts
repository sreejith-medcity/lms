import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { settingBool, settingText } from '@/lib/settings/store';
import { fullTextOf, parseCaptions, searchSegments, wordCount, type Segment } from '@/lib/captions';
import { videoProviderFor } from '@/lib/video';
import { playbackExpiry } from '@/lib/video/tokens';

/**
 * Transcripts against the database: saving one, asking the video platform
 * to write one, pulling it in when it is done, and searching across them.
 */

export async function saveTranscript(input: {
  organizationId: string;
  assetId: string;
  segments: Segment[];
  language: string;
  source: 'UPLOAD' | 'PROVIDER' | 'AI';
}): Promise<{ words: number }> {
  const asset = await db.asset.findFirst({ where: { id: input.assetId, organizationId: input.organizationId }, select: { id: true } });
  if (!asset) throw new Error('NOT_FOUND');
  const fullText = fullTextOf(input.segments);
  const words = wordCount(fullText);
  await db.transcript.upsert({
    where: { assetId: asset.id },
    create: {
      assetId: asset.id,
      language: input.language,
      fullText,
      segments: input.segments as unknown as Prisma.InputJsonValue,
      source: input.source,
      wordCount: words,
    },
    update: {
      language: input.language,
      fullText,
      segments: input.segments as unknown as Prisma.InputJsonValue,
      source: input.source,
      wordCount: words,
      // A new transcript makes the old summary and chapters stale.
      summary: null,
      chapters: undefined,
      keyTerms: [],
    },
  });
  await db.asset.update({ where: { id: asset.id }, data: { captionsRequestedAt: null } });

  // Study notes, when the academy wants them written for every lesson.
  if (await settingBool(input.organizationId, 'ai.autoSummaries')) {
    const { summariseLesson } = await import('@/lib/tutor-data');
    await summariseLesson(input.organizationId, asset.id).catch(() => null);
  }
  return { words };
}

export function segmentsOf(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Segment => Boolean(s) && typeof s === 'object' && typeof (s as Segment).start === 'number' && typeof (s as Segment).text === 'string')
    .map((s) => ({ start: s.start, end: typeof s.end === 'number' ? s.end : s.start, text: s.text, ...(s.speaker ? { speaker: s.speaker } : {}) }));
}

export async function transcriptFor(organizationId: string, assetId: string) {
  const row = await db.transcript.findFirst({
    where: { assetId, asset: { organizationId } },
    select: { language: true, segments: true, summary: true, chapters: true, keyTerms: true, source: true, wordCount: true, updatedAt: true },
  });
  if (!row) return null;
  return { ...row, segments: segmentsOf(row.segments) };
}

/** Ask the platform to write captions from the audio. */
export async function requestCaptions(organizationId: string, assetId: string, language?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId, deletedAt: null },
    select: { id: true, name: true, streamProvider: true, streamId: true, streamPlaybackId: true, streamStatus: true },
  });
  if (!asset) return { ok: false, error: 'File not found.' };
  if (asset.streamStatus !== 'READY' || !asset.streamId) return { ok: false, error: 'Captions are written by the video platform once the encode is ready.' };
  const p = await videoProviderFor(organizationId);
  if (!p || p.id !== asset.streamProvider || !p.generateCaptions) return { ok: false, error: 'The video platform in use cannot write captions.' };
  const lang = (language ?? (await settingText(organizationId, 'video.captionLanguage')) ?? 'en').trim() || 'en';
  try {
    await p.generateCaptions({ streamId: asset.streamId, playbackId: asset.streamPlaybackId }, lang);
    await db.asset.update({ where: { id: asset.id }, data: { captionsRequestedAt: new Date() } });
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'OUT', action: `Asked for ${lang} captions on ${asset.name}`, ok: true });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'OUT', action: `Asking for captions on ${asset.name}`, ok: false, detail: message });
    return { ok: false, error: message };
  }
}

/**
 * Pull captions the platform has written into a transcript. Returns what
 * happened so a page can say "still being written" rather than nothing.
 */
export async function pullCaptions(organizationId: string, assetId: string): Promise<'SAVED' | 'NOT_YET' | 'NOTHING' | 'FAILED'> {
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId, deletedAt: null },
    select: { id: true, name: true, streamProvider: true, streamId: true, streamPlaybackId: true, captionsRequestedAt: true },
  });
  if (!asset?.captionsRequestedAt || !asset.streamId) return 'NOTHING';
  const p = await videoProviderFor(organizationId);
  if (!p || p.id !== asset.streamProvider || !p.fetchCaption) return 'NOTHING';
  const lang = (await settingText(organizationId, 'video.captionLanguage')).trim() || 'en';
  try {
    const vtt = await p.fetchCaption({ streamId: asset.streamId, playbackId: asset.streamPlaybackId }, lang, playbackExpiry(30));
    if (!vtt) {
      // Not ready: push the next try out a little so a busy page does not hammer.
      await db.asset.update({ where: { id: asset.id }, data: { captionsRequestedAt: new Date() } });
      return 'NOT_YET';
    }
    const segments = parseCaptions(vtt);
    if (segments.length === 0) return 'NOT_YET';
    await saveTranscript({ organizationId, assetId: asset.id, segments, language: lang, source: 'PROVIDER' });
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'IN', action: `Captions for ${asset.name}`, ok: true, records: segments.length });
    return 'SAVED';
  } catch (err) {
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'IN', action: `Pulling captions for ${asset.name}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
    return 'FAILED';
  }
}

/** Captions asked for and not yet back for at least this long get another look. */
export function captionsDue(requestedAt: Date | null, now = new Date()): boolean {
  return Boolean(requestedAt) && now.getTime() - (requestedAt as Date).getTime() > 90_000;
}

/** After an encode is ready: ask for captions if the academy wants them written automatically. */
export async function captionsAfterEncode(organizationId: string, assetId: string): Promise<void> {
  if (!(await settingBool(organizationId, 'video.autoCaptions'))) return;
  const existing = await db.transcript.findFirst({ where: { assetId }, select: { id: true } });
  if (existing) return;
  await requestCaptions(organizationId, assetId);
}

export interface CourseHit {
  materialId: string;
  materialTitle: string;
  sectionTitle: string;
  start: number;
  text: string;
}

/** Search the transcripts of every lesson in a course. */
export async function searchCourse(organizationId: string, courseId: string, query: string, limit = 40): Promise<CourseHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db.material.findMany({
    where: {
      section: { module: { courses: { some: { courseId } } } },
      asset: { organizationId, transcript: { fullText: { contains: q, mode: 'insensitive' } } },
    },
    select: {
      id: true,
      title: true,
      section: { select: { title: true } },
      asset: { select: { transcript: { select: { segments: true } } } },
    },
    take: 50,
  });
  const out: CourseHit[] = [];
  for (const m of rows) {
    const segments = segmentsOf(m.asset?.transcript?.segments);
    for (const hit of searchSegments(segments, q, 6)) {
      out.push({ materialId: m.id, materialTitle: m.title, sectionTitle: m.section.title, start: hit.start, text: hit.text });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
