import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who a database query is allowed to see.
 *
 * Row-level security in Postgres (`prisma/rls.sql`) hides every row that
 * does not belong to the academy named in the connection's `app.scope`
 * setting. The setting is written by `src/lib/db-rls.ts` at the start of
 * every query and every transaction, from the scope resolved here:
 *
 *   tenant:<organizationId>  a request on an academy's host, or code
 *                            wrapped in `runAsOrganization`
 *   platform                 the platform console, the cron jobs, scripts
 *                            and tests, or code wrapped in `runAsPlatform`
 *   none                     a request on a host that is nobody's: nothing
 *                            is visible
 *
 * The scope is a second line behind the audit in `tenant-audit.ts`, which
 * checks that every query names the academy in code. The audit catches the
 * query that forgot; the scope catches the one the audit was told to
 * excuse, the raw SQL, and the bug nobody has written yet.
 */
export type DbScope =
  | { kind: 'platform' }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'none' };

const store = new AsyncLocalStorage<DbScope>();

/** Work that legitimately spans academies: the cron loops, the console, provisioning. */
export function runAsPlatform<T>(work: () => Promise<T>): Promise<T> {
  return store.run({ kind: 'platform' }, work);
}

/** Work on behalf of one academy from code that has no request (a cron loop's body). */
export function runAsOrganization<T>(organizationId: string, work: () => Promise<T>): Promise<T> {
  return store.run({ kind: 'organization', organizationId }, work);
}

/** The scope some caller set explicitly, if any; the request decides otherwise. */
export function explicitScope(): DbScope | undefined {
  return store.getStore();
}

/** The value written to `app.scope`, read back by the policies in `prisma/rls.sql`. */
export function scopeSetting(scope: DbScope): string {
  switch (scope.kind) {
    case 'platform':
      return 'platform';
    case 'organization':
      return `tenant:${scope.organizationId}`;
    default:
      return 'none';
  }
}
