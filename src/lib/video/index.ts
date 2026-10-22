import { db } from '@/lib/db';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { settingBool, settingNumber, settingText } from '@/lib/settings/store';
import { organizationOrigin } from '@/lib/org-origin';
import { readUrlFor, storageDriver } from '@/lib/storage';
import { cloudflareStream } from '@/lib/video/cloudflare-stream';
import { mux } from '@/lib/video/mux';
import { bunny } from '@/lib/video/bunny';
import { vimeo, vimeoVideo } from '@/lib/video/vimeo';
import { embedDomains, parseVimeoId } from '@/lib/video/vimeo-rules';
import { dueForCheck, playbackExpiry } from '@/lib/video/tokens';
import type { Playback, VideoProvider } from '@/lib/video/provider';

/**
 * Video, properly: the file is uploaded to the bucket as before, and then
 * handed to a video platform that encodes it to adaptive HLS and serves it
 * with expiring links. Which platform is a setting; its keys are on the
 * integration card. Nothing here runs without both, and a lesson plays
 * from the bucket as it always did until the encoded copy is ready.
 */

export type ProviderKey = 'cloudflare_stream' | 'mux' | 'bunny' | 'vimeo';

export async function videoProviderFor(organizationId: string): Promise<VideoProvider | null> {
  const chosen = (await settingText(organizationId, 'video.provider')).trim() as ProviderKey | '' | 'none';
  if (!chosen || chosen === 'none') return null;
  const resolved = await resolveIntegration(organizationId, chosen);
  if (!resolved?.complete) return null;
  const v = resolved.values;
  switch (chosen) {
    case 'cloudflare_stream':
      return cloudflareStream({ accountId: v.accountId, apiToken: v.apiToken, customerCode: v.customerCode, signingKeyId: v.signingKeyId, signingKeyPem: v.signingKeyPem });
    case 'mux':
      return mux({ tokenId: v.tokenId, tokenSecret: v.tokenSecret, signingKeyId: v.signingKeyId, signingKeyPem: v.signingKeyPem });
    case 'bunny':
      return bunny({ libraryId: v.libraryId, apiKey: v.apiKey, cdnHostname: v.cdnHostname, tokenKey: v.tokenKey });
    case 'vimeo': {
      // With a watermark the page owns full screen, so the mark stays on top of the video.
      const [watermark, org] = await Promise.all([
        settingBool(organizationId, 'player.watermark'),
        db.organization.findUnique({ where: { id: organizationId }, select: { brandColor: true } }),
      ]);
      return vimeo({ accessToken: v.accessToken }, { fullscreen: !watermark, color: org?.brandColor ?? null });
    }
    default:
      return null;
  }
}

/** A URL the platform can fetch the original from, valid for a few hours. */
async function sourceUrlFor(organizationId: string, storageKey: string, mimeType: string | null): Promise<string> {
  const url = readUrlFor(storageKey, { expiresIn: 6 * 3600, mimeType });
  if (storageDriver() === 'local') return `${await organizationOrigin(organizationId)}${url}`;
  return url;
}

const provider = (p: VideoProvider) => p.id;

/**
 * Send a video to the platform. Safe to call twice: a video already sent
 * and not failed is left alone.
 */
export async function queueTranscode(organizationId: string, assetId: string, opts: { again?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = await videoProviderFor(organizationId);
  if (!p) return { ok: false, error: 'No video platform is connected. Choose one under Settings, Video, and add its keys under Integrations.' };

  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId, deletedAt: null },
    select: { id: true, name: true, type: true, storageKey: true, mimeType: true, streamStatus: true, streamId: true, streamProvider: true },
  });
  if (!asset) return { ok: false, error: 'File not found.' };
  if (asset.type !== 'VIDEO') return { ok: false, error: 'Only video is sent for encoding.' };
  if (asset.storageKey.startsWith(VIMEO_KEY)) return { ok: false, error: 'This video was linked from Vimeo; there is no file here to send.' };
  if (asset.streamStatus && asset.streamStatus !== 'FAILED' && !opts.again) return { ok: true };

  // Sending again: let the platform forget the old copy first, quietly.
  if (asset.streamId && asset.streamProvider === p.id) {
    await p.remove(asset.streamId).catch(() => {});
  }

  try {
    const source = await sourceUrlFor(organizationId, asset.storageKey, asset.mimeType);
    const result = await p.ingestFromUrl(source, { name: asset.name, assetId: asset.id });
    await db.asset.update({
      where: { id: asset.id },
      data: {
        streamProvider: p.id,
        streamId: result.streamId,
        streamPlaybackId: result.playbackId ?? null,
        streamStatus: 'QUEUED',
        streamError: null,
        streamReadyAt: null,
        streamCheckedAt: new Date(),
      },
    });
    await recordIntegrationEvent({ organizationId, provider: provider(p), direction: 'OUT', action: `Sent ${asset.name} for encoding`, ok: true });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.asset.update({ where: { id: asset.id }, data: { streamProvider: p.id, streamStatus: 'FAILED', streamError: message.slice(0, 500), streamCheckedAt: new Date() } });
    await recordIntegrationEvent({ organizationId, provider: provider(p), direction: 'OUT', action: `Sending ${asset.name} for encoding`, ok: false, detail: message });
    return { ok: false, error: message };
  }
}

/** Ask the platform where the encode has got to, and remember the answer. */
export async function refreshStream(organizationId: string, assetId: string, opts: { force?: boolean } = {}): Promise<string | null> {
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId, deletedAt: null },
    select: { id: true, streamProvider: true, streamId: true, streamPlaybackId: true, streamStatus: true, streamCheckedAt: true, durationSeconds: true },
  });
  if (!asset?.streamId || !asset.streamProvider) return null;
  if (!opts.force && !dueForCheck(asset.streamStatus, asset.streamCheckedAt)) return asset.streamStatus;

  const p = await videoProviderFor(organizationId);
  if (!p || p.id !== asset.streamProvider) return asset.streamStatus;

  try {
    const status = await p.status({ streamId: asset.streamId, playbackId: asset.streamPlaybackId });
    await db.asset.update({
      where: { id: asset.id },
      data: {
        streamStatus: status.state,
        streamError: status.error ?? null,
        streamPlaybackId: status.playbackId ?? asset.streamPlaybackId,
        streamReadyAt: status.state === 'READY' ? new Date() : null,
        streamCheckedAt: new Date(),
        ...(status.durationSeconds && !asset.durationSeconds ? { durationSeconds: status.durationSeconds } : {}),
      },
    });
    // The first time it comes back ready, captions are asked for if the
    // academy wants them written for everything.
    if (status.state === 'READY' && asset.streamStatus !== 'READY') {
      if (p.protect) await protectOne(organizationId, p, asset.id, asset.streamId);
      const { captionsAfterEncode } = await import('@/lib/transcripts');
      await captionsAfterEncode(organizationId, asset.id).catch(() => {});
    }
    return status.state;
  } catch (err) {
    await db.asset.update({ where: { id: asset.id }, data: { streamCheckedAt: new Date() } });
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'CHECK', action: 'Asking after an encode', ok: false, detail: err instanceof Error ? err.message : String(err) });
    return asset.streamStatus;
  }
}

/** An expiring playback link for a video the platform has ready, or null. */
export async function playbackFor(
  organizationId: string,
  asset: { streamProvider: string | null; streamId: string | null; streamPlaybackId: string | null; streamStatus: string | null },
): Promise<Playback | null> {
  if (asset.streamStatus !== 'READY' || !asset.streamId || !asset.streamProvider) return null;
  const p = await videoProviderFor(organizationId);
  if (!p || p.id !== asset.streamProvider) return null;
  const minutes = await settingNumber(organizationId, 'video.playbackMinutes');
  try {
    return await p.playback({ streamId: asset.streamId, playbackId: asset.streamPlaybackId }, playbackExpiry(minutes));
  } catch (err) {
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'OUT', action: 'Minting a playback link', ok: false, detail: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Let the platform forget a video the library has deleted. A video linked
 * from what was already on the academy's Vimeo is left there: the library
 * only borrowed it.
 */
export async function forgetStream(organizationId: string, asset: { streamProvider: string | null; streamId: string | null; streamPlaybackId?: string | null }): Promise<void> {
  if (!asset.streamId || !asset.streamProvider) return;
  if (asset.streamPlaybackId === LINKED) return;
  const p = await videoProviderFor(organizationId);
  if (!p || p.id !== asset.streamProvider) return;
  await p.remove(asset.streamId).catch(() => {});
}

/* Vimeo: locking videos to the academy's domains, and linking ones already there */

/** The storage key of an asset that is a video on Vimeo and nothing in the bucket. */
export const VIMEO_KEY = 'vimeo:';
/** Marks a Vimeo video the library borrowed, which deleting it here must not delete there. */
const LINKED = 'linked';

/** Every address the academy is reached on, which is where its videos may play. */
export async function academyDomains(organizationId: string): Promise<string[]> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { tenant: { select: { slug: true, domains: { select: { hostname: true } } } } },
  });
  const base = (process.env.APP_BASE_DOMAIN ?? '').split(':')[0].toLowerCase();
  const own = org?.tenant.slug && base ? [`${org.tenant.slug}.${base}`] : [];
  return embedDomains([...(org?.tenant.domains ?? []).map((d) => d.hostname), ...own]);
}

async function protectOne(organizationId: string, p: VideoProvider, assetId: string, streamId: string): Promise<string[]> {
  if (!p.protect) return [];
  try {
    const missing = await p.protect(streamId, await academyDomains(organizationId));
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'OUT', action: 'Locked a video to the academy’s domains', ok: missing.length === 0, detail: missing.join('; ') || null });
    return missing;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.asset.update({ where: { id: assetId }, data: { streamError: `Privacy not applied: ${message}`.slice(0, 500) } }).catch(() => {});
    await recordIntegrationEvent({ organizationId, provider: p.id, direction: 'OUT', action: 'Locking a video to the academy’s domains', ok: false, detail: message });
    return [message];
  }
}

/**
 * Apply the lock to every Vimeo video in the library again: after a new
 * address is added (medcitylms.com), or after settings were changed by hand
 * on vimeo.com. A few at a time is plenty; Vimeo limits calls per minute.
 */
export async function protectAllVideos(organizationId: string, limit = 200): Promise<{ done: number; problems: string[] }> {
  const p = await videoProviderFor(organizationId);
  if (!p?.protect || p.id !== 'vimeo') return { done: 0, problems: ['Vimeo is not the video platform, or its token is missing.'] };
  const assets = await db.asset.findMany({
    where: { organizationId, deletedAt: null, streamProvider: 'vimeo', streamId: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, name: true, streamId: true },
  });
  const problems: string[] = [];
  let done = 0;
  for (const a of assets) {
    const missing = await protectOne(organizationId, p, a.id, a.streamId!);
    done += 1;
    for (const m of missing) if (!problems.includes(m)) problems.push(m);
  }
  return { done, problems };
}

/**
 * A video already on the academy's Vimeo, added to the library without
 * uploading anything: the lesson plays it through the locked player, and
 * the lock is applied to it now.
 */
export async function linkVimeoVideo(organizationId: string, input: string, userId: string | null): Promise<{ ok: true; assetId: string; name: string; notes: string[] } | { ok: false; error: string }> {
  const id = parseVimeoId(input);
  if (!id) return { ok: false, error: 'That does not look like a Vimeo link or video number.' };
  const p = await videoProviderFor(organizationId);
  if (!p || p.id !== 'vimeo') return { ok: false, error: 'Choose Vimeo as the video platform under Settings, Player, and add its token under Integrations first.' };
  const resolved = await resolveIntegration(organizationId, 'vimeo');
  const token = resolved?.values.accessToken ?? '';

  const existing = await db.asset.findFirst({ where: { organizationId, deletedAt: null, streamProvider: 'vimeo', streamId: id }, select: { id: true, name: true } });
  if (existing) return { ok: true, assetId: existing.id, name: existing.name, notes: ['This video was already in the library.'] };

  let video: { name: string; durationSeconds: number | null; ready: boolean };
  try {
    video = await vimeoVideo(token, id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const asset = await db.asset.create({
    data: {
      organizationId,
      name: video.name.slice(0, 200),
      fileName: `vimeo-${id}`,
      type: 'VIDEO',
      storageKey: `${VIMEO_KEY}${id}`,
      mimeType: 'video/mp4',
      sizeBytes: BigInt(0),
      durationSeconds: video.durationSeconds,
      uploadedById: userId,
      streamProvider: 'vimeo',
      streamId: id,
      streamPlaybackId: LINKED,
      streamStatus: video.ready ? 'READY' : 'PROCESSING',
      streamReadyAt: video.ready ? new Date() : null,
      streamCheckedAt: new Date(),
    },
    select: { id: true },
  });
  const notes = await protectOne(organizationId, p, asset.id, id);
  return { ok: true, assetId: asset.id, name: video.name, notes };
}
