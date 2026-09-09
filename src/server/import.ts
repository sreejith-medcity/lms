'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { hashPassword } from '@/lib/password';
import { recordAudit } from '@/lib/audit';
import { parseCsv } from '@/lib/csv';

/**
 * Bulk learner import.
 *
 * Two passes, always. The first only reads: it parses, validates every row and
 * reports what would happen, and writes nothing. The second applies exactly what
 * the first described. Nobody should discover on row 400 that rows 1 to 399 went
 * in wrong, and nobody should have to guess what a file will do before running
 * it.
 *
 * A row that fails does not stop the import. It comes back with its line number
 * and the reason, so a file of six hundred can be fixed in the eleven places it
 * is wrong rather than rejected whole.
 */

export interface ImportRow {
  line: number;
  name: string;
  email: string;
  phone: string;
  course: string;
  outcome: 'create' | 'match' | 'enrol' | 'skip' | 'error';
  detail: string;
  password?: string;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  applied: boolean;
  rows: ImportRow[];
  summary: { created: number; matched: number; enrolled: number; skipped: number; failed: number };
}

const HEADERS = ['name', 'email', 'phone', 'course'];

export async function importLearners(
  csv: string,
  apply: boolean,
): Promise<ImportResult> {
  const empty: ImportResult['summary'] = {
    created: 0,
    matched: 0,
    enrolled: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const [tenant, actor] = await Promise.all([
      requireTenant(),
      requireStaff('new_enrollment.bulk', 'edit'),
    ]);

    const table = parseCsv(csv);
    if (table.length < 2) {
      return { ok: false, applied: false, rows: [], summary: empty, error: 'The file has no rows under its header.' };
    }

    const header = table[0].map((h) => h.trim().toLowerCase());
    const missing = HEADERS.filter((h) => h !== 'phone' && !header.includes(h));
    if (missing.length > 0) {
      return {
        ok: false,
        applied: false,
        rows: [],
        summary: empty,
        error: `The header is missing: ${missing.join(', ')}. Expected name, email, phone, course.`,
      };
    }

    const at = (row: string[], key: string) => {
      const index = header.indexOf(key);
      return index === -1 ? '' : (row[index] ?? '').trim();
    };

    const [products, branch] = await Promise.all([
      db.product.findMany({
        where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
        select: { id: true, title: true, slug: true, course: { select: { id: true } } },
      }),
      db.branch.findFirst({
        where: { organizationId: tenant.organizationId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }),
    ]);

    if (!branch) {
      return { ok: false, applied: false, rows: [], summary: empty, error: 'This academy has no active branch.' };
    }

    const productByKey = new Map<string, (typeof products)[number]>();
    for (const p of products) {
      productByKey.set(p.title.toLowerCase(), p);
      productByKey.set(p.slug.toLowerCase(), p);
    }

    const rows: ImportRow[] = [];
    const summary = { ...empty };
    const seenEmails = new Set<string>();

    for (let i = 1; i < table.length; i++) {
      const raw = table[i];
      const line = i + 1;

      const name = at(raw, 'name');
      const email = at(raw, 'email').toLowerCase();
      const phone = at(raw, 'phone');
      const course = at(raw, 'course');

      const row: ImportRow = { line, name, email, phone, course, outcome: 'error', detail: '' };

      if (!name) {
        row.detail = 'No name.';
        summary.failed++;
        rows.push(row);
        continue;
      }
      if (!email && !phone) {
        row.detail = 'No email and no phone. One of the two is needed.';
        summary.failed++;
        rows.push(row);
        continue;
      }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        row.detail = 'That email address is not valid.';
        summary.failed++;
        rows.push(row);
        continue;
      }
      if (email && seenEmails.has(email)) {
        row.outcome = 'skip';
        row.detail = 'The same address appears earlier in this file.';
        summary.skipped++;
        rows.push(row);
        continue;
      }
      if (email) seenEmails.add(email);

      const product = course ? productByKey.get(course.toLowerCase()) : undefined;
      if (course && !product) {
        row.detail = `No course called "${course}".`;
        summary.failed++;
        rows.push(row);
        continue;
      }

      const existing = email
        ? await db.user.findFirst({
            where: { organizationId: tenant.organizationId, email, deletedAt: null },
            select: { id: true },
          })
        : null;

      let userId = existing?.id ?? null;

      if (existing) {
        row.outcome = 'match';
        row.detail = 'Account already exists.';
        summary.matched++;
      } else {
        row.outcome = 'create';
        row.detail = 'A new account.';
        summary.created++;
      }

      if (apply && !existing) {
        const password = `${randomBytes(6).toString('base64url')}-${randomBytes(2).toString('hex')}`;
        const last = await db.user.aggregate({
          where: { organizationId: tenant.organizationId },
          _max: { registrationNo: true },
        });

        const created = await db.user.create({
          data: {
            organizationId: tenant.organizationId,
            name,
            email: email || null,
            phone: phone || null,
            kind: 'LEARNER',
            status: 'ACTIVE',
            passwordHash: await hashPassword(password),
            mustResetPassword: true,
            registrationNo: (last._max.registrationNo ?? 0) + 1,
            branchMemberships: { create: { branchId: branch.id, isPrimary: true } },
          },
          select: { id: true },
        });
        userId = created.id;
        row.password = password;
      }

      if (product?.course && userId) {
        const already = await db.enrollment.findFirst({
          where: {
            userId,
            productId: product.id,
            status: { notIn: ['CANCELLED', 'ARCHIVED'] },
          },
          select: { id: true },
        });

        if (already) {
          row.detail += ' Already enrolled in that course.';
        } else {
          row.outcome = 'enrol';
          row.detail += ` Enrolling in ${product.title}.`;
          summary.enrolled++;

          if (apply) {
            const batch = await db.batch.findFirst({
              where: {
                courseId: product.course.id,
                status: { in: ['ACTIVE', 'UPCOMING'] },
                deletedAt: null,
              },
              orderBy: [{ isDefault: 'desc' }, { startDate: 'asc' }],
              select: { id: true },
            });

            await db.enrollment.create({
              data: {
                organizationId: tenant.organizationId,
                branchId: branch.id,
                userId,
                productId: product.id,
                batchId: batch?.id,
                status: 'ENROLLED',
                source: 'ADMIN_BULK',
                startsAt: new Date(),
              },
            });
          }
        }
      } else if (!product && apply) {
        row.detail += ' No course given, so no enrolment.';
      }

      rows.push(row);
    }

    if (apply) {
      await recordAudit({
        organizationId: tenant.organizationId,
        actorId: actor.id,
        action: 'learners.imported',
        entity: 'User',
        after: summary,
      });
      revalidatePath('/admin/learners');
    }

    return { ok: true, applied: apply, rows, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'FORBIDDEN') {
      return { ok: false, applied: false, rows: [], summary: empty, error: 'You do not have permission to import learners.' };
    }
    console.error('[import]', message);
    return { ok: false, applied: false, rows: [], summary: empty, error: 'The file could not be read.' };
  }
}
