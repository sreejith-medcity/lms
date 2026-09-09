import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { productIdOfCourseCommunity } from '@/lib/community';
import { Badge, Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * The rooms this learner can actually enter.
 *
 * Filtered by entitlement rather than shown greyed out: a list of doors you
 * cannot open is a worse experience than a shorter list.
 */
export default async function CommunityIndex() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrolments = await db.enrollment.findMany({
    where: {
      userId: user.id,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
    },
    select: { productId: true },
  });
  const productIds = new Set(enrolments.map((e) => e.productId));

  const rooms = await db.community.findMany({
    where: {
      organizationId: tenant.organizationId,
      isActive: true,
      visibility: { in: enrolments.length > 0 ? ['PUBLIC', 'ENROLLED'] : ['PUBLIC'] },
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      _count: { select: { posts: true } },
      posts: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });

  const visible = rooms.filter((r) => {
    const productId = productIdOfCourseCommunity(r.slug);
    return !productId || productIds.has(productId);
  });

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <div className="space-y-6">
        <div>
          <Link href="/learn" className="t-small faint hover:underline">
            My learning
          </Link>
          <h1 className="t-title mt-1">Community</h1>
          <p className="t-small muted mt-1">
            Ask something, answer somebody, or read what others are stuck on.
          </p>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="No rooms open to you yet"
            hint="Course discussions appear here once you are enrolled."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((room) => (
              <Link key={room.id} href={`/learn/community/${room.id}`}>
                <Card className="h-full transition hover:border-[var(--brand)]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{room.name}</p>
                    {productIdOfCourseCommunity(room.slug) && <Badge tone="brand">course</Badge>}
                  </div>
                  {room.description && <p className="t-small muted mt-1">{room.description}</p>}
                  <p className="t-micro faint mt-3">
                    {room._count.posts} {room._count.posts === 1 ? 'post' : 'posts'}
                    {room.posts[0]
                      ? ` · last one ${room.posts[0].createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                      : ' · nobody has posted yet'}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
