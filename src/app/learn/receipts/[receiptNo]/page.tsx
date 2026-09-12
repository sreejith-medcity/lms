import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { mayViewMoneyDocument, receiptDocument } from '@/lib/money-documents';
import { MoneyDocument } from '@/components/money-document';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Receipt', robots: { index: false, follow: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ receiptNo: string }> }) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const { receiptNo } = await params;

  const doc = await receiptDocument(tenant.organizationId, receiptNo);
  if (!doc) notFound();
  if (!mayViewMoneyDocument(user, doc.ownerId)) notFound();
  const staffView = user.kind === 'STAFF' && user.id !== doc.ownerId;

  return <MoneyDocument {...doc} backHref={staffView ? '/admin/fees' : '/learn/fees'} backLabel={staffView ? 'Back to fees' : 'Back to my fees'} />;
}
