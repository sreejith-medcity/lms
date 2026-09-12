import { SidebarNav } from '@/components/admin-nav';

export { ADMIN_NAV, NavIcon, type NavChild, type NavGroup } from '@/components/admin-nav-data';

/**
 * The square mark that goes with a lockup, where we shipped one.
 *
 * Only the bundled artwork can be swapped like this, because only for that do
 * we know a mark exists. An academy's own upload is used as it is.
 */
function markFor(logoUrl: string): string {
  return logoUrl === '/brand/logo.png' ? '/brand/mark.png' : logoUrl;
}

export function Sidebar({
  features,
  orgName,
  logoUrl = null,
}: {
  features: Record<string, boolean>;
  orgName: string;
  logoUrl?: string | null;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-[var(--shell)] text-[var(--shell-ink)] lg:flex">
      <div className="flex h-14 items-center gap-2 border-b border-[var(--shell-line)] px-5">
        {logoUrl ? (
          <>
            {/*
              The mark rather than the full lockup, and the name set in the
              shell's own ink beside it.

              A full-colour logo on a dark sidebar is a coin toss: Medcity's
              wordmark is the same purple as this shell, so it was rendering
              invisibly and only the amber mark showed. Nothing can be assumed
              about a tenant's artwork either, so the readable part of this is
              text we control, and the logo is reduced to the piece that stays
              legible on any background.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={markFor(logoUrl)}
              alt=""
              aria-hidden="true"
              className="h-7 w-7 shrink-0 object-contain"
            />
            <span className="truncate text-sm font-semibold">{orgName}</span>
          </>
        ) : (
          <>
            <span
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-xs font-bold"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {orgName.slice(0, 1)}
            </span>
            <span className="truncate text-sm font-semibold">{orgName}</span>
          </>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav features={features} />
      </nav>

      <div className="border-t border-[var(--shell-line)] px-5 py-3">
        <p className="flex items-center gap-2 text-[0.6875rem] text-[var(--shell-muted)]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--shell-muted)]" />
          Dimmed items are not built yet
        </p>
      </div>
    </aside>
  );
}
