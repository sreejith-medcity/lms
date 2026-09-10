import type { Block } from '@/lib/page-blocks';

/**
 * Reading the words out of a WordPress page.
 *
 * The pages being brought across are Elementor output. Under the design there
 * are perhaps three hundred words that took somebody a morning to write, and
 * those are the only part worth moving. This pulls them out and leaves the
 * markup where it is.
 *
 * It is a text extractor, not a browser. It does not run scripts, does not
 * resolve a layout and does not try to be clever about which div was a
 * column: it walks the document in order, keeps the headings, paragraphs,
 * lists, images and accordion questions it recognises, and reports what it
 * skipped so a person can look. Whatever it produces is saved as a draft and
 * read by a human before it is published, which is the right amount of trust
 * to put in a regular expression.
 *
 * Pure, and no dependencies. It is given a string and returns blocks.
 */

export interface Extraction {
  /** The page's own h1 or title tag, offered as the page title. */
  title?: string;
  blocks: Block[];
  /** Anything a person should look at: skipped media, dropped sections. */
  notes: string[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  uuml: 'ü',
  auml: 'ä',
  ouml: 'ö',
  szlig: 'ß',
  rupee: '₹',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Tags to plain text: what is left is what a reader would have seen. */
export function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole elements whose content is chrome rather than content. */
const CHROME = /<(script|style|noscript|svg|nav|header|footer|form|aside|select|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

function stripChrome(html: string): { html: string; notes: string[] } {
  const notes: string[] = [];

  let out = html.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(CHROME, '');
  // Self-closing or unclosed leftovers of the same kind.
  out = out.replace(/<(script|style)\b[^>]*>/gi, '');

  const iframes = out.match(/<iframe\b[^>]*>/gi) ?? [];
  if (iframes.length > 0) {
    notes.push(
      `${iframes.length} embedded frame${iframes.length === 1 ? '' : 's'} (video or map) were left behind. Add them again if the page needs them.`,
    );
  }

  return { html: out, notes };
}

/**
 * Narrow to the article when the page says where it is.
 *
 * WordPress themes are consistent about `<main>` and `entry-content`, and
 * using them cuts out the cookie bar, the related-posts strip and the eight
 * footer columns. When neither is there the whole body is used, which is
 * noisier but never empty.
 */
function contentRoot(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (main?.[1] && textOf(main[1]).length > 200) return main[1];

  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article?.[1] && textOf(article[1]).length > 200) return article[1];

  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return body?.[1] ?? html;
}

type Token =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'img'; src: string; alt: string }
  | { kind: 'q'; text: string }
  | { kind: 'a'; text: string };

const TOKEN =
  /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<li\b[^>]*>([\s\S]*?)<\/li>|<summary\b[^>]*>([\s\S]*?)<\/summary>|<img\b([^>]*)>|<div\b([^>]*class="[^"]*elementor-tab-title[^"]*"[^>]*)>([\s\S]*?)<\/div>|<div\b([^>]*class="[^"]*elementor-tab-content[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi;

function attr(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return decodeEntities(match?.[2] ?? match?.[3] ?? '').trim();
}

/** A picture worth keeping, rather than a spacer, an icon or a tracking pixel. */
function usableImage(src: string): boolean {
  if (!src.startsWith('https://')) return false;
  if (/data:|\.gif($|\?)/i.test(src)) return false;
  if (/(spacer|blank|pixel|placeholder|icon|logo|avatar|emoji)/i.test(src)) return false;
  return true;
}

function tokenise(html: string): Token[] {
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(html))) {
    if (match[1]) {
      const text = textOf(match[2] ?? '');
      if (text) tokens.push({ kind: 'h', level: Number(match[1]), text });
    } else if (match[3] !== undefined) {
      const text = textOf(match[3]);
      if (text) tokens.push({ kind: 'p', text });
    } else if (match[4] !== undefined) {
      const text = textOf(match[4]);
      if (text) tokens.push({ kind: 'li', text });
    } else if (match[5] !== undefined) {
      const text = textOf(match[5]);
      if (text) tokens.push({ kind: 'q', text });
    } else if (match[6] !== undefined) {
      const tag = match[6];
      // Lazy-loaded images keep the real file in data-src and a placeholder
      // in src, which is how an import ends up full of grey rectangles.
      const src = attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'src');
      if (usableImage(src)) tokens.push({ kind: 'img', src, alt: attr(tag, 'alt') });
    } else if (match[8] !== undefined) {
      const text = textOf(match[8]);
      if (text) tokens.push({ kind: 'q', text });
    } else if (match[10] !== undefined) {
      const text = textOf(match[10]);
      if (text) tokens.push({ kind: 'a', text });
    }
  }

  return tokens;
}

/** Menus and button rows arrive as lists of one or two words. Content does not. */
function looksLikeNavigation(items: string[]): boolean {
  if (items.length < 4) return false;
  const short = items.filter((i) => i.split(/\s+/).length <= 2).length;
  return short / items.length > 0.8;
}

export function extractBlocks(html: string): Extraction {
  const { html: cleaned, notes } = stripChrome(html);
  const root = contentRoot(cleaned);
  const tokens = tokenise(root);

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1 = tokens.find((t) => t.kind === 'h' && t.level === 1) as
    | { kind: 'h'; level: number; text: string }
    | undefined;
  const title = h1?.text || (titleTag ? textOf(titleTag[1]).split(/[|–—-]/)[0].trim() : undefined);

  const blocks: Block[] = [];
  const seenImages = new Set<string>();
  const seenText = new Set<string>();

  let heading: string | undefined;
  let paragraphs: string[] = [];
  let bullets: string[] = [];
  let faq: { q: string; a: string }[] = [];
  let pendingQuestion: string | undefined;
  let skippedLists = 0;

  const flushText = () => {
    if (paragraphs.length > 0) {
      blocks.push({ type: 'text', heading, body: paragraphs.join('\n\n') });
      heading = undefined;
    }
    paragraphs = [];
  };

  const flushBullets = () => {
    if (bullets.length > 0) {
      if (looksLikeNavigation(bullets)) skippedLists += 1;
      else {
        blocks.push({ type: 'bullets', heading, items: bullets });
        heading = undefined;
      }
    }
    bullets = [];
  };

  const flushFaq = () => {
    if (faq.length > 0) {
      blocks.push({ type: 'faq', heading: heading ?? 'Questions people ask', items: faq });
      heading = undefined;
    }
    faq = [];
    pendingQuestion = undefined;
  };

  const flushAll = () => {
    flushText();
    flushBullets();
    flushFaq();
  };

  for (const token of tokens) {
    switch (token.kind) {
      case 'h': {
        if (token.level === 1 && token.text === title) break; // the page title, not a section
        flushAll();
        heading = token.text;
        break;
      }
      case 'p': {
        // The same sentence twice usually means a mobile copy of a section.
        const key = token.text.toLowerCase();
        if (token.text.length < 3 || seenText.has(key)) break;
        seenText.add(key);
        flushBullets();
        flushFaq();
        paragraphs.push(token.text);
        break;
      }
      case 'li': {
        if (token.text.length < 2) break;
        flushText();
        bullets.push(token.text);
        break;
      }
      case 'q': {
        flushText();
        flushBullets();
        pendingQuestion = token.text;
        break;
      }
      case 'a': {
        if (pendingQuestion) {
          faq.push({ q: pendingQuestion, a: token.text });
          pendingQuestion = undefined;
        }
        break;
      }
      case 'img': {
        if (seenImages.has(token.src)) break;
        seenImages.add(token.src);
        flushAll();
        blocks.push({ type: 'image', url: token.src, alt: token.alt || undefined });
        break;
      }
    }
  }

  flushAll();

  if (skippedLists > 0) {
    notes.push(
      `${skippedLists} list${skippedLists === 1 ? '' : 's'} looked like navigation and were left out.`,
    );
  }
  if (blocks.length === 0) {
    notes.push('Nothing readable was found on that page. It may be built entirely from images.');
  }

  return { title, blocks, notes };
}
