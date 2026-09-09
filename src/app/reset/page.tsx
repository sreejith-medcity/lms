import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { getTenantContext } from '@/lib/tenant';
import { ResetForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose a new password', robots: { index: false, follow: false } };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token) ?? '';
  const tenant = await getTenantContext();

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Medcity LMS'}
      title="Choose a new password"
      subtitle="This link works once, and only for an hour."
    >
      {token ? (
        <ResetForm token={token} />
      ) : (
        <p className="t-small muted">
          That link is missing its token.{' '}
          <Link href="/forgot" className="underline">
            Ask for a new one
          </Link>
          .
        </p>
      )}
    </AuthShell>
  );
}
