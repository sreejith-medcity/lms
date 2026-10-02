import { PageHeader } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { TutoringTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Online tutors', robots: { index: false, follow: false } };

export default async function TutoringLayout({ children }: { children: React.ReactNode }) {
  await requireStaff('scheduling.sessions', 'view');
  return (
    <div>
      <PageHeader
        title="Online tutors"
        description="Courses taken with an online tutor: a fixed number of classes at the same time each class day. Tutors mark their hours, learners are placed with whoever is free, and a class called off for leave is added to the end."
      />
      <TutoringTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
