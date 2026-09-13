import { getTenantContext } from '@/lib/tenant';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Paused', robots: { index: false, follow: false } };

/** What everyone but the office sees while an academy is paused. */
export default async function PausedPage() {
  const tenant = await getTenantContext();
  const row = tenant ? await db.tenant.findUnique({ where: { id: tenant.tenantId }, select: { status: true, suspendReason: true } }) : null;
  const cancelled = row?.status === 'CANCELLED';
  return (
    <main className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="text-2xl font-semibold">{cancelled ? 'This academy has closed' : 'This academy is paused for the moment'}</h1>
      <p className="t-small muted mt-3">
        {cancelled
          ? 'Its subscription has ended. If you are a learner here, the academy can tell you how to reach your certificates and records.'
          : 'The office is sorting out its subscription with the platform. Classes, lessons and records are all safe and will be back as soon as that is done.'}
      </p>
      {!cancelled && <p className="t-small faint mt-6">Staff: sign in and open Settings, Billing.</p>}
      {!cancelled && <a href="/login" className="t-small mt-2 inline-block underline">Staff sign in</a>}
    </main>
  );
}
