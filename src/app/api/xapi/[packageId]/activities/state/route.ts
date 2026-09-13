import { NextResponse } from 'next/server';
import { packageFor, readLaunchToken } from '@/lib/scorm/access';
import { readState, writeState } from '@/lib/scorm/lrs';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Experience-API-Version', 'X-Experience-API-Version': '1.0.3' };

async function ctxFor(request: Request, packageId: string) {
  const found = await packageFor(packageId);
  if (!found) return null;
  const who = readLaunchToken(request.headers.get('authorization'), packageId);
  if (!who) return null;
  const stateId = new URL(request.url).searchParams.get('stateId') ?? 'default';
  return { userId: who.userId, stateId };
}

/** The State API: a package's bookmark and suspend data, one document per stateId. */
export async function GET(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const ctx = await ctxFor(request, packageId);
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  const value = await readState(packageId, ctx.userId, ctx.stateId);
  if (value === null) return new NextResponse(null, { status: 404, headers: CORS });
  return typeof value === 'string' ? new NextResponse(value, { headers: { ...CORS, 'Content-Type': 'text/plain' } }) : NextResponse.json(value, { headers: CORS });
}

async function save(request: Request, packageId: string) {
  const ctx = await ctxFor(request, packageId);
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  const text = await request.text();
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* plain text state is fine */
  }
  await writeState(packageId, ctx.userId, ctx.stateId, value);
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function PUT(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  return save(request, (await params).packageId);
}
export async function POST(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  return save(request, (await params).packageId);
}
export async function DELETE(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const ctx = await ctxFor(request, packageId);
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  await writeState(packageId, ctx.userId, ctx.stateId, null);
  return new NextResponse(null, { status: 204, headers: CORS });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
