import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { slugify, uniqueSlug } from '@/lib/slug';
import { buildObjectKey, inferMimeType, inferType, maxBytesFor, putObject } from '@/lib/storage';
import { assetDownloadUrl, assetLibrary, catalogue, curriculum, edmingleFor, type EdmingleClient } from '@/lib/edmingle';
import { bundleSlug, inOrder, matchAsset, planMaterial, plainText, type EdmingleAsset, type EdmingleMaterial } from '@/lib/edmingle-rules';
import type { StepReport } from '@/lib/migrate-woo';

/**
 * Bringing the courses across from Edmingle.
 *
 * The same three rules as the store migration. It runs twice safely: every
 * course, module, section, material and file that crosses writes a
 * `MigrationRecord` keyed on Edmingle's own id, and a second run finds the
 * work done. It shows before it does. And it never pretends: a video sits
 * on Vimeo under Edmingle's account and cannot be fetched, so the lesson is
 * created with its title, length and file name and marked as waiting for
 * the file; when the export arrives the file is matched to it by name.
 *
 * Three steps, each bounded in time because they run inside one request:
 * the catalogue (courses, modules, sections, materials), the files (every
 * PDF and document pulled straight from Edmingle's signed links into the
 * bucket), and the videos (matching files that have since been uploaded
 * here to the lessons waiting for them).
 */

const SOURCE = 'EDMINGLE';
const BUDGET_MS = 45_000;

export interface EdmingleReport extends StepReport {
  /** Work left for another press of the button. */
  remaining: number;
}

interface MaterialPayload {
  name: string;
  fileName: string | null;
  mime: string | null;
  type: string;
  needsFile: boolean;
  video: boolean;
  vimeoId: string | null;
  sizeBytes: number | null;
  moduleId: number;
}

export function report(entity: string): EdmingleReport {
  return { entity, looked: 0, wouldCreate: 0, wouldUpdate: 0, alreadyDone: 0, problems: [], samples: [], remaining: 0 };
}

export function sample(r: EdmingleReport, line: string) {
  if (r.samples.length < 8) r.samples.push(line);
}

export function problem(r: EdmingleReport, line: string) {
  if (r.problems.length < 200) r.problems.push(line);
}

export async function migrated(entity: string): Promise<Map<string, string | null>> {
  const rows = await db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity, status: 'MIGRATED' }, select: { sourceId: true, targetId: true } });
  return new Map(rows.map((r) => [r.sourceId, r.targetId]));
}

export async function mark(entity: string, sourceId: string, targetId: string | null, payload?: Prisma.InputJsonValue) {
  await db.migrationRecord.upsert({
    where: { sourceSystem_entity_sourceId: { sourceSystem: SOURCE, entity, sourceId } },
    create: { sourceSystem: SOURCE, entity, sourceId, targetId, status: 'MIGRATED', migratedAt: new Date(), payload },
    update: { targetId, status: 'MIGRATED', migratedAt: new Date(), ...(payload === undefined ? {} : { payload }) },
  });
}

/* Step 1: the catalogue ----------------------------------------------------- */

export async function importCatalogue(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('catalogue');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected. Put the API key on the Edmingle card in Settings, Integrations.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  const outOfTime = () => Date.now() - started > budget;

  let cat;
  try {
    cat = await catalogue(client);
  } catch (err) {
    problem(r, err instanceof Error ? err.message : String(err));
    return r;
  }
  const bundles = cat.bundles.filter((b) => !b.is_archived);
  const modules = cat.modules;
  r.looked = bundles.length + modules.length;
  sample(r, `${bundles.length} courses, ${modules.length} modules in Edmingle (archived courses left out).`);

  const [doneCourses, doneModules, doneCurricula] = await Promise.all([migrated('course'), migrated('module'), migrated('curriculum')]);

  // Courses.
  const courseTarget = new Map<number, string>();
  for (const b of bundles) {
    const key = String(b.bundle_id);
    const done = doneCourses.get(key);
    if (done) {
      r.alreadyDone += 1;
      courseTarget.set(b.bundle_id, done);
      continue;
    }
    r.wouldCreate += 1;
    if (options.dryRun) {
      sample(r, `course: ${b.bundle_name} (${b.course_ids.length} modules)`);
      continue;
    }
    try {
      const slug = await uniqueSlug(bundleSlug(b, slugify), async (candidate) => (await db.product.findUnique({ where: { organizationId_slug: { organizationId, slug: candidate } }, select: { id: true } })) !== null);
      const product = await db.product.create({
        data: {
          organizationId,
          type: 'COURSE',
          title: b.bundle_name.trim().slice(0, 100) || `Course ${b.bundle_id}`,
          slug,
          status: 'DRAFT',
          course: { create: { organizationId, description: plainText(b.bundle_description).slice(0, 2000) || null, prettyName: slug, legacyEdmingleId: key } },
        },
        select: { id: true, course: { select: { id: true } } },
      });
      courseTarget.set(b.bundle_id, product.id);
      await mark('course', key, product.id, { name: b.bundle_name, slug });
      if (b.img_url && product.course) await thumbnail(organizationId, product.course.id, b.img_url, b.bundle_name).catch((err) => problem(r, `${b.bundle_name}: picture not copied (${err instanceof Error ? err.message : err})`));
    } catch (err) {
      problem(r, `course ${b.bundle_name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Modules.
  const moduleTarget = new Map<number, string>();
  for (const m of modules) {
    const key = String(m.course_id);
    const done = doneModules.get(key);
    if (done) {
      r.alreadyDone += 1;
      moduleTarget.set(m.course_id, done);
      continue;
    }
    r.wouldCreate += 1;
    if (options.dryRun) {
      sample(r, `module: ${m.name} (${m.num_of_section ?? '?'} sections)`);
      continue;
    }
    try {
      const created = await db.module.create({ data: { organizationId, name: m.name.trim().slice(0, 200) || `Module ${m.course_id}`, description: plainText(m.description).slice(0, 2000) || null, legacyEdmingleId: key }, select: { id: true } });
      moduleTarget.set(m.course_id, created.id);
      await mark('module', key, created.id, { name: m.name });
    } catch (err) {
      problem(r, `module ${m.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Which modules each course teaches, in Edmingle's order.
  if (!options.dryRun) {
    for (const b of bundles) {
      const productId = courseTarget.get(b.bundle_id);
      if (!productId) continue;
      const course = await db.course.findFirst({ where: { productId, organizationId }, select: { id: true } });
      if (!course) continue;
      let order = 0;
      for (const raw of b.course_ids) {
        const moduleId = moduleTarget.get(Number(raw));
        if (!moduleId) {
          problem(r, `${b.bundle_name}: module ${raw} is not in the library, so it was not linked.`);
          continue;
        }
        await db.courseModule.upsert({ where: { courseId_moduleId: { courseId: course.id, moduleId } }, create: { courseId: course.id, moduleId, sortOrder: order }, update: { sortOrder: order } });
        order += 1;
      }
    }
  }

  // Sections and materials, module by module, until the clock runs out.
  const pending = modules.filter((m) => !doneCurricula.has(String(m.course_id)));
  let processed = 0;
  for (const m of pending) {
    if (outOfTime()) break;
    // A rehearsal reads two curricula as a sample and leaves Edmingle's call allowance for the real run.
    if (options.dryRun && processed >= 2) break;
    const moduleId = moduleTarget.get(m.course_id);
    if (!moduleId && !options.dryRun) continue;
    let sections;
    try {
      sections = await curriculum(client, m.course_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      problem(r, `${m.name}: curriculum not read (${message})`);
      if (/rate-limiting/.test(message)) break;
      continue;
    }
    processed += 1;
    const [doneSections, doneMaterials] = options.dryRun ? [new Map<string, string | null>(), new Map<string, string | null>()] : await Promise.all([migrated('section'), migrated('material')]);
    let sOrder = 0;
    let complete = true;
    for (const s of inOrder(sections)) {
      const sKey = String(s.section_id);
      // Edmingle leaves the name off a section made by its own import tool.
      const sectionName = (s.section_name ?? '').trim() || 'Section';
      let sectionId = doneSections.get(sKey) ?? null;
      r.looked += 1;
      if (sectionId) r.alreadyDone += 1;
      else {
        r.wouldCreate += 1;
        if (options.dryRun) sample(r, `section: ${m.name} / ${sectionName} (${s.resources?.length ?? 0} materials)`);
        else {
          try {
            const created = await db.section.create({ data: { moduleId: moduleId!, title: sectionName.slice(0, 200), sortOrder: sOrder, isVisible: (s.status ?? 'published') === 'published' }, select: { id: true } });
            sectionId = created.id;
            await mark('section', sKey, sectionId, { name: sectionName, module: m.course_id });
          } catch (err) {
            problem(r, `section ${sectionName}: ${err instanceof Error ? err.message : String(err)}`);
            complete = false;
            continue;
          }
        }
      }
      sOrder += 1;
      let mOrder = 0;
      for (const mat of inOrder(s.resources ?? [])) {
        const mKey = String(mat.material_id);
        const materialName = (mat.material_name ?? '').trim() || (mat.file_name ?? '').trim() || 'Lesson';
        r.looked += 1;
        if (doneMaterials.has(mKey)) {
          r.alreadyDone += 1;
          mOrder += 1;
          continue;
        }
        r.wouldCreate += 1;
        const plan = planMaterial(mat);
        if (options.dryRun) {
          if (r.samples.length < 8) sample(r, `material: ${materialName} [${plan.type}${plan.video ? ', file from Edmingle export' : plan.needsFile ? ', file pulled' : ''}]`);
          mOrder += 1;
          continue;
        }
        try {
          const created = await db.material.create({
            data: {
              sectionId: sectionId!,
              title: materialName.slice(0, 200),
              type: plan.type,
              externalUrl: plan.externalUrl,
              bodyHtml: plan.bodyHtml,
              durationSeconds: mat.duration_seconds || null,
              isFreePreview: Boolean(mat.freepreview),
              isDownloadable: Boolean(mat.is_downloadable),
              sortOrder: mOrder,
            },
            select: { id: true },
          });
          const payload: MaterialPayload = { name: materialName, fileName: mat.file_name ?? null, mime: mat.type ?? null, type: plan.type, needsFile: plan.needsFile, video: plan.video, vimeoId: mat.vimeo_url ? String(mat.vimeo_url) : null, sizeBytes: mat.file_size ?? null, moduleId: m.course_id };
          await mark('material', mKey, created.id, payload as unknown as Prisma.InputJsonValue);
        } catch (err) {
          problem(r, `material ${materialName}: ${err instanceof Error ? err.message : String(err)}`);
          complete = false;
        }
        mOrder += 1;
      }
    }
    if (!options.dryRun && complete) await mark('curriculum', String(m.course_id), moduleId ?? null);
  }
  r.remaining = Math.max(0, pending.length - processed);
  if (r.remaining > 0) sample(r, options.dryRun ? `${r.remaining} modules' curricula to read on the real run (a rehearsal samples two).` : `${r.remaining} modules' curricula still to read: press again, or switch on the background run.`);
  return r;
}

async function thumbnail(organizationId: string, courseId: string, url: string, title: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`picture ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('picture too large');
  const ext = (new URL(url).pathname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const fileName = `${slugify(title) || 'course'}.${ext}`;
  const key = buildObjectKey(organizationId, fileName);
  const mime = res.headers.get('content-type')?.split(';')[0] || inferMimeType(fileName);
  await putObject(key, bytes, mime);
  const asset = await db.asset.create({ data: { organizationId, name: `Course picture: ${title}`.slice(0, 200), fileName, type: 'IMAGE', storageKey: key, mimeType: mime, sizeBytes: BigInt(bytes.byteLength), transcodeStatus: 'READY' }, select: { id: true } });
  await db.course.update({ where: { id: courseId }, data: { thumbnailAssetId: asset.id } });
}

/* Step 2: the files ----------------------------------------------------------- */

let libraryCache: { at: number; assets: EdmingleAsset[] } | null = null;

async function library(client: EdmingleClient): Promise<EdmingleAsset[]> {
  if (libraryCache && Date.now() - libraryCache.at < 10 * 60_000) return libraryCache.assets;
  const assets = await assetLibrary(client);
  libraryCache = { at: Date.now(), assets };
  return assets;
}

/** Materials created by step 1 whose file has not crossed yet. */
async function waitingForFile(video: boolean): Promise<{ sourceId: string; materialId: string; payload: MaterialPayload }[]> {
  const [materials, files] = await Promise.all([
    db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity: 'material', status: 'MIGRATED' }, select: { sourceId: true, targetId: true, payload: true } }),
    db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity: 'file', status: 'MIGRATED' }, select: { sourceId: true } }),
  ]);
  const done = new Set(files.map((f) => f.sourceId));
  const out: { sourceId: string; materialId: string; payload: MaterialPayload }[] = [];
  for (const m of materials) {
    const p = m.payload as unknown as MaterialPayload | null;
    if (!p || !p.needsFile || p.video !== video || !m.targetId || done.has(m.sourceId)) continue;
    out.push({ sourceId: m.sourceId, materialId: m.targetId, payload: p });
  }
  return out;
}

export async function importFiles(organizationId: string, options: { dryRun: boolean; budgetMs?: number; max?: number }): Promise<EdmingleReport> {
  const r = report('files');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  const max = options.max ?? 25;

  const waiting = await waitingForFile(false);
  r.looked = waiting.length;
  if (waiting.length === 0) {
    sample(r, 'Every document that could be pulled has been.');
    return r;
  }
  let assets: EdmingleAsset[];
  try {
    assets = await library(client);
  } catch (err) {
    problem(r, `Asset library not read: ${err instanceof Error ? err.message : String(err)}`);
    return r;
  }

  // One Edmingle file is often attached to several lessons (the same
  // worksheet in three batches' modules). Once it has been pulled for one
  // lesson, the others are attached to the same asset here: no second
  // download, no second copy in the bucket, no call to Edmingle at all.
  const pulled = new Map<number, string>();
  for (const f of await db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity: 'file', status: 'MIGRATED', targetId: { not: null } }, select: { targetId: true, payload: true } })) {
    const p = f.payload as { assetId?: number; matched?: boolean } | null;
    if (p?.assetId && !p.matched && f.targetId) pulled.set(Number(p.assetId), f.targetId);
  }

  let moved = 0;
  const outOfTime = () => Date.now() - started > budget;

  const pullOne = async (w: (typeof waiting)[number], asset: EdmingleAsset) => {
    const have = pulled.get(asset.asset_id);
    if (have) {
      const ours = await db.asset.findFirst({ where: { id: have, organizationId, deletedAt: null }, select: { id: true, fileName: true } });
      if (ours) {
        await db.material.update({ where: { id: w.materialId }, data: { assetId: ours.id } });
        await mark('file', w.sourceId, ours.id, { assetId: asset.asset_id, fileName: ours.fileName, shared: true });
        moved += 1;
        sample(r, `${ours.fileName} (already here, attached)`);
        return;
      }
    }
    const target = await assetDownloadUrl(client, asset.asset_id);
    if (!target.url) throw new Error('Edmingle gave no download link');
    const fileName = (target.fileName || w.payload.fileName || `${asset.asset_id}.bin`).trim();
    const type = inferType(fileName);
    const res = await fetch(target.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`download answered ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? asset.file_size_bytes ?? 0);
    if (length > maxBytesFor(type)) throw new Error('larger than the ceiling for its type');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytesFor(type)) throw new Error('larger than the ceiling for its type');
    const key = buildObjectKey(organizationId, fileName);
    const mime = target.mimeType || asset.mime_type || res.headers.get('content-type')?.split(';')[0] || inferMimeType(fileName);
    await putObject(key, bytes, mime);
    const created = await db.asset.create({
      data: { organizationId, name: w.payload.name.slice(0, 200), fileName, type, storageKey: key, mimeType: mime, sizeBytes: BigInt(bytes.byteLength), transcodeStatus: 'READY', durationSeconds: null },
      select: { id: true },
    });
    await db.material.update({ where: { id: w.materialId }, data: { assetId: created.id } });
    await mark('file', w.sourceId, created.id, { assetId: asset.asset_id, fileName, bytes: bytes.byteLength });
    pulled.set(asset.asset_id, created.id);
    moved += 1;
    sample(r, `${fileName} (${Math.round(bytes.byteLength / 1024)} KB)`);
  };

  // A few files in flight at once: the call to Edmingle for the next link
  // is paced by the client whatever happens, so the gain is the download
  // and the upload to the bucket overlapping the wait, not more calls.
  let cursor = 0;
  const claimed = new Set<number>();
  const deferred: typeof waiting = [];
  const worker = async () => {
    while (!options.dryRun && moved + claimed.size < max && !outOfTime()) {
      const w = waiting[cursor++];
      if (!w) return;
      const mat: EdmingleMaterial = { material_id: Number(w.sourceId), material_name: w.payload.name, file_name: w.payload.fileName, file_size: w.payload.sizeBytes };
      const { asset, reason } = matchAsset(mat, assets);
      if (!asset) {
        problem(r, `${w.payload.name}: ${reason}`);
        continue;
      }
      // Two lessons sharing one file are pulled one after the other, not side by side, so the second finds the first's copy.
      if (claimed.has(asset.asset_id)) {
        deferred.push(w);
        continue;
      }
      claimed.add(asset.asset_id);
      r.wouldCreate += 1;
      try {
        await pullOne(w, asset);
      } catch (err) {
        problem(r, `${w.payload.name}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        claimed.delete(asset.asset_id);
      }
    }
  };

  if (options.dryRun) {
    for (const w of waiting) {
      if (moved >= max) break;
      const mat: EdmingleMaterial = { material_id: Number(w.sourceId), material_name: w.payload.name, file_name: w.payload.fileName, file_size: w.payload.sizeBytes };
      const { asset, reason } = matchAsset(mat, assets);
      if (!asset) {
        problem(r, `${w.payload.name}: ${reason}`);
        continue;
      }
      r.wouldCreate += 1;
      sample(r, pulled.has(asset.asset_id) ? `${w.payload.fileName} (already here, would be attached)` : `${w.payload.fileName} (${asset.file_size_bytes ? Math.round(asset.file_size_bytes / 1024) + ' KB' : 'size unknown'})`);
      moved += 1;
    }
  } else {
    await Promise.all([worker(), worker(), worker()]);
    // The lessons that shared a file with one in flight: their copy is here now.
    for (const w of deferred) {
      if (moved >= max || outOfTime()) break;
      const mat: EdmingleMaterial = { material_id: Number(w.sourceId), material_name: w.payload.name, file_name: w.payload.fileName, file_size: w.payload.sizeBytes };
      const { asset } = matchAsset(mat, assets);
      if (!asset) continue;
      r.wouldCreate += 1;
      try {
        await pullOne(w, asset);
      } catch (err) {
        problem(r, `${w.payload.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  r.remaining = Math.max(0, waiting.length - moved - r.problems.length);
  if (r.remaining > 0) sample(r, `${r.remaining} more to pull: press again.`);
  return r;
}

/* Step 3: the videos ----------------------------------------------------------- */

/**
 * Videos cannot be pulled; they arrive as an export and are uploaded here.
 * This step finds, for every lesson still waiting, a video in this library
 * with the same file name and attaches it.
 */
export async function attachVideos(organizationId: string, options: { dryRun: boolean }): Promise<EdmingleReport> {
  const r = report('videos');
  const waiting = await waitingForFile(true);
  r.looked = waiting.length;
  if (waiting.length === 0) {
    sample(r, 'No lessons are waiting for a video.');
    return r;
  }
  const names = [...new Set(waiting.map((w) => (w.payload.fileName ?? '').trim()).filter(Boolean))];
  const found = await db.asset.findMany({ where: { organizationId, type: 'VIDEO', deletedAt: null, fileName: { in: names } }, select: { id: true, fileName: true, sizeBytes: true }, orderBy: { createdAt: 'desc' } });
  const byName = new Map<string, { id: string }[]>();
  for (const a of found) byName.set(a.fileName.trim().toLowerCase(), [...(byName.get(a.fileName.trim().toLowerCase()) ?? []), a]);

  for (const w of waiting) {
    const candidates = byName.get((w.payload.fileName ?? '').trim().toLowerCase()) ?? [];
    if (candidates.length === 0) continue;
    r.wouldUpdate += 1;
    if (options.dryRun) {
      sample(r, `${w.payload.name} <- ${w.payload.fileName}`);
      continue;
    }
    try {
      await db.material.update({ where: { id: w.materialId }, data: { assetId: candidates[0].id } });
      await mark('file', w.sourceId, candidates[0].id, { fileName: w.payload.fileName, matched: true });
      sample(r, `${w.payload.name} <- ${w.payload.fileName}`);
    } catch (err) {
      problem(r, `${w.payload.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  r.remaining = waiting.length - r.wouldUpdate;
  if (r.remaining > 0) sample(r, `${r.remaining} lessons still waiting for their video file.`);
  return r;
}

/* The page ------------------------------------------------------------------- */

export async function edmingleSummary(): Promise<{ entity: string; migrated: number }[]> {
  const grouped = await db.migrationRecord.groupBy({ by: ['entity'], where: { sourceSystem: SOURCE, status: 'MIGRATED' }, _count: { _all: true } });
  const counts = grouped.map((row) => ({ entity: row.entity, migrated: row._count._all }));
  const [docs, videos] = await Promise.all([waitingForFile(false), waitingForFile(true)]);
  counts.push({ entity: 'documents waiting', migrated: docs.length }, { entity: 'videos waiting', migrated: videos.length });
  return counts;
}

/** The video files the lessons are waiting for, as a list for whoever prepares the export. */
export async function waitingVideoList(): Promise<{ name: string; fileName: string | null; vimeoId: string | null }[]> {
  const w = await waitingForFile(true);
  return w.map((x) => ({ name: x.payload.name, fileName: x.payload.fileName, vimeoId: x.payload.vimeoId }));
}
