'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ADMIN_NAV, NavIcon, type NavGroup } from '@/components/admin-nav-data';

/**
 * The admin menu, folded.
 *
 * Fifty entries in eight groups do not fit on one screen, and a menu that
 * has to be scrolled to find Settings is a menu people stop reading. So a
 * group opens when it is clicked, the group holding the current page is
 * open on arrival, and which groups a person leaves open is remembered in
 * their own browser. Nothing here decides access; a link is only ever a
 * link, and the page it leads to checks for itself.
 */

const STORE = 'admin.nav.open';

function readOpen(): string[] | null {
  try {
    const raw = localStorage.getItem(STORE);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function writeOpen(open: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(open));
  } catch {
    /* a private window, or storage turned off: the menu still works, it just forgets */
  }
}

/** The group whose child is the current page, by the longest matching href. */
function groupFor(pathname: string, groups: NavGroup[]): string | null {
  let best: { label: string; len: number } | null = null;
  for (const g of groups) {
    for (const c of g.children ?? []) {
      if (c.soon) continue;
      const hit = pathname === c.href || pathname.startsWith(`${c.href}/`);
      if (hit && (!best || c.href.length > best.len)) best = { label: g.label, len: c.href.length };
    }
  }
  return best?.label ?? null;
}

function isCurrent(pathname: string, href: string, all: NavGroup[]): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  // /admin/settings must not light up for /admin/settings/roles when the
  // roles link exists; the longer match wins.
  const longer = all.flatMap((g) => (g.children ?? []).map((c) => c.href)).concat(all.map((g) => g.href ?? '')).filter((h) => h && h !== href && h.length > href.length && (pathname === h || pathname.startsWith(`${h}/`)));
  return longer.length === 0;
}

export function SidebarNav({ features, onNavigate }: { features: Record<string, boolean>; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  const current = groupFor(pathname, ADMIN_NAV);
  const [open, setOpen] = useState<string[]>(() => (current ? [current] : []));
  const [hydrated, setHydrated] = useState(false);

  // Remembered groups, plus whichever group the page arrived in.
  useEffect(() => {
    const stored = readOpen();
    setOpen((now) => {
      const base = stored ?? now;
      return current && !base.includes(current) ? [...base, current] : base;
    });
    setHydrated(true);
  }, [current]);

  useEffect(() => {
    if (hydrated) writeOpen(open);
  }, [open, hydrated]);

  const toggle = (label: string) => setOpen((now) => (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]));

  return (
    <ul className="space-y-1">
      {ADMIN_NAV.map((group) => {
        const children = (group.children ?? []).filter((c) => !c.feature || features[c.feature] !== false);
        const active = group.href ? isCurrent(pathname, group.href, ADMIN_NAV) : current === group.label;
        const isOpen = open.includes(group.label);

        if (group.href) {
          return (
            <li key={group.label}>
              <Link
                href={group.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm ${active ? 'bg-[var(--shell-2)] text-[var(--shell-ink)]' : 'text-[var(--shell-ink)] hover:bg-[var(--shell-2)]'}`}
              >
                <NavIcon name={group.icon} />
                {group.label}
              </Link>
            </li>
          );
        }

        return (
          <li key={group.label}>
            <button
              type="button"
              onClick={() => toggle(group.label)}
              aria-expanded={isOpen}
              className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm ${active ? 'text-[var(--shell-ink)]' : 'text-[var(--shell-ink)]/85'} hover:bg-[var(--shell-2)]`}
            >
              <NavIcon name={group.icon} />
              <span className="flex-1">{group.label}</span>
              {active && !isOpen && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-3.5 w-3.5 shrink-0 text-[var(--shell-muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden>
                <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {isOpen && (
              <ul className="mt-0.5 space-y-0.5 pb-1">
                {children.map((c) =>
                  c.soon ? (
                    <li key={`${group.label}-${c.label}`}>
                      <span aria-disabled="true" title="Not built yet" className="flex cursor-default items-center justify-between gap-2 rounded-[var(--radius-sm)] py-1.5 pl-9 pr-2.5 text-sm text-[var(--shell-muted)] opacity-55">
                        {c.label}
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--shell-muted)]" />
                        <span className="sr-only">not built yet</span>
                      </span>
                    </li>
                  ) : (
                    <li key={c.href}>
                      <Link
                        href={c.href}
                        onClick={onNavigate}
                        aria-current={isCurrent(pathname, c.href, ADMIN_NAV) ? 'page' : undefined}
                        className={`block rounded-[var(--radius-sm)] py-1.5 pl-9 pr-2.5 text-sm ${
                          isCurrent(pathname, c.href, ADMIN_NAV) ? 'bg-[var(--shell-2)] font-medium text-[var(--shell-ink)]' : 'text-[var(--shell-muted)] hover:bg-[var(--shell-2)] hover:text-[var(--shell-ink)]'
                        }`}
                      >
                        {c.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The same menu on a phone, behind a button in the header. */
export function MobileAdminNav({ features, orgName }: { features: Record<string, boolean>; orgName: string }) {
  const [openMenu, setOpenMenu] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpenMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [openMenu]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenMenu(true)}
        aria-label="Open menu"
        aria-expanded={openMenu}
        className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>

      {openMenu && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" onClick={() => setOpenMenu(false)} className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[var(--shell)] text-[var(--shell-ink)] shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-[var(--shell-line)] px-4">
              <span className="truncate text-sm font-semibold">{orgName}</span>
              <button type="button" onClick={() => setOpenMenu(false)} aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] hover:bg-[var(--shell-2)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <SidebarNav features={features} onNavigate={() => setOpenMenu(false)} />
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
