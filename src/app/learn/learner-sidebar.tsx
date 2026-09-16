'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/components/i18n-provider';

/**
 * The learner's menu, down the left.
 *
 * Fifteen tabs across the top stopped fitting long before the fifteenth was
 * added, so the portal is a sidebar now, the way every course platform a
 * learner has used lays itself out. On a wide screen it can be folded to
 * its icons and the choice is remembered in the browser; on a lesson page
 * it arrives folded, because the video wants the room. On a phone it is a
 * drawer behind the menu button in the header.
 *
 * Nothing here decides access: a link is only a link, and the page it leads
 * to checks for itself.
 */

export interface SidebarItem {
  key: string;
  label: string;
  href: string;
}

const STORE = 'learner.nav.folded';

/** Sections of the portal that are not "My learning", so that link only lights up for the courses themselves. */
const SECTIONS = new Set(['community', 'wallet', 'book', 'purchases', 'fees', 'practice', 'account', 'assignments', 'calendar', 'notifications', 'revise', 'wishlist', 'help', 'badges', 'attempt', 'assessment', 'affiliate', 'invoices', 'receipts', 'shared']);

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return false;
  if (href === '/learn') {
    if (pathname === '/learn') return true;
    const first = pathname.split('/')[2] ?? '';
    return pathname.startsWith('/learn/') && !SECTIONS.has(first);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A lesson page: /learn/<course>/<material>, as opposed to a course's own overview, discussion, revision or search. */
function isLessonPage(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'learn') return false;
  if (SECTIONS.has(parts[1])) return false;
  return !['discussion', 'revise', 'search'].includes(parts[2]);
}

function readFolded(): boolean | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw === null ? null : raw === '1';
  } catch {
    return null;
  }
}

function writeFolded(folded: boolean) {
  try {
    localStorage.setItem(STORE, folded ? '1' : '0');
  } catch {
    /* a private window, or storage turned off: the menu still works, it just forgets */
  }
}

export function NavIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const path = ICONS[name] ?? ICONS.learning;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {path}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  learning: <><path d="M4 19V6a2 2 0 0 1 2-2h13v15" /><path d="M4 19a2 2 0 0 0 2 2h13" /><path d="M9 8h6" /></>,
  community: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M14.5 18.5A4.5 4.5 0 0 1 21 16" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12.5h5" /><circle cx="16.5" cy="12.5" r="0.6" fill="currentColor" /><path d="M3 9.5h18" /></>,
  'one-to-one': <><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M2.5 19a5.5 5.5 0 0 1 11 0" /><path d="M10.5 19a5.5 5.5 0 0 1 11 0" /></>,
  purchases: <><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  fees: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  practice: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>,
  assignments: <><path d="M9 4h6v3H9z" /><path d="M9 5.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5a2 2 0 0 0-2-2h-2" /><path d="m9 13 2 2 4-4" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  revise: <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></>,
  wishlist: <><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7" /><circle cx="12" cy="17" r="0.7" fill="currentColor" /></>,
  badges: <><circle cx="12" cy="9" r="5" /><path d="m8.5 13.5-2 7 5.5-2.5 5.5 2.5-2-7" /></>,
  account: <><circle cx="12" cy="8.5" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  explore: <><circle cx="12" cy="12" r="8.5" /><path d="m15 9-2 5-5 2 2-5 5-2Z" /></>,
  admin: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
};

function NavList({ items, folded, onNavigate }: { items: SidebarItem[]; folded: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/learn';
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={folded ? item.label : undefined}
              className={`flex items-center gap-3 rounded-[var(--radius-sm)] py-2 text-sm transition ${folded ? 'justify-center px-0' : 'px-3'} ${
                active ? 'bg-[var(--brand-soft)] font-semibold text-[var(--brand)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
              }`}
            >
              <NavIcon name={item.key} />
              {!folded && <span className="truncate">{item.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function withAdmin(items: SidebarItem[], isStaff: boolean, adminLabel: string): SidebarItem[] {
  return isStaff ? [...items, { key: 'admin', label: adminLabel, href: '/admin' }] : items;
}

/** The sidebar on a wide screen: folds to icons, remembers the choice, arrives folded on a lesson. */
export function LearnerSidebar({
  items,
  isStaff,
  brand,
  account,
}: {
  items: SidebarItem[];
  isStaff: boolean;
  /** The lockup for the top of the sidebar, and the mark shown when folded. */
  brand: { full: ReactNode; mark: ReactNode };
  /** The person at the bottom: avatar and name, linking to their account. */
  account: { avatar: ReactNode; name: string };
}) {
  const pathname = usePathname() ?? '/learn';
  const { t } = useT();
  const lesson = isLessonPage(pathname);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setChoice(readFolded());
    setHydrated(true);
  }, []);

  // A choice made by hand wins everywhere; without one, a lesson is the only page that folds.
  const folded = hydrated && choice !== null ? choice : lesson;
  const toggle = () => {
    const next = !folded;
    setChoice(next);
    writeFolded(next);
  };

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-[var(--surface)] transition-[width] duration-200 lg:flex ${folded ? 'w-[4.5rem]' : 'w-60'}`}
      aria-label={t('Menu')}
    >
      <div className={`flex h-14 shrink-0 items-center border-b ${folded ? 'justify-center' : 'px-5'}`}>
        <Link href="/learn" className="flex min-w-0 items-center" title={folded ? t('My learning') : undefined}>
          {folded ? brand.mark : brand.full}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <NavList items={withAdmin(items, isStaff, t('Admin'))} folded={folded} />
      </nav>

      <div className="shrink-0 border-t px-3 py-3">
        <Link
          href="/learn/account"
          title={t('Account')}
          className={`flex items-center gap-3 rounded-[var(--radius-sm)] py-1.5 hover:bg-[var(--surface-2)] ${folded ? 'justify-center px-0' : 'px-2'}`}
        >
          {account.avatar}
          {!folded && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{account.name}</span>
              <span className="block truncate text-xs text-[var(--ink-2)]">{t('Account')}</span>
            </span>
          )}
        </Link>
        <div className={`mt-1 flex items-center ${folded ? 'flex-col gap-1' : 'justify-between'}`}>
          <a
            href="/logout"
            title={t('Sign out')}
            className={`flex items-center gap-3 rounded-[var(--radius-sm)] py-1.5 text-sm text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] ${folded ? 'justify-center px-2' : 'px-2'}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden>
              <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M14 8l4 4-4 4M18 12H9" />
            </svg>
            {!folded && <span>{t('Sign out')}</span>}
          </a>
          <button
            type="button"
            onClick={toggle}
            aria-label={folded ? t('Expand menu') : t('Collapse menu')}
            title={folded ? t('Expand menu') : t('Collapse menu')}
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 transition-transform ${folded ? 'rotate-180' : ''}`} aria-hidden>
              <path d="m14 6-6 6 6 6" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

/** The same menu on a phone: a button in the header, a drawer from the left. */
export function LearnerMenu({ items, isStaff, brand, account }: { items: SidebarItem[]; isStaff: boolean; brand: ReactNode; account: { avatar: ReactNode; name: string } }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { t } = useT();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('Open menu')}
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t('Menu')}>
          <button type="button" aria-label={t('Close menu')} onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[var(--surface)] shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
              <span className="flex min-w-0 flex-1 items-center">{brand}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('Close menu')} className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <NavList items={withAdmin(items, isStaff, t('Admin'))} folded={false} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="shrink-0 border-t px-3 py-3">
              <Link href="/learn/account" className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--surface-2)]">
                {account.avatar}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{account.name}</span>
                  <span className="block truncate text-xs text-[var(--ink-2)]">{t('Account')}</span>
                </span>
              </Link>
              <a href="/logout" className="mt-1 flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden>
                  <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M14 8l4 4-4 4M18 12H9" />
                </svg>
                {t('Sign out')}
              </a>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
