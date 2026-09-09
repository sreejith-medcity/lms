import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { productIdOfCourseCommunity, toPlainText } from '@/lib/community';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { CommunityState, NewCommunity, PostControls } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The rooms, and the things somebody has objected to.
 *
 * Reported posts come first and are the reason to open this page. A flag hides
 * nothing on its own: letting one annoyed learner silence another is worse than
 * the post they objected to, so it waits for a person.
 */
export default async function CommunityPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('community.manage_communities', 'view');
  const canEdit = me.permissions['community.manage_communities']?.edit ?? false;
  const canModerate = me.permissions['community.moderate_posts']?.edit ?? canEdit;
  const tz = tenant.timezone;

  const [communities, flagged, recent] = await Promise.all([
    db.community.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        visibility: true,
        isActive: true,
        _count: { select: { posts: true } },
      },
    }),
    db.communityPost.findMany({
      where: { isFlagged: true, community: { organizationId: tenant.organizationId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        bodyHtml: true,
        createdAt: true,
        isPinned: true,
        author: { select: { id: true, name: true } },
        community: { select: { name: true } },
        _count: { select: { comments: true } },
      },
    }),
    db.communityPost.findMany({
      where: { community: { organizationId: tenant.organizationId }, isFlagged: false },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        title: true,
        bodyHtml: true,
        createdAt: true,
        isPinned: true,
        author: { select: { id: true, name: true } },
        community: { select: { name: true } },
        _count: { select: { comments: true } },
      },
    }),
  ]);

  const week = new Date(Date.now() - 7 * 86_400_000);
  const thisWeek = await db.communityPost.count({
    where: { community: { organizationId: tenant.organizationId }, createdAt: { gte: week } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Community"
        description="Rooms, and the posts somebody has reported. Course discussions appear here too, one per course."
      />

      <StatGrid>
        <Stat label="Rooms" value={communities.length} sub={`${communities.filter((c) => c.isActive).length} open`} />
        <Stat
          label="Reported"
          value={flagged.length}
          sub={flagged.length > 0 ? 'waiting on a person' : 'nothing reported'}
        />
        <Stat
          label="Posts this week"
          value={thisWeek}
          sub={`${communities.reduce((n, c) => n + c._count.posts, 0)} in total`}
        />
        <Stat
          label="Course rooms"
          value={communities.filter((c) => productIdOfCourseCommunity(c.slug)).length}
          sub="made when a course first gets a post"
        />
      </StatGrid>

      {flagged.length > 0 && (
        <section className="space-y-3">
          <h2 className="t-heading flex items-center gap-2">
            Reported <Badge tone="bad">{flagged.length}</Badge>
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {flagged.map((p) => (
              <Card key={p.id} className="border-[var(--bad)]/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {p.title && <p className="font-medium">{p.title}</p>}
                    <p className="t-micro faint">
                      {p.author.name} · {p.community.name} ·{' '}
                      {formatDayLabel(dayKey(p.createdAt, tz), tz)}
                    </p>
                  </div>
                  <Badge tone="bad">reported</Badge>
                </div>
                <p className="t-small mt-3 whitespace-pre-wrap">{toPlainText(p.bodyHtml)}</p>
                {canModerate && (
                  <div className="mt-3">
                    <PostControls id={p.id} isPinned={p.isPinned} isFlagged />
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="t-heading">Rooms</h2>
        {communities.length === 0 ? (
          <EmptyState
            title="No rooms yet"
            hint="Make one below, or let a course discussion create its own the first time somebody posts."
          />
        ) : (
          <Table head={['Room', 'Who can see it', 'Posts', 'State', '']}>
            {communities.map((c) => {
              const productId = productIdOfCourseCommunity(c.slug);
              return (
                <Row key={c.id}>
                  <Cell>
                    <span className="font-medium">{c.name}</span>
                    {productId && (
                      <p className="t-micro faint">
                        <Link href={`/admin/courses/${productId}`} className="hover:underline">
                          a course discussion
                        </Link>
                      </p>
                    )}
                  </Cell>
                  <Cell className="muted">
                    {c.visibility === 'PUBLIC'
                      ? 'Anyone signed in'
                      : c.visibility === 'ENROLLED'
                        ? 'Enrolled learners'
                        : 'Staff only'}
                  </Cell>
                  <Cell className="tabular-nums">{c._count.posts}</Cell>
                  <Cell>
                    {canEdit ? (
                      <CommunityState id={c.id} isActive={c.isActive} />
                    ) : (
                      <Badge tone={c.isActive ? 'ok' : 'neutral'}>
                        {c.isActive ? 'open' : 'closed'}
                      </Badge>
                    )}
                  </Cell>
                  <Cell className="text-right">
                    <Link href={`/learn/community/${c.id}`} className="t-small faint hover:underline">
                      Open
                    </Link>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="t-heading">Lately</h2>
          <Card padded={false}>
            <ul className="divide-y">
              {recent.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {p.title ?? toPlainText(p.bodyHtml).slice(0, 90)}
                      {p.isPinned && (
                        <span className="ml-2">
                          <Badge tone="brand">pinned</Badge>
                        </span>
                      )}
                    </p>
                    <p className="t-micro faint">
                      {p.author.name} · {p.community.name} ·{' '}
                      {formatDayLabel(dayKey(p.createdAt, tz), tz)} · {p._count.comments} replies
                    </p>
                  </div>
                  {canModerate && <PostControls id={p.id} isPinned={p.isPinned} isFlagged={false} />}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Open a room</h2>
          <p className="t-small muted mt-1 max-w-prose">
            One general room is usually plenty. Course discussions make themselves, so there is no
            need to create one per course here.
          </p>
          <div className="mt-4">
            <NewCommunity />
          </div>
        </Card>
      )}
    </div>
  );
}
