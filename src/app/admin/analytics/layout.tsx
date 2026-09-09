import { PageHeader } from '@/components/ui';
import { AnalyticsTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Every figure here says what it counts and over what period, at the bottom of its own page. A number nobody can trace is a number nobody should act on."
      />
      <AnalyticsTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
