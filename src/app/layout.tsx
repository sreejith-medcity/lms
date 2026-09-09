import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { getTenantContext } from '@/lib/tenant';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Medcity LMS',
  description: 'Learning platform',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();

  // The tenant's accent is injected here and nowhere else, which is what makes
  // white labelling a data change rather than a rebuild.
  const themeVars = tenant
    ? ({ ['--brand' as string]: tenant.brandColor } as React.CSSProperties)
    : undefined;

  return (
    <html lang="en" className={sans.variable}>
      <body className="font-sans antialiased" style={themeVars}>
        {children}
      </body>
    </html>
  );
}
