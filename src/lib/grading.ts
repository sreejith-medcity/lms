/**
 * Grade bands.
 *
 * A percentage is a measurement; a grade is a judgement, and the two should not
 * be confused. This turns one into the other with bands an academy sets for
 * itself, because 40% is a pass in one exam board and a fail in another, and
 * hard-coding either is how a report card starts lying.
 */

export interface Band {
  grade: string;
  minPercent: number;
  maxPercent: number;
  point?: number;
  label?: string;
}

/** What most Indian institutes start from, and can then edit. */
export const DEFAULT_BANDS: Band[] = [
  { grade: 'A+', minPercent: 90, maxPercent: 100, point: 10, label: 'Outstanding' },
  { grade: 'A', minPercent: 80, maxPercent: 89, point: 9, label: 'Excellent' },
  { grade: 'B', minPercent: 70, maxPercent: 79, point: 8, label: 'Very good' },
  { grade: 'C', minPercent: 60, maxPercent: 69, point: 7, label: 'Good' },
  { grade: 'D', minPercent: 50, maxPercent: 59, point: 6, label: 'Satisfactory' },
  { grade: 'E', minPercent: 40, maxPercent: 49, point: 5, label: 'Pass' },
  { grade: 'F', minPercent: 0, maxPercent: 39, point: 0, label: 'Did not pass' },
];

export function parseBands(raw: unknown): Band[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (b): b is Band =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as Band).grade === 'string' &&
        Number.isFinite((b as Band).minPercent) &&
        Number.isFinite((b as Band).maxPercent),
    )
    .map((b) => ({
      grade: String(b.grade).slice(0, 8),
      minPercent: Math.max(0, Math.min(100, Number(b.minPercent))),
      maxPercent: Math.max(0, Math.min(100, Number(b.maxPercent))),
      point: b.point != null ? Number(b.point) : undefined,
      label: b.label ? String(b.label).slice(0, 60) : undefined,
    }))
    .sort((a, b) => b.minPercent - a.minPercent);
}

export function gradeFor(percent: number, bands: Band[]): Band | null {
  const p = Math.max(0, Math.min(100, percent));
  return bands.find((b) => p >= b.minPercent && p <= b.maxPercent) ?? null;
}

export interface BandProblem {
  kind: 'GAP' | 'OVERLAP' | 'INVERTED' | 'INCOMPLETE';
  message: string;
}

/**
 * Every way a set of bands can be wrong, found before it is saved.
 *
 * A gap between 79 and 80 is invisible until the day somebody scores 79.5 and
 * their report card has no grade on it, which is exactly the sort of thing that
 * surfaces in front of a parent rather than in front of the person who set it.
 */
export function checkBands(bands: Band[]): BandProblem[] {
  const problems: BandProblem[] = [];
  if (bands.length === 0) return [{ kind: 'INCOMPLETE', message: 'There are no bands.' }];

  for (const band of bands) {
    if (band.minPercent > band.maxPercent) {
      problems.push({
        kind: 'INVERTED',
        message: `${band.grade} runs from ${band.minPercent} down to ${band.maxPercent}, which is backwards.`,
      });
    }
  }

  const sorted = [...bands].sort((a, b) => a.minPercent - b.minPercent);

  if (sorted[0].minPercent > 0) {
    problems.push({
      kind: 'GAP',
      message: `Nothing covers 0 to ${sorted[0].minPercent - 1}%. A score in that range would have no grade.`,
    });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const here = sorted[i];
    const next = sorted[i + 1];

    if (next.minPercent <= here.maxPercent) {
      problems.push({
        kind: 'OVERLAP',
        message: `${here.grade} and ${next.grade} both cover ${next.minPercent}%. The higher band would win, silently.`,
      });
    } else if (next.minPercent > here.maxPercent + 1) {
      problems.push({
        kind: 'GAP',
        message: `Nothing covers ${here.maxPercent + 1} to ${next.minPercent - 1}%.`,
      });
    }
  }

  const top = sorted[sorted.length - 1];
  if (top.maxPercent < 100) {
    problems.push({
      kind: 'GAP',
      message: `Nothing covers ${top.maxPercent + 1} to 100%.`,
    });
  }

  return problems;
}
