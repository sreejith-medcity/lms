import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { SignupForm } from './form';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/learn');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8">
        <h1 className="text-lg font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Join {tenant?.name ?? 'the academy'} and start learning.
        </p>

        <SignupForm />

        <p className="mt-6 text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-slate-800 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
