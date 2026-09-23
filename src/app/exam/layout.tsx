import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import './exam.css';

export const dynamic = 'force-dynamic';

/** A paper under way: never in a search result, never translated. */
export const metadata = { robots: { index: false, follow: false }, other: { google: 'notranslate' } };

/**
 * The exam has no menu and no way out but finishing: the screen is the
 * paper, the clock and the parts, as it is on the day.
 */
export default async function ExamLayout({ children }: { children: React.ReactNode }) {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (!tenant) redirect('/');
  if (!user) redirect('/login');
  return <div className="exam-root">{children}</div>;
}
