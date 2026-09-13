import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { Card } from '@/components/ui';
import { SetupForm } from './form';

export const dynamic = 'force-dynamic';

/** Only while the console has nobody. After the first owner exists this page is gone. */
export default async function PlatformSetupPage() {
  if ((await db.platformUser.count()) > 0) redirect('/platform/login');
  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="t-title">Set up the console</h1>
      <p className="t-small muted mt-1">The first owner. Add the rest from Console users afterwards.</p>
      <Card className="mt-6"><SetupForm /></Card>
    </div>
  );
}
