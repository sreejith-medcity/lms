import type { $Enums } from '@prisma/client';

/**
 * What Edmingle's records mean in our terms.
 *
 * Edmingle calls a sellable course a "bundle" and a module a "course"; a
 * module has sections, a section has materials, and a material is a file
 * in the asset library, a link, or a page of text. The names are kept as
 * Edmingle uses them at this layer, so the mapping is visible in one place
 * rather than argued about in three.
 *
 * Pure: the importer hands in what the API returned.
 */

export interface EdmingleBundle {
  bundle_id: number;
  bundle_name: string;
  bundle_description?: string | null;
  pretty_name?: string | null;
  img_url?: string | null;
  is_archived?: number;
  course_ids: (string | number)[];
}

export interface EdmingleModule {
  course_id: number;
  name: string;
  description?: string | null;
  status?: string | null;
  num_of_section?: number;
  display_index?: number;
}

export interface EdmingleMaterial {
  material_id: number;
  material_name?: string | null;
  file_name?: string | null;
  description?: string | null;
  /** A mime type for a file ("video/mp4"), or what kind of thing it is otherwise. */
  type?: string | null;
  /** "file", "link", "youtube", "html" and so on. */
  material_source?: string | null;
  external_url?: string | null;
  html_text?: string | null;
  duration_seconds?: number | null;
  display_index?: number;
  is_active?: number;
  is_downloadable?: number;
  freepreview?: number | null;
  vimeo_url?: number | string | null;
  file_size?: number | null;
}

export interface EdmingleSection {
  section_id: number;
  section_name?: string | null;
  description?: string | null;
  status?: string | null;
  display_index?: number;
  resources?: EdmingleMaterial[];
}

export interface EdmingleAsset {
  asset_id: number;
  asset_name?: string | null;
  file_name?: string | null;
  file_size_bytes?: number | null;
  mime_type?: string | null;
  vimeo_url?: number | string | null;
}

export interface MaterialPlan {
  type: $Enums.MaterialType;
  /** The file has to come across before the lesson works. */
  needsFile: boolean;
  /** The file lives on Vimeo under Edmingle's account: a placeholder here until the export arrives. */
  video: boolean;
  externalUrl: string | null;
  bodyHtml: string | null;
}

const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** The kind of lesson a material becomes, and whether a file has to follow it. */
export function planMaterial(m: EdmingleMaterial): MaterialPlan {
  const mime = (m.type ?? '').toLowerCase();
  const source = (m.material_source ?? '').toLowerCase();
  const url = (m.external_url ?? '').trim();

  if (m.html_text && m.html_text.trim()) return { type: 'TEXT_HTML', needsFile: false, video: false, externalUrl: null, bodyHtml: m.html_text };
  if (url && (source === 'youtube' || YOUTUBE.test(hostOf(url)))) return { type: 'YOUTUBE', needsFile: false, video: false, externalUrl: url, bodyHtml: null };
  if (url && source !== 'file') return { type: 'LINK_EMBED', needsFile: false, video: false, externalUrl: url, bodyHtml: null };

  if (mime.startsWith('video/')) return { type: 'VIDEO', needsFile: true, video: true, externalUrl: null, bodyHtml: null };
  if (mime.startsWith('audio/')) return { type: 'AUDIO', needsFile: true, video: false, externalUrl: null, bodyHtml: null };
  if (mime === 'application/pdf') return { type: 'PDF', needsFile: true, video: false, externalUrl: null, bodyHtml: null };
  if (mime.startsWith('image/')) return { type: 'IMAGE', needsFile: true, video: false, externalUrl: null, bodyHtml: null };
  if (/presentation|powerpoint/.test(mime)) return { type: 'SLIDE', needsFile: true, video: false, externalUrl: null, bodyHtml: null };
  if (/spreadsheet|excel/.test(mime)) return { type: 'SHEET', needsFile: true, video: false, externalUrl: null, bodyHtml: null };
  if (/msword|wordprocessing|text\/plain|rtf/.test(mime)) return { type: 'DOC', needsFile: true, video: false, externalUrl: null, bodyHtml: null };
  if (/zip/.test(mime)) return { type: 'ZIP', needsFile: true, video: false, externalUrl: null, bodyHtml: null };

  // A file of a kind we do not know by mime: go by the name.
  const ext = (m.file_name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'mkv', 'webm', 'm4v'].includes(ext)) return { type: 'VIDEO', needsFile: true, video: true, externalUrl: null, bodyHtml: null };
  if (ext === 'pdf') return { type: 'PDF', needsFile: true, video: false, externalUrl: null, bodyHtml: null };
  return { type: 'DOC', needsFile: Boolean(m.file_name), video: false, externalUrl: null, bodyHtml: null };
}

/** Sort key: Edmingle's display index, then the order the API listed them in. */
export function inOrder<T extends { display_index?: number }>(items: T[]): T[] {
  return items.map((item, i) => ({ item, i })).sort((a, b) => (a.item.display_index ?? a.i) - (b.item.display_index ?? b.i) || a.i - b.i).map((x) => x.item);
}

const normaliseName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The asset a material's file is. Edmingle keeps the two apart, and the
 * only thing they share is the file name (plus the size, when both sides
 * carry it). An exact name match with one candidate is a match; several
 * candidates narrow by size; anything still ambiguous is reported, not
 * guessed.
 */
export function matchAsset(m: EdmingleMaterial, assets: EdmingleAsset[]): { asset: EdmingleAsset | null; reason?: string } {
  const name = normaliseName(m.file_name ?? '');
  if (!name) return { asset: null, reason: 'no file name' };
  let candidates = assets.filter((a) => normaliseName(a.file_name ?? '') === name);
  if (candidates.length === 0) candidates = assets.filter((a) => normaliseName(a.asset_name ?? '') === normaliseName(m.material_name ?? ''));
  if (candidates.length === 0) return { asset: null, reason: 'no asset with that file name' };
  if (candidates.length > 1 && m.file_size) {
    const bySize = candidates.filter((a) => a.file_size_bytes === m.file_size);
    if (bySize.length >= 1) candidates = bySize;
  }
  if (candidates.length > 1) {
    // Identical uploads: any of them is the same bytes.
    const sizes = new Set(candidates.map((a) => a.file_size_bytes ?? -1));
    if (sizes.size > 1) return { asset: null, reason: `${candidates.length} assets share the name with different sizes` };
  }
  return { asset: candidates[0] };
}

/** A course's slug: Edmingle's pretty name where it set one, else from the title. */
export function bundleSlug(b: EdmingleBundle, slugify: (s: string) => string): string {
  const pretty = (b.pretty_name ?? '').trim();
  return slugify(pretty || b.bundle_name) || `course-${b.bundle_id}`;
}

/** Edmingle descriptions arrive as HTML; the course editor wants plain text. */
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
