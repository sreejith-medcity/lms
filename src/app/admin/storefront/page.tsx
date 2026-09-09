import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { PageEditor, PostEditor, RemovePage, RemovePost } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

interface Block {
  heading?: string;
  body?: string;
}

export default async function StorefrontPage_({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('blogs.manage_blogs', 'view');

  const sp = await searchParams;
  const editPage = (Array.isArray(sp.page) ? sp.page[0] : sp.page) as string | undefined;
  const editPost = (Array.isArray(sp.post) ? sp.post[0] : sp.post) as string | undefined;

  const [pages, posts] = await Promise.all([
    db.storefrontPage.findMany({
      where: { organizationId: tenant.organizationId, kind: 'STATIC' },
      orderBy: { slug: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        blocks: true,
        seoTitle: true,
        seoDescription: true,
        updatedAt: true,
      },
    }),
    db.blogPost.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ publishedAt: 'desc' }, { title: 'asc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        bodyHtml: true,
        tags: true,
        status: true,
        publishedAt: true,
      },
    }),
  ]);

  const page = pages.find((p) => p.id === editPage);
  const post = posts.find((p) => p.id === editPost);

  return (
    <div>
      <PageHeader
        title="Storefront"
        description="The words on the public site. Pages are headings and prose rather than free HTML, and posts are plain text: a paste-anything editor on a multi-tenant site is an injection surface nothing here needs yet."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          <section>
            <h2 className="t-heading mb-3">Pages</h2>
            {pages.length === 0 ? (
              <EmptyState
                title="No pages yet"
                hint="The About page is the one visitors look for first, and it currently says it has not been written."
              />
            ) : (
              <ul className="space-y-2">
                {pages.map((p) => {
                  const blocks = Array.isArray(p.blocks) ? (p.blocks as Block[]) : [];
                  return (
                    <li key={p.id}>
                      <Card>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/admin/storefront?page=${p.id}`}
                                className="font-medium hover:underline"
                              >
                                {p.title}
                              </Link>
                              <Badge tone={p.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                                {p.status.toLowerCase()}
                              </Badge>
                            </div>
                            <p className="t-small faint mt-1 font-mono">/{p.slug}</p>
                            <p className="t-small faint mt-1">
                              {blocks.length} section{blocks.length === 1 ? '' : 's'}
                            </p>
                          </div>
                          <RemovePage id={p.id} />
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="t-heading mb-3">Posts</h2>
            {posts.length === 0 ? (
              <EmptyState title="Nothing written yet" hint="The blog is live at /blog once a post is published." />
            ) : (
              <ul className="space-y-2">
                {posts.map((p) => (
                  <li key={p.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/admin/storefront?post=${p.id}`}
                              className="font-medium hover:underline"
                            >
                              {p.title}
                            </Link>
                            <Badge tone={p.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                              {p.status.toLowerCase()}
                            </Badge>
                          </div>
                          <p className="t-small faint mt-1 font-mono">/blog/{p.slug}</p>
                          {p.publishedAt && (
                            <p className="t-small faint mt-1">
                              {p.publishedAt.toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </p>
                          )}
                        </div>
                        <RemovePost id={p.id} />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="t-heading">{page ? `Edit ${page.title}` : 'New page'}</h2>
            <div className="mt-5">
              <PageEditor
                page={
                  page
                    ? {
                        id: page.id,
                        slug: page.slug,
                        title: page.title,
                        status: page.status,
                        seoTitle: page.seoTitle,
                        seoDescription: page.seoDescription,
                        blocks: Array.isArray(page.blocks) ? (page.blocks as Block[]) : [],
                      }
                    : undefined
                }
              />
            </div>
          </Card>

          <Card>
            <h2 className="t-heading">{post ? `Edit ${post.title}` : 'New post'}</h2>
            <div className="mt-5">
              <PostEditor
                post={
                  post
                    ? {
                        id: post.id,
                        title: post.title,
                        excerpt: post.excerpt,
                        bodyHtml: post.bodyHtml,
                        tags: post.tags,
                        status: post.status,
                      }
                    : undefined
                }
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
