import { ProviderError, readJson, type VideoProvider } from '@/lib/video/provider';
import { bunnyState, bunnyToken } from '@/lib/video/tokens';

/**
 * Bunny Stream. The cheapest of the three per minute and per gigabyte,
 * which matters at 281 GB. Playback is guarded by token authentication on
 * the library (switch it on under the library's security settings and paste
 * the key here); without it any link is a public link.
 */
export function bunny(creds: { libraryId: string; apiKey: string; cdnHostname: string; tokenKey: string }): VideoProvider {
  const base = `https://video.bunnycdn.com/library/${creds.libraryId}`;
  const headers = { AccessKey: creds.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  const cdn = `https://${creds.cdnHostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const body = (await readJson(res)) as Record<string, unknown> | null;
    if (!res.ok) throw new ProviderError('Bunny Stream', String(body?.Message ?? body?.message ?? `HTTP ${res.status}`), res.status);
    return body ?? {};
  }

  const signed = (videoId: string, expiresAt: Date) => {
    const expires = Math.floor(expiresAt.getTime() / 1000);
    return { token: bunnyToken({ securityKey: creds.tokenKey, videoId, expires }), expires };
  };

  return {
    id: 'bunny',
    name: 'Bunny Stream',

    async ingestFromUrl(sourceUrl, meta) {
      const created = await call('/videos', { method: 'POST', body: JSON.stringify({ title: meta.name }) });
      const guid = String(created.guid ?? '');
      if (!guid) throw new ProviderError('Bunny Stream', 'no video id returned');
      await call(`/videos/${guid}/fetch`, { method: 'POST', body: JSON.stringify({ url: sourceUrl }) });
      return { streamId: guid };
    },

    async status({ streamId }) {
      const video = await call(`/videos/${streamId}`);
      return {
        state: bunnyState(typeof video.status === 'number' ? video.status : undefined),
        durationSeconds: typeof video.length === 'number' && video.length > 0 ? Math.round(video.length) : null,
        error: null,
      };
    },

    async playback({ streamId }, expiresAt) {
      const { token, expires } = signed(streamId, expiresAt);
      return {
        hlsUrl: `${cdn}/${streamId}/playlist.m3u8?token=${token}&expires=${expires}`,
        thumbnailUrl: `${cdn}/${streamId}/thumbnail.jpg?token=${token}&expires=${expires}`,
        expiresAt,
      };
    },

    async remove(streamId) {
      await call(`/videos/${streamId}`, { method: 'DELETE' });
    },

    async generateCaptions({ streamId }, language) {
      await call(`/videos/${streamId}/transcribe?language=${encodeURIComponent(language)}`, { method: 'POST', body: '{}' });
    },

    async captions({ streamId }, expiresAt) {
      const video = await call(`/videos/${streamId}`);
      const list = (video.captions ?? []) as { srclang: string; label: string }[];
      const { token, expires } = signed(streamId, expiresAt);
      return list.map((c) => ({
        language: c.srclang,
        label: c.label || c.srclang,
        url: `${cdn}/${streamId}/captions/${c.srclang}.vtt?token=${token}&expires=${expires}`,
      }));
    },

    async fetchCaption(ids, language, expiresAt) {
      const list = await this.captions!(ids, expiresAt);
      const track = list.find((t) => t.language === language) ?? list[0];
      if (!track?.url) return null;
      const res = await fetch(track.url);
      return res.ok ? res.text() : null;
    },
  };
}
