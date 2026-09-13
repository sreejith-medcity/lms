import type { StreamState } from '@/lib/video/tokens';

/**
 * A video platform: it takes a file, turns it into adaptive HLS, and hands
 * out playback links that expire. Three of them speak this; the rest of
 * the product speaks only this.
 */

export interface IngestResult {
  streamId: string;
  /** Mux plays by a separate id; the others reuse streamId. */
  playbackId?: string | null;
}

export interface StreamStatus {
  state: StreamState;
  durationSeconds?: number | null;
  error?: string | null;
  /** Mux sets the playback id only once the asset exists; read it back here. */
  playbackId?: string | null;
}

export interface Playback {
  hlsUrl: string;
  thumbnailUrl: string | null;
  expiresAt: Date;
}

export interface CaptionTrack {
  language: string;
  label: string;
  /** Where the VTT can be fetched from, when the provider serves one. */
  url?: string;
}

export interface VideoProvider {
  id: 'cloudflare_stream' | 'mux' | 'bunny';
  name: string;
  /** Ask the platform to pull the file from a URL we mint and start encoding. */
  ingestFromUrl(sourceUrl: string, meta: { name: string; assetId: string }): Promise<IngestResult>;
  status(ids: { streamId: string; playbackId?: string | null }): Promise<StreamStatus>;
  playback(ids: { streamId: string; playbackId?: string | null }, expiresAt: Date): Promise<Playback>;
  remove(streamId: string): Promise<void>;
  /** Ask the platform to write captions from the audio, where it can. */
  generateCaptions?(ids: { streamId: string; playbackId?: string | null }, language: string): Promise<void>;
  /** The caption tracks it has, and the VTT of one. */
  captions?(ids: { streamId: string; playbackId?: string | null }, expiresAt: Date): Promise<CaptionTrack[]>;
  fetchCaption?(ids: { streamId: string; playbackId?: string | null }, language: string, expiresAt: Date): Promise<string | null>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
