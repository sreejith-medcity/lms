import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { SettingsTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="How this academy is set up: who it is, how it looks, where it operates, what it charges, and who can do what."
        action={
          <Link href="/admin/team" className="t-small faint hover:underline">
            Team →
          </Link>
        }
      />
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
