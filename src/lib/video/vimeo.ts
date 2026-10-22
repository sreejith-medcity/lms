import { ProviderError, readJson, type VideoProvider } from '@/lib/video/provider';
import { idFromUri, lockedEmbedUrl, vimeoState } from '@/lib/video/vimeo-rules';

/**
 * Vimeo, on the academy's own account.
 *
 * Every video sent from here (or linked from what is already on the
 * account) is locked down the same way: hidden from vimeo.com, embeddable
 * only on the academy's own domains, no download, no comments, not
 * addable to anyone's showcase; the player's title, owner, logo and share
 * buttons off. It plays only in Vimeo's player, so `playback` hands out a
 * locked embed address rather than a stream; Vimeo's direct HLS links are
 * deliberately not used, because they never expire and ignore the privacy
 * settings, which would make them a leak waiting to be copied.
 *
 * The token needs the public, private, edit, upload, delete and
 * video_files scopes.
 */

const API = 'https://api.vimeo.com';

export const VIMEO_LOCKED_PRIVACY = {
  view: 'disable',
  embed: 'whitelist',
  download: false,
  add: false,
  comments: 'nobody',
} as const;

const LOCKED_EMBED = {
  buttons: { like: false, watchlater: false, share: false, embed: false },
  logos: { vimeo: false },
  title: { name: 'hide', owner: 'hide', portrait: 'hide' },
};

export function vimeo(creds: { accessToken: string }, options: { fullscreen?: boolean; color?: string | null } = {}): VideoProvider {
  const headers = {
    Authorization: `bearer ${creds.accessToken.trim()}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.vimeo.*+json;version=3.4',
  };

  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (res.status === 204) return {};
    const body = (await readJson(res)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message = String(body?.developer_message ?? body?.error ?? `HTTP ${res.status}`);
      throw new ProviderError('Vimeo', message, res.status);
    }
    return body ?? {};
  }

  /** Hidden from vimeo.com where the plan allows it, else unlisted (reachable only with its hash). */
  async function hide(id: string, missing: string[]) {
    try {
      await call(`/videos/${id}`, { method: 'PATCH', body: JSON.stringify({ privacy: VIMEO_LOCKED_PRIVACY }) });
    } catch {
      missing.push('Hide from Vimeo is not on this plan, so the video is unlisted instead');
      await call(`/videos/${id}`, { method: 'PATCH', body: JSON.stringify({ privacy: { ...VIMEO_LOCKED_PRIVACY, view: 'unlisted' } }) });
    }
  }

  return {
    id: 'vimeo',
    name: 'Vimeo',

    async ingestFromUrl(sourceUrl, meta) {
      const body = { upload: { approach: 'pull', link: sourceUrl }, name: meta.name, privacy: VIMEO_LOCKED_PRIVACY };
      let created: Record<string, unknown>;
      try {
        created = await call('/me/videos', { method: 'POST', body: JSON.stringify(body) });
      } catch (err) {
        // A plan without "hide from Vimeo" refuses the whole upload over it; unlisted then.
        if (err instanceof ProviderError && err.status === 400) {
          created = await call('/me/videos', { method: 'POST', body: JSON.stringify({ ...body, privacy: { ...VIMEO_LOCKED_PRIVACY, view: 'unlisted' } }) });
        } else {
          throw err;
        }
      }
      const id = idFromUri(created.uri);
      if (!id) throw new ProviderError('Vimeo', 'no video id returned');
      return { streamId: id };
    },

    async status({ streamId }) {
      const v = await call(`/videos/${streamId}?fields=status,transcode.status,duration`);
      const transcode = (v.transcode as { status?: string } | undefined)?.status;
      const state = vimeoState(v.status, transcode);
      return {
        state,
        durationSeconds: typeof v.duration === 'number' && v.duration > 0 ? Math.round(v.duration) : null,
        error: state === 'FAILED' ? `Vimeo says ${String(v.status ?? 'error')}` : null,
      };
    },

    async playback({ streamId }, expiresAt) {
      const v = await call(`/videos/${streamId}?fields=player_embed_url,pictures.base_link`);
      const pictures = v.pictures as { base_link?: string } | undefined;
      return {
        hlsUrl: null,
        embedUrl: lockedEmbedUrl({ id: streamId, playerEmbedUrl: typeof v.player_embed_url === 'string' ? v.player_embed_url : null, fullscreen: options.fullscreen, color: options.color }),
        thumbnailUrl: pictures?.base_link ? `${pictures.base_link}_1280x720` : null,
        expiresAt,
      };
    },

    async remove(streamId) {
      await call(`/videos/${streamId}`, { method: 'DELETE' });
    },

    async protect(streamId, domains) {
      const missing: string[] = [];
      await hide(streamId, missing);
      for (const domain of domains) {
        try {
          await call(`/videos/${streamId}/privacy/domains/${encodeURIComponent(domain)}`, { method: 'PUT' });
        } catch (err) {
          missing.push(`Could not allow ${domain}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      try {
        await call(`/videos/${streamId}`, { method: 'PATCH', body: JSON.stringify({ embed: LOCKED_EMBED }) });
      } catch {
        missing.push('The player’s logo and buttons could not be switched off on this plan; the player hides them anyway');
      }
      return missing;
    },
  };
}

/** What the account behind a token is, for the integration card's check. */
export async function vimeoAccount(accessToken: string): Promise<{ name: string; plan: string }> {
  const res = await fetch(`${API}/me?fields=name,account`, {
    headers: { Authorization: `bearer ${accessToken.trim()}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' },
  });
  const body = (await readJson(res)) as Record<string, unknown> | null;
  if (!res.ok) throw new ProviderError('Vimeo', String(body?.developer_message ?? body?.error ?? `HTTP ${res.status}`), res.status);
  return { name: String(body?.name ?? ''), plan: String(body?.account ?? '') };
}

/** A video already on the account, for linking: its name, length and whether it is ready. */
export async function vimeoVideo(accessToken: string, id: string): Promise<{ name: string; durationSeconds: number | null; ready: boolean }> {
  const res = await fetch(`${API}/videos/${id}?fields=name,duration,status,transcode.status`, {
    headers: { Authorization: `bearer ${accessToken.trim()}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' },
  });
  const body = (await readJson(res)) as Record<string, unknown> | null;
  if (!res.ok) throw new ProviderError('Vimeo', res.status === 404 ? 'no such video on this account' : String(body?.developer_message ?? body?.error ?? `HTTP ${res.status}`), res.status);
  const transcode = (body?.transcode as { status?: string } | undefined)?.status;
  return {
    name: String(body?.name ?? `Vimeo ${id}`),
    durationSeconds: typeof body?.duration === 'number' && body.duration > 0 ? Math.round(body.duration) : null,
    ready: vimeoState(body?.status, transcode) === 'READY',
  };
}
