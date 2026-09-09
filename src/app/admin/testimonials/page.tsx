import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { TestimonialRow, NewTestimonial } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The queue of things people said.
 *
 * Unpublished first, because a testimonial nobody has looked at is the only
 * thing on this page that needs a decision. Fifteen of them sat unread in the
 * incumbent, which is what happens when the pile is sorted by date.
 */
export default async function TestimonialsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('testimonials.manage_testimonials', 'view');
  const canEdit = me.permissions['testimonials.manage_testimonials']?.edit ?? false;
  const tz = tenant.timezone;

  const [testimonials, products] = await Promise.all([
    db.testimonial.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ isPublished: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        authorName: true,
        authorEmail: true,
        rating: true,
        comment: true,
        isPublished: true,
        createdAt: true,
        userId: true,
        product: { select: { id: true, title: true } },
      },
    }),
    db.product.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
  ]);

  const waiting = testimonials.filter((t) => !t.isPublished);
  const live = testimonials.length - waiting.length;
  const ratings = testimonials.map((t) => t.rating);
  const average = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Testimonials"
        description="What learners said, and which of it the academy is willing to put its name behind."
      />

      <StatGrid>
        <Stat
          label="Waiting on you"
          value={waiting.length}
          sub={waiting.length > 0 ? 'nobody has read these' : 'nothing in the queue'}
        />
        <Stat label="On the site" value={live} sub="published" />
        <Stat label="Average" value={average != null ? average.toFixed(1) : '—'} sub="out of five" />
        <Stat
          label="From learners"
          value={testimonials.filter((t) => t.userId).length}
          sub="left by an account rather than typed in"
        />
      </StatGrid>

      {testimonials.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          hint="Learners are asked for one when they finish a course, and you can add one below."
        />
      ) : (
        <div className="space-y-3">
          {waiting.length > 0 && (
            <h2 className="t-heading flex items-center gap-2">
              Waiting <Badge tone="warn">{waiting.length}</Badge>
            </h2>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {testimonials.map((t) => (
              <TestimonialRow
                key={t.id}
                canEdit={canEdit}
                testimonial={{
                  id: t.id,
                  authorName: t.authorName,
                  authorEmail: t.authorEmail,
                  rating: t.rating,
                  comment: t.comment ?? '',
                  isPublished: t.isPublished,
                  fromLearner: Boolean(t.userId),
                  courseTitle: t.product?.title ?? null,
                  when: formatDayLabel(dayKey(t.createdAt, tz), tz),
                }}
              />
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Add one yourself</h2>
          <p className="t-small muted mt-1 max-w-prose">
            For the ones that arrive by WhatsApp. Use the person&apos;s real words and real name, and
            ask them first: a quote on a public page is the academy speaking.
          </p>
          <div className="mt-4">
            <NewTestimonial products={products} />
          </div>
        </Card>
      )}
    </div>
  );
}
