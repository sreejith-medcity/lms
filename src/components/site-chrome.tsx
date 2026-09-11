import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { BrandLockup } from '@/components/brand-lockup';
import { exploreMenu, getSiteContext } from '@/lib/site';
import { AccountButtons, ExploreMenu, MobileMenu, MobileSearch, SearchBox } from '@/components/site-nav';
import { CartLink } from '@/components/cart-link';

/**
 * The public shell, in the shape people already know from the big course
 * marketplaces: a white bar with the logo, an Explore menu, one wide search
 * box, the cart and the account; a strip of subjects under it on a desktop;
 * a dark footer in the academy's own colour.
 *
 * Nothing about who is looking is rendered on the server. The account
 * buttons and the cart badge decide themselves in the browser, which is
 * what lets a CDN hold every public page.
 */
export async function SiteHeader() {
  const site = await getSiteContext();
  if (!site) return null;

  const categories = await exploreMenu(site.organizationId);
  const links = [
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[var(--surface)] shadow-[0_1px_0_var(--line),0_2px_8px_rgb(50_32_70/0.06)]">
      <div className="relative mx-auto flex h-[4.25rem] max-w-[90rem] items-center gap-3 px-4 sm:px-6">
        <Suspense>
          <MobileMenu categories={categories} links={links} />
        </Suspense>

        <Link href="/" className="min-w-0 flex-1 truncate md:flex-none">
          <BrandLockup name={site.organization.name} logoUrl={site.organization.logoUrl} height={32} className="max-w-full truncate" />
        </Link>

        <ExploreMenu categories={categories} />

        <div className="hidden min-w-0 flex-1 md:block">
          <Suspense fallback={<div className="h-11 w-full rounded-full border bg-[var(--surface-2)]" />}>
            <SearchBox />
          </Suspense>
        </div>

        <nav className="hidden items-center gap-1 xl:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--ink-2)] transition hover:text-[var(--brand)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <Suspense>
            <MobileSearch />
          </Suspense>
          <CartLink />
          <div className="hidden sm:block">
            <AccountButtons />
          </div>
        </div>
      </div>

      {/* The subject strip. On a desktop it is the second row of the header,
          the way a bookshop has its sections written over the aisles. */}
      {categories.length > 0 && (
        <div className="hidden border-t lg:block">
          <nav aria-label="Subjects" className="mx-auto flex max-w-[90rem] items-center gap-1 overflow-x-auto px-4 sm:px-6">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/courses/${c.slug}`}
                className="whitespace-nowrap px-3 py-2.5 text-[0.8125rem] text-[var(--ink-2)] transition hover:text-[var(--brand)]"
              >
                {c.name}
              </Link>
            ))}
          </nav>
        </div>
      )}
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
    <footer className="mt-20 text-[var(--shell-ink)]" style={{ background: 'var(--shell)' }}>
      <div className="mx-auto grid max-w-[90rem] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <p className="text-lg font-bold">{org.name}</p>
          {(org.addressLine || org.city) && (
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--shell-muted)]">
              {[org.addressLine, org.city, org.state, org.pincode].filter(Boolean).join(', ')}
            </p>
          )}
          <div className="mt-3 space-y-1">
            {org.contactNumber && (
              <a href={`tel:${org.contactNumber}`} className="block text-sm text-[var(--shell-muted)] hover:text-[var(--shell-ink)]">
                {org.contactNumber}
              </a>
            )}
            {org.supportEmail && (
              <a href={`mailto:${org.supportEmail}`} className="block text-sm text-[var(--shell-muted)] hover:text-[var(--shell-ink)]">
                {org.supportEmail}
              </a>
            )}
          </div>
          {socialLinks.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {socialLinks.map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-full border border-[var(--shell-line)] px-3 py-1 text-xs font-medium capitalize text-[var(--shell-muted)] transition hover:border-[var(--shell-ink)] hover:text-[var(--shell-ink)]"
                >
                  {name}
                </a>
              ))}
            </div>
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
          <FooterLink href="/blog">Notes</FooterLink>
          <FooterLink href="/help">Help centre</FooterLink>
          <FooterLink href="/login">Sign in</FooterLink>
        </FooterColumn>

        <FooterColumn title="Policies">
          <FooterLink href="/policies/terms">Terms of use</FooterLink>
          <FooterLink href="/policies/privacy">Privacy</FooterLink>
          <FooterLink href="/policies/refund">Refunds and cancellation</FooterLink>
        </FooterColumn>
      </div>

      <div className="border-t border-[var(--shell-line)]">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <p className="text-xs text-[var(--shell-muted)]">
            © {new Date().getFullYear()} {org.name}. All rights reserved.
          </p>
          <p className="text-xs text-[var(--shell-muted)]">Prices in INR, before applicable taxes.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--shell-muted)]">{title}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-sm text-[var(--shell-ink)]/90 hover:underline">
        {children}
      </Link>
    </li>
  );
}
