import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { baseDomain } from '@/lib/platform/provision';
import { StartForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Start an academy', robots: { index: true, follow: true } };

/** The front door for a new academy. Public, on the platform host. */
export default async function StartPage() {
  const open = (process.env.PLATFORM_SELF_SERVE ?? '1') !== '0';
  const plans = await db.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true, description: true, monthlyPaise: true, currency: true, trialDays: true } });
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="t-display">Start an academy</h1>
      <p className="t-small muted mt-2 max-w-prose">
        Courses, live classes, fees, certificates and the learner app, on your own address, in a few minutes. Your first person is you; add the team once you are in.
      </p>
      <div className="mt-8">
        {open ? (
          <StartForm base={baseDomain()} plans={plans.map((p) => ({ code: p.code, name: p.name, description: p.description, monthlyLabel: formatMoney(p.monthlyPaise, p.currency), trialDays: p.trialDays }))} />
        ) : (
          <p className="t-small muted">New academies are set up by the platform team just now. Write to us and we will have yours ready the same day.</p>
        )}
      </div>
    </div>
  );
}
