'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { signupProblem, slugProblem } from '@/lib/platform/signup';
import { baseDomain, provisionTenant } from '@/lib/platform/provision';
import { clearPlatformSession, issuePlatformSession, requirePlatform } from '@/lib/platform/session';
import type { ActionState } from '@/server/courses';

/**
 * The platform's own actions: an academy starting itself, the console's
 * sign-in, and the first console user when there is none.
 */

export interface SignupState extends ActionState {
  hostname?: string;
}

function selfServeOpen(): boolean {
  return (process.env.PLATFORM_SELF_SERVE ?? '1') !== '0';
}

export async function startAcademy(_prev: SignupState, formData: FormData): Promise<SignupState> {
  if (!selfServeOpen()) return { error: 'New academies are set up by the platform team just now. Write to us.' };
  const input = {
    academyName: String(formData.get('academyName') ?? ''),
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
    ownerName: String(formData.get('ownerName') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    password: String(formData.get('password') ?? ''),
    planCode: String(formData.get('planCode') ?? ''),
    website: String(formData.get('website') ?? ''),
  };
  const problem = signupProblem(input);
  if (problem) return { error: problem };

  const taken = await db.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (taken) return { error: 'That address is taken. Try another.' };
  const plan = await db.plan.findFirst({ where: { code: input.planCode, isActive: true, isPublic: true }, select: { id: true } });
  if (!plan) return { error: 'Pick a plan to start on.' };

  try {
    const made = await provisionTenant({
      academyName: input.academyName,
      slug: input.slug,
      ownerName: input.ownerName,
      ownerEmail: input.email,
      ownerPhone: input.phone,
      password: input.password,
      planCode: input.planCode,
      status: 'TRIALING',
    });
    return { ok: true, hostname: made.hostname };
  } catch (err) {
    console.error('[platform] signup', err instanceof Error ? err.message : err);
    return { error: 'We could not set the academy up just now. Nothing was charged. Please try again in a minute.' };
  }
}

export async function checkSlug(slug: string): Promise<{ ok: boolean; message: string }> {
  const s = slug.trim().toLowerCase();
  const problem = slugProblem(s);
  if (problem) return { ok: false, message: problem };
  const taken = await db.tenant.findUnique({ where: { slug: s }, select: { id: true } });
  if (taken) return { ok: false, message: 'Taken.' };
  return { ok: true, message: `${s}.${baseDomain()} is free.` };
}

/* The console ---------------------------------------------------------------- */

export async function platformLogin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const user = await db.platformUser.findUnique({ where: { email }, select: { id: true, passwordHash: true, isActive: true } });
  const wrong = { error: 'That email and password do not match.' };
  if (!user || !user.isActive || !user.passwordHash) return wrong;
  if (!(await verifyPassword(password, user.passwordHash))) return wrong;
  await issuePlatformSession(user.id, user.passwordHash);
  redirect('/platform');
}

export async function platformLogout(): Promise<void> {
  await clearPlatformSession();
  redirect('/platform/login');
}

/** The first console user, allowed only while there is none and with the setup key from the environment. */
export async function createFirstPlatformUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const count = await db.platformUser.count();
  if (count > 0) return { error: 'The console already has a user. Sign in instead.' };
  const key = process.env.PLATFORM_SETUP_KEY ?? '';
  if (!key || String(formData.get('setupKey') ?? '') !== key) return { error: 'The setup key is wrong. It is PLATFORM_SETUP_KEY in the environment.' };
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That does not look like an email address.' };
  if (name.length < 2) return { error: 'Give the user a name.' };
  if (password.length < 10) return { error: 'A password of at least ten characters for the console.' };
  const user = await db.platformUser.create({ data: { email, name, role: 'OWNER', passwordHash: await hashPassword(password) }, select: { id: true, passwordHash: true } });
  await issuePlatformSession(user.id, user.passwordHash);
  redirect('/platform');
}

export async function addPlatformUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const me = await requirePlatform(true);
    if (me.role !== 'OWNER') return { error: 'Only an owner adds console users.' };
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const name = String(formData.get('name') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const roleRaw = String(formData.get('role') ?? 'SUPPORT');
    const role = ['OWNER', 'ENGINEER', 'SUPPORT', 'BILLING', 'READ_ONLY'].includes(roleRaw) ? (roleRaw as 'OWNER') : 'SUPPORT';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That does not look like an email address.' };
    if (name.length < 2) return { error: 'Give the user a name.' };
    if (password.length < 10) return { error: 'A password of at least ten characters.' };
    await db.platformUser.create({ data: { email, name, role, passwordHash: await hashPassword(password) } });
    revalidatePath('/platform/team');
    return { ok: true, message: 'Added.' };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (m === 'PLATFORM_SIGN_IN') return { error: 'Please sign in again.' };
    if (m === 'FORBIDDEN') return { error: 'Not allowed.' };
    if (m.includes('Unique')) return { error: 'That email already has a console user.' };
    return { error: 'Something went wrong.' };
  }
}
