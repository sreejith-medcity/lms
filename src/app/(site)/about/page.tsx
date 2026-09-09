import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { LinkButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  return {
    title: site ? `About ${site.organization.name}` : 'About',
    alternates: { canonical: '/about' },
  };
}

/**
 * Everything on this page comes from the organisation record and the live
 * catalogue. Where the copy has not been written yet, the page says so to staff
 * rather than filling the space with invented claims.
 */
export default async function AboutPage() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const org = site.organization;

  const page = await db.storefrontPage.findFirst({
    where: { organizationId: site.organizationId, slug: 'about', status: 'PUBLISHED' },
    select: { title: true, blocks: true },
  });

  const [branches, categories, courseCount] = await Promise.all([
    db.branch.count({ where: { organizationId: site.organizationId, isActive: true } }),
    db.category.count({ where: { organizationId: site.organizationId, isActive: true } }),
    db.product.count({
      where: { organizationId: site.organizationId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null },
    }),
  ]);

  const blocks = Array.isArray(page?.blocks)
    ? (page.blocks as { heading?: string; body?: string }[])
    : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{page?.title ?? `About ${org.name}`}</h1>

      {blocks.length > 0 ? (
        <div className="mt-6 space-y-6">
          {blocks.map((b, i) => (
            <section key={i}>
              {b.heading && <h2 className="text-lg font-semibold">{b.heading}</h2>}
              {b.body && <p className="muted mt-2 leading-relaxed">{b.body}</p>}
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-[var(--radius)] border border-dashed bg-[var(--surface)] p-6">
          <p className="text-sm font-medium">This page has not been written yet</p>
          <p className="t-small muted mt-1 max-w-prose">
            Rather than fill it with claims nobody has approved, it stays empty until someone
            publishes an <code>about</code> page from the admin. What is below is drawn from the
            live catalogue, so it is true by construction.
          </p>
        </div>
      )}

      <dl className="mt-10 grid gap-4 sm:grid-cols-3">
        <Fact label="Courses published" value={courseCount} />
        <Fact label="Subject areas" value={categories} />
        <Fact label="Branches" value={branches} />
      </dl>

      <div className="mt-10 flex flex-wrap gap-3">
        <LinkButton href="/courses">Browse courses</LinkButton>
        <LinkButton href="/contact" variant="secondary">
          Talk to us
        </LinkButton>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5">
      <dt className="t-micro faint uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
