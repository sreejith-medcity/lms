/**
 * What a package says about itself. imsmanifest.xml for SCORM, tincan.xml
 * for xAPI, read with a few regular expressions rather than an XML parser:
 * the four things needed (the standard, the title, the launch file, the
 * mastery score) sit in well-known places, and a dependency for four
 * fields is a dependency too many.
 */

export type Standard = 'SCORM_1_2' | 'SCORM_2004' | 'XAPI';

export interface PackageInfo {
  standard: Standard;
  title: string;
  launchPath: string;
  identifier: string | null;
  masteryScore: number | null;
}

/** The manifest's path inside the zip, allowing for a single top-level folder. */
export function findManifest(names: string[]): { path: string; root: string; kind: 'scorm' | 'xapi' } | null {
  const candidates = names.filter((n) => /(^|\/)(imsmanifest|tincan)\.xml$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length);
  const first = candidates[0];
  if (!first) return null;
  const root = first.includes('/') ? first.slice(0, first.lastIndexOf('/') + 1) : '';
  return { path: first, root, kind: /tincan\.xml$/i.test(first) ? 'xapi' : 'scorm' };
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? decode(m[1]) : null;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}

function text(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i'));
  return m ? decode(m[1].replace(/<[^>]+>/g, '')) : null;
}

export function parseImsManifest(xml: string): PackageInfo {
  const schemaVersion = text(xml, 'schemaversion') ?? '';
  const standard: Standard = /2004|CAM/i.test(schemaVersion) || /adlseq|imsss/i.test(xml) ? 'SCORM_2004' : 'SCORM_1_2';

  // Resources by identifier, with their href and base.
  const resources = new Map<string, { href: string; base: string }>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?resource\b([^>]*)>/gi)) {
    const id = attr(m[1], 'identifier');
    const href = attr(m[1], 'href');
    const base = attr(m[1], 'xml:base') ?? '';
    if (id) resources.set(id, { href: href ?? '', base });
  }
  const resourcesBase = attr(xml.match(/<(?:[\w-]+:)?resources\b([^>]*)>/i)?.[1] ?? '', 'xml:base') ?? '';

  // The first item with a resource is what launches. A manifest may nest
  // items; the first leaf in document order is the entry point.
  let launchRef: string | null = null;
  let title: string | null = null;
  let masteryScore: number | null = null;
  const orgMatch = xml.match(/<(?:[\w-]+:)?organization\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?organization>/i);
  const orgXml = orgMatch?.[1] ?? xml;
  title = text(orgXml, 'title');
  for (const m of orgXml.matchAll(/<(?:[\w-]+:)?item\b([^>]*)>([\s\S]*?)(?=<(?:[\w-]+:)?item\b|<\/(?:[\w-]+:)?item>)/gi)) {
    const ref = attr(m[1], 'identifierref');
    if (ref && resources.has(ref)) {
      launchRef = ref;
      const ms = text(m[2], 'masteryscore') ?? text(m[2], 'minNormalizedMeasure');
      if (ms !== null && ms !== '') {
        const n = Number(ms);
        if (Number.isFinite(n)) masteryScore = n <= 1 && standard === 'SCORM_2004' ? n * 100 : n;
      }
      if (!title) title = text(m[2], 'title');
      break;
    }
  }
  if (!launchRef) {
    // No organisation items: take the first resource with an href.
    for (const [id, r] of resources) if (r.href) { launchRef = id; break; }
  }
  const res = launchRef ? resources.get(launchRef) : null;
  if (!res || !res.href) throw new Error('NO_LAUNCH_FILE');
  const launchPath = joinPath(resourcesBase, res.base, res.href);
  const identifier = attr(xml.match(/<(?:[\w-]+:)?manifest\b([^>]*)>/i)?.[1] ?? '', 'identifier');
  return { standard, title: title || 'Interactive lesson', launchPath, identifier, masteryScore };
}

export function parseTincan(xml: string): PackageInfo {
  const activity = xml.match(/<(?:[\w-]+:)?activity\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?activity>/i);
  const identifier = activity ? attr(activity[1], 'id') : null;
  const title = activity ? text(activity[2], 'name') : null;
  const launch = activity ? text(activity[2], 'launch') : null;
  if (!launch) throw new Error('NO_LAUNCH_FILE');
  return { standard: 'XAPI', title: title || 'Interactive lesson', launchPath: launch, identifier, masteryScore: null };
}

function joinPath(...parts: string[]): string {
  const out: string[] = [];
  for (const raw of parts) {
    if (!raw) continue;
    const p = raw.replace(/\\/g, '/').split('?')[0];
    for (const seg of p.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        // Climbing above the package is refused rather than silently clamped.
        if (out.length === 0) return '..';
        out.pop();
      } else out.push(seg);
    }
  }
  return out.join('/');
}

/** The part of the launch href after the file, if any: SCORM allows "index.html?x=1". */
export function launchQuery(href: string): string {
  const i = href.indexOf('?');
  return i >= 0 ? href.slice(i) : '';
}

export function safeRelativePath(path: string): string | null {
  const cleaned = joinPath(path);
  if (!cleaned || cleaned.startsWith('..')) return null;
  return cleaned;
}
