/**
 * Learning paths: the rules with no database in them.
 *
 * Two ideas. A prerequisite says "finish A1 before A2 is sold to you"; a
 * chain of them is a path, and the storefront can draw it. A bundle is
 * several courses at one price; buying it enrols you in each.
 */

export interface Prerequisite {
  requiredCourseId: string;
  requiredTitle: string;
  /** How far through the required course they must be; 100 is finished. */
  minProgressPercent: number;
}

export interface PrerequisiteCheck {
  met: boolean;
  /** The ones still in the way, in the order they were set. */
  missing: { requiredCourseId: string; requiredTitle: string; need: number; have: number | null }[];
}

/**
 * Has this learner done what the course asks first?
 * `progress` is what they have of each course: a percent, or null when they
 * are not enrolled in it at all.
 */
export function checkPrerequisites(
  prerequisites: Prerequisite[],
  progress: Map<string, number | null>,
): PrerequisiteCheck {
  const missing = prerequisites
    .map((p) => {
      const have = progress.get(p.requiredCourseId) ?? null;
      const need = Math.max(0, Math.min(100, p.minProgressPercent));
      const ok = have !== null && (need === 0 || have >= need);
      return ok ? null : { requiredCourseId: p.requiredCourseId, requiredTitle: p.requiredTitle, need, have };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
  return { met: missing.length === 0, missing };
}

/** What a prerequisite asks, in words. */
export function prerequisiteLabel(p: { requiredTitle: string; minProgressPercent: number }): string {
  const need = Math.max(0, Math.min(100, p.minProgressPercent));
  if (need >= 100) return `Finish ${p.requiredTitle}`;
  if (need <= 0) return `Be enrolled in ${p.requiredTitle}`;
  return `Get ${need}% through ${p.requiredTitle}`;
}

/** The sentence a blocked buyer sees. */
export function blockedMessage(check: PrerequisiteCheck): string | null {
  if (check.met) return null;
  // The verb goes lower case mid-sentence; the course keeps its name.
  const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
  const parts = check.missing.map((m) => {
    const label = lower(prerequisiteLabel({ requiredTitle: m.requiredTitle, minProgressPercent: m.need }));
    return m.have === null ? label : `${label} (you are at ${Math.round(m.have)}%)`;
  });
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `To take this course, first ${list}.`;
}

export interface PathEdge {
  courseId: string;
  requiredCourseId: string;
}

/**
 * Would adding "course needs required" make a loop? A1 needs A2 needs A1
 * would lock both forever, so the editor refuses it.
 */
export function wouldLoop(edges: PathEdge[], courseId: string, requiredCourseId: string): boolean {
  if (courseId === requiredCourseId) return true;
  // Walk what the required course itself needs; if we reach courseId, it is a loop.
  const seen = new Set<string>();
  const stack = [requiredCourseId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === courseId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const e of edges) if (e.courseId === current) stack.push(e.requiredCourseId);
  }
  return false;
}

/**
 * The path that leads to a course: everything it needs, in an order where
 * each course comes after what it needs, then the course itself. A1 → A2 →
 * B1 for a B1 that needs A2 that needs A1.
 */
export function pathTo(edges: PathEdge[], courseId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const e of edges) if (e.courseId === id) visit(e.requiredCourseId);
    out.push(id);
  };
  visit(courseId);
  return out;
}

/** The courses this one opens the door to: those that list it as a requirement. */
export function unlockedBy(edges: PathEdge[], courseId: string): string[] {
  return Array.from(new Set(edges.filter((e) => e.requiredCourseId === courseId).map((e) => e.courseId)));
}

/* Bundles ------------------------------------------------------------------- */

export interface BundleSaving {
  /** What the courses cost bought one by one. */
  separatelyPaise: number;
  savingPaise: number;
  savingPercent: number;
}

export function bundleSaving(bundlePricePaise: number, partPricesPaise: number[]): BundleSaving {
  const separatelyPaise = partPricesPaise.reduce((n, p) => n + Math.max(0, p), 0);
  const savingPaise = Math.max(0, separatelyPaise - bundlePricePaise);
  return {
    separatelyPaise,
    savingPaise,
    savingPercent: separatelyPaise > 0 ? Math.round((savingPaise / separatelyPaise) * 100) : 0,
  };
}

export function bundleProblem(title: string, courseIds: string[]): string | null {
  if (title.trim().length < 2) return 'Give the bundle a name.';
  const distinct = new Set(courseIds.filter(Boolean));
  if (distinct.size < 2) return 'A bundle needs at least two courses.';
  if (distinct.size > 20) return 'Twenty courses is plenty for one bundle.';
  return null;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'bundle';
}
