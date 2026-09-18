import type { $Enums } from '@prisma/client';

/**
 * Company notices: the rules, without the database.
 *
 * A notice is written once, previewed against the people it will reach,
 * and published once. What the office needs to trust is the count: a parent
 * with two children in the audience is one parent, a learner picked by
 * branch and again by batch is one learner. A correction is a new version
 * that says it corrects the old one, in the inbox as well as in the office,
 * so nobody is left holding the earlier date.
 */

export const NOTICE_KINDS: { key: $Enums.NoticeKind; label: string; category: string }[] = [
  { key: 'GENERAL', label: 'General notice', category: 'Notice' },
  { key: 'MEETING', label: 'Meeting', category: 'Meeting' },
  { key: 'HOLIDAY', label: 'Holiday', category: 'Holiday' },
  { key: 'EXAM', label: 'Exam', category: 'Exam' },
  { key: 'FEE', label: 'Fees', category: 'Fees' },
  { key: 'EVENT', label: 'Event', category: 'Event' },
];

export function noticeCategory(kind: $Enums.NoticeKind): string {
  return NOTICE_KINDS.find((k) => k.key === kind)?.category ?? 'Notice';
}

export interface NoticeInput {
  kind: $Enums.NoticeKind;
  title: string;
  body: string;
  everyone: boolean;
  branchIds: string[];
  batchIds: string[];
  learnerIds: string[];
  toParents: boolean;
  toLearners: boolean;
  meetingAt: Date | null;
  meetingEndsAt: Date | null;
  venue: string | null;
  link: string | null;
  instructions: string | null;
}

export type ParseResult = { ok: true; value: NoticeInput } | { ok: false; error: string };

function list(v: unknown): string[] {
  if (Array.isArray(v)) return Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean)));
  if (typeof v === 'string') return Array.from(new Set(v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)));
  return [];
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function when(v: unknown): Date | null | 'bad' {
  const s = text(v, 40);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 'bad' : d;
}

/** Reads a notice off a form. Values are raw strings and arrays, as `FormData` yields them. */
export function parseNotice(raw: Record<string, unknown>): ParseResult {
  const kind = NOTICE_KINDS.find((k) => k.key === raw.kind)?.key ?? 'GENERAL';
  const title = text(raw.title, 160);
  const body = text(raw.body, 6000);
  if (title.length < 3) return { ok: false, error: 'Give the notice a title.' };
  if (body.length < 3) return { ok: false, error: 'Write the notice.' };

  const everyone = raw.everyone === 'on' || raw.everyone === true || raw.everyone === 'true';
  const branchIds = list(raw.branchIds);
  const batchIds = list(raw.batchIds);
  const learnerIds = list(raw.learnerIds);
  if (!everyone && branchIds.length + batchIds.length + learnerIds.length === 0) return { ok: false, error: 'Pick who this goes to: a branch, a batch, or particular learners.' };

  const toParents = raw.toParents === undefined ? true : raw.toParents === 'on' || raw.toParents === true || raw.toParents === 'true';
  const toLearners = raw.toLearners === 'on' || raw.toLearners === true || raw.toLearners === 'true';
  if (!toParents && !toLearners) return { ok: false, error: 'A notice goes to parents, to learners, or both.' };

  let meetingAt: Date | null = null;
  let meetingEndsAt: Date | null = null;
  let venue: string | null = null;
  let link: string | null = null;
  let instructions: string | null = null;
  if (kind === 'MEETING') {
    const at = when(raw.meetingAt);
    if (at === 'bad' || at === null) return { ok: false, error: 'A meeting needs a date and time.' };
    meetingAt = at;
    const ends = when(raw.meetingEndsAt);
    if (ends === 'bad') return { ok: false, error: 'The end time could not be read.' };
    if (ends && ends <= at) return { ok: false, error: 'The meeting ends before it starts.' };
    meetingEndsAt = ends;
    venue = text(raw.venue, 200) || null;
    link = text(raw.link, 500) || null;
    if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: 'The meeting link must start with http:// or https://.' };
    if (!venue && !link) return { ok: false, error: 'Say where the meeting is: a venue, or a link.' };
    instructions = text(raw.instructions, 1000) || null;
  }

  return { ok: true, value: { kind, title, body, everyone, branchIds, batchIds, learnerIds, toParents, toLearners, meetingAt, meetingEndsAt, venue, link, instructions } };
}

export interface AudienceLearner {
  id: string;
  name: string;
  branchId: string | null;
  parents: { contact: string; name: string }[];
}

export interface Audience {
  learners: AudienceLearner[];
  /** One entry per parent contact, with every child of theirs in the audience. */
  parents: { contact: string; name: string; children: { id: string; name: string }[] }[];
}

/** Folds learners reached by several groups into one list, and their parents into one per contact. */
export function foldAudience(rows: AudienceLearner[]): Audience {
  const learners = new Map<string, AudienceLearner>();
  for (const r of rows) if (!learners.has(r.id)) learners.set(r.id, r);
  const parents = new Map<string, { contact: string; name: string; children: { id: string; name: string }[] }>();
  for (const l of learners.values()) {
    for (const p of l.parents) {
      const hit = parents.get(p.contact) ?? { contact: p.contact, name: p.name, children: [] };
      if (!hit.children.some((c) => c.id === l.id)) hit.children.push({ id: l.id, name: l.name });
      parents.set(p.contact, hit);
    }
  }
  return { learners: Array.from(learners.values()), parents: Array.from(parents.values()) };
}

/** "3 parents of 2 learners, e.g. Anu, Ben" for the preview line. */
export function audienceLine(a: Audience, input: { toParents: boolean; toLearners: boolean }): string {
  const parts: string[] = [];
  if (input.toParents) parts.push(`${a.parents.length} parent${a.parents.length === 1 ? '' : 's'}`);
  if (input.toLearners) parts.push(`${a.learners.length} learner${a.learners.length === 1 ? '' : 's'}`);
  const who = parts.join(' and ');
  const of = input.toParents && !input.toLearners ? ` of ${a.learners.length} learner${a.learners.length === 1 ? '' : 's'}` : '';
  const sample = a.learners
    .slice(0, 3)
    .map((l) => l.name)
    .join(', ');
  return `${who}${of}${sample ? `, e.g. ${sample}` : ''}.`;
}

/** The inbox line for a parent: one row however many of their children it covers. */
export function parentNoticeRow(notice: { id: string; kind: $Enums.NoticeKind; title: string; version: number; supersedesId: string | null }, children: { id: string; name: string }[]) {
  const correction = notice.supersedesId !== null || notice.version > 1;
  const about = children.length === 1 ? children[0].name : children.map((c) => c.name).join(', ');
  return {
    title: `${correction ? 'Correction: ' : ''}${notice.title}`,
    body: `${noticeCategory(notice.kind)} for ${about}. Open to read it.`,
    href: `/parent/notices/${notice.id}`,
    dedupeKey: `notice:${notice.id}`,
  };
}

/** A meeting's line: "Sat 3 Oct, 10:00 to 11:00 · Kochi branch" or the link. */
export function meetingLine(n: { meetingAt: Date | null; meetingEndsAt: Date | null; venue: string | null; link: string | null }, fmt: (d: Date) => string, fmtTime: (d: Date) => string): string | null {
  if (!n.meetingAt) return null;
  const when = `${fmt(n.meetingAt)}${n.meetingEndsAt ? ` to ${fmtTime(n.meetingEndsAt)}` : ''}`;
  const where = n.venue ?? (n.link ? 'online' : '');
  return where ? `${when} · ${where}` : when;
}

/** What may still happen to a notice in this state. */
export function noticeActions(status: $Enums.NoticeStatus, superseded: boolean): { edit: boolean; publish: boolean; withdraw: boolean; correct: boolean; discard: boolean } {
  return {
    edit: status === 'DRAFT',
    publish: status === 'DRAFT',
    withdraw: status === 'PUBLISHED' && !superseded,
    correct: status === 'PUBLISHED' && !superseded,
    discard: status === 'DRAFT',
  };
}
