import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { publicOrigin } from '@/lib/http-headers';
import { CART_COOKIE } from '@/lib/cart-cookie';
import { contactOf, mayViewOrder } from '@/lib/guest-order';
import { startWith } from '@/lib/payments';
import type { GatewayId } from '@/lib/payments/gateway';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REDIRECT_GATEWAYS = new Set(['phonepe', 'payu', 'stripe']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The buyer pressed "Pay with …". The order is theirs (or their guest
 * browser's), the gateway is asked to start, and the browser is sent on:
 * a redirect for PhonePe and Stripe, a self-posting form for PayU.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  if (!REDIRECT_GATEWAYS.has(gateway)) return new NextResponse('Unknown gateway', { status: 404 });
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });

  const form = await request.formData().catch(() => null);
  const orderId = String(form?.get('orderId') ?? '');
  if (!orderId) return new NextResponse('No order', { status: 400 });

  const [user, order] = await Promise.all([
    getSessionUser(),
    db.order.findFirst({
      where: { id: orderId, organizationId: tenant.organizationId },
      select: {
        id: true,
        orderNo: true,
        status: true,
        totalPaise: true,
        currency: true,
        userId: true,
        billingAddress: true,
        items: { select: { titleSnapshot: true } },
        user: { select: { name: true, email: true, phone: true } },
      },
    }),
  ]);
  if (!order) return new NextResponse('Order not found', { status: 404 });
  const cartCookie = (await cookies()).get(CART_COOKIE)?.value ?? null;
  if (!mayViewOrder({ orderUserId: order.userId, sessionUserId: user?.id ?? null, orderBillingAddress: order.billingAddress, cartCookie })) {
    return new NextResponse('Not allowed', { status: 401 });
  }
  const origin = publicOrigin(request);
  if (order.status === 'PAID') return NextResponse.redirect(`${origin}/checkout/${order.id}`, 303);

  const contact = contactOf(order.billingAddress);
  try {
    const result = await startWith({
      organizationId: tenant.organizationId,
      gatewayId: gateway as Exclude<GatewayId, 'razorpay'>,
      order,
      buyer: { name: order.user.name || contact.name || 'Learner', email: order.user.email ?? contact.email ?? null, phone: order.user.phone ?? contact.phone ?? null },
      origin,
    });
    if (result.kind === 'redirect') return NextResponse.redirect(result.url, 303);

    const inputs = Object.entries(result.fields)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Taking you to the payment page</title></head><body style="font-family:system-ui;padding:2rem"><p>Taking you to the payment page…</p><form id="f" method="post" action="${escapeHtml(result.action)}">${inputs}<noscript><button type="submit">Continue to payment</button></noscript></form><script>document.getElementById('f').submit()</script></body></html>`;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[payments/start]', err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${origin}/checkout/${order.id}?failed=start`, 303);
  }
}
