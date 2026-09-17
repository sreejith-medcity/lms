/**
 * What Edmingle's people, batches, prices and questions mean in our terms.
 *
 * Pure: the importer hands in what the API returned and takes back rows
 * ready to write. Nothing here reads or writes.
 */

/* People ------------------------------------------------------------------- */

export interface EdmingleStudent {
  user_id: number;
  name: string;
  email?: string | null;
  contact_number?: string | null;
  contact_number_dial_code?: string | null;
  contact_number_2?: string | null;
  registration_number?: string | number | null;
  status?: number;
  is_archived?: number;
  /** dd/mm/yyyy, the day they were added. */
  date?: string | null;
  parent_name?: string | null;
  parent_contact_number?: string | null;
  parent_email?: string | null;
  customfield_data?: { field_name: string; field_value?: string | null }[];
}

export interface LearnerRow {
  name: string;
  email: string | null;
  phone: string | null;
  registrationNo: number | null;
  archived: boolean;
  addedOn: Date | null;
  profile: { parentName: string | null; parentPhone: string | null; parentEmail: string | null; alternatePhone: string | null; permanentAddress: string | null; residentialAddress: string | null; schoolOrCollege: string | null; occupation: string | null; area: string | null; source: string | null };
}

/** A phone the way the LMS keeps it: ten digits for India, dial code and digits otherwise, or nothing. */
export function normalisePhone(raw: string | null | undefined, dial: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  const code = (dial ?? '').replace(/\D/g, '');
  if (!code || code === '91') {
    const ten = digits.slice(-10);
    return ten.length === 10 && /^[6-9]/.test(ten) ? ten : null;
  }
  return `+${code}${digits.replace(new RegExp(`^${code}`), '')}`;
}

function field(s: EdmingleStudent, name: string): string | null {
  const v = s.customfield_data?.find((f) => f.field_name === name)?.field_value?.trim();
  return v ? v : null;
}

function ddmmyyyy(s: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A learner as we would keep them. Religion, Aadhaar and the like are on
 * Edmingle's record and deliberately not read here: an academy's LMS has
 * no need of them and every reason not to hold them.
 */
export function learnerRow(s: EdmingleStudent): LearnerRow {
  const email = (s.email ?? '').trim().toLowerCase();
  const reg = Number(String(s.registration_number ?? '').trim());
  return {
    name: (s.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || `Learner ${s.user_id}`,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    phone: normalisePhone(s.contact_number, s.contact_number_dial_code),
    registrationNo: Number.isInteger(reg) && reg > 0 ? reg : null,
    archived: Boolean(s.is_archived),
    addedOn: ddmmyyyy(s.date),
    profile: {
      parentName: (s.parent_name ?? field(s, 'parent_name'))?.trim() || null,
      parentPhone: normalisePhone(s.parent_contact_number ?? field(s, 'parent_contact_number'), null),
      parentEmail: (s.parent_email ?? field(s, 'parent_email'))?.trim().toLowerCase() || null,
      alternatePhone: normalisePhone(s.contact_number_2 ?? field(s, 'alternate_contact'), null),
      permanentAddress: field(s, 'permanent_address'),
      residentialAddress: field(s, 'residential_address'),
      schoolOrCollege: field(s, 'school_college_name'),
      occupation: field(s, 'occupation'),
      area: field(s, 'area'),
      source: field(s, 'student_source'),
    },
  };
}

/* Batches -------------------------------------------------------------------- */

export interface EdmingleBatch {
  class_id: number;
  class_name: string;
  /** Seconds since the epoch, or nothing. */
  start_date?: number | string | null;
  end_date?: number | string | null;
  tutor_id?: number | null;
  tutor_name?: string | null;
  mb_archived?: number;
  registered_students?: number;
  admitted_students?: number;
}

export type BatchState = 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

export function epochDate(v: number | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isFinite(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Where a batch stands today, from its dates and Edmingle's archive flag. */
export function batchState(b: EdmingleBatch, now: Date): BatchState {
  if (b.mb_archived) return 'ARCHIVED';
  const start = epochDate(b.start_date);
  const end = epochDate(b.end_date);
  if (end && end < now) return 'COMPLETED';
  if (start && start > now) return 'UPCOMING';
  return 'ACTIVE';
}

/* Prices --------------------------------------------------------------------- */

export interface EdminglePackage {
  package_id: number;
  bundle_id: number;
  package_name?: string | null;
  cost?: number | string | null;
  currency_symbol?: string | null;
  is_archived?: number;
  package_cost_set?: number;
}

/** The price in paise, or null when the package carries none worth writing. */
export function packagePaise(p: EdminglePackage): number | null {
  if (p.is_archived) return null;
  const cost = Number(p.cost);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const symbol = (p.currency_symbol ?? '').trim();
  if (symbol && !/₹|INR|Rs/i.test(symbol)) return null;
  return Math.round(cost * 100);
}

/* Questions ------------------------------------------------------------------ */

export interface EdmingleQuestion {
  question_id: number;
  question_JSON?: string | null;
  input_JSON?: string | null;
  answer_JSON?: string | null;
  question_number?: number;
  is_removed?: number;
  difficulty?: number;
  sound_asset?: unknown;
  video_asset?: unknown;
  text_image_asset?: unknown;
}

export interface QuestionRow {
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'FILL_BLANK' | 'SHORT_ANSWER' | 'LONG_ANSWER';
  promptHtml: string;
  explanation: string | null;
  marks: number;
  negativeMarks: number;
  options: { label: string; isCorrect: boolean }[];
  answerKey: { kind: 'FILL_BLANK'; blanks: string[][]; caseSensitive: boolean } | null;
  /** The question carried audio, video or a picture we did not bring. */
  mediaLeftBehind: boolean;
}

function parseJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const html = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Edmingle keeps a question as three JSON strings: the passage, the parts
 * (each with its own text, marks and options) and the answers per part. A
 * question with several parts becomes several questions here, each with
 * the passage above its own text, because our banks are one question per
 * row and an assessment picks them one at a time.
 *
 * Bank types seen: 0 choice, 2 fill in the blank, 5 written answer. The
 * part's own input_type decides where the bank type does not.
 */
export function questionRows(bankType: number, q: EdmingleQuestion): QuestionRow[] {
  if (q.is_removed) return [];
  const passageRaw = parseJson(q.question_JSON);
  const passage = Array.isArray(passageRaw) ? passageRaw.map(html).filter(Boolean).join('\n') : html(passageRaw);
  const partsRaw = parseJson(q.input_JSON);
  const answersRaw = parseJson(q.answer_JSON);
  const parts = Array.isArray(partsRaw) ? partsRaw : [];
  const answers = Array.isArray(answersRaw) ? answersRaw : [];
  const mediaLeftBehind = Boolean(q.sound_asset || q.video_asset || q.text_image_asset);
  const out: QuestionRow[] = [];

  parts.forEach((partRaw, i) => {
    const part = (partRaw && typeof partRaw === 'object' ? partRaw : {}) as Record<string, unknown>;
    const answer = (answers[i] && typeof answers[i] === 'object' ? answers[i] : {}) as Record<string, unknown>;
    const text = html(part.question_string);
    const prompt = [passage, text].filter(Boolean).join('\n') || `Question ${q.question_number ?? q.question_id}`;
    const marks = Number(part.marks);
    const neg = Number(part.neg_mark);
    const explanation = html(answer.explanation) || html(part.explanation) || null;
    const inputType = Number(part.input_type);
    const base = { promptHtml: prompt, explanation, marks: Number.isFinite(marks) && marks > 0 ? marks : 1, negativeMarks: Number.isFinite(neg) && neg > 0 ? neg : 0, mediaLeftBehind };

    const opts = Array.isArray(part.options) ? part.options : [];
    const choiceOptions = opts.filter((o) => o && typeof o === 'object' && !Array.isArray(o)) as Record<string, unknown>[];
    const keyRaw = Array.isArray(answer.answer) ? answer.answer : [];

    if (choiceOptions.length >= 2 && (inputType === 0 || inputType === 1 || bankType === 0)) {
      const correct = new Set<number>();
      for (const k of keyRaw.flat(2)) if (typeof k === 'number') correct.add(k);
      choiceOptions.forEach((o, idx) => {
        if (Number(o.is_correct) === 1) correct.add(typeof o.index === 'number' ? o.index : idx);
      });
      const options = choiceOptions.map((o, idx) => ({ label: html(o.option_string) || `Option ${idx + 1}`, isCorrect: correct.has(typeof o.index === 'number' ? o.index : idx) }));
      if (options.some((o) => o.isCorrect)) {
        out.push({ ...base, type: options.filter((o) => o.isCorrect).length > 1 ? 'MCQ_MULTI' : 'MCQ_SINGLE', options, answerKey: null });
        return;
      }
    }

    const blanks = keyRaw
      .map((k) => (Array.isArray(k) ? k.map((x) => (typeof x === 'string' ? x.trim() : String(x ?? ''))).filter(Boolean) : typeof k === 'string' && k.trim() ? [k.trim()] : []))
      .filter((b) => b.length > 0);
    if (blanks.length > 0 && (inputType === 2 || bankType === 2)) {
      out.push({ ...base, type: 'FILL_BLANK', options: [], answerKey: { kind: 'FILL_BLANK', blanks, caseSensitive: false } });
      return;
    }

    out.push({ ...base, type: bankType === 5 || base.marks >= 5 ? 'LONG_ANSWER' : 'SHORT_ANSWER', options: [], answerKey: null });
  });

  return out;
}
