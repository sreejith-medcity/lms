import { ProviderError, readJson, type VideoProvider } from '@/lib/video/provider';
import { cloudflareState, cloudflareStreamToken } from '@/lib/video/tokens';

/**
 * Cloudflare Stream. Encodes to HLS and DASH, serves from its own edge,
 * and refuses playback without a token signed by a key you create once
 * (POST /accounts/:id/stream/keys) and paste here.
 */
export function cloudflareStream(creds: {
  accountId: string;
  apiToken: string;
  customerCode: string;
  signingKeyId: string;
  signingKeyPem: string;
}): VideoProvider {
  const base = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/stream`;
  const headers = { Authorization: `Bearer ${creds.apiToken}`, 'Content-Type': 'application/json' };
  const host = `https://${creds.customerCode.replace(/^https?:\/\//, '').replace(/\.cloudflarestream\.com.*$/, '')}.cloudflarestream.com`;

  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const body = (await readJson(res)) as { success?: boolean; result?: Record<string, unknown>; errors?: { message: string }[] } | null;
    if (!res.ok || body?.success === false) {
      throw new ProviderError('Cloudflare Stream', body?.errors?.[0]?.message ?? `HTTP ${res.status}`, res.status);
    }
    return body?.result ?? {};
  }

  return {
    id: 'cloudflare_stream',
    name: 'Cloudflare Stream',

    async ingestFromUrl(sourceUrl, meta) {
      const result = await call('/copy', {
        method: 'POST',
        body: JSON.stringify({ url: sourceUrl, meta: { name: meta.name, assetId: meta.assetId }, requireSignedURLs: true }),
      });
      const uid = String(result.uid ?? '');
      if (!uid) throw new ProviderError('Cloudflare Stream', 'no uid returned');
      return { streamId: uid };
    },

    async status({ streamId }) {
      const result = await call(`/${streamId}`);
      const status = (result.status ?? {}) as { state?: string; errorReasonText?: string };
      return {
        state: cloudflareState(status.state, Boolean(result.readyToStream)),
        durationSeconds: typeof result.duration === 'number' && result.duration > 0 ? Math.round(result.duration) : null,
        error: status.errorReasonText ?? null,
      };
    },

    async playback({ streamId }, expiresAt) {
      const token = cloudflareStreamToken({ keyId: creds.signingKeyId, pem: creds.signingKeyPem, videoId: streamId, expiresAt });
      return {
        hlsUrl: `${host}/${token}/manifest/video.m3u8`,
        thumbnailUrl: `${host}/${token}/thumbnails/thumbnail.jpg?time=2s`,
        expiresAt,
      };
    },

    async remove(streamId) {
      await call(`/${streamId}`, { method: 'DELETE' });
    },

    async generateCaptions({ streamId }, language) {
      await call(`/${streamId}/captions/${encodeURIComponent(language)}/generate`, { method: 'POST' });
    },

    async captions({ streamId }, expiresAt) {
      const result = (await call(`/${streamId}/captions`)) as unknown as { language: string; label: string }[] | Record<string, unknown>;
      const list = Array.isArray(result) ? result : [];
      const token = cloudflareStreamToken({ keyId: creds.signingKeyId, pem: creds.signingKeyPem, videoId: streamId, expiresAt });
      return list.map((c) => ({ language: c.language, label: c.label, url: `${host}/${token}/captions/${c.language}` }));
    },

    async fetchCaption({ streamId }, language) {
      const res = await fetch(`${base}/${streamId}/captions/${encodeURIComponent(language)}/vtt`, { headers });
      if (!res.ok) return null;
      return res.text();
    },
  };
}
