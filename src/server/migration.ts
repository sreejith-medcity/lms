'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { wooFor, checkConnection } from '@/lib/woocommerce';
import {
  importCustomers,
  importProductRedirects,
  importOrders,
  type StepReport,
} from '@/lib/migrate-woo';
import type { ActionState } from '@/server/courses';
import { checkEdmingle, edmingleFor } from '@/lib/edmingle';
import { attachVideos, importCatalogue, importFiles, type EdmingleReport } from '@/lib/migrate-edmingle';
import { importBatches, importEnrollments, importLearners, importPrices } from '@/lib/migrate-edmingle-people';
import { importQuestions } from '@/lib/migrate-edmingle-questions';

/**
 * Running the migration.
 *
 * Every step is a dry run unless somebody has explicitly asked for the real
 * thing, and the real thing needs the delete permission rather than edit. That
 * is deliberate: importing four thousand accounts is not the same class of
 * action as changing a setting, and it should not be reachable by everybody who
 * can do the latter.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.integrations', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[migration]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export interface StepState extends ActionState {
  report?: StepReport;
  dryRun?: boolean;
}

export async function testStore(): Promise<ActionState> {
  try {
    const { tenant } = await guard('view');

    const client = await wooFor(tenant.organizationId);
    if (!client) {
      return { error: 'WooCommerce is not connected. Add the keys in Settings, Integrations.' };
    }

    return { ok: true, message: await checkConnection(client) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export type Step = 'customers' | 'products' | 'orders';

export async function runStep(step: Step, apply: boolean): Promise<StepState> {
  try {
    // Reading is an ordinary permission. Writing four thousand accounts is not.
    const { tenant, user } = await guard(apply ? 'delete' : 'view');

    const options = { dryRun: !apply };

    const report =
      step === 'customers'
        ? await importCustomers(tenant.organizationId, options)
        : step === 'products'
          ? await importProductRedirects(tenant.organizationId, options)
          : await importOrders(tenant.organizationId, options);

    if (apply) {
      await recordAudit({
        organizationId: tenant.organizationId,
        actorId: user.id,
        action: 'migration.ran',
        entity: 'MigrationRecord',
        entityId: step,
        after: {
          created: report.wouldCreate,
          updated: report.wouldUpdate,
          alreadyDone: report.alreadyDone,
        },
      });
      revalidatePath('/admin/settings/migration');
      revalidatePath('/admin/settings/redirects');
    }

    const moved = report.wouldCreate + report.wouldUpdate;

    return {
      ok: true,
      dryRun: !apply,
      report,
      message: apply
        ? `${moved} ${moved === 1 ? 'record' : 'records'} brought across, ${report.alreadyDone} were already here.`
        : `${moved} would move, ${report.alreadyDone} are already here. Nothing has been written.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/* Edmingle --------------------------------------------------------------------- */

export type EdmingleStep = 'catalogue' | 'files' | 'videos' | 'prices' | 'learners' | 'batches' | 'enrolments' | 'questions';

export interface EdmingleStepState extends ActionState {
  report?: EdmingleReport;
  dryRun?: boolean;
}

export async function testEdmingle(): Promise<ActionState> {
  try {
    const { tenant } = await guard('view');
    const client = await edmingleFor(tenant.organizationId);
    if (!client) return { error: 'Edmingle is not connected. Put the key on the Edmingle card in Settings, Integrations.' };
    return { ok: true, message: await checkEdmingle(client) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export async function runEdmingleStep(step: EdmingleStep, apply: boolean): Promise<EdmingleStepState> {
  try {
    const { tenant, user } = await guard(apply ? 'delete' : 'view');
    const options = { dryRun: !apply };
    const runners: Record<EdmingleStep, () => Promise<EdmingleReport>> = {
      catalogue: () => importCatalogue(tenant.organizationId, options),
      files: () => importFiles(tenant.organizationId, options),
      videos: () => attachVideos(tenant.organizationId, options),
      prices: () => importPrices(tenant.organizationId, options),
      learners: () => importLearners(tenant.organizationId, options),
      batches: () => importBatches(tenant.organizationId, options),
      enrolments: () => importEnrollments(tenant.organizationId, options),
      questions: () => importQuestions(tenant.organizationId, options),
    };
    const report = await runners[step]();

    if (apply) {
      await recordAudit({
        organizationId: tenant.organizationId,
        actorId: user.id,
        action: 'migration.edmingle',
        entity: 'MigrationRecord',
        entityId: step,
        after: { created: report.wouldCreate, updated: report.wouldUpdate, alreadyDone: report.alreadyDone, remaining: report.remaining, problems: report.problems.length },
      });
      revalidatePath('/admin/settings/migration');
      revalidatePath('/admin/courses');
      revalidatePath('/admin/library');
      revalidatePath('/admin/learners');
      revalidatePath('/admin/batches');
      revalidatePath('/admin/question-bank');
    }

    const moved = report.wouldCreate + report.wouldUpdate;
    const more = report.remaining > 0 ? ` ${report.remaining} left for the next press.` : '';
    return {
      ok: true,
      dryRun: !apply,
      report,
      message: apply
        ? `${moved} ${moved === 1 ? 'item' : 'items'} brought across, ${report.alreadyDone} were already here.${more}`
        : `${moved} would come across, ${report.alreadyDone} are already here. Nothing has been written.${more}`,
    };
  } catch (err) {
    return fail(err);
  }
}
