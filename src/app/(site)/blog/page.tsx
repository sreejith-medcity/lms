import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  return {
    title: site ? `Notes — ${site.organization.name}` : 'Notes',
    description: 'Guidance on exams, courses and studying, written by the trainers.',
    alternates: { canonical: '/blog' },
  };
}

export default async function BlogIndex() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const posts = await db.blogPost.findMany({
    where: { organizationId: site.organizationId, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    take: 30,
    select: { id: true, slug: true, title: true, excerpt: true, tags: true, publishedAt: true },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
      <p className="t-small muted mt-1">Written by the people who teach here.</p>

      {posts.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="Nothing published yet" hint="Posts appear here as they are written." />
        </div>
      ) : (
        <ul className="mt-8 divide-y">
          {posts.map((p) => (
            <li key={p.id} className="py-5">
              <Link href={`/blog/${p.slug}`} className="group block">
                <h2 className="text-lg font-medium group-hover:text-[var(--brand)]">{p.title}</h2>
                {p.publishedAt && (
                  <p className="t-small faint mt-1">
                    {p.publishedAt.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                )}
                {p.excerpt && <p className="t-small muted mt-2 leading-relaxed">{p.excerpt}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
