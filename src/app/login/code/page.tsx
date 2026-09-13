import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { AuthShell } from '@/components/auth-shell';
import { CodeForm } from './form';
import { getLocale } from '@/lib/i18n/server';
import { dictionaryFor, translatorFor } from '@/lib/i18n';
import { I18nProvider } from '@/components/i18n-provider';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function CodeLoginPage() {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/learn');
  const locale = await getLocale();
  const t = translatorFor(locale);

  return (
    <I18nProvider locale={locale} dict={dictionaryFor(locale)}>
      <AuthShell
        orgName={tenant?.name ?? 'Academy'}
        title={t('Sign in with a code')}
        subtitle={t('No password needed. We send a six digit code to your phone.')}
      >
        <CodeForm />
      </AuthShell>
    </I18nProvider>
  );
}
