import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { LoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8">
        <h1 className="text-lg font-semibold">{tenant?.name ?? 'Sign in'}</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to continue.</p>
        <LoginForm />
      </div>
    </main>
  );
}
