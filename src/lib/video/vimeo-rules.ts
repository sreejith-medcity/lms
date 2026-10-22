import type { StreamState } from '@/lib/video/tokens';

/**
 * Vimeo, the parts that need no network: reading a video id out of
 * whatever someone pastes, mapping Vimeo's status to ours, and building the
 * locked-down player address. Kept apart so they can be tested.
 */

/** "https://vimeo.com/123456789", ".../123456789/abcdef", "player.vimeo.com/video/123?h=..", "/videos/123" or "123". */
export function parseVimeoId(input: string): string | null {
  const s = input.trim();
  if (/^\d{4,12}$/.test(s)) return s;
  const m = /(?:vimeo\.com\/(?:video\/|videos\/|manage\/videos\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?|^\/videos\/)(\d{4,12})(?:[/?#]|$)/i.exec(s);
  return m ? m[1] : null;
}

/** The id at the end of an API uri such as "/videos/123456789". */
export function idFromUri(uri: unknown): string | null {
  const m = /\/videos\/(\d+)/.exec(String(uri ?? ''));
  return m ? m[1] : null;
}

/**
 * Vimeo's `status` and `transcode.status` as one of ours. "available" with a
 * transcode still running is PROCESSING: the player would show a spinner.
 */
export function vimeoState(status: unknown, transcode: unknown): StreamState {
  const s = String(status ?? '');
  const t = String(transcode ?? '');
  if (/error|exceeded/.test(s) || t === 'error') return 'FAILED';
  if (s === 'available' && (t === '' || t === 'complete')) return 'READY';
  if (s === 'uploading') return 'QUEUED';
  return 'PROCESSING';
}

/**
 * The player with everything a learner could use to leave the lesson or
 * pull the video apart switched off: no title, owner, portrait or Vimeo
 * logo; no settings (speed, quality), picture-in-picture, AirPlay,
 * Chromecast, captions or transcript menus; no Vimeo right-click menu; no
 * tracking. What stays: play, the progress bar, volume and, unless the
 * academy's watermark needs the page to own full screen, full screen.
 */
export const LOCKED_PLAYER_PARAMS: Record<string, string> = {
  title: '0',
  byline: '0',
  portrait: '0',
  badge: '0',
  vimeo_logo: '0',
  speed: '0',
  quality_selector: '0',
  pip: '0',
  airplay: '0',
  chromecast: '0',
  cc: '0',
  transcript: '0',
  watch_full_video: '0',
  interactive_markers: '0',
  disable_context_menu: '1',
  dnt: '1',
  keyboard: '1',
  playsinline: '1',
  autopause: '1',
  transparent: '0',
};

/**
 * The embed address for a video: Vimeo's own `player_embed_url` when the API
 * gave one (it carries the `h` hash an unlisted video needs), else built from
 * the id; the locked parameters added, and full screen off when the page
 * provides its own.
 */
export function lockedEmbedUrl(input: { id: string; playerEmbedUrl?: string | null; fullscreen?: boolean; color?: string | null }): string {
  const base = input.playerEmbedUrl && /^https:\/\/player\.vimeo\.com\/video\/\d+/.test(input.playerEmbedUrl) ? input.playerEmbedUrl : `https://player.vimeo.com/video/${input.id}`;
  const url = new URL(base);
  for (const [k, v] of Object.entries(LOCKED_PLAYER_PARAMS)) url.searchParams.set(k, v);
  url.searchParams.set('fullscreen', input.fullscreen === false ? '0' : '1');
  const color = (input.color ?? '').replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(color)) url.searchParams.set('color', color.toLowerCase());
  return url.toString();
}

/** Hostnames a video may be embedded on: lower-cased, no port, no duplicates, no localhost. */
export function embedDomains(hostnames: string[]): string[] {
  const out = new Set<string>();
  for (const h of hostnames) {
    const host = h.trim().toLowerCase().split(':')[0];
    if (!host || host === 'localhost' || host.endsWith('.localhost') || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) continue;
    out.add(host);
  }
  return [...out].sort();
}
