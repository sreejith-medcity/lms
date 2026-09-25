import Link from 'next/link';
import type { Metadata } from 'next';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { EmptyState } from '@/components/ui';
import { EXAM_FORMATS, FAMILY_NAMES } from '@/lib/exams/registry';
import { setCounts } from '@/lib/exams/content';
import { packsOnSale } from '@/lib/exams/packs';
import { sampleOn } from '@/lib/exams/sample';
import { FAMILY_BLURB, WHAT_YOU_GET, minutesOf, whoFor } from '@/lib/exams/public-copy';
import { PackCards } from './pack-cards';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  const name = site?.organization.name ?? 'Mock tests';
  return {
    title: `Mock tests: telc German A1 to B2 | ${name}`,
    description: 'Full mock exams in the format of the real test, marked the way the examiners mark: every part on the clock, a fresh paper every time, writing and speaking marked with comments.',
    alternates: { canonical: '/tests' },
  };
}

export default async function TestsHome() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;
  const [counts, packs, free] = await Promise.all([setCounts(site.organizationId), packsOnSale(site.organizationId), sampleOn(site.organizationId)]);
  const live = EXAM_FORMATS.filter((f) => (counts[f.code] ?? 0) > 0);
  const families = [...new Set(live.map((f) => f.family))];

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
      <header className="max-w-3xl">
        <p className="t-micro faint font-semibold uppercase tracking-wide">Mock tests</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Sit the exam before the exam.</h1>
        <p className="muted mt-3 text-lg">
          Complete papers in the format of the real test, on the real clock, marked against the examiners&apos; own criteria.{' '}
          {free ? 'Your first paper at each level is free: create an account and start.' : ''}
        </p>
      </header>

      {live.length === 0 ? (
        <div className="mt-10">
          <EmptyState title="Coming soon" hint="The mock tests are being set up. Check back shortly, or ask us about them." />
        </div>
      ) : (
        families.map((fam) => (
          <section key={fam} className="mt-12">
            <h2 className="t-title">{FAMILY_NAMES[fam] ?? fam}</h2>
            {FAMILY_BLURB[fam] && <p className="muted mt-1 max-w-3xl">{FAMILY_BLURB[fam]}</p>}
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {live
                .filter((f) => f.family === fam)
                .map((f) => (
                  <Link
                    key={f.code}
                    href={`/tests/${f.slug}`}
                    className="glass-card group flex flex-col rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm transition hover:border-[var(--brand)]"
                  >
                    <span className="t-micro faint font-semibold uppercase">{f.level ?? f.subtitle}</span>
                    <span className="mt-1 text-lg font-semibold">{f.name}</span>
                    <span className="t-small muted">{f.subtitle}</span>
                    <span className="t-small mt-3 flex-1">{whoFor(f)}</span>
                    <span className="t-small faint mt-4">
                      About {Math.round(minutesOf(f) / 5) * 5} minutes · {f.scoring.total} points
                    </span>
                    <span className="t-small mt-3 font-medium text-[var(--brand)] group-hover:underline">{free ? 'Try one paper free' : 'See the test'} →</span>
                  </Link>
                ))}
            </div>
            <PackCards packs={packs.filter((p) => p.familyCode === fam)} />
          </section>
        ))
      )}

      <section className="glass glass-rim relative mt-14 grid gap-8 rounded-[var(--radius)] border bg-[var(--surface)] p-6 sm:p-8 lg:grid-cols-[1fr_2fr]">
        <h2 className="t-title">What a paper gives you</h2>
        <ul className="space-y-3">
          {WHAT_YOU_GET.map((w) => (
            <li key={w} className="flex gap-3">
              <span aria-hidden className="mt-1 text-[var(--brand)]">✓</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="t-small faint mt-6 max-w-3xl">
        These are practice papers in the format of the exam, written by our teachers. They are not official papers and are not connected with the exam providers; the scores
        are an indication of where you stand.
      </p>
    </div>
  );
}
