import QRCode from 'qrcode';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { memberCode } from '@/lib/member-card';
import { Avatar } from '@/components/avatar';
import { Card } from '@/components/ui';
import { PrintButton } from '@/components/print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My card' };

/**
 * The learner's member card: the academy's mark, their name and number,
 * and a QR the counter reads. Shown large on a phone so it can be held
 * up, and printable for a wallet. The number under the QR is the one to
 * say out loud at a branch with no scanner.
 */
export default async function CardPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const me = await db.user.findUnique({ where: { id: user.id }, select: { name: true, registrationNo: true, avatarUrl: true, status: true, createdAt: true, branchMemberships: { where: { isPrimary: true }, select: { branch: { select: { name: true } } }, take: 1 } } });
  if (!me) return null;
  const code = memberCode(user.id);
  const qr = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: 320, color: { dark: '#322046', light: '#ffffff' } });
  const branch = me.branchMemberships[0]?.branch.name;
  const suspended = me.status === 'SUSPENDED' || me.status === 'ARCHIVED';

  return (
    <div className="mx-auto max-w-md px-5 py-7">
      <div className="flex items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold">My card</h1>
          <p className="t-small faint mt-1">Show this at the counter to check in, pay a fee or collect material.</p>
        </div>
        <PrintButton label="Print" />
      </div>

      <div className="mt-5">
        <Card>
          <div className="flex items-center gap-3">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt="" className="h-8 w-auto" />
            ) : (
              <span className="font-semibold">{tenant.name}</span>
            )}
            <span className="t-small faint ml-auto">{branch ?? tenant.name}</span>
          </div>
          <div className="mt-5 flex items-center gap-4">
            <Avatar name={me.name} src={me.avatarUrl} size={56} />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{me.name}</p>
              <p className="t-small faint">
                {me.registrationNo ? `Registration ${me.registrationNo}` : 'No registration number yet'} · since {me.createdAt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-center rounded-[var(--radius-sm)] bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Your member QR code" width={280} height={280} className={suspended ? 'opacity-30' : ''} />
          </div>
          <p className="mt-3 text-center font-mono text-2xl tracking-[0.3em] tabular-nums" aria-label="Member number">
            {me.registrationNo ?? '–'}
          </p>
          {suspended ? (
            <p className="t-small mt-3 text-center text-[var(--bad)]">This card is not active. Ask the office.</p>
          ) : (
            <p className="t-small faint mt-3 text-center">Say the number if the counter has no scanner.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
