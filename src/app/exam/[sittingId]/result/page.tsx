import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { can } from '@/lib/permissions';
import { db } from '@/lib/db';
import { examFormat } from '@/lib/exams/registry';
import { modelAnswers, type PaperBlock } from '@/lib/exams/draw';
import { markPaper, typedCorrect, type Answers } from '@/lib/exams/score';
import { criteriaFor } from '@/lib/exams/marking';
import { paperOf } from '@/lib/exams/sittings';
import { geminiReady } from '@/lib/exams/gemini';
import { safeHtml, plainOf } from '@/lib/exams/html';
import { isAuto } from '@/lib/exams/types';
import { Refresher } from './refresher';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Result' };

const fmt = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(n * 100) / 100).replace('.', ','));
const html = (s: unknown) => ({ __html: safeHtml(s) });

/** What a letter means in this block: the option, heading, advert or word it stands for. */
function labelOf(block: PaperBlock, n: number, value: string | null | undefined): string {
  if (value == null || value === '') return '';
  if (block.layout === 'audioRF' || block.layout === 'textRF') return value === 'r' ? 'richtig' : value === 'f' ? 'falsch' : value;
  if (value === 'x') return 'x: keine passt';
  const item = (block.items ?? []).find((i) => i.n === n);
  const opt = item?.opts?.find((o) => o.k === value);
  if (opt) return `${value}: ${plainOf(opt.t ?? opt.h)}`;
  const bank = (block.bank as { k: string; t: string }[] | undefined)?.find((b) => b.k === value);
  if (bank) return `${value}: ${plainOf(bank.t)}`;
  const ad = (block.ads as { k: string; h: string }[] | undefined)?.find((a) => a.k === value);
  if (ad) return `${value}: ${plainOf(ad.h)}`;
  return value;
}

type Feedback = { marks?: { criterion: string; points: number; comment: string }[]; overall?: string };

export default async function ResultPage({ params }: { params: Promise<{ sittingId: string }> }) {
  const { sittingId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const s = await db.examSitting.findFirst({ where: { id: sittingId, organizationId: tenant.organizationId }, include: { user: { select: { name: true } } } });
  if (!s) notFound();
  const staff = user.kind === 'STAFF' && can(user.permissions, 'submission.view_submissions', 'view');
  if (s.userId !== user.id && !staff) notFound();
  if (s.status === 'IN_PROGRESS' && s.userId === user.id) redirect(`/exam/${s.id}`);
  const format = examFormat(s.formatCode);
  if (!format) notFound();

  const paper = paperOf(s);
  const answers = (s.answers ?? {}) as Answers;
  const scope = s.sectionId ? [s.sectionId] : null;
  const marking = markPaper(paper, answers, scope);
  const muster = modelAnswers(paper);
  const points = (s.points ?? {}) as Record<string, number | null>;
  const conditions = (Array.isArray(s.conditions) ? s.conditions : []) as { name: string; met: boolean; got: number; min: number; max: number }[];
  const subs = await db.examSubmission.findMany({ where: { organizationId: tenant.organizationId, sittingId: s.id } });
  const aiOn = await geminiReady(tenant.organizationId);
  const waiting = s.status === 'SUBMITTED';
  const modelWorking = waiting && aiOn && subs.some((x) => x.aiPoints == null && x.tutorPoints == null && !x.aiError);
  const modules = format.scoring.modules.filter((m) => format.blocks.some((b) => b.moduleId === m.id && (!scope || scope.includes(b.sectionId))));
  const guard = (s.guard ?? {}) as Record<string, number>;

  return (
    <div className="exam-result">
      {modelWorking && <Refresher />}
      <header className="exam-result-head">
        <p className="exam-eyebrow">{format.name}</p>
        <h1>{s.userId === user.id ? 'Ihr Ergebnis' : `Ergebnis: ${s.user.name}`}</h1>
        <p className="t-small muted">
          {s.submittedAt?.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone })}
          {s.minutes ? ` · ${s.minutes} Min.` : ''}
          {s.mode === 'practice' ? ' · Übungsmodus' : ''}
          {s.sectionId ? ` · nur ${format.sections.find((x) => x.id === s.sectionId)?.title ?? s.sectionId}` : ''}
        </p>
        <div className="exam-result-score">
          <div>
            <b>{fmt(s.total)}</b>
            <span> / {fmt(s.maxPoints)} Punkte</span>
          </div>
          {s.passed != null && <span className={`exam-pill ${s.passed ? 'ok' : 'bad'}`}>{s.passed ? 'bestanden' : 'nicht bestanden'}</span>}
          {waiting && <span className="exam-pill">Schreiben und Sprechen werden {aiOn ? 'bewertet' : 'von Ihrer Lehrkraft bewertet'}</span>}
        </div>
        {!scope && <p className="t-small muted mt-2">{format.passNote}</p>}
        {s.status === 'EVALUATED' && s.mode === 'exam' && !scope && (
          <p className="mt-3">
            <a className="exam-btn" href={`/api/tests/${s.id}/result-pdf`} target="_blank" rel="noopener">
              Ergebnis als PDF
            </a>
          </p>
        )}
      </header>

      <section className="exam-result-card">
        <h2>Die Prüfungsteile</h2>
        <ul className="exam-modules">
          {modules.map((m) => {
            const got = points[m.id];
            return (
              <li key={m.id}>
                <span>{m.name}</span>
                <span className="bar" aria-hidden>
                  <i style={{ width: `${got == null ? 0 : Math.min(100, (Number(got) / m.max) * 100)}%` }} />
                </span>
                <b>
                  {got == null ? 'offen' : fmt(Number(got))} / {m.max}
                </b>
              </li>
            );
          })}
        </ul>
        {conditions.length > 0 && (
          <ul className="exam-conditions">
            {conditions.map((c) => (
              <li key={c.name} className={c.met ? 'ok' : 'bad'}>
                {c.met ? '✓' : '✗'} {c.name}: {fmt(c.got)} von {c.max} (mindestens {c.min})
              </li>
            ))}
          </ul>
        )}
        <p className="t-small muted mt-3">
          {marking.correct} von {marking.items} Aufgaben richtig. Dies ist ein Übungstest im Format der Prüfung, kein Zertifikat; die Punkte sind eine Einschätzung.
        </p>
        {staff && (guard.leave || guard.copy || guard.translate) ? (
          <p className="t-small mt-2 text-[var(--warn)]">
            Fenster verlassen: {guard.leave ?? 0} · Kopierversuche: {guard.copy ?? 0} · Übersetzung: {guard.translate ?? 0}
          </p>
        ) : null}
      </section>

      {paper
        .filter((b) => (!scope || scope.includes(b.sectionId)) && isAuto(b.layout))
        .map((b) => (
          <section key={b.id} className="exam-result-card">
            <h2>
              {b.part}: {b.title}
            </h2>
            <table className="exam-review">
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Ihre Antwort</th>
                  <th>Richtig</th>
                  <th>Warum</th>
                </tr>
              </thead>
              <tbody>
                {(b.items ?? []).map((it) => {
                  const k = marking.keys[it.n];
                  const given = answers[String(it.n)] as string | null | undefined;
                  const typed = b.layout === 'formular' || b.layout === 'audioNotiz';
                  const ok = given != null && given !== '' ? (typed ? typedCorrect(it, given) : given === k?.key) : null;
                  const right = b.layout === 'formular' || b.layout === 'audioNotiz' ? [k?.key, ...(k?.alt ?? [])].filter(Boolean).join(' / ') : labelOf(b, it.n, k?.key);
                  return (
                    <tr key={it.n}>
                      <td>{it.no}</td>
                      <td className={given == null || given === '' ? 'muted' : ok === false ? 'bad' : ok ? 'ok' : ''}>
                        {given == null || given === '' ? 'keine' : b.layout === 'formular' || b.layout === 'audioNotiz' ? given : labelOf(b, it.n, given)}
                      </td>
                      <td>{right}</td>
                      <td className="t-small" dangerouslySetInnerHTML={html(k?.why ?? '')} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}

      {format.blocks
        .filter((d) => !isAuto(d.layout) && (!scope || scope.includes(d.sectionId)))
        .map((d) => {
          const sub = subs.find((x) => x.task === d.id);
          const fb = (sub?.aiFeedback ?? null) as Feedback | null;
          const criteria = criteriaFor(format, d);
          const choice = answers[`choice:${d.id}`] != null ? Number(answers[`choice:${d.id}`]) : null;
          const model = d.layout === 'speak' ? null : (muster[choice != null ? `${d.id}:${choice}` : d.id] ?? muster[d.id]);
          const final = sub?.tutorPoints ?? sub?.aiPoints ?? null;
          return (
            <section key={d.id} className="exam-result-card">
              <h2>
                {d.part}: {d.title}
                <span className="float-right">
                  {final == null ? (sub ? 'wird bewertet' : '0') : fmt(final)} / {fmt(criteria.reduce((a, c) => a + c.max, 0))}
                </span>
              </h2>
              {!sub && <p className="muted">Nicht bearbeitet.</p>}
              {sub?.kind === 'WRITING' && sub.text && <div className="exam-answer-text">{sub.text}</div>}
              {sub?.kind === 'SPEAKING' && sub.recordingAssetId && (
                <>
                  <audio controls src={`/api/tests/${s.id}/recording/${d.id}`} className="w-full" />
                  {sub.text && (
                    <details className="mt-2">
                      <summary className="t-small">Abschrift</summary>
                      <div className="exam-answer-text">{sub.text}</div>
                    </details>
                  )}
                </>
              )}
              {fb?.marks && (
                <ul className="exam-marks">
                  {fb.marks.map((m) => {
                    const c = criteria.find((x) => x.name === m.criterion);
                    return (
                      <li key={m.criterion}>
                        <div>
                          <b>{m.criterion}</b>
                          <p>{m.comment}</p>
                        </div>
                        <span>
                          {fmt(m.points)} / {fmt(c?.max)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {fb?.overall && <p className="exam-overall">{fb.overall}</p>}
              {sub?.tutorPoints != null && (
                <p className="exam-tutor">
                  Bewertung der Lehrkraft: <b>{fmt(sub.tutorPoints)}</b>
                  {sub.tutorNote ? `: ${sub.tutorNote}` : ''}
                </p>
              )}
              {sub?.aiError && sub.aiPoints == null && sub.tutorPoints == null && <p className="t-small muted">Die automatische Bewertung ist noch nicht durchgelaufen; sie wird wiederholt oder von einer Lehrkraft übernommen.</p>}
              {model && (
                <details className="exam-model">
                  <summary>Musterlösung ansehen</summary>
                  <div className="exam-answer-text">{model}</div>
                </details>
              )}
            </section>
          );
        })}

      <p className="mt-8">
        <Link href={s.userId === user.id ? '/learn/tests' : '/admin/tests'} className="exam-btn">
          {s.userId === user.id ? 'Zu meinen Tests' : 'Zurück'}
        </Link>
      </p>
    </div>
  );
}
