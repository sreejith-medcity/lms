'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
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
      className="relative"
    >
      <label htmlFor="site-search" className="sr-only">
        Search courses
      </label>
      <svg
        aria-hidden
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-3)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.2-3.2" strokeLinecap="round" />
      </svg>
      <input
        id="site-search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search courses"
        className="h-9 w-52 rounded-full border bg-[var(--surface)] pl-9 pr-3 text-sm
          placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline-none
          focus:ring-4 focus:ring-[var(--brand-soft)] lg:w-60"
      />
    </form>
  );
}

export function MobileMenu({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border bg-[var(--surface)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open && (
        <div className="absolute inset-x-0 top-16 border-b bg-[var(--surface)] shadow-lg">
          <nav className="mx-auto flex max-w-6xl flex-col p-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-sm)] px-3 py-2.5 text-sm hover:bg-[var(--surface-2)]"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 border-t pt-3">
              <SearchBox />
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
