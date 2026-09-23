/**
 * The exam content carries a little markup (bold in an instruction, a line
 * break in an advert). It comes from our own sets, but a set can be edited
 * by staff, so what reaches the page is cut down to a handful of harmless
 * tags with no attributes at all.
 */

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'span', 'small', 'sup', 'sub']);

export function safeHtml(input: unknown): string {
  const s = String(input ?? '');
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>/g, (_m, close: string, tag: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return '';
      if (t === 'br') return '<br>';
      return `<${close ? '/' : ''}${t}>`;
    });
}

/** Plain text of a bit of content, for a heading or an aria label. */
export function plainOf(input: unknown): string {
  return String(input ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
