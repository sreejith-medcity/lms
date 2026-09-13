import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { courseCardSelect, ratingsFor, type CourseCard as Card } from '@/lib/site';
import { CourseCard } from '@/components/course-card';
import { SaveButton } from '@/components/save-button';
import { syncWishlist } from '@/server/wishlist';
import { EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Saved for later' };

/**
 * The courses somebody saved. Opening the page signed in merges whatever
 * the cookie collected before they signed in, so nothing saved as a guest
 * is lost at the door.
 */
export default async function WishlistPage() {
  const tenant = await requireTenant();
  const ids = await syncWishlist();
  const products = ids.length
    ? await db.product.findMany({
        where: { id: { in: ids }, organizationId: tenant.organizationId, status: 'PUBLISHED', deletedAt: null },
        select: courseCardSelect,
      })
    : [];
  const cards = ids.map((id) => (products as unknown as Card[]).find((p) => p.id === id)).filter((c): c is Card => Boolean(c));
  const ratings = await ratingsFor(tenant.organizationId, cards.map((c) => c.id));

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <h1 className="text-xl font-semibold">Saved for later</h1>
      <p className="t-small faint mt-1">Courses you marked to come back to. They stay here until you take them off.</p>
      <div className="mt-6">
        {cards.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            hint="The heart on any course saves it here."
            action={
              <Link href="/courses" className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
                Browse the courses
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.id} className="relative">
                <CourseCard card={c} rating={ratings.get(c.id)} />
                <div className="absolute right-2 top-2 z-10">
                  <SaveButton productId={c.id} compact />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
