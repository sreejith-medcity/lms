import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { AuthShell } from '@/components/auth-shell';
import { SignupForm } from './form';

export const dynamic = 'force-dynamic';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/learn');

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Academy'}
      title="Create your account"
      subtitle={`Join ${tenant?.name ?? 'the academy'} and start learning.`}
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-[var(--ink)] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm referralCode={(ref ?? '').trim().toUpperCase().slice(0, 16)} />
    </AuthShell>
  );
}
