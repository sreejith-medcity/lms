import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site-glass flex min-h-dvh flex-col bg-[var(--canvas)]">
      {/* The backdrop the glass frosts: three slow blobs in the academy's colours. */}
      <div className="site-backdrop" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50
          focus:rounded-[var(--radius-sm)] focus:bg-[var(--surface)] focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
