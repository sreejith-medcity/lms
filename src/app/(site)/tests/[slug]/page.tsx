import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { getSessionUser } from '@/lib/auth';
import { NoTenantNotice } from '@/components/tenant-notices';
import { TrackEvent } from '@/components/track-event';
import { formatBySlug, FAMILY_NAMES } from '@/lib/exams/registry';
import { setCounts } from '@/lib/exams/content';
import { packsOnSale } from '@/lib/exams/packs';
import { sampleOn } from '@/lib/exams/sample';
import { syncCourseAllowances } from '@/lib/exams/course-allowances';
import { leftAt, type AllowanceRow } from '@/lib/exams/allowance';
import { WHAT_YOU_GET, minutesOf, moduleRows, passRule, whoFor } from '@/lib/exams/public-copy';
import { StartButtons } from '@/app/learn/tests/start-buttons';
import { PackCards } from '../pack-cards';
import { SampleButton } from './sample-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const format = formatBySlug((await params).slug);
  const site = await getSiteContext();
  if (!format) return { title: 'Test not found' };
  return {
    title: `${format.name} mock test online (${format.subtitle}) | ${site?.organization.name ?? ''}`.trim(),
    description: `A full ${format.name} practice paper in the format of the real exam: ${moduleRows(format)
      .map((m) => m.name.toLowerCase())
      .join(', ')}, on the clock, marked with comments. ${passRule(format)}`,
    alternates: { canonical: `/tests/${format.slug}` },
  };
}

export default async function TestPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;
  const format = formatBySlug(slug);
  if (!format) notFound();
  const orgId = site.organizationId;
  const [counts, packs, free, user] = await Promise.all([setCounts(orgId), packsOnSale(orgId, { familyCode: format.family, level: format.level }), sampleOn(orgId), getSessionUser()]);
  const live = (counts[format.code] ?? 0) > 0;
  const rows = moduleRows(format);

  /* Who is looking decides the button: a stranger is sent to sign up, a learner starts. */
  let left = 0;
  let hadSample = false;
  const signedIn = Boolean(user && user.organizationId === orgId);
  if (user && signedIn && user.kind !== 'STAFF') {
    await syncCourseAllowances(orgId, user.id);
    const rowsA = (await db.examAllowance.findMany({ where: { organizationId: orgId, userId: user.id, familyCode: format.family, revokedAt: null } })) as AllowanceRow[];
    left = leftAt(rowsA, format.family, format.level, new Date());
    /* Revoked or not: the free paper is once per person, ever. */
    hadSample = (await db.examAllowance.count({ where: { organizationId: orgId, userId: user.id, source: 'SAMPLE', familyCode: format.family, level: format.level } })) > 0;
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
      {sp.welcome && user && <TrackEvent once={`signup:${user.id}`} event={{ name: 'sign_up', eventId: `signup:${user.id}`, method: 'form' }} />}
      <p className="t-small">
        <Link href="/tests" className="underline">
          Mock tests
        </Link>{' '}
        / {FAMILY_NAMES[format.family] ?? format.family}
      </p>

      <div className="mt-4 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{format.name} mock test</h1>
          <p className="muted mt-1 text-lg">{format.subtitle}</p>
          <p className="mt-4 text-lg">{whoFor(format)}</p>
          <p className="muted mt-2">
            About {Math.round(minutesOf(format) / 5) * 5} minutes in all. {passRule(format)}
          </p>

          <h2 className="t-title mt-10">The paper</h2>
          <div className="mt-3 overflow-x-auto rounded-[var(--radius)] border bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-[var(--surface-2)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Part</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Tasks</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Time</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.own} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {r.name} {r.own !== r.name && <span className="faint">({r.own})</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.parts} part{r.parts === 1 ? '' : 's'}
                      {r.items ? ` · ${r.items} questions` : ''}
                    </td>
                    <td className="px-4 py-3">{r.minutes}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="t-title mt-10">What you get</h2>
          <ul className="mt-3 space-y-3">
            {WHAT_YOU_GET.map((w) => (
              <li key={w} className="flex gap-3">
                <span aria-hidden className="mt-1 text-[var(--brand)]">✓</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
          <p className="t-small faint mt-6">
            The paper itself is in {format.language === 'de' ? 'German' : 'English'}, as in the exam. Use a computer or a tablet with headphones and a microphone; the
            speaking part is recorded in the browser. Translation tools are switched off during the paper.
          </p>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-6 shadow-sm">
            {!live ? (
              <p className="muted">This test is being set up. Check back shortly.</p>
            ) : !signedIn ? (
              <>
                <p className="font-semibold">{free ? 'Your first paper is free' : 'Sit a paper'}</p>
                <p className="t-small muted mt-1">
                  {free ? 'Create an account and sit one full paper at this level, free, with the marking and feedback.' : 'Sign in to sit a paper from a pack or your course.'}
                </p>
                <a
                  href={`/tests/${format.slug}/join`}
                  className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-[var(--radius-sm)] px-5 text-sm font-semibold text-[var(--brand-ink)]"
                  style={{ background: 'var(--brand)' }}
                >
                  {free ? 'Create an account and start' : 'Create an account'}
                </a>
                <a href={`/tests/${format.slug}/join?login=1`} className="t-small mt-3 block text-center underline">
                  I have an account: sign in
                </a>
              </>
            ) : user?.kind === 'STAFF' ? (
              <>
                <p className="font-semibold">You are signed in as staff</p>
                <p className="t-small muted mt-1">Staff papers use no allowance and are not counted.</p>
                <div className="mt-4">
                  <StartButtons formatCode={format.code} practice label="Start a paper" />
                </div>
              </>
            ) : left > 0 ? (
              <>
                <p className="font-semibold">{left === Infinity ? 'Unlimited papers' : `${left} paper${left === 1 ? '' : 's'} left`} at this level</p>
                <div className="mt-4">
                  <StartButtons formatCode={format.code} practice label="Start a paper" />
                </div>
              </>
            ) : free && !hadSample ? (
              <>
                <p className="font-semibold">Your first paper is free</p>
                <p className="t-small muted mt-1">One full paper at this level, on the clock, with the marking and feedback.</p>
                <div className="mt-4">
                  <SampleButton formatCode={format.code} />
                </div>
              </>
            ) : (
              <>
                <p className="font-semibold">No papers left at this level</p>
                <p className="t-small muted mt-1">{packs.length ? 'A pack below gives you more.' : 'Ask us about more papers.'}</p>
              </>
            )}
            {signedIn && (
              <Link href="/learn/tests" className="t-small mt-4 block text-center underline">
                My tests and results
              </Link>
            )}
          </div>
        </aside>
      </div>

      <PackCards packs={packs} title="Packs for this test" />
      <p className="t-small faint mt-10 max-w-3xl">
        A practice paper in the format of the exam, written by our teachers. It is not an official paper and is not connected with the exam provider; the score is an
        indication of where you stand.
      </p>
    </div>
  );
}
