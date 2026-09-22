import type { PrismaClient } from '@prisma/client';

/**
 * Every query tells Postgres who is asking.
 *
 * The policies in `prisma/rls.sql` read `current_setting('app.scope')`.
 * A setting only lives for one transaction (`set_config(..., true)`), and
 * Prisma hands each query to whichever pooled connection is free, so the
 * setting has to travel with the query: a lone query is wrapped in a
 * two-statement batch transaction (set the scope, run the query), and a
 * transaction the code opened itself gets the scope as its first
 * statement. That is the pattern Prisma documents for row-level security;
 * what it leaves out is that a query already inside a transaction must not
 * be wrapped again, which is what the transaction check below is for.
 *
 * Nothing here knows about Next.js or the tenant: the resolver is handed
 * in, so the same wiring runs in a test against a bare Postgres.
 *
 * Off (`enabled()` false), the client is returned as it was: no scope, no
 * extra round trips. On, without the policies applied, the scope is set
 * and ignored, which is the safe order to switch it on in: code first,
 * policies second, `prisma/rls-off.sql` if anything goes wrong.
 */
export interface RowScopeOptions {
  enabled: () => boolean;
  /** The `app.scope` value for the query about to run. */
  resolve: () => Promise<string>;
}

type AnyOperation = {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
  __internalParams?: { transaction?: unknown };
};

export function withRowScope(base: PrismaClient, options: RowScopeOptions): PrismaClient {
  const { enabled, resolve } = options;

  const extended = base.$extends({
    query: {
      async $allOperations(params) {
        const { args, query, __internalParams } = params as unknown as AnyOperation;
        if (!enabled()) return query(args);
        // Inside a transaction the scope was set by the wrapper below, and
        // a batch started here would run on another connection anyway.
        if (__internalParams?.transaction) return query(args);
        const scope = await resolve();
        const [, result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.scope', ${scope}, true)`,
          query(args) as never,
        ]);
        return result;
      },
    },
  });

  type Interactive = (tx: unknown) => Promise<unknown>;
  type TransactionArg = Interactive | Array<Promise<unknown>>;

  async function transaction(arg: TransactionArg, opts?: unknown): Promise<unknown> {
    const run = (a: unknown, o?: unknown) =>
      (extended.$transaction as unknown as (a: unknown, o?: unknown) => Promise<unknown>).call(extended, a, o);
    if (!enabled()) return run(arg, opts);
    const scope = await resolve();
    if (typeof arg === 'function') {
      return run(async (tx: { $executeRaw: PrismaClient['$executeRaw'] }) => {
        await tx.$executeRaw`SELECT set_config('app.scope', ${scope}, true)`;
        return arg(tx);
      }, opts);
    }
    const rows = (await run([extended.$executeRaw`SELECT set_config('app.scope', ${scope}, true)`, ...arg], opts)) as unknown[];
    return rows.slice(1);
  }

  return new Proxy(extended, {
    get(target, prop) {
      if (prop === '$transaction') return transaction;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as PrismaClient;
}
