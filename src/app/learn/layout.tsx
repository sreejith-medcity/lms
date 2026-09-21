import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { ImpersonationBanner } from '@/components/impersonation-banner';
import { learnerNav } from '@/lib/learner-nav';
import { BrandLockup } from '@/components/brand-lockup';
import { LearnerMenu, LearnerSidebar } from './learner-sidebar';
import { inApp } from '@/lib/in-app';
import { Bell } from './bell';
import { getLocale, offeredForTenant } from '@/lib/i18n/server';
import { dictionaryFor, translatorFor } from '@/lib/i18n';
import { I18nProvider } from '@/components/i18n-provider';
import { LanguageSwitch } from '@/components/language-switch';

export const dynamic = 'force-dynamic';

/** Application surface: useful to the person signed in, useless in a search result. */
export const metadata = { robots: { index: false, follow: false } };

/**
 * The learner's shell: the menu down the left, a slim bar across the top
 * with the bell and the language, the page in the rest.
 *
 * The bar stays 3.5rem tall on every screen because the lesson player and
 * the exam paper pin their own rails just under it.
 */
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (!tenant) redirect('/');
  if (!user) redirect('/login');

  const [locale, offered] = await Promise.all([getLocale(), offeredForTenant()]);
  const t = translatorFor(locale);
  const nav = (await learnerNav(tenant.organizationId)).map((item) => ({ ...item, label: t(item.label) }));
  const initial = user.name.trim().slice(0, 1).toUpperCase() || '?';
  const avatarUrl = (await db.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } }))?.avatarUrl ?? null;
  const unread = await db.notificationLog.count({ where: { organizationId: tenant.organizationId, userId: user.id, channel: 'IN_APP', status: 'SENT' } });

  const avatar = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  ) : (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
      {initial}
    </span>
  );
  const brandFull = <BrandLockup name={tenant.name} logoUrl={tenant.logoUrl} height={26} fallback="initial" className="min-w-0" />;
  const brandMark = (
    <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-sm font-bold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }} aria-label={tenant.name}>
      {tenant.name.trim().slice(0, 1).toUpperCase()}
    </span>
  );

  if (await inApp()) {
    return (
      <I18nProvider locale={locale} dict={dictionaryFor(locale)}>
        <main className="rise min-h-screen min-w-0 bg-[var(--canvas)]">{children}</main>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider locale={locale} dict={dictionaryFor(locale)}>
      <div className="min-h-screen bg-[var(--canvas)]">
        <ImpersonationBanner learnerName={user.name} />
        <div className="flex min-h-screen">
          <LearnerSidebar items={nav} isStaff={user.kind === 'STAFF'} brand={{ full: brandFull, mark: brandMark }} account={{ avatar, name: user.name }} />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--line),0_2px_8px_rgb(50_32_70/0.06)]">
              <div className="flex h-14 items-center gap-3 px-4 sm:px-5">
                <LearnerMenu items={nav} isStaff={user.kind === 'STAFF'} brand={brandFull} account={{ avatar, name: user.name }} />
                <Link href="/learn" className="flex min-w-0 flex-1 items-center lg:hidden">
                  {brandFull}
                </Link>

                <div className="ml-auto flex shrink-0 items-center gap-3">
                  <LanguageSwitch current={locale} offered={offered} compact />
                  <Bell unread={unread} />
                  <Link href="/learn/account" className="flex items-center" title={t('Account')}>
                    {avatar}
                  </Link>
                </div>
              </div>
            </header>

            {/* No container here: the player wants the full width for its curriculum rail.
                Pages that want a reading measure add their own. */}
            <main className="rise min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}
