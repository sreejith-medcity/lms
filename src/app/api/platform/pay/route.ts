import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { platformSignatureValid, settleInvoice } from '@/lib/platform/billing';

export const dynamic = 'force-dynamic';

/** Razorpay's handler lands here with the signature; the invoice is settled only when it checks out. */
export async function POST(request: Request) {
  const tenant = await requireTenant();
  try {
    await requireStaff('settings.organization', 'edit');
  } catch {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { invoiceId?: string; razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string } | null;
  if (!body?.invoiceId || !body.razorpay_order_id || !body.razorpay_payment_id || !body.razorpay_signature) return NextResponse.json({ error: 'Incomplete' }, { status: 400 });
  const invoice = await db.tenantInvoice.findFirst({ where: { id: body.invoiceId, tenantId: tenant.tenantId }, select: { id: true, gatewayOrderId: true, status: true } });
  if (!invoice || invoice.gatewayOrderId !== body.razorpay_order_id) return NextResponse.json({ error: 'That payment does not match the invoice' }, { status: 400 });
  if (!platformSignatureValid(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) return NextResponse.json({ error: 'The signature did not check out' }, { status: 400 });
  if (invoice.status !== 'PAID') await settleInvoice(invoice.id, { paymentId: body.razorpay_payment_id, reference: 'Razorpay' });
  return NextResponse.json({ ok: true });
}
