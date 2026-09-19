'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { correctAttendanceAs, submitRegisterAs } from '@/lib/register-core';
import type { ActionState } from '@/server/courses';

/**
 * The register a teacher keeps on a phone, and the corrections after it.
 * The rules live in `lib/register-core.ts`, shared with the app's API;
 * this file is the web door: the cookie session, and the pages to refresh.
 */

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('scheduling.sessions', 'view')]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[register]', message);
  return { error: 'Something went wrong. Nothing was saved; please try again.' };
}

export interface RegisterResult extends ActionState {
  recorded?: number;
  unchanged?: number;
  alerted?: number;
  savedAt?: string;
}

export async function submitRegister(sessionId: string, marks: { userId: string; status: string }[]): Promise<RegisterResult> {
  try {
    const { tenant, user } = await guard();
    const res = await submitRegisterAs(tenant.organizationId, user, sessionId, marks);
    if (!res.ok) return { error: res.error };
    revalidatePath(`/admin/register/${sessionId}`);
    revalidatePath(`/admin/sessions/${sessionId}`);
    revalidatePath('/admin/register');
    return { ok: true, ...res.value };
  } catch (err) {
    return fail(err);
  }
}

export async function correctAttendance(sessionId: string, userId: string, status: string, reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const res = await correctAttendanceAs(tenant.organizationId, user, sessionId, userId, status, reason);
    if (!res.ok) return { error: res.error };
    revalidatePath(`/admin/register/${sessionId}`);
    revalidatePath(`/admin/sessions/${sessionId}`);
    return { ok: true, message: res.value.message };
  } catch (err) {
    return fail(err);
  }
}
