/**
 * What an automation is made of, and the parts of running one that need
 * no database: reading a trigger's narrowing, checking an event against it,
 * reading a step's settings, deciding what a condition says about a
 * learner's situation, and working out when the next step is due.
 *
 * Everything here is a pure function, so it is tested without a server
 * and the runner in workflows.ts is thin.
 */

export interface TriggerFilters {
  productIds: string[];
  batchIds: string[];
  /** For "gone quiet": how many days without activity. */
  days: number;
  /** For "a paper was marked": only passes, only fails, or either. */
  outcome: 'ANY' | 'PASSED' | 'FAILED';
}

export function parseTriggerFilters(raw: unknown): TriggerFilters {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 50) : []);
  const days = Number(r.days);
  return {
    productIds: ids(r.productIds),
    batchIds: ids(r.batchIds),
    days: Number.isFinite(days) && days >= 1 ? Math.min(365, Math.round(days)) : 7,
    outcome: r.outcome === 'PASSED' || r.outcome === 'FAILED' ? r.outcome : 'ANY',
  };
}

/** Does this event fall inside the trigger's narrowing? */
export function eventMatches(
  filters: TriggerFilters,
  event: { productId?: string | null; batchId?: string | null; data?: Record<string, unknown> },
): boolean {
  if (filters.productIds.length && (!event.productId || !filters.productIds.includes(event.productId))) return false;
  if (filters.batchIds.length && (!event.batchId || !filters.batchIds.includes(event.batchId))) return false;
  if (filters.outcome !== 'ANY') {
    const passed = event.data?.passed;
    if (typeof passed !== 'boolean') return false;
    if (filters.outcome === 'PASSED' && !passed) return false;
    if (filters.outcome === 'FAILED' && passed) return false;
  }
  return true;
}

/* Steps --------------------------------------------------------------------- */

export const ACTION_TYPES = [
  { key: 'SEND_MESSAGE', label: 'Send a message', blurb: 'Email, SMS or WhatsApp, from a saved template or written here.' },
  { key: 'WAIT', label: 'Wait', blurb: 'Pause before the next step: hours or days.' },
  { key: 'CONDITION', label: 'Continue only if', blurb: 'Stop here unless something is true about the learner.' },
  { key: 'ADD_TAG', label: 'Add a tag', blurb: 'A label on the learner the office can filter by.' },
  { key: 'REMOVE_TAG', label: 'Remove a tag', blurb: '' },
  { key: 'ADD_POINTS', label: 'Give credit points', blurb: 'Into their loyalty wallet, with a note they will see.' },
  { key: 'FOLLOW_UP', label: 'Create a follow-up', blurb: 'A call or message for a counsellor, on the enquiry list.' },
  { key: 'ENROL', label: 'Enrol them in a course', blurb: 'Without payment: a free preview, a bonus module, the next level.' },
  { key: 'WEBHOOK', label: 'Call a URL', blurb: 'A signed POST to another system.' },
] as const;

export type ActionType = (typeof ACTION_TYPES)[number]['key'];

export const isActionType = (v: unknown): v is ActionType => ACTION_TYPES.some((a) => a.key === v);

export const CONDITION_KINDS = [
  { key: 'ENROLLED_IN', label: 'They are enrolled in a course', needs: 'product' },
  { key: 'NOT_ENROLLED_IN', label: 'They are not enrolled in a course', needs: 'product' },
  { key: 'HAS_TAG', label: 'They have a tag', needs: 'tag' },
  { key: 'NOT_HAS_TAG', label: 'They do not have a tag', needs: 'tag' },
  { key: 'HAS_PAID', label: 'They have ever paid', needs: null },
  { key: 'ACTIVE_WITHIN', label: 'They were active in the last N days', needs: 'days' },
  { key: 'INACTIVE_FOR', label: 'They have not been active for N days', needs: 'days' },
] as const;

export type ConditionKind = (typeof CONDITION_KINDS)[number]['key'];

export interface StepConfig {
  /* SEND_MESSAGE */
  templateId?: string;
  channel?: 'EMAIL' | 'SMS' | 'WHATSAPP';
  subject?: string;
  body?: string;
  /* tags */
  tag?: string;
  /* points */
  points?: number;
  note?: string;
  /* follow-up */
  followUpChannel?: 'CALL' | 'EMAIL' | 'WHATSAPP';
  daysFromNow?: number;
  /* enrol / condition */
  productId?: string;
  /* condition */
  condition?: ConditionKind;
  days?: number;
  /* webhook */
  url?: string;
  secret?: string;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A step's settings, read defensively: a bad row cannot crash the runner. */
export function parseStepConfig(raw: unknown): StepConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const channel = r.channel === 'SMS' || r.channel === 'WHATSAPP' ? r.channel : r.channel === 'EMAIL' ? 'EMAIL' : undefined;
  const followUpChannel = r.followUpChannel === 'EMAIL' || r.followUpChannel === 'WHATSAPP' ? r.followUpChannel : 'CALL';
  const condition = CONDITION_KINDS.some((c) => c.key === r.condition) ? (r.condition as ConditionKind) : undefined;
  return {
    templateId: str(r.templateId, 60) || undefined,
    channel,
    subject: str(r.subject, 200) || undefined,
    body: str(r.body, 4000) || undefined,
    tag: str(r.tag, 60) || undefined,
    points: Math.round(num(r.points, 0, 100000, 0)),
    note: str(r.note, 500) || undefined,
    followUpChannel,
    daysFromNow: num(r.daysFromNow, 0, 365, 1),
    productId: str(r.productId, 60) || undefined,
    condition,
    days: Math.round(num(r.days, 1, 365, 7)),
    url: str(r.url, 500) || undefined,
    secret: str(r.secret, 200) || undefined,
  };
}

/** What is wrong with a step, in words, or nothing. */
export function stepProblem(actionType: string, config: StepConfig): string | null {
  switch (actionType) {
    case 'SEND_MESSAGE':
      if (config.templateId) return null;
      if (!config.channel) return 'Pick a channel or a template.';
      if (!config.body) return 'The message has no text.';
      if (config.channel === 'WHATSAPP') return 'WhatsApp needs an approved template; pick one rather than writing text here.';
      return null;
    case 'WAIT':
      return null;
    case 'CONDITION': {
      if (!config.condition) return 'Pick what has to be true.';
      const needs = CONDITION_KINDS.find((c) => c.key === config.condition)?.needs;
      if (needs === 'product' && !config.productId) return 'Pick the course.';
      if (needs === 'tag' && !config.tag) return 'Type the tag.';
      return null;
    }
    case 'ADD_TAG':
    case 'REMOVE_TAG':
      return config.tag ? null : 'Type the tag.';
    case 'ADD_POINTS':
      return config.points && config.points > 0 ? null : 'How many points?';
    case 'FOLLOW_UP':
      return null;
    case 'ENROL':
      return config.productId ? null : 'Pick the course.';
    case 'WEBHOOK':
      return config.url && /^https:\/\//.test(config.url) ? null : 'The URL must start with https://';
    default:
      return 'Unknown step.';
  }
}

/* Conditions ---------------------------------------------------------------- */

/** What the runner knows about the learner when a condition is checked. */
export interface LearnerFacts {
  enrolledProductIds: string[];
  tags: string[];
  hasPaid: boolean;
  /** Most recent activity of any kind, or null for never. */
  lastActiveAt: Date | null;
}

export function conditionHolds(config: StepConfig, facts: LearnerFacts, now = new Date()): boolean {
  const daysSince = facts.lastActiveAt ? (now.getTime() - facts.lastActiveAt.getTime()) / 864e5 : Infinity;
  switch (config.condition) {
    case 'ENROLLED_IN':
      return Boolean(config.productId && facts.enrolledProductIds.includes(config.productId));
    case 'NOT_ENROLLED_IN':
      return Boolean(config.productId && !facts.enrolledProductIds.includes(config.productId));
    case 'HAS_TAG':
      return Boolean(config.tag && facts.tags.includes(config.tag));
    case 'NOT_HAS_TAG':
      return Boolean(config.tag && !facts.tags.includes(config.tag));
    case 'HAS_PAID':
      return facts.hasPaid;
    case 'ACTIVE_WITHIN':
      return daysSince <= (config.days ?? 7);
    case 'INACTIVE_FOR':
      return daysSince >= (config.days ?? 7);
    default:
      return false;
  }
}

/* Timing -------------------------------------------------------------------- */

/** When step `index` is due, given the run reached it at `now`. */
export function dueAt(steps: { delayMinutes: number }[], index: number, now: Date): Date {
  const delay = steps[index]?.delayMinutes ?? 0;
  return delay > 0 ? new Date(now.getTime() + delay * 60_000) : now;
}

/** "2 days", "3 hours", "45 minutes", "straight away". */
export function describeDelay(minutes: number): string {
  if (minutes <= 0) return 'straight away';
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** The dedupe key for a run: once per person, or once per person per subject. */
export function runKey(workflowId: string, runOnce: boolean, personId: string, subjectId: string): string {
  return runOnce ? `${workflowId}:${personId}` : `${workflowId}:${personId}:${subjectId}`;
}

/** Tags are case-insensitive and tidy: "  Needs a Call " and "needs a call" are one tag. */
export function normaliseTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 60);
}

/** The variables a message step may use, spelled out for the editor. */
export const MESSAGE_VARIABLES = ['name', 'item', 'organization', 'url', 'amount', 'date', 'score'] as const;
