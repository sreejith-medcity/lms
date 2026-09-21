import { resolveIntegration } from '@/lib/integration-store';
import type { EdmingleAsset, EdmingleBundle, EdmingleModule, EdmingleSection } from '@/lib/edmingle-rules';
import type { EdmingleBatch, EdminglePackage, EdmingleQuestion, EdmingleStudent } from '@/lib/edmingle-records';

/**
 * Edmingle's own API, the one its admin panel talks to.
 *
 * Nothing about it is published, so this is written against what the panel
 * sends and receives today: an `apikey` header (the value the panel keeps
 * in the browser under that name) and an `orgid` header, JSON back with a
 * `code` field. Read-only: the importer only ever asks. If Edmingle changes
 * a route the step that uses it reports the failure rather than guessing.
 *
 * Edmingle rate-limits a burst of calls (429), so every call is spaced out
 * and a 429 waits and tries again rather than failing the item.
 */

/** Gap between calls, so a step reads a library without tripping the limit. */
const PACE_MS = 1500;
const RETRIES = 3;
let lastCallAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function paced() {
  const wait = lastCallAt + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

export interface EdmingleClient {
  baseUrl: string;
  orgId: string;
  get<T>(path: string, params?: Record<string, string | number>): Promise<T>;
}

export async function edmingleFor(organizationId: string): Promise<EdmingleClient | null> {
  const resolved = await resolveIntegration(organizationId, 'edmingle');
  if (!resolved?.complete) return null;
  const baseUrl = resolved.values.apiBase.trim().replace(/\/+$/, '');
  const orgId = resolved.values.orgId.trim();
  // A key pasted from the browser's storage panel often arrives with a quote
  // or a newline on it; Edmingle answers "invalid credentials" to that.
  const apiKey = (resolved.values.apiKey ?? '').trim().replace(/^["']+|["']+$/g, '');
  if (!/^https:\/\//.test(baseUrl) || !orgId || !apiKey) return null;

  return {
    baseUrl,
    orgId,
    async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
      const url = new URL(`${baseUrl}/nuSource/api/v1/${path.replace(/^\//, '')}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      for (let attempt = 0; ; attempt += 1) {
        await paced();
        const res = await fetch(url, {
          headers: { accept: 'application/json, text/plain, */*', apikey: apiKey, orgid: orgId },
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 && attempt < RETRIES) {
          const after = Number(res.headers.get('retry-after'));
          await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 5000 * 2 ** attempt);
          continue;
        }
        if (res.status === 429) throw new Error(`Edmingle is rate-limiting us on ${path}: wait a minute and press again`);
        const text = await res.text();
        let body: T & { code?: number; message?: string };
        try {
          body = JSON.parse(text) as T & { code?: number; message?: string };
        } catch {
          throw new Error(`Edmingle answered ${res.status} for ${path} with something that is not JSON`);
        }
        if (!res.ok) {
          const said = typeof body.message === 'string' ? body.message : '';
          throw new Error(/invalid\.?credentials/i.test(said) ? 'Edmingle refused the API key: paste a fresh "apikey" value from your signed-in admin session on the Edmingle card.' : `Edmingle answered ${res.status} for ${path}${said ? `: ${said}` : ''}`);
        }
        if (typeof body.code === 'number' && body.code >= 400) throw new Error(`Edmingle refused ${path}: ${body.message ?? body.code}`);
        return body;
      }
    },
  };
}

interface PageContext {
  page: number;
  per_page: number;
  has_more_page?: boolean;
  total_rows?: number;
}

/** Is the key any good: one small call that needs it. */
export async function checkEdmingle(client: EdmingleClient): Promise<string> {
  const r = await client.get<{ page_context?: PageContext }>('organization/courses', { organization_id: client.orgId, page: 1, per_page: 1 });
  const total = r.page_context?.total_rows;
  return typeof total === 'number' ? `Connected. ${total} modules in the library.` : 'Connected.';
}

/** Every module, and every course with the modules it holds. */
export async function catalogue(client: EdmingleClient): Promise<{ modules: EdmingleModule[]; bundles: EdmingleBundle[] }> {
  const modules: EdmingleModule[] = [];
  const bundleMap = new Map<number, EdmingleBundle>();
  for (let page = 1; page <= 50; page += 1) {
    const r = await client.get<{ courses?: EdmingleModule[]; course_bundles?: EdmingleBundle[]; page_context?: PageContext }>('organization/courses', {
      organization_id: client.orgId,
      page,
      per_page: 100,
    });
    for (const m of r.courses ?? []) modules.push(m);
    for (const b of r.course_bundles ?? []) bundleMap.set(b.bundle_id, { ...bundleMap.get(b.bundle_id), ...b });
    if (!r.page_context?.has_more_page) break;
  }

  // The bundle list carries what the module list does not: the slug, the
  // picture, the archived flag. Optional: the import works without it.
  try {
    for (let page = 1; page <= 20; page += 1) {
      const r = await client.get<{ bundle?: EdmingleBundle[]; page_context?: PageContext }>('bundles/list', { organization_id: client.orgId, page, per_page: 100, archived: 0 });
      for (const b of r.bundle ?? []) bundleMap.set(b.bundle_id, { ...bundleMap.get(b.bundle_id), ...b });
      if (!r.page_context?.has_more_page) break;
    }
  } catch {
    /* the course list already gave the mapping */
  }

  return { modules, bundles: [...bundleMap.values()] };
}

/** A module's sections and their materials, in Edmingle's order. */
export async function curriculum(client: EdmingleClient, moduleId: number): Promise<EdmingleSection[]> {
  const r = await client.get<{ course_curriculum?: { resources?: EdmingleSection[] } }>(`tutor/curriculum/${moduleId}`);
  return r.course_curriculum?.resources ?? [];
}

/** The whole asset library, so materials can be matched to files by name. */
export async function assetLibrary(client: EdmingleClient): Promise<EdmingleAsset[]> {
  const out: EdmingleAsset[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const r = await client.get<{ assets?: EdmingleAsset[]; page_context?: PageContext }>('assetlibrary/list', { page, per_page: 100 });
    for (const a of r.assets ?? []) out.push(a);
    if (!r.assets?.length || !r.page_context?.has_more_page) break;
  }
  return out;
}

/** Where an asset's bytes can be fetched from right now: a short-lived signed link, or nothing (video on Vimeo). */
export async function assetDownloadUrl(client: EdmingleClient, assetId: number): Promise<{ url: string | null; fileName: string | null; mimeType: string | null; sizeBytes: number | null }> {
  const r = await client.get<{ material?: { url?: string | null; mat_file_path?: string | null; file_name?: string | null; mime_type?: string | null; file_size?: number | null } }>(`assetlibrary/details/${assetId}`, {
    device_id: 1,
    device_name: 'LMS importer',
    device_os: 'server',
  });
  const m = r.material ?? {};
  const candidate = [m.url, m.mat_file_path].find((u) => typeof u === 'string' && /^https?:\/\//.test(u)) ?? null;
  return { url: candidate, fileName: m.file_name ?? null, mimeType: m.mime_type ?? null, sizeBytes: typeof m.file_size === 'number' ? m.file_size : null };
}

/* People, batches, prices, questions --------------------------------------- */


/** One page of learners, oldest first so a re-run walks the same order. */
export async function studentsPage(client: EdmingleClient, page: number): Promise<{ students: EdmingleStudent[]; more: boolean; total: number }> {
  const r = await client.get<{ students?: EdmingleStudent[]; page_context?: PageContext }>('organization/students', { organization_id: client.orgId, page, per_page: 100, sort_order: 'A' });
  return { students: r.students ?? [], more: Boolean(r.page_context?.has_more_page), total: r.page_context?.total_rows ?? 0 };
}

/** Every batch, with the course it belongs to. */
export async function batches(client: EdmingleClient): Promise<{ bundleId: number; bundleName: string; batch: EdmingleBatch }[]> {
  const out: { bundleId: number; bundleName: string; batch: EdmingleBatch }[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const r = await client.get<{ courses?: { bundle_id: number; bundle_name: string; batch?: EdmingleBatch[] }[]; page_context?: PageContext }>('short/masterbatch', { organization_id: client.orgId, page, per_page: 100 });
    for (const c of r.courses ?? []) for (const b of c.batch ?? []) out.push({ bundleId: c.bundle_id, bundleName: c.bundle_name, batch: b });
    if (!r.courses?.length || !r.page_context?.has_more_page) break;
  }
  return out;
}

export interface EdmingleBatchStudent {
  user_id: number;
  name?: string;
  progress?: number;
  classusers_start_date?: number | null;
  attendance_percent?: number;
  total_present?: number;
  total_absent?: number;
  total_late?: number;
  total_excused?: number;
  total_sessions?: number;
}

/** One page of a batch's learners. Edmingle refuses a sort on this call, so the roll comes in its own order. */
export async function batchStudentsPage(client: EdmingleClient, classId: number, page: number): Promise<{ students: EdmingleBatchStudent[]; more: boolean }> {
  const r = await client.get<{ students?: EdmingleBatchStudent[]; page_context?: PageContext }>(`masterbatch/${classId}/students`, { page, per_page: 100 });
  return { students: r.students ?? [], more: Boolean(r.page_context?.has_more_page) };
}

/** The prices Edmingle sells the courses at. */
export async function packages(client: EdmingleClient): Promise<EdminglePackage[]> {
  const out: EdminglePackage[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const r = await client.get<{ packages?: EdminglePackage[]; page_context?: PageContext }>('institutions/packages', { institution_id: client.orgId, page, per_page: 100 });
    for (const p of r.packages ?? []) out.push(p);
    if (!r.packages?.length || !r.page_context?.has_more_page) break;
  }
  return out;
}

export interface EdmingleBank {
  question_list_id: number;
  question_list_name: string;
  description?: string | null;
  total_questions?: number;
  question_type?: number;
  difficulty?: number;
  engage_topic_tag_name?: string | null;
}

export async function questionBanks(client: EdmingleClient): Promise<EdmingleBank[]> {
  const out: EdmingleBank[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const r = await client.get<{ q_banks?: EdmingleBank[]; page_context?: PageContext }>('user/qbanks', { page, per_page: 100 });
    for (const b of r.q_banks ?? []) out.push(b);
    if (!r.q_banks?.length || !r.page_context?.has_more_page) break;
  }
  return out;
}

export async function bankQuestionsPage(client: EdmingleClient, bankId: number, page: number): Promise<{ questions: EdmingleQuestion[]; more: boolean; bankType: number }> {
  const r = await client.get<{ question_bank?: { details?: { question_type?: number }; questions?: EdmingleQuestion[] }; page_context?: PageContext }>('questionbank/questions', { question_list_id: bankId, page, per_page: 100 });
  return { questions: r.question_bank?.questions ?? [], more: Boolean(r.page_context?.has_more_page), bankType: r.question_bank?.details?.question_type ?? 0 };
}

/* The archive: staff, classes, sessions, attendance, marks, certificates --- */

export interface EdmingleTutor {
  user_id: number | string;
  name: string;
  email?: string | null;
  contact_number?: string | null;
  contact_number_dial_code?: string | null;
  /** "2" is the academy's own super-admin login; "0" an ordinary tutor. */
  role?: string | number | null;
  super_admin?: string | number | null;
  is_archived?: string | number | null;
  date_user_added?: number | null;
}

/** Everyone who signs in to Edmingle's admin side: tutors and admins alike. */
export async function tutors(client: EdmingleClient): Promise<EdmingleTutor[]> {
  const out: EdmingleTutor[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const r = await client.get<{ tutors?: EdmingleTutor[]; page_context?: PageContext }>('organization/tutors', { organization_id: client.orgId, page, per_page: 100 });
    for (const t of r.tutors ?? []) out.push(t);
    if (!r.tutors?.length || !r.page_context?.has_more_page) break;
  }
  return out;
}

export interface EdmingleMasterBatchDetail {
  class_id: number;
  tutor_id?: number | null;
  tutor_name?: string | null;
  /** The teaching classes under the batch; sessions and marks hang off these ids, not the batch's. */
  courses_array?: { class_id: number; course_id?: number; tutor_id?: number | null; batch_name?: string }[];
}

/** A batch in full: its tutor and the classes (one per module) it runs. */
export async function masterBatchDetail(client: EdmingleClient, masterBatchId: number): Promise<EdmingleMasterBatchDetail | null> {
  const r = await client.get<{ class?: EdmingleMasterBatchDetail }>(`masterbatch/${masterBatchId}`);
  return r.class ?? null;
}

export interface EdmingleSession {
  /** Edmingle calls a session an "attendance"; this is its id. */
  id: number;
  class_id: number;
  class_name?: string | null;
  /** Comma-separated master batch ids the session was held for. */
  master_batch_ids?: string | number | null;
  master_batch_names?: string | null;
  /** Epoch seconds, UTC. */
  gmt_start_time?: number | null;
  gmt_end_time?: number | null;
  class_date?: number | null;
  /** 0 scheduled or never signed in, 1 held, 5 held with the register complete, 3 cancelled. */
  status?: number | null;
  taken_at?: number | null;
  taken_by?: number | null;
  taken_by_name?: string | null;
  topics_taught?: string | null;
  homework?: string | null;
  virtual_class_type?: number | null;
  is_nonmandatory_session?: number | null;
  total_present?: number | string | null;
  total_absent?: number | string | null;
  not_marked?: number | string | null;
}

/** Every session the academy ever scheduled, in one call (a few thousand rows). */
export async function sessions(client: EdmingleClient): Promise<EdmingleSession[]> {
  const r = await client.get<{ classes?: EdmingleSession[] }>('organization/attendances', { org_id: client.orgId, start: 946684800, end: Math.floor(Date.now() / 1000) + 366 * 86400 });
  return r.classes ?? [];
}

export interface EdmingleLearnerAttendance {
  user_id: number;
  learner_name?: string;
  /** Keyed by session id: 1 present, 0 absent; a session missing here was not marked for this learner. */
  learner_attendance?: Record<string, { attendance_id: number; date?: number; status?: number; is_nonmandatory_session?: number }>;
  total_present?: number;
  absent?: number;
}

/** One page of a class's learners with their mark for every session of the class. */
export async function classAttendancePage(client: EdmingleClient, classId: number, page: number): Promise<{ learners: EdmingleLearnerAttendance[]; sessionIds: number[]; more: boolean; total: number }> {
  const r = await client.get<{ attendances?: EdmingleLearnerAttendance[]; attendance_ids?: { attendance_id: number }[]; page_context?: PageContext }>('class/attendance/details', {
    class_id: classId,
    start: 946684800,
    end: Math.floor(Date.now() / 1000) + 366 * 86400,
    page,
    per_page: 100,
  });
  return { learners: r.attendances ?? [], sessionIds: (r.attendance_ids ?? []).map((a) => a.attendance_id), more: Boolean(r.page_context?.has_more_page), total: r.page_context?.total_rows ?? 0 };
}

export interface EdmingleMark {
  exercise_id?: string | number | null;
  quiz_id?: string | number | null;
  material_id?: string | number | null;
  section_id?: string | number | null;
  grade?: string | number | null;
  marks?: string | number | null;
  total_marks?: string | number | null;
  points?: string | number | null;
  total_points?: string | number | null;
  no_of_attempts?: string | number | null;
  passed?: string | number | null;
  total_time_taken?: string | number | null;
}

export interface EdmingleClassReport {
  /** [id, name, kind, ...]: kind 2 a test, 4 a lesson, -1 the grand total column. */
  columns: { id: string; name: string; kind: number }[];
  learners: { user_id: number; user_name?: string; marks: EdmingleMark[] }[];
  more: boolean;
  total: number;
}

/**
 * The progress report for a class, one page of learners at a time: the
 * tests with each learner's marks, or (with `lessons`) every lesson with
 * how many times each learner opened it.
 */
export async function classReportPage(client: EdmingleClient, classId: number, page: number, lessons: boolean): Promise<EdmingleClassReport> {
  const r = await client.get<{ class_report?: { assessment_names?: unknown[][]; user_details?: { user_id: number; user_name?: string; user_marks?: EdmingleMark[] }[] }; page_context?: PageContext }>('report/class/progress', {
    class_id: classId,
    page,
    per_page: 100,
    ...(lessons ? { material_required: 1 } : {}),
  });
  const columns = (r.class_report?.assessment_names ?? []).map((row) => ({ id: String(row[0] ?? ''), name: String(row[1] ?? '').trim(), kind: Number(row[2]) }));
  const learners = (r.class_report?.user_details ?? []).map((u) => ({ user_id: u.user_id, user_name: u.user_name, marks: u.user_marks ?? [] }));
  return { columns, learners, more: Boolean(r.page_context?.has_more_page), total: r.page_context?.total_rows ?? 0 };
}

/** Where a learner's certificate PDF can be fetched from, or null when none was issued. */
export async function learnerCertificateUrl(client: EdmingleClient, userId: number): Promise<string | null> {
  const r = await client.get<{ certificate_details?: { url?: string | null } }>(`certificates/${userId}`);
  const url = r.certificate_details?.url;
  if (!url || !/^https?:\/\//.test(url)) return null;
  // An empty path is Edmingle's way of saying "nothing issued".
  const path = new URL(url).pathname.replace(/^\/+/, '');
  return path && path !== '-' ? url : null;
}

/** The courses the academy's automatic certificate is switched on for, by bundle id. */
export async function certificateCourses(client: EdmingleClient): Promise<{ templateId: number; name: string; bundleIds: number[] }[]> {
  const list = await client.get<{ payload?: { certificates?: unknown[][] } }>('certificates', { page: 1, per_page: 100 });
  const out: { templateId: number; name: string; bundleIds: number[] }[] = [];
  for (const row of list.payload?.certificates ?? []) {
    const templateId = Number(row[0]);
    if (!Number.isFinite(templateId)) continue;
    const mapped = await client.get<{ course?: { content_id?: number; content_type?: number }[] }>(`automatedcertificate/${templateId}/course`);
    out.push({ templateId, name: String(row[1] ?? 'Certificate'), bundleIds: (mapped.course ?? []).map((c) => Number(c.content_id)).filter((n) => Number.isFinite(n)) });
  }
  return out;
}
