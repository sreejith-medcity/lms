import Link from 'next/link';
import { db } from '@/lib/db';
import { courseCardSelect, learningFormat, ratingsFor, type CourseCard as Card } from '@/lib/site';
import { settingText } from '@/lib/settings/store';
import { CourseListRow } from '@/components/course-card';
import { SortSelect } from './sort-select';

export interface CatalogueFilters {
  q?: string;
  category?: string;
  level?: string;
  format?: string;
  language?: string;
  price?: string;
  sort?: string;
  page?: string;
}

const PAGE = 20;

/**
 * The one query behind /courses and every subject page.
 *
 * Filters down the left, results as wide rows on the right, the way every
 * course marketplace lays out a search. The controls are links, not client
 * state: every filtered view is its own URL a learner can bookmark, a search
 * engine can index and an ad can point at, and the page stays cacheable.
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
      ...(filters.category ? { course: { categories: { some: { category: { slug: filters.category } } } } } : {}),
      ...(filters.level ? { course: { level: filters.level } } : {}),
      ...(filters.language ? { course: { language: filters.language } } : {}),
    },
    orderBy:
      filters.sort === 'newest'
        ? { createdAt: 'desc' }
        : filters.sort === 'title'
          ? { title: 'asc' }
          : [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    select: courseCardSelect,
  });

  let cards = products as unknown as Card[];

  // Format and price live on derived or related rows, so they filter here.
  if (filters.format) {
    cards = cards.filter((c) => learningFormat(c).toLowerCase() === filters.format);
  }
  if (filters.price === 'free') cards = cards.filter((c) => (c.pricingPlans[0]?.pricePaise ?? 0) === 0);
  if (filters.price === 'paid') cards = cards.filter((c) => (c.pricingPlans[0]?.pricePaise ?? 0) > 0);
  if (filters.price === 'instalments') cards = cards.filter((c) => (c.pricingPlans[0]?.instalmentCount ?? 0) > 1);

  if (filters.sort === 'price' || filters.sort === 'price-desc') {
    const dir = filters.sort === 'price' ? 1 : -1;
    cards = [...cards].sort(
      (a, b) => dir * ((a.pricingPlans[0]?.pricePaise ?? Infinity) - (b.pricingPlans[0]?.pricePaise ?? Infinity)),
    );
  }

  const total = cards.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1));
  const shown = cards.slice((page - 1) * PAGE, page * PAGE);

  const [levels, languages, ratings, googleRating, googleCount] = await Promise.all([
    db.course.findMany({
      where: { organizationId, level: { not: null }, product: { status: 'PUBLISHED', deletedAt: null } },
      distinct: ['level'],
      select: { level: true },
    }),
    db.course.findMany({
      where: { organizationId, language: { not: null }, product: { status: 'PUBLISHED', deletedAt: null } },
      distinct: ['language'],
      select: { language: true },
    }),
    ratingsFor(organizationId, shown.map((c) => c.id)),
    settingText(organizationId, 'website.googleRating'),
    settingText(organizationId, 'website.googleReviewCount'),
  ]);

  const google =
    googleRating.trim() && googleCount.trim()
      ? { rating: googleRating.trim(), reviewCount: googleCount.trim() }
      : undefined;

  const active = Boolean(q || filters.category || filters.level || filters.format || filters.language || filters.price);
  const link = (key: keyof CatalogueFilters, value: string) => withParam(basePath, filters, key, value);

  const sidebar = (
    <div className="space-y-6">
      {basePath === '/courses' && (
        <FilterGroup title="Subject">
          <FilterLink href={link('category', '')} active={!filters.category}>
            All subjects
          </FilterLink>
          {categories.map((c) => (
            <FilterLink key={c.slug} href={`/courses/${c.slug}${queryOf(filters)}`} active={filters.category === c.slug} count={c._count.courses}>
              {c.name}
            </FilterLink>
          ))}
        </FilterGroup>
      )}

      <FilterGroup title="Format">
        {[
          ['', 'Any'],
          ['live', 'Live classes'],
          ['recorded', 'Recorded lessons'],
          ['blended', 'Live and recorded'],
        ].map(([value, label]) => (
          <FilterLink key={label} href={link('format', value)} active={(filters.format ?? '') === value}>
            {label}
          </FilterLink>
        ))}
      </FilterGroup>

      {levels.length > 0 && (
        <FilterGroup title="Level">
          <FilterLink href={link('level', '')} active={!filters.level}>
            Any
          </FilterLink>
          {levels.map((l) => (
            <FilterLink key={l.level} href={link('level', l.level ?? '')} active={filters.level === l.level}>
              {l.level}
            </FilterLink>
          ))}
        </FilterGroup>
      )}

      {languages.length > 1 && (
        <FilterGroup title="Language">
          <FilterLink href={link('language', '')} active={!filters.language}>
            Any
          </FilterLink>
          {languages.map((l) => (
            <FilterLink key={l.language} href={link('language', l.language ?? '')} active={filters.language === l.language}>
              {l.language}
            </FilterLink>
          ))}
        </FilterGroup>
      )}

      <FilterGroup title="Price">
        {[
          ['', 'Any'],
          ['paid', 'Paid'],
          ['free', 'Free'],
          ['instalments', 'Instalments available'],
        ].map(([value, label]) => (
          <FilterLink key={label} href={link('price', value)} active={(filters.price ?? '') === value}>
            {label}
          </FilterLink>
        ))}
      </FilterGroup>

      {active && (
        <Link href={basePath} className="t-small inline-block font-semibold underline" style={{ color: 'var(--brand)' }}>
          Clear all filters
        </Link>
      )}
    </div>
  );

  const sortHrefs = Object.fromEntries(['', 'newest', 'price', 'price-desc', 'title'].map((v) => [v, link('sort', v)]));

  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Filters: a column on a desktop, a fold-out on a phone. */}
      <aside className="lg:sticky lg:top-[7.5rem] lg:self-start">
        <details className="rounded-[var(--radius-sm)] border lg:hidden">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold">
            Filters{active ? ' · on' : ''}
          </summary>
          <div className="border-t px-4 py-4">{sidebar}</div>
        </details>
        <div className="hidden lg:block">{sidebar}</div>
      </aside>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="t-small muted" aria-live="polite">
            <strong className="tabular-nums text-[var(--ink)]">{total}</strong> result{total === 1 ? '' : 's'}
            {q ? (
              <>
                {' '}for <strong className="text-[var(--ink)]">“{q}”</strong>
              </>
            ) : null}
          </p>
          <SortSelect value={filters.sort ?? ''} hrefFor={sortHrefs} />
        </div>

        {shown.length === 0 ? (
          <div className="mt-5 rounded-[var(--radius-lg)] border border-dashed bg-[var(--surface)] p-12 text-center">
            <p className="t-card-title">Nothing matches that</p>
            <p className="t-small muted mx-auto mt-1.5 max-w-sm">
              {active
                ? 'Try removing a filter, or search for something broader.'
                : 'Courses appear here as soon as they are published.'}
            </p>
            {active && (
              <Link href={basePath} className="mt-4 inline-flex h-10 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-4 text-sm font-medium">
                Show every course
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-3">
            {shown.map((c, i) => (
              <CourseListRow key={c.id} card={c} rating={ratings.get(c.id)} google={google} priority={i < 3} />
            ))}
          </div>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-6 flex items-center justify-center gap-1.5">
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <Link
                key={n}
                href={link('page', n === 1 ? '' : String(n))}
                aria-current={n === page ? 'page' : undefined}
                className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-medium ${
                  n === page ? 'text-[var(--brand-ink)]' : 'border hover:border-[var(--brand)]'
                }`}
                style={n === page ? { background: 'var(--brand)' } : undefined}
              >
                {n}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

function queryOf(filters: CatalogueFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v && k !== 'category' && k !== 'page') params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function withParam(base: string, filters: CatalogueFilters, key: string, value: string) {
  const params = new URLSearchParams();
  const merged: Record<string, string | undefined> = { ...filters, [key]: value || undefined };
  delete merged.category; // carried by the path, not the query string
  if (key !== 'page') delete merged.page; // a new filter starts from the first page
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
  const qs = params.toString();
  const path = key === 'category' && !value ? '/courses' : base;
  return qs ? `${path}?${qs}` : path;
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-bold">{title}</p>
      <ul className="mt-2 space-y-1">{children}</ul>
    </div>
  );
}

function FilterLink({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-2.5 py-1 text-sm transition hover:text-[var(--brand)] ${active ? 'font-semibold text-[var(--brand)]' : 'text-[var(--ink-2)]'}`}
      >
        <span
          aria-hidden
          className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? 'border-[var(--brand)]' : 'border-[var(--line-strong)]'}`}
        >
          {active && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--brand)' }} />}
        </span>
        <span className="flex-1">{children}</span>
        {count !== undefined && <span className="faint tabular-nums text-xs">{count}</span>}
      </Link>
    </li>
  );
}
