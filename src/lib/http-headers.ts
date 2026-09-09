/**
 * Header names shared between middleware and server components.
 *
 * These live apart from tenant.ts on purpose: middleware runs on the edge
 * runtime, and importing tenant.ts would drag the Prisma client in with it.
 */
export const TENANT_HEADER = 'x-tenant-id';
export const HOST_HEADER = 'x-tenant-host';
