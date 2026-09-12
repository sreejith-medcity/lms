import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { invoiceDocument, mayViewMoneyDocument } from '@/lib/money-documents';
import { MoneyDocument } from '@/components/money-document';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice', robots: { index: false, follow: false } };

/**
 * The invoice behind a paid order, printable. Issued once when the order was
 * paid and never edited, so this only reads what fulfilment wrote, through
 * the same loader the PDF and the email attachment use.
 */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceNo: string }> }) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const { invoiceNo } = await params;

  const doc = await invoiceDocument(tenant.organizationId, invoiceNo);
  if (!doc) notFound();
  if (!mayViewMoneyDocument(user, doc.ownerId)) notFound();
  const staffView = user.kind === 'STAFF' && user.id !== doc.ownerId;

  return <MoneyDocument {...doc} backHref={staffView ? '/admin/invoices' : '/learn/purchases'} backLabel={staffView ? 'Back to invoices' : 'Back to purchases'} />;
}
