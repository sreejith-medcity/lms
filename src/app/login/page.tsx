import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { resolveIntegration } from '@/lib/integration-store';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from './form';
import { getLocale, offeredForTenant } from '@/lib/i18n/server';
import { dictionaryFor, translatorFor } from '@/lib/i18n';
import { I18nProvider } from '@/components/i18n-provider';
import { LanguageSwitch } from '@/components/language-switch';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string }>;
}) {
  const [tenant, user, params] = await Promise.all([
    getTenantContext(),
    getSessionUser(),
    searchParams,
  ]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/learn');
  const [locale, offered] = await Promise.all([getLocale(), offeredForTenant()]);
  const t = translatorFor(locale);

  // The buttons appear only where the academy has actually connected the
  // provider, so nobody is offered a door that leads to an error page.
  const sso: string[] = [];
  if (tenant) {
    const [google, microsoft] = await Promise.all([
      resolveIntegration(tenant.organizationId, 'google_sso'),
      resolveIntegration(tenant.organizationId, 'microsoft_sso'),
    ]);
    if (google?.complete) sso.push('google');
    if (microsoft?.complete) sso.push('microsoft');
  }

  return (
    <I18nProvider locale={locale} dict={dictionaryFor(locale)}>
      <AuthShell
        orgName={tenant?.name ?? 'Academy'}
        title={t('Welcome back')}
        subtitle={t('Sign in to pick up where you left off.')}
        footer={
          <>
            {t('New here?')}{' '}
            <Link href="/signup" className="font-medium text-[var(--ink)] hover:underline">
              {t('Create an account')}
            </Link>
            <span className="mx-2 faint">·</span>
            <Link href="/parent/login" className="hover:underline">
              {t('A parent?')}
            </Link>
            {offered.length > 1 && (
              <span className="mt-3 block">
                <LanguageSwitch current={locale} offered={offered} />
              </span>
            )}
          </>
        }
      >
        <LoginForm sso={sso} problem={params.sso} />
      </AuthShell>
    </I18nProvider>
  );
}
