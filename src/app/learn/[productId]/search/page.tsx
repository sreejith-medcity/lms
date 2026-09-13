import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { searchCourse } from '@/lib/transcripts';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/**
 * "Where did she explain the dative?" Search every transcript in the course
 * and land on the second it was said. Only lessons the enrolment can open
 * are worth listing, and the lesson page enforces that anyway.
 */
export default async function CourseSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { productId } = await params;
  const { q = '' } = await searchParams;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrollment = await db.enrollment.findFirst({
    where: { userId: user.id, productId, organizationId: tenant.organizationId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    select: { product: { select: { title: true, course: { select: { id: true } } } } },
  });
  if (!enrollment?.product.course) notFound();

  const hits = q.trim().length >= 2 ? await searchCourse(tenant.organizationId, enrollment.product.course.id, q) : [];

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <Link href={`/learn/${productId}`} className="t-small faint hover:underline">
        {enrollment.product.title}
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Search the course</h1>
      <p className="t-small faint mt-1">Every word said in every lesson that has a transcript. Click a line to land on that moment.</p>

      <form className="mt-5 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="A word or a phrase"
          className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm"
          autoFocus
        />
        <button type="submit" className="h-10 rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
          Search
        </button>
      </form>

      {q.trim().length >= 2 && (
        <div className="mt-5">
          {hits.length === 0 ? (
            <Card>
              <p className="t-small muted">Nothing says &ldquo;{q}&rdquo; in the lessons that have transcripts yet.</p>
            </Card>
          ) : (
            <ul className="space-y-2">
              {hits.map((h, i) => (
                <li key={`${h.materialId}-${h.start}-${i}`}>
                  <Link
                    href={`/learn/${productId}/${h.materialId}?t=${Math.floor(h.start)}&tab=transcript`}
                    className="block rounded-[var(--radius)] border bg-[var(--surface)] p-3 hover:border-[var(--brand)]"
                  >
                    <p className="t-small faint">
                      {h.sectionTitle} · {h.materialTitle} · <span className="tabular-nums">{stamp(h.start)}</span>
                    </p>
                    <p className="mt-1 text-sm">{h.text}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
