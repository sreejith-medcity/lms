import type { ExamFormat } from '@/lib/exams/types';
import { TELC_FORMATS } from './formats/telc';

/**
 * Every format the portal knows. A format is live for an academy once it
 * has at least one active set of content; the public page and the
 * learner's list show only those.
 */
export const EXAM_FORMATS: ExamFormat[] = [...TELC_FORMATS];

export function examFormat(code: string): ExamFormat | null {
  return EXAM_FORMATS.find((f) => f.code === code) ?? null;
}

export function formatBySlug(slug: string): ExamFormat | null {
  return EXAM_FORMATS.find((f) => f.slug === slug) ?? null;
}

/** The families a pack or an allowance can be for, with the levels each has. */
export function examFamilies(): { family: string; name: string; levels: string[] }[] {
  const out = new Map<string, { family: string; name: string; levels: string[] }>();
  for (const f of EXAM_FORMATS) {
    const entry = out.get(f.family) ?? { family: f.family, name: FAMILY_NAMES[f.family] ?? f.family, levels: [] };
    if (f.level && !entry.levels.includes(f.level)) entry.levels.push(f.level);
    out.set(f.family, entry);
  }
  return [...out.values()];
}

export const FAMILY_NAMES: Record<string, string> = {
  telc: 'telc Deutsch',
  ielts: 'IELTS',
  oet: 'OET',
  pte: 'PTE Academic',
  nclex: 'NCLEX-RN',
  dha: 'DHA',
};
