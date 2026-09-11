import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { mayViewMoneyDocument } from '@/lib/money-documents';
import { MoneyDocument } from '@/components/money-document';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Receipt', robots: { index: false, follow: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ receiptNo: string }> }) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const { receiptNo } = await params;

  const payment = await db.payment.findFirst({
    where: { organizationId: tenant.organizationId, receiptNo, status: { not: 'FAILED' } },
    select: {
      id: true,
      userId: true,
      receiptNo: true,
      method: true,
      gateway: true,
      gatewayRef: true,
      amountPaise: true,
      currency: true,
      capturedAt: true,
      createdAt: true,
      status: true,
      raw: true,
    },
  });
  if (!payment || !payment.receiptNo) notFound();
  if (!mayViewMoneyDocument(user, payment.userId)) notFound();

  const [learner, organization, taxConfig] = await Promise.all([
    payment.userId
      ? db.user.findFirst({
          where: { id: payment.userId, organizationId: tenant.organizationId },
          select: { name: true, email: true, phone: true },
        })
      : null,
    db.organization.findUnique({
      where: { id: tenant.organizationId },
      select: {
        name: true,
        legalName: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        supportEmail: true,
        contactNumber: true,
        logoUrl: true,
      },
    }),
    db.taxConfig.findFirst({
      where: { organizationId: tenant.organizationId },
      select: { gstin: true, pan: true },
    }),
  ]);
  if (!organization) notFound();

  const raw = (payment.raw ?? {}) as {
    item?: string;
    note?: string | null;
    allocations?: { sequence: number; paise: number; settles: boolean }[];
  };

  const lines = raw.allocations?.length
    ? raw.allocations.map((a) => ({
        title: `${raw.item ?? 'Course fee'}: instalment ${a.sequence}`,
        detail: a.settles ? undefined : 'Part payment',
        amountPaise: a.paise,
      }))
    : [{ title: raw.item ?? 'Fee', amountPaise: payment.amountPaise }];

  const refunded = payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED';

  return (
    <MoneyDocument
      kind="RECEIPT"
      number={payment.receiptNo}
      issuedAt={payment.capturedAt ?? payment.createdAt}
      currency={payment.currency}
      issuer={{ ...organization, gstin: taxConfig?.gstin, pan: taxConfig?.pan }}
      recipient={learner ?? { name: 'Learner' }}
      lines={lines}
      totals={[{ label: 'Total received', amountPaise: payment.amountPaise, strong: true }]}
      paidBy={payment.method ?? payment.gateway.toLowerCase()}
      reference={payment.gatewayRef}
      note={
        [raw.note, refunded ? `This payment has since been ${payment.status === 'REFUNDED' ? 'refunded' : 'partly refunded'}.` : null]
          .filter(Boolean)
          .join(' ') || undefined
      }
      backHref={user.kind === 'STAFF' && user.id !== payment.userId ? '/admin/fees' : '/learn/fees'}
      backLabel={user.kind === 'STAFF' && user.id !== payment.userId ? 'Back to fees' : 'Back to my fees'}
    />
  );
}
