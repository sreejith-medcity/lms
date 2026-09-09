import Link from 'next/link';
import type { Metadata } from 'next';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Help',
  description: 'How enrolment, access, classes and recordings work here.',
  alternates: { canonical: '/help' },
};

/**
 * Every answer here describes something the platform actually does today. When a
 * capability lands, its answer is added; nothing is described in advance.
 */
export default async function HelpPage() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const groups: { title: string; items: [string, React.ReactNode][] }[] = [
    {
      title: 'Getting started',
      items: [
        [
          'Creating an account',
          'Use Get started, or Sign in if you already have one. One account covers every course you take here.',
        ],
        [
          'Finding the right course',
          <>
            Filter by subject, level and format on the{' '}
            <Link href="/courses" className="underline">
              courses page
            </Link>
            . Every course page states its format, duration and next batch.
          </>,
        ],
        [
          'Trying before you enrol',
          <>
            Courses can mark a lesson as a free preview. Where one exists you can{' '}
            <Link href="/sample" className="underline">
              open it without an account
            </Link>
            .
          </>,
        ],
      ],
    },
    {
      title: 'While you are learning',
      items: [
        [
          'Where do I start each day?',
          'Your learning page opens on what comes next, with today’s classes above it.',
        ],
        [
          'Does my progress save?',
          'Yes. Completion is recorded per lesson on the server, so it is the same on your phone and your laptop.',
        ],
        [
          'How is attendance recorded?',
          'Joining a live class from your dashboard marks you present, and marks you late if you join more than ten minutes in. Nobody has to keep a register.',
        ],
        [
          'I missed a class',
          'If a recording has been published for your batch, it appears on your course page and you can seek through it.',
        ],
      ],
    },
    {
      title: 'Account and access',
      items: [
        [
          'Changing my password',
          'Sign in and use the account settings. If you cannot sign in at all, contact support and we will help.',
        ],
        [
          'How long does access last?',
          'Each course states its access period on its pricing. Where none is stated, access does not expire.',
        ],
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
      <p className="t-small muted mt-1">
        How things work here. If your question is not answered,{' '}
        <Link href="/contact" className="underline">
          ask us
        </Link>
        .
      </p>

      <div className="mt-8 space-y-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-lg font-semibold">{g.title}</h2>
            <div className="mt-3 divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
              {g.items.map(([q, a]) => (
                <details key={q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                    {q}
                    <span aria-hidden className="faint transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="t-small muted mt-2 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
