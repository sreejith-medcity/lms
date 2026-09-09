/**
 * Shown when the app is up but the tenant behind this hostname is not usable.
 * These say what is actually wrong, because an error digest helps nobody.
 */
export function SetupNotice({ detail }: { detail: string }) {
  return (
    <Shell title="Database not ready">
      <p>The app is running, but it cannot use its database yet. Usually one of:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code>DATABASE_URL</code> is still a placeholder, or the password needs percent-encoding
        </li>
        <li>
          <code>?sslmode=require</code> is missing from the connection string
        </li>
        <li>
          The schema has not been created: run <code>npm run db:push</code> then{' '}
          <code>npm run db:seed</code>
        </li>
      </ul>
      <p className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 font-mono text-xs">{detail}</p>
    </Shell>
  );
}

export function NoTenantNotice() {
  return (
    <Shell title="No academy on this hostname">
      <p>
        The database is reachable, but no tenant matches this address. Add the hostname as a
        TenantDomain row, or set <code>APP_HOSTNAME</code> and run the seed again.
      </p>
    </Shell>
  );
}
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="t-title">{title}</h1>
      <div className="t-body muted mt-4 space-y-3">{children}</div>
    </main>
  );
}
