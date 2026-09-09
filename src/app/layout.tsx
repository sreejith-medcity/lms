import type { Metadata } from 'next';
import './globals.css';
import { getTenantContext } from '@/lib/tenant';

export const metadata: Metadata = {
  title: 'Medcity LMS',
  description: 'Learning platform',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();

  return (
    <html lang="en">
      <body
        style={
          tenant
            ? ({ ['--brand' as string]: tenant.brandColor } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </body>
    </html>
  );
}
