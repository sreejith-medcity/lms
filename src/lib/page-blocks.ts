/**
 * The content of a landing page, as data rather than as markup.
 *
 * The pages being brought over from WordPress are Elementor output: hundreds
 * of nested divs carrying a theme's classes, inline styles and a few scripts.
 * Storing that and printing it back would import the old site's layout bugs
 * along with its words, and would put third-party markup inside our own pages
 * with nothing standing between the two.
 *
 * So a page is a list of small typed blocks holding plain text. What survives
 * the import is the content: the headings, the paragraphs, the lists, the
 * questions and answers, the pictures. The design is ours.
 *
 * Everything here is pure. Nothing is trusted: `parseBlocks` is given whatever
 * sits in a json column and returns only blocks it recognises, so an edit made
 * by hand, or a shape from a version of this file that no longer exists,
 * degrades to a shorter page instead of a broken one.
 */

export type Block =
  | { type: 'text'; heading?: string; body: string }
  | { type: 'bullets'; heading?: string; items: string[] }
  | { type: 'faq'; heading?: string; items: { q: string; a: string }[] }
  | { type: 'stats'; heading?: string; items: { value: string; label: string }[] }
  | { type: 'image'; assetId?: string; url?: string; alt?: string; caption?: string }
  | { type: 'cta'; heading?: string; body?: string; label?: string };

export const BLOCK_TYPES: Block['type'][] = ['text', 'bullets', 'faq', 'stats', 'image', 'cta'];

/** Long enough to be content, short enough to keep one block on one screen. */
const MAX_TEXT = 8000;
const MAX_HEADING = 200;
const MAX_ITEMS = 60;
const MAX_BLOCKS = 80;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optional(value: unknown, max: number): string | undefined {
  const text = str(value, max);
  return text ? text : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseBlock(raw: unknown): Block | null {
  const r = record(raw);
  if (!r) return null;

  /* The About page and the other static pages were written before blocks had
     types: they are { heading, body } pairs. They are text blocks, so they
     are read as text blocks rather than migrated. */
  if (r.type === undefined && (typeof r.heading === 'string' || typeof r.body === 'string')) {
    const body = str(r.body, MAX_TEXT);
    const heading = optional(r.heading, MAX_HEADING);
    if (!body && !heading) return null;
    return { type: 'text', heading, body: body || (heading as string) };
  }

  switch (r.type) {
    case 'text': {
      const body = str(r.body, MAX_TEXT);
      if (!body) return null;
      return { type: 'text', heading: optional(r.heading, MAX_HEADING), body };
    }
    case 'bullets': {
      const items = Array.isArray(r.items)
        ? r.items.map((i) => str(i, 400)).filter(Boolean).slice(0, MAX_ITEMS)
        : [];
      if (items.length === 0) return null;
      return { type: 'bullets', heading: optional(r.heading, MAX_HEADING), items };
    }
    case 'faq': {
      const items = Array.isArray(r.items)
        ? r.items
            .map((i) => {
              const item = record(i);
              const q = str(item?.q, 400);
              const a = str(item?.a, 4000);
              return q && a ? { q, a } : null;
            })
            .filter((i): i is { q: string; a: string } => Boolean(i))
            .slice(0, MAX_ITEMS)
        : [];
      if (items.length === 0) return null;
      return { type: 'faq', heading: optional(r.heading, MAX_HEADING), items };
    }
    case 'stats': {
      const items = Array.isArray(r.items)
        ? r.items
            .map((i) => {
              const item = record(i);
              const value = str(item?.value, 40);
              const label = str(item?.label, 120);
              return value && label ? { value, label } : null;
            })
            .filter((i): i is { value: string; label: string } => Boolean(i))
            .slice(0, 8)
        : [];
      if (items.length === 0) return null;
      return { type: 'stats', heading: optional(r.heading, MAX_HEADING), items };
    }
    case 'image': {
      const assetId = optional(r.assetId, 40);
      const url = optional(r.url, 500);
      // An image block with nothing to show is a gap in the page, not a block.
      if (!assetId && !url) return null;
      // Only our own asset route or an https source. An http image on an https
      // page is blocked by the browser and shows as a hole.
      if (!assetId && url && !url.startsWith('https://')) return null;
      return {
        type: 'image',
        assetId,
        url: assetId ? undefined : url,
        alt: optional(r.alt, 300),
        caption: optional(r.caption, 300),
      };
    }
    case 'cta': {
      return {
        type: 'cta',
        heading: optional(r.heading, MAX_HEADING),
        body: optional(r.body, 600),
        label: optional(r.label, 60),
      };
    }
    default:
      return null;
  }
}

export function parseBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const item of raw) {
    const block = parseBlock(item);
    if (block) out.push(block);
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

/** Paragraphs, for rendering a text block without holding markup. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * A one-line summary of a page, for the admin list and for a meta description
 * when nobody wrote one.
 */
export function pageSummary(blocks: Block[], max = 160): string {
  for (const block of blocks) {
    const text =
      block.type === 'text'
        ? paragraphs(block.body)[0]
        : block.type === 'bullets'
          ? block.items[0]
          : block.type === 'faq'
            ? block.items[0]?.a
            : undefined;
    if (text) return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  return '';
}
