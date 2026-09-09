import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { getSessionUser } from '@/lib/auth';
import { getSiteContext } from '@/lib/site';
import { MobileMenu, SearchBox } from '@/components/site-nav';

/**
 * The public shell. Deliberately quiet: one accent colour from the tenant's own
 * brand, generous space, and no decoration that does not carry information.
 */
export async function SiteHeader() {
  const [site, user] = await Promise.all([getSiteContext(), getSessionUser()]);
  if (!site) return null;

  const links = [
    { href: '/courses', label: 'Courses' },
    ...site.categories.slice(0, 4).map((c) => ({ href: `/courses/${c.slug}`, label: c.name })),
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-[var(--surface)]/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0 text-base font-semibold tracking-tight">
          {site.organization.name}
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--ink-2)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* useSearchParams needs a boundary so the header never blocks static rendering. */}
          <div className="hidden md:block">
            <Suspense fallback={<div className="h-9 w-52 rounded-full border bg-[var(--surface)] lg:w-60" />}>
              <SearchBox />
            </Suspense>
          </div>

          {user ? (
            <Link
              href={user.kind === 'STAFF' ? '/admin' : '/learn'}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] px-3.5 text-sm font-medium text-[var(--brand-ink)]"
              style={{ background: 'var(--brand)' }}
            >
              {user.kind === 'STAFF' ? 'Admin' : 'My learning'}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden h-9 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3.5 text-sm font-medium sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] px-3.5 text-sm font-medium text-[var(--brand-ink)]"
                style={{ background: 'var(--brand)' }}
              >
                Get started
              </Link>
            </>
          )}

          <Suspense>
            <MobileMenu links={links} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const site = await getSiteContext();
  if (!site) return null;

  const org = site.organization;
  const social = (org.social ?? {}) as Record<string, string | undefined>;
  const socialLinks = Object.entries(social).filter(([, v]) => Boolean(v));

  return (
    <footer className="mt-20 border-t bg-[var(--surface-2)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div>
          <p className="text-sm font-semibold">{org.name}</p>
          {(org.addressLine || org.city) && (
            <p className="t-small muted mt-2 leading-relaxed">
              {[org.addressLine, org.city, org.state, org.pincode].filter(Boolean).join(', ')}
            </p>
          )}
          {org.contactNumber && (
            <a href={`tel:${org.contactNumber}`} className="t-small muted mt-2 block hover:underline">
              {org.contactNumber}
            </a>
          )}
          {org.supportEmail && (
            <a href={`mailto:${org.supportEmail}`} className="t-small muted block hover:underline">
              {org.supportEmail}
            </a>
          )}
        </div>

        <FooterColumn title="Courses">
          {site.categories.map((c) => (
            <FooterLink key={c.slug} href={`/courses/${c.slug}`}>
              {c.name}
            </FooterLink>
          ))}
          <FooterLink href="/courses">All courses</FooterLink>
        </FooterColumn>

        <FooterColumn title="Academy">
          <FooterLink href="/about">About us</FooterLink>
          <FooterLink href="/contact">Contact</FooterLink>
          <FooterLink href="/help">Help centre</FooterLink>
          <FooterLink href="/login">Sign in</FooterLink>
        </FooterColumn>

        <FooterColumn title="Policies">
          <FooterLink href="/policies/terms">Terms of use</FooterLink>
          <FooterLink href="/policies/privacy">Privacy</FooterLink>
          <FooterLink href="/policies/refund">Refunds and cancellation</FooterLink>
        </FooterColumn>
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <p className="t-small faint">
            © {new Date().getFullYear()} {org.name}. All rights reserved.
          </p>
          {socialLinks.length > 0 && (
            <div className="flex gap-4">
              {socialLinks.map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="t-small muted capitalize hover:underline"
                >
                  {name}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="t-micro faint font-semibold uppercase tracking-wide">{title}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="t-small muted hover:text-[var(--ink)] hover:underline">
        {children}
      </Link>
    </li>
  );
}
