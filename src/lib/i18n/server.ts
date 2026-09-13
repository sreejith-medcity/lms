import { cache } from 'react';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { settingText } from '@/lib/settings/store';
import { db } from '@/lib/db';
import { DEFAULT_LOCALE, LANG_COOKIE, offeredLocales, pickLocale, translatorFor, type Locale, type Translator } from './index';

/**
 * Which language this request is in. A signed-in learner's own setting
 * wins; otherwise the cookie the switcher set; otherwise English. Always
 * narrowed to what the academy offers, so a language switched off under
 * Settings stops appearing without anybody's cookie needing to expire.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const tenant = await getTenantContext();
  if (!tenant) return DEFAULT_LOCALE;
  const offered = offeredLocales(await settingText(tenant.organizationId, 'learning.languages'));
  if (offered.length === 1) return DEFAULT_LOCALE;
  const user = await getSessionUser();
  if (user) {
    const row = await db.user.findFirst({ where: { id: user.id, organizationId: tenant.organizationId }, select: { locale: true } });
    if (row?.locale && row.locale !== 'en') return pickLocale(row.locale, offered);
  }
  const cookie = (await cookies()).get(LANG_COOKIE)?.value;
  return pickLocale(cookie, offered);
});

export async function getTranslator(): Promise<Translator> {
  return translatorFor(await getLocale());
}

export async function offeredForTenant(): Promise<Locale[]> {
  const tenant = await getTenantContext();
  if (!tenant) return [DEFAULT_LOCALE];
  return offeredLocales(await settingText(tenant.organizationId, 'learning.languages'));
}
