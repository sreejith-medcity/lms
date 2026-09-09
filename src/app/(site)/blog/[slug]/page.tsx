import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';

export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const site = await getSiteContext();
  if (!site) return null;

  const post = await db.blogPost.findFirst({
    where: { organizationId: site.organizationId, slug, status: 'PUBLISHED' },
    select: {
      title: true,
      excerpt: true,
      bodyHtml: true,
      tags: true,
      publishedAt: true,
      slug: true,
    },
  });
  return post ? { site, post } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const found = await load((await params).slug);
  if (!found) return { title: 'Not found' };

  return {
    title: `${found.post.title} — ${found.site.organization.name}`,
    description: found.post.excerpt ?? undefined,
    alternates: { canonical: `/blog/${found.post.slug}` },
    openGraph: {
      title: found.post.title,
      description: found.post.excerpt ?? undefined,
      type: 'article',
      publishedTime: found.post.publishedAt?.toISOString(),
    },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) {
    const site = await getSiteContext();
    if (!site) return <NoTenantNotice />;
    notFound();
  }

  const { post, site } = found;

  return (
    <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.excerpt ?? undefined,
            datePublished: post.publishedAt?.toISOString(),
            publisher: { '@type': 'Organization', name: site.organization.name },
          }),
        }}
      />

      <Link href="/blog" className="t-small faint hover:underline">
        Notes
      </Link>
      <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">{post.title}</h1>
      {post.publishedAt && (
        <p className="t-small faint mt-2">
          {post.publishedAt.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      )}

      {/* Plain text from the admin, so paragraphs are split rather than injected. */}
      <div className="mt-8 space-y-4">
        {post.bodyHtml
          .split(/\n{2,}/)
          .map((para, i) => (
            <p key={i} className="whitespace-pre-wrap leading-relaxed">
              {para}
            </p>
          ))}
      </div>

      {post.tags.length > 0 && (
        <div className="mt-10 flex flex-wrap gap-1.5 border-t pt-6">
          {post.tags.map((t) => (
            <span key={t} className="t-micro faint rounded-full border px-2.5 py-1">
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
