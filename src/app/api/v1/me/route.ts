import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { meProfile } from '@/lib/api/data';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { isLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  return ok(await meProfile(ctx.tenant, ctx.user));
}

/** The two things the app may change without the web: language and clock. */
export async function PATCH(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const data: { locale?: string; timezone?: string } = {};
  const locale = str(body?.locale, 5);
  if (locale) {
    if (!isLocale(locale)) return fail('bad_locale', 'Unknown language code.', 400);
    data.locale = locale;
  }
  const timezone = str(body?.timezone, 60);
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      data.timezone = timezone;
    } catch {
      return fail('bad_timezone', 'Unknown timezone.', 400);
    }
  }
  if (Object.keys(data).length) await db.user.update({ where: { id: ctx.user.id }, data });
  return ok(await meProfile(ctx.tenant, { ...ctx.user, ...data }));
}
