import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { getTenantContext } from '@/lib/tenant';
import { getLocale } from '@/lib/i18n/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { trackingTags } from '@/lib/tracking-config';
import { Tracking } from '@/components/tracking';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
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
  const tags = tenant ? await trackingTags(tenant.organizationId) : {};

  // A paused or closed academy shows one page to everyone except the office,
  // who still need to sign in and settle the bill.
  if (tenant && (tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED')) {
    const path = (await headers()).get('x-pathname') ?? '/';
    const allowed = path === '/paused' || path.startsWith('/login') || path.startsWith('/logout') || path.startsWith('/admin') || path.startsWith('/api/') || path.startsWith('/platform');
    if (!allowed) redirect('/paused');
  }

  // The tenant's accent is injected here and nowhere else, which is what makes
  // white labelling a data change rather than a rebuild.
  const themeVars = tenant
    ? ({ ['--brand' as string]: tenant.brandColor } as React.CSSProperties)
    : undefined;

  return (
    <html lang={await getLocale()} className={sans.variable}>
      {tenant?.faviconUrl && (
        <head>
          <link rel="icon" href={tenant.faviconUrl} />
        </head>
      )}
      <body className="font-sans antialiased" style={themeVars}>
        {children}
        <Tracking tags={tags} />
      </body>
    </html>
  );
}
