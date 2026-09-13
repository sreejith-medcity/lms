import { db } from '@/lib/db';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { settingNumber, settingText } from '@/lib/settings/store';
import { organizationOrigin } from '@/lib/org-origin';
import { readUrlFor, storageDriver } from '@/lib/storage';
import { cloudflareStream } from '@/lib/video/cloudflare-stream';
import { mux } from '@/lib/video/mux';
import { bunny } from '@/lib/video/bunny';
import { dueForCheck, playbackExpiry } from '@/lib/video/tokens';
import type { Playback, VideoProvider } from '@/lib/video/provider';

/**
 * Video, properly: the file is uploaded to the bucket as before, and then
 * handed to a video platform that encodes it to adaptive HLS and serves it
 * with expiring links. Which platform is a setting; its keys are on the
 * integration card. Nothing here runs without both, and a lesson plays
 * from the bucket as it always did until the encoded copy is ready.
 */

export type ProviderKey = 'cloudflare_stream' | 'mux' | 'bunny';

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

/** Let the platform forget a video the library has deleted. */
export async function forgetStream(organizationId: string, asset: { streamProvider: string | null; streamId: string | null }): Promise<void> {
  if (!asset.streamId || !asset.streamProvider) return;
  const p = await videoProviderFor(organizationId);
  if (!p || p.id !== asset.streamProvider) return;
  await p.remove(asset.streamId).catch(() => {});
}
