import { NextResponse } from 'next/server';

/** One shape for every answer, so the app has one place to look. */
export function ok<T>(data: T, init?: { status?: number; headers?: Record<string, string> }): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: init?.status ?? 200, headers: { 'Cache-Control': 'private, no-store', ...(init?.headers ?? {}) } });
}

export function fail(code: string, message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, ...(extra ?? {}) } }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export { limited } from './limiter';

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
