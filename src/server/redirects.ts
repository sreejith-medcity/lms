'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { normalisePath, parseRules } from '@/lib/redirects';
import type { ActionState } from '@/server/courses';

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.organization', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[redirects]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function addRedirect(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const rawFrom = String(formData.get('fromPath') ?? '');
    const rawTo = String(formData.get('toPath') ?? '');
    if (!rawFrom.trim() || !rawTo.trim()) return { error: 'Both paths are needed.' };

    const wildcard = rawFrom.trim().endsWith('/*');
    const fromPath = wildcard
      ? `${normalisePath(rawFrom.trim().slice(0, -2))}/*`
      : normalisePath(rawFrom);
    const toPath = rawTo.trim().endsWith('/*')
      ? `${normalisePath(rawTo.trim().slice(0, -2))}/*`
      : normalisePath(rawTo);

    if (fromPath === toPath) return { error: 'That points at itself, which would loop.' };

    const statusCode = Number(formData.get('statusCode')) === 302 ? 302 : 301;

    await db.redirect.upsert({
      where: { organizationId_fromPath: { organizationId: tenant.organizationId, fromPath } },
      create: { organizationId: tenant.organizationId, fromPath, toPath, statusCode },
      update: { toPath, statusCode },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'redirect.saved',
      entity: 'Redirect',
      entityId: fromPath,
      after: { toPath, statusCode },
    });

    revalidatePath('/admin/settings/redirects');
    return { ok: true, message: `${fromPath} now goes to ${toPath}.` };
  } catch (err) {
    return fail(err);
  }
}

export interface ImportState extends ActionState {
  added?: number;
  updated?: number;
  skipped?: { line: string; reason: string }[];
}

/**
 * A pasted list, checked before it is written.
 *
 * Four hundred rules typed one at a time is not a thing anybody will do, so the
 * real path into this table is a paste from a spreadsheet or a Search Console
 * export. Every row that cannot be used comes back with a reason attached
 * rather than being dropped, because a rule silently skipped is a 404 nobody
 * finds out about until the traffic has gone.
 */
export async function importRedirects(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  try {
    const { tenant, user } = await guard();

    const text = String(formData.get('rules') ?? '');
    if (!text.trim()) return { error: 'Paste some rules first.' };

    const parsed = parseRules(text);
    if (!parsed.length) return { error: 'Nothing in that looked like a rule.' };

    const skipped: { line: string; reason: string }[] = [];
    const usable = parsed.filter((rule) => {
      if (rule.error) {
        skipped.push({ line: rule.fromPath, reason: rule.error });
        return false;
      }
      return true;
    });

    // A rule pointing at a path that is itself redirected sends the visitor on
    // two hops, and search engines discount the second. Worth naming rather
    // than accepting quietly.
    const destinations = new Set(usable.map((r) => r.toPath));
    for (const rule of usable) {
      if (destinations.has(rule.fromPath)) {
        skipped.push({
          line: rule.fromPath,
          reason: 'Another rule points here, so this would be a second hop. Point both at the final page.',
        });
      }
    }
    const chained = new Set(skipped.map((s) => s.line));
    const clean = usable.filter((rule) => !chained.has(rule.fromPath));

    const existing = await db.redirect.findMany({
      where: {
        organizationId: tenant.organizationId,
        fromPath: { in: clean.map((r) => r.fromPath) },
      },
      select: { fromPath: true },
    });
    const known = new Set(existing.map((row) => row.fromPath));

    for (const rule of clean) {
      await db.redirect.upsert({
        where: {
          organizationId_fromPath: {
            organizationId: tenant.organizationId,
            fromPath: rule.fromPath,
          },
        },
        create: {
          organizationId: tenant.organizationId,
          fromPath: rule.fromPath,
          toPath: rule.toPath,
          statusCode: rule.statusCode,
        },
        update: { toPath: rule.toPath, statusCode: rule.statusCode },
      });
    }

    const added = clean.filter((r) => !known.has(r.fromPath)).length;
    const updated = clean.length - added;

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'redirect.imported',
      entity: 'Redirect',
      after: { added, updated, skipped: skipped.length },
    });

    revalidatePath('/admin/settings/redirects');

    return {
      ok: true,
      added,
      updated,
      skipped,
      message: `${added} added, ${updated} updated${skipped.length ? `, ${skipped.length} left out` : ''}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function removeRedirect(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');

    const gone = await db.redirect.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (gone.count === 0) return { error: 'That one is already gone.' };

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'redirect.removed',
      entity: 'Redirect',
      entityId: id,
    });

    revalidatePath('/admin/settings/redirects');
    return { ok: true, message: 'Removed.' };
  } catch (err) {
    return fail(err);
  }
}
