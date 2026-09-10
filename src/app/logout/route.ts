import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth';
import { WHO_COOKIE } from '@/lib/who-cookie';

/**
 * Route handlers must return a Response, so the redirect is built here rather
 * than thrown by next/navigation's redirect().
 */
async function endSession(req: NextRequest) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.authSession.deleteMany({ where: { sessionToken: token } });
  }

  // Relative, so the browser resolves it against the address it actually
  // asked for. Behind a proxy `req.url` is the bind address, and a logout
  // that lands on 0.0.0.0:3000 looks to a user like the site going down.
  const res = new NextResponse(null, { status: 302, headers: { Location: '/login' } });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(WHO_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  return endSession(req);
}

export async function POST(req: NextRequest) {
  return endSession(req);
}
