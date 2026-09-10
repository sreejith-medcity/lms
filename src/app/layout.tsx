import type { Metadata } from 'next';
import { Caveat, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { getTenantContext } from '@/lib/tenant';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

/**
 * One handwriting face, for the phrase beside the hero photograph and
 * nothing else. It is loaded here rather than linked from a stylesheet so it
 * is self-hosted with the rest: a Google Fonts link on every page is a third
 * party watching every visitor arrive.
 */
const script = Caveat({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
  variable: '--font-script',
});

/**
 * A template, so every page's own title reads naturally and none of them has to
 * repeat the academy's name. Pages that set their own full title override it.
 */
export const metadata: Metadata = {
  title: { default: 'Medcity LMS', template: '%s · Medcity LMS' },
  description: 'Courses, live classes and exam preparation.',
  formatDetection: { telephone: false },
};

/**
 * The tab icon.
 *
 * `src/app/icon.png` is served automatically as the default, which is what a
 * fresh deployment falls back to. An academy that sets its own favicon in
 * settings overrides it here, per request, so a tenant's tab is theirs.
 */
export async function generateViewport() {
  return { themeColor: '#322046' };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();

  // The tenant's accent is injected here and nowhere else, which is what makes
  // white labelling a data change rather than a rebuild.
  const themeVars = tenant
    ? ({ ['--brand' as string]: tenant.brandColor } as React.CSSProperties)
    : undefined;

  return (
    <html lang="en" className={`${sans.variable} ${script.variable}`}>
      {tenant?.faviconUrl && (
        <head>
          <link rel="icon" href={tenant.faviconUrl} />
        </head>
      )}
      <body className="font-sans antialiased" style={themeVars}>
        {children}
      </body>
    </html>
  );
}
