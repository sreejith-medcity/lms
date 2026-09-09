import Link from 'next/link';
import { db } from '@/lib/db';
import { courseCardSelect, type CourseCard as Card } from '@/lib/site';
import { CourseCard } from '@/components/course-card';

export interface CatalogueFilters {
  q?: string;
  category?: string;
  level?: string;
  format?: string;
  sort?: string;
}

/**
 * The one query behind /courses and every category page. Filtering happens in
 * the database rather than in the page, so a large catalogue does not get slower
 * as it grows.
 */
export async function Catalogue({
  organizationId,
  filters,
  categories,
  basePath = '/courses',
}: {
  organizationId: string;
  filters: CatalogueFilters;
  categories: { name: string; slug: string; _count: { courses: number } }[];
  basePath?: string;
}) {
  const q = filters.q?.trim();

  const products = await db.product.findMany({
    where: {
      organizationId,
      type: 'COURSE',
      status: 'PUBLISHED',
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { course: { description: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
      ...(filters.category
        ? { course: { categories: { some: { category: { slug: filters.category } } } } }
        : {}),
      ...(filters.level ? { course: { level: filters.level } } : {}),
    },
    orderBy:
      filters.sort === 'newest'
        ? { createdAt: 'desc' }
        : filters.sort === 'title'
          ? { title: 'asc' }
          : [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: 60,
    select: courseCardSelect,
  });

  let cards = products as unknown as Card[];

  // Format is derived rather than stored, so it is filtered after the query.
  if (filters.format) {
    cards = cards.filter((c) => {
      const live = (c.course?.batches.length ?? 0) > 0;
      const material =
        (c.course?.modules.reduce(
          (n, m) => n + m.module.sections.reduce((s, sec) => s + sec._count.materials, 0),
          0,
        ) ?? 0) > 0;
      if (filters.format === 'live') return live && !material;
      if (filters.format === 'recorded') return !live && material;
      return live && material;
    });
  }

  const levels = await db.course.findMany({
    where: { organizationId, level: { not: null }, product: { status: 'PUBLISHED' } },
    distinct: ['level'],
    select: { level: true },
  });

  const active = Boolean(q || filters.category || filters.level || filters.format);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <FilterLink href={basePath} active={!filters.category}>
          All subjects
        </FilterLink>
        {categories.map((c) => (
          <FilterLink
            key={c.slug}
            href={`${basePath === '/courses' ? '/courses/' : ''}${c.slug}`}
            active={filters.category === c.slug}
          >
            {c.name}
          </FilterLink>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="t-small faint">Format</span>
        {[
          ['', 'Any'],
          ['live', 'Live'],
          ['recorded', 'Recorded'],
          ['blended', 'Blended'],
        ].map(([value, label]) => (
          <FilterLink
            key={label}
            href={withParam(basePath, filters, 'format', value)}
            active={(filters.format ?? '') === value}
            small
          >
            {label}
          </FilterLink>
        ))}

        {levels.length > 0 && (
          <>
            <span className="t-small faint ml-3">Level</span>
            <FilterLink href={withParam(basePath, filters, 'level', '')} active={!filters.level} small>
              Any
            </FilterLink>
            {levels.map((l) => (
              <FilterLink
                key={l.level}
                href={withParam(basePath, filters, 'level', l.level ?? '')}
                active={filters.level === l.level}
                small
              >
                {l.level}
              </FilterLink>
            ))}
          </>
        )}
      </div>

      <p className="t-small faint" aria-live="polite">
        {cards.length} course{cards.length === 1 ? '' : 's'}
        {q ? ` matching “${q}”` : ''}
      </p>

      {cards.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed bg-[var(--surface)] p-12 text-center">
          <p className="t-heading">Nothing matches that</p>
          <p className="t-small muted mx-auto mt-1 max-w-sm">
            {active
              ? 'Try removing a filter, or search for something broader.'
              : 'Courses appear here as soon as they are published.'}
          </p>
          {active && (
            <Link
              href={basePath}
              className="mt-4 inline-flex h-9 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3.5 text-sm font-medium"
            >
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <CourseCard key={c.id} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function withParam(base: string, filters: CatalogueFilters, key: string, value: string) {
  const params = new URLSearchParams();
  const merged: Record<string, string | undefined> = { ...filters, [key]: value || undefined };
  delete merged.category; // carried by the path, not the query string
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function FilterLink({
  href,
  active,
  small = false,
  children,
}: {
  href: string;
  active: boolean;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full border px-3 transition ${small ? 'py-1 text-[0.8125rem]' : 'py-1.5 text-sm'} ${
        active
          ? 'border-transparent text-[var(--brand-ink)]'
          : 'bg-[var(--surface)] hover:border-[var(--brand)] hover:text-[var(--brand)]'
      }`}
      style={active ? { background: 'var(--brand)' } : undefined}
    >
      {children}
    </Link>
  );
}
