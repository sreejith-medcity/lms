'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ExploreCategory } from '@/lib/site';
import { readWhoFromDocument, type Who } from '@/lib/who-cookie';

/**
 * The parts of the public header that need a browser: the search box, the
 * Explore menu that opens on hover, and the drawer a phone gets instead.
 * All of it renders the same HTML for every visitor, so the pages around it
 * stay cacheable; only the account row reads a cookie, after the fact.
 */

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" strokeLinecap="round" />
    </svg>
  );
}

export function SearchBox({ autoFocus = false, size = 'md' }: { autoFocus?: boolean; size?: 'md' | 'lg' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        router.push(q ? `/courses?q=${encodeURIComponent(q)}` : '/courses');
      }}
      className="relative w-full"
    >
      <label htmlFor="site-search" className="sr-only">
        Search courses
      </label>
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" />
      <input
        id="site-search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search for a course, an exam or a language"
        className={`w-full rounded-full border border-[var(--line-strong)] bg-[var(--surface-2)] pl-11 pr-4 text-sm
          placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:bg-[var(--surface)] focus:outline-none
          focus:ring-4 focus:ring-[var(--brand-soft)] ${size === 'lg' ? 'h-12' : 'h-11'}`}
      />
    </form>
  );
}

/**
 * Subjects on the left, the hovered subject's courses on the right. Opens on
 * hover with a short grace so a diagonal move to the right column does not
 * close it, and on click or keyboard for everyone else.
 */
export function ExploreMenu({ categories }: { categories: ExploreCategory[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const closeTimer = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (categories.length === 0) return null;
  const current = categories[Math.min(active, categories.length - 1)];

  return (
    <div
      ref={root}
      className="relative hidden lg:block"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-sm font-medium transition
          hover:text-[var(--brand)] ${open ? 'text-[var(--brand)]' : 'text-[var(--ink)]'}`}
      >
        Explore
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 flex w-[44rem] overflow-hidden rounded-[var(--radius)] border
            bg-[var(--surface)] shadow-[var(--shadow)]"
          role="menu"
        >
          <ul className="w-64 border-r bg-[var(--canvas)] py-2">
            {categories.map((c, i) => (
              <li key={c.slug}>
                <Link
                  href={`/courses/${c.slug}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setOpen(false)}
                  className={`flex items-center justify-between px-4 py-2.5 text-sm transition
                    ${i === active ? 'bg-[var(--surface)] font-semibold text-[var(--brand)]' : 'text-[var(--ink)] hover:bg-[var(--surface)]'}`}
                >
                  <span>{c.name}</span>
                  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t px-4 pt-2.5">
              <Link href="/courses" onClick={() => setOpen(false)} className="text-sm font-semibold text-[var(--brand)] hover:underline">
                All courses
              </Link>
            </li>
          </ul>

          <div className="flex-1 px-5 py-4">
            <p className="t-eyebrow" style={{ color: 'var(--ink-3)' }}>
              {current.name}
            </p>
            <ul className="mt-2 space-y-0.5">
              {current.courses.map((course) => (
                <li key={course.slug}>
                  <Link
                    href={`/course/${course.slug}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-[var(--radius-sm)] px-2 py-2 text-sm hover:bg-[var(--surface-2)] hover:text-[var(--brand)]"
                  >
                    {course.title}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={`/courses/${current.slug}`}
              onClick={() => setOpen(false)}
              className="mt-3 inline-block text-sm font-semibold text-[var(--brand)] hover:underline"
            >
              All {current.name} courses ({current.count})
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sign in / sign up, or My learning, decided in the browser from a cookie. */
export function AccountButtons() {
  const [who, setWho] = useState<Who | null | undefined>(undefined);
  useEffect(() => {
    setWho(readWhoFromDocument(document.cookie));
  }, []);

  if (who === undefined) return <div className="h-10 w-[11rem]" aria-hidden="true" />;

  if (who) {
    return (
      <Link
        href={who === 'staff' ? '/admin' : '/learn'}
        className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]"
        style={{ background: 'var(--brand)' }}
      >
        {who === 'staff' ? 'Admin' : 'My learning'}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-[var(--ink)] px-4 text-sm font-semibold
          transition hover:bg-[var(--surface-2)]"
      >
        Log in
      </Link>
      <Link
        href="/signup"
        className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]
          transition hover:brightness-110"
        style={{ background: 'var(--brand)' }}
      >
        Sign up
      </Link>
    </div>
  );
}

/**
 * The phone gets a drawer: search on top, subjects as an accordion, then the
 * plain links and the account buttons. It is the whole menu, not a
 * cut-down one, because the phone is where most visitors are.
 */
export function MobileMenu({
  categories,
  links,
}: {
  categories: ExploreCategory[];
  links: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)]"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 top-[4.25rem] z-50 bg-black/30" onClick={() => setOpen(false)}>
          <nav
            className="h-full w-[86%] max-w-sm overflow-y-auto bg-[var(--surface)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            aria-label="Menu"
          >
            <div className="border-b p-4">
              <SearchBox />
            </div>

            <div className="p-2">
              <p className="t-eyebrow px-3 pb-1 pt-2" style={{ color: 'var(--ink-3)' }}>
                Subjects
              </p>
              {categories.map((c) => {
                const isOpen = expanded === c.slug;
                return (
                  <div key={c.slug}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : c.slug)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-3 py-2.5 text-left text-sm font-medium hover:bg-[var(--surface-2)]"
                    >
                      {c.name}
                      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition ${isOpen ? 'rotate-180' : ''}`}>
                        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {isOpen && (
                      <ul className="mb-1 ml-3 border-l pl-3">
                        {c.courses.map((course) => (
                          <li key={course.slug}>
                            <Link href={`/course/${course.slug}`} onClick={() => setOpen(false)} className="block py-2 text-sm muted hover:text-[var(--brand)]">
                              {course.title}
                            </Link>
                          </li>
                        ))}
                        <li>
                          <Link href={`/courses/${c.slug}`} onClick={() => setOpen(false)} className="block py-2 text-sm font-semibold text-[var(--brand)]">
                            All {c.name} courses
                          </Link>
                        </li>
                      </ul>
                    )}
                  </div>
                );
              })}
              <Link href="/courses" onClick={() => setOpen(false)} className="block rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-semibold text-[var(--brand)] hover:bg-[var(--surface-2)]">
                All courses
              </Link>
            </div>

            <div className="border-t p-2">
              {links.map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-[var(--radius-sm)] px-3 py-2.5 text-sm hover:bg-[var(--surface-2)]">
                  {l.label}
                </Link>
              ))}
            </div>

            <div className="border-t p-4">
              <AccountButtons />
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}

/** On a phone the search box lives behind an icon so the logo has room. */
export function MobileSearch() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? 'Close search' : 'Search'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)]"
      >
        <SearchIcon />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full border-b bg-[var(--surface)] p-3 shadow-lg">
          <SearchBox autoFocus />
        </div>
      )}
    </div>
  );
}
