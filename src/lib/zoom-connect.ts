import { db } from '@/lib/db';
import { open, seal } from '@/lib/secrets';
import type { Prisma } from '@prisma/client';

/**
 * The sign-in way into Zoom.
 *
 * A server to server app is better and needs an admin on the Zoom account.
 * Where the academy cannot get one, somebody signs in instead and Zoom hands
 * back a refresh token, which is stored sealed beside the other credentials.
 *
 * The rotation is the part that has to be right. Zoom retires a refresh token
 * the moment it is used and returns a replacement, so every renewal writes the
 * new one back. A cached copy in a running process is how this integration
 * appears to work and then dies the first time two requests renew at once, so
 * the current token is always read from the row rather than from memory.
 */

export const ZOOM_SCOPES = [
  'meeting:write:admin',
  'meeting:read:admin',
  'user:read:admin',
  'recording:read:admin',
];

/** Where Zoom sends the browser back. It must match the app's redirect URL exactly. */
export function zoomRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/integrations/zoom/callback`;
}

export function zoomAuthoriseUrl(input: {
  clientId: string;
  origin: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: zoomRedirectUri(input.origin),
    state: input.state,
  });
  return `https://zoom.us/oauth/authorize?${params.toString()}`;
}

async function credentialsOf(organizationId: string): Promise<Record<string, unknown>> {
  const row = await db.integration.findFirst({
    where: { organizationId, provider: 'zoom' },
    select: { credentials: true },
  });
  return (row?.credentials ?? {}) as Record<string, unknown>;
}

/**
 * The refresh token as it stands in the database right now.
 *
 * Falls back to whatever the caller resolved, which covers the first use
 * after a connection and the case where the value came from the environment.
 */
export async function currentRefreshToken(
  organizationId: string,
  fallback: string,
): Promise<string> {
  const stored = await credentialsOf(organizationId);
  const raw = stored.refreshToken;
  if (typeof raw !== 'string' || !raw) return fallback;
  return open(raw) ?? fallback;
}

export async function storeRefreshToken(organizationId: string, token: string): Promise<void> {
  const stored = await credentialsOf(organizationId);

  await db.integration.updateMany({
    where: { organizationId, provider: 'zoom' },
    data: {
      credentials: { ...stored, refreshToken: seal(token) } as Prisma.InputJsonValue,
    },
  });
}

/** Everything the connection needs, written in one go after a successful sign-in. */
export async function saveZoomConnection(input: {
  organizationId: string;
  refreshToken: string;
  connectedAs: string;
}): Promise<void> {
  const stored = await credentialsOf(input.organizationId);

  const credentials = {
    ...stored,
    refreshToken: seal(input.refreshToken),
    connectedAs: input.connectedAs,
  } as Prisma.InputJsonValue;

  const existing = await db.integration.findFirst({
    where: { organizationId: input.organizationId, provider: 'zoom' },
    select: { id: true },
  });

  if (existing) {
    await db.integration.update({
      where: { id: existing.id },
      data: { credentials, isConnected: true, connectedAt: new Date() },
    });
    return;
  }

  await db.integration.create({
    data: {
      organizationId: input.organizationId,
      provider: 'zoom',
      category: 'meeting',
      credentials,
      isConnected: true,
      connectedAt: new Date(),
    },
  });
}
