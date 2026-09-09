import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { getTenantContext } from '@/lib/tenant';
import { ForgotForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reset your password', robots: { index: false, follow: false } };

export default async function ForgotPage() {
  const tenant = await getTenantContext();
  const emailWorks = Boolean(process.env.SMTP_URL);

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Medcity LMS'}
      title="Reset your password"
      subtitle={`Enter the address on your ${tenant?.name ?? 'academy'} account.`}
    >
      <ForgotForm emailWorks={emailWorks} />
      <p className="t-small faint mt-6">
        Remembered it?{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
