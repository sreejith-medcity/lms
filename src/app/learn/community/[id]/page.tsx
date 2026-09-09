import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { productIdOfCourseCommunity, toPlainText } from '@/lib/community';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, EmptyState } from '@/components/ui';
import { PostBox, ReplyBox, PostMenu } from './boxes';

export const dynamic = 'force-dynamic';

export default async function Room({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const tz = tenant.timezone;

  const room = await db.community.findFirst({
    where: { id, organizationId: tenant.organizationId, isActive: true },
    select: { id: true, name: true, slug: true, description: true, visibility: true },
  });
  if (!room) notFound();

  // The same check the actions make, so a room nobody may enter never renders.
  const productId = productIdOfCourseCommunity(room.slug);
  if (user.kind !== 'STAFF') {
    if (room.visibility === 'INVITE') notFound();
    const enrolled = await db.enrollment.count({
      where: {
        userId: user.id,
        organizationId: tenant.organizationId,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
        ...(productId ? { productId } : {}),
      },
    });
    if (enrolled === 0 && !(room.visibility === 'PUBLIC' && !productId)) notFound();
  }

  const posts = await db.communityPost.findMany({
    where: { communityId: room.id },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      title: true,
      bodyHtml: true,
      isPinned: true,
      isFlagged: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          bodyHtml: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="space-y-6">
        <div>
          <Link href="/learn/community" className="t-small faint hover:underline">
            Community
          </Link>
          <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
            {room.name}
            {productId && <Badge tone="brand">course</Badge>}
          </h1>
          {room.description && <p className="t-small muted mt-1">{room.description}</p>}
        </div>

        <PostBox communityId={room.id} />

        {posts.length === 0 ? (
          <EmptyState title="Nothing here yet" hint="Be the first to ask something." />
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <Card key={post.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {post.title && <p className="font-medium">{post.title}</p>}
                    <p className="t-micro faint">
                      {post.author.name} · {formatDayLabel(dayKey(post.createdAt, tz), tz)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {post.isPinned && <Badge tone="brand">pinned</Badge>}
                    <PostMenu postId={post.id} alreadyFlagged={post.isFlagged} />
                  </div>
                </div>

                <p className="t-small mt-3 whitespace-pre-wrap leading-relaxed">
                  {toPlainText(post.bodyHtml)}
                </p>

                {post.comments.length > 0 && (
                  <ul className="mt-4 space-y-3 border-l pl-4">
                    {post.comments.map((c) => (
                      <li key={c.id}>
                        <p className="t-micro faint">
                          {c.author.name} · {formatDayLabel(dayKey(c.createdAt, tz), tz)}
                        </p>
                        <p className="t-small whitespace-pre-wrap">{toPlainText(c.bodyHtml)}</p>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4">
                  <ReplyBox postId={post.id} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
