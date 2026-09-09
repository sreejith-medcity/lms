import Link from 'next/link';
import type { ReactNode } from 'react';

/** Split screen: brand on the left, the form on the right. */
export function AuthShell({
  orgName,
  title,
  subtitle,
  children,
  footer,
}: {
  orgName: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[var(--shell)] p-10 text-[var(--shell-ink)] lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full opacity-25 blur-3xl"
          style={{ background: 'var(--brand)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full opacity-15 blur-3xl"
          style={{ background: 'var(--brand)' }}
        />

        <Link href="/" className="relative flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-sm font-bold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {orgName.slice(0, 1)}
          </span>
          <span className="font-semibold">{orgName}</span>
        </Link>

        <div className="relative max-w-md">
          <p className="text-2xl font-semibold leading-snug tracking-tight">
            Classes, materials, tests and progress. In one place, on any device.
          </p>
          <p className="mt-3 text-sm text-[var(--shell-muted)]">
            Live sessions with attendance, recordings you can revisit, and a clear view of how far
            you have come.
          </p>
        </div>

        <p className="relative text-xs text-[var(--shell-muted)]">
          © {new Date().getFullYear()} {orgName}
        </p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="t-title">{title}</h1>
          <p className="t-small muted mt-1">{subtitle}</p>
          {children}
          {footer && <div className="t-small muted mt-6">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
