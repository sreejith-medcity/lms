import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { SecurityPanel } from './panel';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const me = await getSessionUser();
  if (!me) redirect('/login');

  const account = await db.user.findUnique({
    where: { id: me.id },
    select: { twoFactorEnabledAt: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <PageHeader
        title="Sign-in and security"
        description="How this account proves it is you."
      />
      <SecurityPanel enabled={Boolean(account?.twoFactorEnabledAt)} />
    </div>
  );
}
