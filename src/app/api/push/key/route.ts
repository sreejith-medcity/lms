import { NextResponse } from 'next/server';
import { pushPublicKey } from '@/lib/messaging/push';

export const dynamic = 'force-dynamic';

/** The VAPID public key a browser needs to subscribe. Public by nature. */
export async function GET() {
  const key = pushPublicKey();
  return NextResponse.json({ key }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
