import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { EnquiryForm } from './form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  return {
    title: site ? `Contact ${site.organization.name}` : 'Contact',
    description: 'Ask about a course, a batch date or an admission.',
    alternates: { canonical: '/contact' },
  };
}

export default async function ContactPage() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const org = site.organization;

  const [courses, branches] = await Promise.all([
    db.product.findMany({
      where: { organizationId: site.organizationId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
    db.branch.findMany({
      where: { organizationId: site.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, addressLine: true, city: true, state: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Talk to us</h1>
      <p className="t-small muted mt-1 max-w-prose">
        Tell us what you are trying to do and we will point you at the right course and batch.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <EnquiryForm courses={courses} />

        <aside className="space-y-5">
          <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5">
            <p className="text-sm font-semibold">Reach us directly</p>
            <div className="t-small muted mt-3 space-y-2">
              {org.contactNumber && (
                <p>
                  <a href={`tel:${org.contactNumber}`} className="hover:underline">
                    {org.contactNumber}
                  </a>
                </p>
              )}
              {org.supportEmail && (
                <p>
                  <a href={`mailto:${org.supportEmail}`} className="hover:underline">
                    {org.supportEmail}
                  </a>
                </p>
              )}
              {[org.addressLine, org.city, org.state, org.pincode].some(Boolean) && (
                <p className="leading-relaxed">
                  {[org.addressLine, org.city, org.state, org.pincode].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          </div>

          {branches.length > 0 && (
            <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5">
              <p className="text-sm font-semibold">Branches</p>
              <ul className="mt-3 space-y-3">
                {branches.map((b) => (
                  <li key={b.id}>
                    <p className="text-sm">{b.name}</p>
                    {[b.addressLine, b.city, b.state].some(Boolean) && (
                      <p className="t-small faint">
                        {[b.addressLine, b.city, b.state].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
