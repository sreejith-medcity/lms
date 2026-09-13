import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getPlatformUser } from '@/lib/platform/session';
import { Card } from '@/components/ui';
import { PlatformLoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function PlatformLoginPage() {
  if (await getPlatformUser()) redirect('/platform');
  const none = (await db.platformUser.count()) === 0;
  if (none) redirect('/platform/setup');
  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="t-title">Console sign in</h1>
      <p className="t-small muted mt-1">For the people who run the platform, not an academy.</p>
      <Card className="mt-6"><PlatformLoginForm /></Card>
      <p className="t-small faint mt-4">Starting an academy? <Link href="/platform/start" className="underline">Begin here</Link>.</p>
    </div>
  );
}
