import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Which build is answering, and whether it can reach its database.
 *
 * Read by the smoke run after every push, which waits here until the
 * commit it pushed is the one serving before it fetches the pages that
 * must answer. Nothing private: the commit is public on GitHub already,
 * and "database: ok" is the one word an uptime monitor needs.
 */
export async function GET() {
  let database: 'ok' | 'down' = 'ok';
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  return NextResponse.json(
    { sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? 'unknown', builtAt: process.env.NEXT_PUBLIC_BUILD_AT ?? null, database },
    { status: database === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
