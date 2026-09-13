import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatDateTime } from '@/lib/clock';
import { statusLabel } from '@/lib/data-rights';
import { Badge, Card } from '@/components/ui';
import { DeletionForm } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your data' };

/**
 * A learner's two rights over their data, on one page: take a copy, and
 * ask to be forgotten. The copy is immediate. The deletion is a request,
 * because an academy keeps invoices and certificates whatever happens to
 * the account, and somebody has to close it knowing that.
 */
export default async function PrivacyPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const requests = await db.dataRequest.findMany({
    where: { userId: user.id, organizationId: tenant.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, kind: true, status: true, reason: true, note: true, createdAt: true, handledAt: true },
  });
  const openDeletion = requests.find((r) => r.kind === 'DELETION' && r.status === 'OPEN') ?? null;
  const lastDecision = requests.find((r) => r.kind === 'DELETION' && r.status === 'REFUSED') ?? null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <Link href="/learn/account" className="t-small faint hover:underline">
        Account
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Your data</h1>
      <p className="t-small faint mt-1">What {tenant.name} holds about you, and what you can do about it.</p>

      <div className="mt-6 space-y-4">
        <Card>
          <p className="font-semibold">Take a copy</p>
          <p className="t-small muted mt-0.5 max-w-prose">
            Everything on file about you in one file: your details, enrolments, progress, marks, notes,
            questions, certificates, orders and the messages sent to you. It is made the moment you ask and
            sent only to you, signed in.
          </p>
          <a
            href="/api/me/export"
            download
            className="mt-4 inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]"
            style={{ background: 'var(--brand)' }}
          >
            Download my data
          </a>
          <p className="t-small faint mt-2">A JSON file, readable in any text editor. A few copies a day at most.</p>
        </Card>

        <Card>
          <p className="font-semibold">Close my account and forget me</p>
          <p className="t-small muted mt-0.5 max-w-prose">
            Your name, contact details, sign-ins, notes and profile are removed and you can no longer sign in.
            Invoices and certificates already issued are kept, as the academy is required to, but no longer
            carry a way to reach you. Live enrolments end. This cannot be undone.
          </p>
          <div className="mt-4">
            <DeletionForm open={openDeletion ? { askedAt: formatDateTime(openDeletion.createdAt, tenant.timezone) } : null} />
          </div>
          {lastDecision && !openDeletion && (
            <div className="mt-4 rounded-[var(--radius-sm)] border-l-4 bg-[var(--surface-2)] p-3" style={{ borderColor: 'var(--warn)' }}>
              <p className="t-small font-semibold">
                The academy did not go ahead with your last request
                {lastDecision.handledAt && <span className="faint font-normal"> · {formatDateTime(lastDecision.handledAt, tenant.timezone)}</span>}
              </p>
              {lastDecision.note && <p className="t-small mt-1">{lastDecision.note}</p>}
            </div>
          )}
        </Card>

        {requests.length > 0 && (
          <Card>
            <p className="font-semibold">History</p>
            <ul className="mt-3 divide-y">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="t-small font-medium">{r.kind === 'EXPORT' ? 'Copy of your data' : 'Account closure'}</span>
                  <Badge tone={r.status === 'DONE' ? 'ok' : r.status === 'OPEN' ? 'warn' : r.status === 'REFUSED' ? 'bad' : 'neutral'}>
                    {statusLabel(r.status)}
                  </Badge>
                  <span className="t-small faint ml-auto">{formatDateTime(r.createdAt, tenant.timezone)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
