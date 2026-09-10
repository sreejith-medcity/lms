'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { parseSubjects, type SubjectRow } from '@/lib/import-subjects';
import { storageConfigured } from '@/lib/storage';
/* One picture fetcher, shared with the landing page importer, because both
   have the same job: bring the image over so the old host can be switched
   off without leaving holes. */
import { fetchImageAsAsset as fetchImage } from '@/lib/remote-image';

/**
 * Bringing the subject cards across from the old storefront.
 *
 * Two passes, always, and the same shape as the learner import: the first
 * only reads and reports what would happen, and nothing is written until
 * somebody has seen that. The expensive mistake with an importer is not a
 * failure, it is a success that did the wrong thing quietly.
 *
 * Re-runnable. Rows are matched on the address made from the name, so a
 * second run updates what it made the first time rather than making a second
 * copy of everything.
 */

export interface SubjectImportResult {
  ok: boolean;
  error?: string;
  applied: boolean;
  wouldCreate: number;
  wouldUpdate: number;
  imagesFetched: number;
  problems: string[];
  /** A line per row, so a person can read the whole thing before committing. */
  lines: string[];
}

export async function importSubjects(csv: string, apply: boolean): Promise<SubjectImportResult> {
  const empty = {
    applied: false,
    wouldCreate: 0,
    wouldUpdate: 0,
    imagesFetched: 0,
    problems: [] as string[],
    lines: [] as string[],
  };

  try {
    const [tenant, user] = await Promise.all([
      requireTenant(),
      requireStaff('category.manage_categories', 'edit'),
    ]);
    if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');

    const { rows, problems } = parseSubjects(csv);
    if (rows.length === 0) {
      return { ok: false, error: problems[0] ?? 'Nothing to import.', ...empty, problems };
    }

    const existing = await db.category.findMany({
      where: { organizationId: tenant.organizationId, slug: { in: rows.map((r) => r.slug) } },
      select: { id: true, slug: true, imageAssetId: true },
    });
    const bySlug = new Map(existing.map((c) => [c.slug, c]));

    const wantsImage = (row: SubjectRow) => Boolean(row.imageUrl);

    if (!apply) {
      return {
        ok: true,
        applied: false,
        wouldCreate: rows.filter((r) => !bySlug.has(r.slug)).length,
        wouldUpdate: rows.filter((r) => bySlug.has(r.slug)).length,
        imagesFetched: rows.filter(wantsImage).length,
        problems,
        lines: rows.map((r) => {
          const verb = bySlug.has(r.slug) ? 'update' : 'create';
          const bits = [
            `${verb} ${r.name} at /courses/${r.slug}`,
            r.comingSoon ? 'coming soon' : 'live',
            r.imageUrl ? 'with a picture to fetch' : 'no picture',
          ];
          return bits.join(', ');
        }),
      };
    }

    if (rows.some(wantsImage) && !storageConfigured()) {
      return {
        ok: false,
        error: 'File storage is not connected, so the pictures cannot be saved. Connect it first, or import without an image column.',
        ...empty,
        problems,
      };
    }

    let created = 0;
    let updated = 0;
    let fetched = 0;
    const lines: string[] = [];
    const trouble = [...problems];

    for (const row of rows) {
      let imageAssetId: string | undefined;

      if (row.imageUrl) {
        const result = await fetchImage(row.imageUrl, tenant.organizationId, user.id);
        if ('problem' in result) {
          // A picture that will not come is a note, not a failure: the subject
          // is still worth creating and the card falls back to its own colour.
          trouble.push(`${row.name}: ${result.problem}`);
        } else {
          imageAssetId = result.assetId;
          fetched += 1;
        }
      }

      const card = {
        tagline: row.tagline || null,
        ctaLabel: row.ctaLabel || null,
        comingSoon: row.comingSoon,
        showOnHome: row.showOnHome,
        sortOrder: row.sortOrder,
        ...(imageAssetId ? { imageAssetId } : {}),
      };

      const found = bySlug.get(row.slug);
      if (found) {
        await db.category.update({ where: { id: found.id }, data: { name: row.name, ...card } });
        updated += 1;
        lines.push(`Updated ${row.name}`);
      } else {
        await db.category.create({
          data: {
            organizationId: tenant.organizationId,
            name: row.name,
            slug: row.slug,
            isActive: true,
            ...card,
          },
        });
        created += 1;
        lines.push(`Created ${row.name}`);
      }
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'category.imported',
      entity: 'Category',
      after: { created, updated, imagesFetched: fetched },
    });

    revalidatePath('/admin/categories');
    revalidatePath('/', 'layout');

    return {
      ok: true,
      applied: true,
      wouldCreate: created,
      wouldUpdate: updated,
      imagesFetched: fetched,
      problems: trouble,
      lines,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'UNAUTHORIZED') return { ok: false, error: 'Please sign in again.', ...empty };
    if (message === 'FORBIDDEN') {
      return { ok: false, error: 'You do not have permission to manage categories.', ...empty };
    }
    console.error('[import-subjects]', message);
    return { ok: false, error: 'Something went wrong reading that file.', ...empty };
  }
}
