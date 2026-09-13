'use server';

import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { isLocale, LANG_COOKIE } from '@/lib/i18n';

/** Remember the language: on the account when signed in, in a cookie either way. */
export async function setLanguage(code: string): Promise<{ ok: boolean }> {
  if (!isLocale(code)) return { ok: false };
  (await cookies()).set(LANG_COOKIE, code, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 365 * 86400 });
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (tenant && user) {
    await db.user.updateMany({ where: { id: user.id, organizationId: tenant.organizationId }, data: { locale: code } });
  }
  return { ok: true };
}
