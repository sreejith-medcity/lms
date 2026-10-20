/**
 * How fast the pages answer, measured the same way every time.
 *
 * Each page is fetched several times; the first fetch of a page is reported
 * on its own (a cold render, the cost a visitor pays after a deploy or a
 * quiet hour) and the rest are summarised as a median and a 90th percentile
 * of the time to the first byte, which is server time plus one round trip.
 * The floor (`/api/version`, which renders nothing) is measured alongside,
 * so the round trip can be taken off and what is left is the page itself.
 *
 * Pure: the script in `scripts/perf.ts` does the fetching.
 */

export interface Sample {
  path: string;
  /** Milliseconds to the response headers. */
  ttfb: number;
  /** Milliseconds to the last byte. */
  total: number;
  bytes: number;
  status: number;
}

export interface Row {
  path: string;
  status: number;
  cold: number;
  median: number;
  p90: number;
  /** The median less the floor's median: the page's own share. */
  page: number;
  totalMedian: number;
  kb: number;
  runs: number;
}

/** The value at a quantile, by nearest rank on the sorted values; 0 for none. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank];
}

export const median = (values: number[]) => quantile(values, 0.5);

export const FLOOR_PATH = '/api/version';

/** One row per path, in the order the paths were first seen, with the floor taken off each. */
export function summarise(samples: Sample[]): { rows: Row[]; floor: number } {
  const byPath = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = byPath.get(s.path) ?? [];
    list.push(s);
    byPath.set(s.path, list);
  }
  const warm = (list: Sample[]) => (list.length > 1 ? list.slice(1) : list);
  const floorSamples = byPath.get(FLOOR_PATH);
  const floor = floorSamples ? Math.round(median(warm(floorSamples).map((s) => s.ttfb))) : 0;
  const rows: Row[] = [];
  for (const [path, list] of byPath) {
    const rest = warm(list);
    const ttfb = rest.map((s) => s.ttfb);
    const m = Math.round(median(ttfb));
    rows.push({
      path,
      status: list[list.length - 1].status,
      cold: Math.round(list[0].ttfb),
      median: m,
      p90: Math.round(quantile(ttfb, 0.9)),
      page: path === FLOOR_PATH ? 0 : Math.max(0, m - floor),
      totalMedian: Math.round(median(rest.map((s) => s.total))),
      kb: Math.round(median(rest.map((s) => s.bytes)) / 1024),
      runs: list.length,
    });
  }
  return { rows, floor };
}

/** A plain table for a terminal or a note. */
export function formatTable(rows: Row[], floor: number): string {
  const head = ['page', 'status', 'cold', 'median', 'p90', 'page only', 'whole', 'KB'];
  const lines = rows.map((r) => [r.path, String(r.status), `${r.cold}`, `${r.median}`, `${r.p90}`, r.path === FLOOR_PATH ? '(floor)' : `${r.page}`, `${r.totalMedian}`, `${r.kb}`]);
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [
    fmt(head),
    fmt(widths.map((w) => '-'.repeat(w))),
    ...lines.map(fmt),
    '',
    `Milliseconds. "cold" is the first fetch; median and p90 are the rest, to the first byte. "page only" takes off the floor (${floor} ms, ${FLOOR_PATH}), which is the round trip and the app's own minimum. "whole" is to the last byte.`,
  ].join('\n');
}
