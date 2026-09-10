import Link from 'next/link';
import { db } from '@/lib/db';
import { courseCardSelect, ratingsFor, type CourseCard as Card } from '@/lib/site';
import { formatMoney } from '@/lib/money';
import { settingText } from '@/lib/settings/store';
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
 *
 * The controls are links and a plain GET form, not client state. That is what
 * lets every filtered view be its own URL a learner can bookmark, a search
 * engine can index and an ad can point at, and it is also what keeps the page
 * cacheable at the edge.
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
      // Something sold only alongside a course is not a course. It has no
      // page of its own, so a card linking to one would be a dead end.
      isAddonOnly: false,
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
          : filters.sort === 'price'
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

  // Price is on the plan rather than the product, so cheapest-first is sorted
  // here. Sixty rows at most, so this costs nothing worth avoiding.
  if (filters.sort === 'price') {
    cards = [...cards].sort(
      (a, b) => (a.pricingPlans[0]?.pricePaise ?? Infinity) - (b.pricingPlans[0]?.pricePaise ?? Infinity),
    );
  }

  const [levels, ratings, addonRows, googleRating, googleCount] = await Promise.all([
    db.course.findMany({
      where: { organizationId, level: { not: null }, product: { status: 'PUBLISHED' } },
      distinct: ['level'],
      select: { level: true },
    }),
    ratingsFor(organizationId, cards.map((c) => c.id)),
    // One query for the whole grid rather than one per card. Only the first
    // extra per course reaches a card: a card is a summary, and a course with
    // three extras is a decision that belongs on its own page.
    db.productAddon.findMany({
      where: {
        organizationId,
        isActive: true,
        productId: { in: cards.map((c) => c.id) },
        addonProduct: { status: 'PUBLISHED', deletedAt: null },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        productId: true,
        label: true,
        addonProduct: {
          select: {
            id: true,
            title: true,
            pricingPlans: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              take: 1,
              select: { pricePaise: true, currency: true },
            },
          },
        },
      },
    }),
    settingText(organizationId, 'website.googleRating'),
    settingText(organizationId, 'website.googleReviewCount'),
  ]);

  const google =
    googleRating.trim() && googleCount.trim()
      ? { rating: googleRating.trim(), reviewCount: googleCount.trim() }
      : undefined;

  const addonByProduct = new Map<string, { productId: string; label: string; priceLabel: string }>();
  for (const row of addonRows) {
    if (addonByProduct.has(row.productId)) continue;
    const plan = row.addonProduct.pricingPlans[0];
    if (!plan || plan.pricePaise <= 0) continue;
    addonByProduct.set(row.productId, {
      productId: row.addonProduct.id,
      label: row.label ?? `Add ${row.addonProduct.title}`,
      priceLabel: `+${formatMoney(plan.pricePaise, plan.currency)}`,
    });
  }

  const active = Boolean(q || filters.category || filters.level || filters.format);

  return (
    <div>
      {/* Subject rail. Scrolls sideways on a phone rather than wrapping into
          five ragged rows above the first card. */}
      <nav aria-label="Subjects" className="rail -mx-4 flex gap-2 px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip href={basePath} active={!filters.category}>
          All subjects
        </Chip>
        {categories.map((c) => (
          <Chip
            key={c.slug}
            href={`${basePath === '/courses' ? '/courses/' : ''}${c.slug}`}
            active={filters.category === c.slug}
          >
            {c.name}
            <span className="ml-1.5 tabular-nums opacity-60">{c._count.courses}</span>
          </Chip>
        ))}
      </nav>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-y py-3">
        <Group label="Format">
          {[
            ['', 'Any'],
            ['live', 'Live'],
            ['recorded', 'Recorded'],
            ['blended', 'Blended'],
          ].map(([value, label]) => (
            <Chip
              key={label}
              href={withParam(basePath, filters, 'format', value)}
              active={(filters.format ?? '') === value}
              small
            >
              {label}
            </Chip>
          ))}
        </Group>

        {levels.length > 0 && (
          <Group label="Level">
            <Chip href={withParam(basePath, filters, 'level', '')} active={!filters.level} small>
              Any
            </Chip>
            {levels.map((l) => (
              <Chip
                key={l.level}
                href={withParam(basePath, filters, 'level', l.level ?? '')}
                active={filters.level === l.level}
                small
              >
                {l.level}
              </Chip>
            ))}
          </Group>
        )}

        <Group label="Sort by">
          {[
            ['', 'Recommended'],
            ['newest', 'Newest'],
            ['price', 'Lowest price'],
            ['title', 'A to Z'],
          ].map(([value, label]) => (
            <Chip
              key={label}
              href={withParam(basePath, filters, 'sort', value)}
              active={(filters.sort ?? '') === value}
              small
            >
              {label}
            </Chip>
          ))}
        </Group>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="t-small muted" aria-live="polite">
          <strong className="tabular-nums text-[var(--ink)]">{cards.length}</strong> course
          {cards.length === 1 ? '' : 's'}
          {q ? ` matching “${q}”` : ''}
        </p>
        {active && (
          <Link href={basePath} className="t-small underline" style={{ color: 'var(--brand)' }}>
            Clear filters
          </Link>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="mt-5 rounded-[var(--radius-lg)] border border-dashed bg-[var(--surface)] p-12 text-center">
          <p className="t-card-title">Nothing matches that</p>
          <p className="t-small muted mx-auto mt-1.5 max-w-sm">
            {active
              ? 'Try removing a filter, or search for something broader. Every published course is on the all subjects tab.'
              : 'Courses appear here as soon as they are published.'}
          </p>
          {active && (
            <Link
              href={basePath}
              className="mt-4 inline-flex h-10 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-4 text-sm font-medium"
            >
              Show every course
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((c, i) => (
            <CourseCard
              key={c.id}
              card={c}
              rating={ratings.get(c.id)}
              addon={addonByProduct.get(c.id)}
              google={google}
              priority={i < 4}
            />
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

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="t-small faint shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
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
      className={`inline-flex shrink-0 items-center rounded-full border font-medium transition ${
        small ? 'px-2.5 py-1 text-[0.8125rem]' : 'px-3.5 py-1.5 text-sm'
      } ${
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
