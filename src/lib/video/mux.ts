import { ProviderError, readJson, type VideoProvider } from '@/lib/video/provider';
import { muxState, muxToken } from '@/lib/video/tokens';

/**
 * Mux Video. Assets are created with a signed playback policy, so nothing
 * plays without a token from the signing key you make in the dashboard.
 * Captions are asked for at creation (generated_subtitles) and read back
 * as text tracks.
 */
export function mux(creds: { tokenId: string; tokenSecret: string; signingKeyId: string; signingKeyPem: string }): VideoProvider {
  const base = 'https://api.mux.com/video/v1';
  const auth = `Basic ${Buffer.from(`${creds.tokenId}:${creds.tokenSecret}`).toString('base64')}`;
  const headers = { Authorization: auth, 'Content-Type': 'application/json' };

  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const body = (await readJson(res)) as { data?: Record<string, unknown>; error?: { messages?: string[] } } | null;
    if (!res.ok) throw new ProviderError('Mux', body?.error?.messages?.[0] ?? `HTTP ${res.status}`, res.status);
    return body?.data ?? {};
  }

  const playbackIdOf = (asset: Record<string, unknown>): string | null => {
    const ids = (asset.playback_ids ?? []) as { id: string; policy: string }[];
    return ids.find((p) => p.policy === 'signed')?.id ?? ids[0]?.id ?? null;
  };

  return {
    id: 'mux',
    name: 'Mux',

    async ingestFromUrl(sourceUrl, meta) {
      const data = await call('/assets', {
        method: 'POST',
        body: JSON.stringify({
          input: [{ url: sourceUrl, generated_subtitles: [{ language_code: 'en', name: 'English' }] }],
          playback_policy: ['signed'],
          video_quality: 'basic',
          passthrough: meta.assetId,
        }),
      });
      const id = String(data.id ?? '');
      if (!id) throw new ProviderError('Mux', 'no asset id returned');
      return { streamId: id, playbackId: playbackIdOf(data) };
    },

    async status({ streamId }) {
      const data = await call(`/assets/${streamId}`);
      const errors = data.errors as { messages?: string[] } | undefined;
      return {
        state: muxState(typeof data.status === 'string' ? data.status : undefined),
        durationSeconds: typeof data.duration === 'number' ? Math.round(data.duration) : null,
        error: errors?.messages?.[0] ?? null,
        playbackId: playbackIdOf(data),
      };
    },

    async playback({ playbackId }, expiresAt) {
      if (!playbackId) throw new ProviderError('Mux', 'no playback id yet');
      const video = muxToken({ keyId: creds.signingKeyId, pem: creds.signingKeyPem, playbackId, expiresAt, audience: 'v' });
      const thumb = muxToken({ keyId: creds.signingKeyId, pem: creds.signingKeyPem, playbackId, expiresAt, audience: 't' });
      return {
        hlsUrl: `https://stream.mux.com/${playbackId}.m3u8?token=${video}`,
        thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg?token=${thumb}&time=2`,
        expiresAt,
      };
    },

    async remove(streamId) {
      await call(`/assets/${streamId}`, { method: 'DELETE' });
    },

    async generateCaptions({ streamId }, language) {
      const data = await call(`/assets/${streamId}`);
      const tracks = (data.tracks ?? []) as { id: string; type: string }[];
      const audio = tracks.find((t) => t.type === 'audio');
      if (!audio) throw new ProviderError('Mux', 'no audio track to transcribe');
      await call(`/assets/${streamId}/tracks/${audio.id}/generate-subtitles`, {
        method: 'POST',
        body: JSON.stringify({ generated_subtitles: [{ language_code: language, name: language.toUpperCase() }] }),
      });
    },

    async captions({ streamId, playbackId }, expiresAt) {
      const data = await call(`/assets/${streamId}`);
      const tracks = (data.tracks ?? []) as { id: string; type: string; text_type?: string; language_code?: string; name?: string; status?: string }[];
      const token = playbackId ? muxToken({ keyId: creds.signingKeyId, pem: creds.signingKeyPem, playbackId, expiresAt, audience: 'v' }) : null;
      return tracks
        .filter((t) => t.type === 'text' && t.text_type === 'subtitles' && t.status !== 'errored')
        .map((t) => ({
          language: t.language_code ?? 'en',
          label: t.name ?? t.language_code ?? 'Captions',
          url: playbackId && token ? `https://stream.mux.com/${playbackId}/text/${t.id}.vtt?token=${token}` : undefined,
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
