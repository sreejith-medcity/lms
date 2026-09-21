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
  const apiKey = resolved.values.apiKey;
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
        if (!res.ok) throw new Error(res.status === 429 ? `Edmingle is rate-limiting us on ${path}: wait a minute and press again` : `Edmingle answered ${res.status} for ${path}`);
        const body = (await res.json()) as T & { code?: number; message?: string };
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
