/**
 * Header names shared between middleware and server components.
 *
 * These live apart from tenant.ts on purpose: middleware runs on the edge
 * runtime, and importing tenant.ts would drag the Prisma client in with it.
 */
export const TENANT_HEADER = 'x-tenant-id';
export const HOST_HEADER = 'x-tenant-host';

/**
 * A redirect that does not guess where the site lives.
 *
 * `NextResponse.redirect(new URL(path, request.url))` looks right and is a
 * trap behind a reverse proxy: `request.url` is the address the Node process
 * was reached on, not the address the visitor typed. On this deployment that
 * is the bind address, so every one of those redirects was sending browsers
 * to https://0.0.0.0:3000, which is what broke course artwork. The image was
 * allowed, found and signed correctly, and then the browser was pointed at a
 * machine that does not exist.
 *
 * Relative is the fix rather than a better guess. HTTP has always allowed a
 * relative Location and the browser resolves it against the URL it actually
 * asked for, which is by definition the right one. Nothing to configure, and
 * no header to get wrong.
 *
 * An absolute target, such as a presigned bucket URL or an identity
 * provider's authorize endpoint, is passed through untouched.
 */
export function redirectResponse(
  target: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(null, {
    status: init.status ?? 302,
    headers: { ...init.headers, Location: target },
  });
}

/**
 * The origin the outside world used to reach us.
 *
 * `request.url` behind a reverse proxy is the address the Node process
 * listens on, which on shared hosting is `https://0.0.0.0:3000`, and a
 * redirect URL built from that is refused by every OAuth provider. The
 * proxy says where the request really came from in the forwarded headers,
 * and the Host header is the next best thing; the process address is only
 * for a bare local run.
 */
export function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host')?.trim();
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    (host && /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(host) ? 'http' : 'https');
  if (host && !/^0\.0\.0\.0(:|$)/.test(host)) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
