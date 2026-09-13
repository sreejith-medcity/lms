import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { packageFor, readLaunchToken } from '@/lib/scorm/access';
import { applyToAttempt, storeStatements } from '@/lib/scorm/lrs';
import { markScormMaterialDone } from '@/lib/scorm/progress';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Experience-API-Version', 'X-Experience-API-Version': '1.0.3' };

async function authed(request: Request, packageId: string) {
  const found = await packageFor(packageId);
  if (!found) return null;
  const who = readLaunchToken(request.headers.get('authorization'), packageId);
  if (!who) return null;
  return { ...found, userId: who.userId };
}

async function ingest(request: Request, packageId: string) {
  const ctx = await authed(request, packageId);
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400, headers: CORS });
  }
  const url = new URL(request.url);
  const givenId = url.searchParams.get('statementId');
  if (givenId && body && typeof body === 'object' && !Array.isArray(body)) (body as { id?: string }).id = givenId;
  const r = await storeStatements({ organizationId: ctx.pkg.organizationId, packageId, userId: ctx.userId, statements: body });
  const newlyDone = await applyToAttempt(packageId, ctx.userId, r);
  if (newlyDone) await markScormMaterialDone(ctx.pkg.organizationId, ctx.userId, ctx.pkg.materialId);
  return givenId ? new NextResponse(null, { status: 204, headers: CORS }) : NextResponse.json(r.ids, { status: 200, headers: CORS });
}

export async function POST(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  return ingest(request, (await params).packageId);
}

export async function PUT(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  return ingest(request, (await params).packageId);
}

/** The package's own statements back, newest first. Enough for a resume; not a query language. */
export async function GET(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const ctx = await authed(request, packageId);
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  const rows = await db.xapiStatement.findMany({ where: { packageId, userId: ctx.userId, organizationId: ctx.pkg.organizationId }, orderBy: { storedAt: 'desc' }, take: 100, select: { statement: true } });
  return NextResponse.json({ statements: rows.map((r) => r.statement), more: '' }, { headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
