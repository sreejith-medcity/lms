import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import type { $Enums } from '@prisma/client';
import { Badge, Card, EmptyState, LinkButton } from '@/components/ui';
import { QuestionForm, DeleteQuestion } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const TYPE_LABELS: Record<string, string> = {
  MCQ_SINGLE: 'Single answer',
  MCQ_MULTI: 'Multiple answers',
  TRUE_FALSE: 'True or false',
  SHORT_ANSWER: 'Short written',
  LONG_ANSWER: 'Long written',
};

const PAGE = 50;

export default async function BankPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; tag?: string; type?: string; level?: string; page?: string }>;
}) {
  const { id } = await params;
  const { q, tag, type, level, page: pageRaw } = await searchParams;
  const tenant = await requireTenant();
  await requireStaff('question_bank.manage_questions', 'view');

  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);

  const where = {
    bankId: id,
    ...(q ? { promptHtml: { contains: q, mode: 'insensitive' as const } } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(type ? { type: type as $Enums.QuestionType } : {}),
    ...(level ? { difficulty: level as $Enums.Difficulty } : {}),
  };

  const bank = await db.questionBank.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      name: true,
      exam: true,
      subject: true,
      _count: { select: { questions: true } },
      questions: {
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: {
          id: true,
          type: true,
          promptHtml: true,
          difficulty: true,
          marks: true,
          negativeMarks: true,
          tags: true,
          options: { orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, isCorrect: true } },
          _count: { select: { answers: true, items: true } },
        },
      },
    },
  });
  if (!bank) notFound();

  const [matching, tagRows] = await Promise.all([
    db.question.count({ where }),
    // tenant-safe: the bank was loaded scoped to this academy above.
    db.question.findMany({ where: { bankId: id }, select: { tags: true } }),
  ]);

  const tagCounts = new Map<string, number>();
  for (const row of tagRows) for (const t of row.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const filtered = Boolean(q || tag || type || level);
  const pages = Math.max(1, Math.ceil(matching / PAGE));
  const link = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, tag, type, level, ...over })) if (v) params.set(k, v);
    const str = params.toString();
    return `/admin/question-bank/${bank.id}${str ? `?${str}` : ''}`;
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/question-bank" className="t-small faint hover:underline">
            Question bank
          </Link>
          <h1 className="t-title mt-1">{bank.name}</h1>
          <p className="t-small faint mt-1">
            {[bank.exam, bank.subject].filter(Boolean).join(' · ')}
            {bank.exam || bank.subject ? ' · ' : ''}
            {bank._count.questions} question{bank._count.questions === 1 ? '' : 's'}
            {filtered ? `, ${matching} matching` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/admin/question-bank/${bank.id}/import`} size="sm" variant="secondary">
            Import from a file
          </LinkButton>
          {bank._count.questions > 0 && (
            <>
              <a
                href={`/admin/question-bank/${bank.id}/export`}
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border px-3 text-sm font-medium hover:bg-[var(--surface-2)]"
              >
                Export CSV
              </a>
              <LinkButton href={`/admin/assessments/generate?bank=${bank.id}`} size="sm">
                Generate a paper
              </LinkButton>
            </>
          )}
        </div>
      </div>

      {bank._count.questions > 0 && (
        <div className="mb-5 space-y-3">
          <form action={`/admin/question-bank/${bank.id}`} method="get" className="flex flex-wrap items-center gap-2">
            {tag && <input type="hidden" name="tag" value={tag} />}
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search the question text"
              className="h-9 min-w-[14rem] flex-1 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm"
              aria-label="Search"
            />
            <select name="type" defaultValue={type ?? ''} className="h-9 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-sm" aria-label="Type">
              <option value="">Any type</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select name="level" defaultValue={level ?? ''} className="h-9 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-sm" aria-label="Difficulty">
              <option value="">Any level</option>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
            <button type="submit" className="h-9 rounded-[var(--radius-sm)] border px-3 text-sm font-medium hover:bg-[var(--surface-2)]">
              Filter
            </button>
            {filtered && (
              <Link href={`/admin/question-bank/${bank.id}`} className="t-small underline">
                Clear
              </Link>
            )}
          </form>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.slice(0, 40).map(([t, n]) => {
                const active = tag === t;
                return (
                  <Link
                    key={t}
                    href={link({ tag: active ? undefined : t, page: undefined })}
                    className={`t-small rounded-full border px-2.5 py-0.5 ${
                      active ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {t} <span className="faint tabular-nums">{n}</span>
                  </Link>
                );
              })}
              {tags.length > 40 && <span className="t-small faint self-center">and {tags.length - 40} more tags</span>}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {bank.questions.length === 0 ? (
            filtered ? (
              <EmptyState title="Nothing matches" hint="Try a different search or clear the filter." />
            ) : (
              <EmptyState
                title="Nothing in this bank yet"
                hint="Write the first question beside, or import a whole set from Word or a spreadsheet."
              />
            )
          ) : (
            bank.questions.map((q) => (
              <Card key={q.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="brand">{TYPE_LABELS[q.type] ?? q.type}</Badge>
                      <Badge tone="neutral">{q.difficulty.toLowerCase()}</Badge>
                      <span className="t-small faint tabular-nums">
                        {q.marks} mark{q.marks === 1 ? '' : 's'}
                        {q.negativeMarks > 0 ? `, −${q.negativeMarks} wrong` : ''}
                      </span>
                      {q._count.items > 0 && (
                        <Badge tone="ok">in {q._count.items} assessment{q._count.items === 1 ? '' : 's'}</Badge>
                      )}
                    </div>

                    <p className="mt-2 text-sm">{q.promptHtml}</p>

                    {q.options.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {q.options.map((o) => (
                          <li key={o.id} className="t-small flex items-center gap-2">
                            <span
                              aria-hidden
                              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                                o.isCorrect ? 'border-transparent text-white' : 'text-transparent'
                              }`}
                              style={o.isCorrect ? { background: 'var(--ok)' } : undefined}
                            >
                              ✓
                            </span>
                            <span className={o.isCorrect ? 'font-medium' : 'muted'}>{o.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {q.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {q.tags.map((t) => (
                          <span key={t} className="t-micro faint rounded-full border px-2 py-0.5">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <DeleteQuestion id={q.id} answered={q._count.answers} />
                </div>
              </Card>
            ))
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <span className="t-small faint tabular-nums">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={link({ page: String(page - 1) })} className="t-small underline">
                    Previous
                  </Link>
                )}
                {page < pages && (
                  <Link href={link({ page: String(page + 1) })} className="t-small underline">
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <Card className="sticky top-6">
            <h2 className="t-heading">Add a question</h2>
            <div className="mt-5">
              <QuestionForm bankId={bank.id} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
