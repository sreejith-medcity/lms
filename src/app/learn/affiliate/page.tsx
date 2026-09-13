import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/clock';
import { organizationOrigin } from '@/lib/org-origin';
import { affiliateLink, saleTotals } from '@/lib/affiliates';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your referral link' };

/**
 * A partner's own view: their link, how many came through it, what it
 * earned, and what has been paid. Buyers' names are not theirs to see.
 */
export default async function AffiliateSelfPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const affiliate = await db.affiliate.findFirst({
    where: { organizationId: tenant.organizationId, userId: user.id },
    select: {
      code: true,
      status: true,
      commissionPercent: true,
      _count: { select: { clicks: true } },
      sales: { orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, status: true, commissionPaise: true, createdAt: true, paidAt: true } },
    },
  });

  if (!affiliate) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-7">
        <h1 className="text-xl font-semibold">Your referral link</h1>
        <p className="t-small muted mt-2">This account is not set up as a partner. Ask the academy if you would like to be one.</p>
      </div>
    );
  }

  const t = saleTotals(affiliate.sales);
  const link = affiliateLink(await organizationOrigin(tenant.organizationId), affiliate.code);

  return (
    <div className="mx-auto max-w-2xl px-5 py-7">
      <Link href="/learn/account" className="t-small faint hover:underline">
        Account
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Your referral link</h1>
      <p className="t-small faint mt-1">
        {affiliate.commissionPercent}% of every course bought through it, once the buyer has paid.
        {affiliate.status !== 'ACTIVE' && ' The link is paused at the moment.'}
      </p>

      <Card className="mt-5">
        <p className="break-all rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-3 py-2 font-mono text-sm">{link}</p>
        <p className="t-small faint mt-2">Share it anywhere. Whoever arrives through it is counted for you for a while, even if they buy later.</p>
      </Card>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Clicks', String(affiliate._count.clicks)],
          ['Sales', String(t.approved + t.paid)],
          ['Owed to you', formatMoney(t.owedPaise, tenant.currency)],
          ['Paid to you', formatMoney(t.paidPaise, tenant.currency)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2">
            <p className="text-lg font-semibold tabular-nums">{value}</p>
            <p className="t-small faint">{label}</p>
          </div>
        ))}
      </div>

      {affiliate.sales.length > 0 && (
        <Card className="mt-5">
          <p className="font-semibold">Sales</p>
          <ul className="mt-2 divide-y">
            {affiliate.sales.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="faint">{formatDateTime(s.createdAt, tenant.timezone)}</span>
                <span className="tabular-nums">{formatMoney(s.commissionPaise, tenant.currency)}</span>
                <span className="t-small faint">
                  {s.status === 'PAID' ? `paid ${s.paidAt ? formatDateTime(s.paidAt, tenant.timezone) : ''}` : s.status === 'APPROVED' ? 'owed' : s.status === 'PENDING' ? 'buyer has not paid yet' : 'void'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
