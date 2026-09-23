'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { moveFilesToBucket, runEdmingleStep, setEdmingleAuto, testEdmingle, type EdmingleStep, type EdmingleStepState, type StorageMoveState } from '@/server/migration';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, FormError, FormSuccess } from '@/components/ui';

/**
 * The Edmingle steps, in the order they have to run. Each is bounded to
 * one request's worth of work and says how much is left, so a big library
 * comes across in presses rather than in one call that times out.
 */
const STEPS: { key: EdmingleStep; title: string; blurb: string; caution?: string; counts: string[] }[] = [
  {
    key: 'catalogue',
    title: 'Courses, modules, sections and lessons',
    blurb:
      'Every course in Edmingle becomes a draft course here, with its modules, sections and lessons in the same order and its picture. Lessons are created with their title, length and file name; the files follow in the next two steps.',
    caution:
      'Courses arrive as drafts with no price, so nothing goes on sale by accident. Pricing plans are set here, or come from the WooCommerce import below. Runs in chunks: press again until it reports nothing left.',
    counts: ['course', 'module', 'section', 'material'],
  },
  {
    key: 'files',
    title: 'Documents',
    blurb:
      'Every PDF, slide deck and document is pulled straight from Edmingle’s asset library into this library and attached to its lesson. About twenty-five a press, so a library of two thousand takes a while; nothing is lost between presses.',
    caution:
      'A document whose file name matches several assets of different sizes is reported rather than guessed at. A lesson that names a file the library does not have is set aside, listed below, and looked for again the next day.',
    counts: ['file'],
  },
  {
    key: 'prices',
    title: 'Prices',
    blurb: 'The price each course sells at on Edmingle becomes a one-time pricing plan here, only on courses that have no plan yet. Instalment schedules are set here by hand.',
    counts: ['price'],
  },
  {
    key: 'learners',
    title: 'Learners',
    blurb:
      'Every learner on Edmingle, with their registration number, contact details and parent details. Somebody who already has an account here is linked by email, not doubled. Nobody gets a password: they sign in with a code. About eight hundred a press.',
    caution: 'Religion, Aadhaar and similar fields on the Edmingle record are deliberately not read.',
    counts: ['learner'],
  },
  {
    key: 'batches',
    title: 'Batches',
    blurb: 'Every batch, under its course, with its dates; finished batches arrive as completed, archived ones as archived. Needs the courses step done first.',
    counts: ['batch'],
  },
  {
    key: 'enrolments',
    title: 'Enrolments',
    blurb: 'Who sits in which batch, read from each batch roll, with their progress. Needs learners and batches done first; a learner not yet here is reported and picked up on the next press.',
    caution: 'Attendance history, test results and certificates follow in the archive steps below.',
    counts: ['enrolment'],
  },
  {
    key: 'questions',
    title: 'Question banks',
    blurb:
      'Every question bank and its questions: choices with the right ones marked, blanks with the accepted answers, written answers for a trainer to mark. A question with several parts becomes several questions. Audio and pictures on questions do not come and are tagged "media to add".',
    counts: ['qbank', 'question'],
  },
  {
    key: 'videos',
    title: 'Videos',
    blurb:
      'Videos sit on Vimeo under Edmingle’s account and cannot be pulled. Ask Edmingle for the originals (the list of file names is below), upload them to this library, then press this: each lesson still waiting is matched to the video with the same file name.',
    counts: ['videos waiting'],
  },
  {
    key: 'staff',
    title: 'Archive: tutors',
    blurb:
      'Everyone who signs in to Edmingle’s admin side becomes a staff account here with the Instructor role, and is put on the batches Edmingle had them teaching. Somebody already on the team is linked by email. Nobody gets a password.',
    caution: 'Edmingle admins arrive as Instructors too: promote the ones who run the office under Team.',
    counts: ['staff', 'batch-tutor'],
  },
  {
    key: 'sessions',
    title: 'Archive: sessions',
    blurb:
      'Every class on Edmingle’s calendar, past and future, under the batch it was held for: held ones as completed with the register marked as taken, cancelled ones as cancelled, coming ones as scheduled. Needs batches and tutors done first.',
    counts: ['session'],
  },
  {
    key: 'attendance',
    title: 'Archive: attendance',
    blurb: 'Each learner’s present or absent for each session, read class by class from Edmingle’s registers. Needs sessions and enrolments done first. A batch or two a press; the background run gets through them.',
    counts: ['class-attendance'],
  },
  {
    key: 'progress',
    title: 'Archive: test results and lesson progress',
    blurb:
      'Every test a learner sat on Edmingle, with marks and pass or fail, kept as an archived test here (the marks come, the paper stays behind). Every lesson a learner opened is marked as done, so course progress carries over.',
    counts: ['class-progress', 'quiz'],
  },
  {
    key: 'certificates',
    title: 'Archive: certificates',
    blurb:
      'For every learner who finished a course Edmingle certifies, the certificate PDF Edmingle issued is pulled into this library and recorded against their enrolment, so it can be downloaded and verified here after Edmingle is gone.',
    counts: ['certificate'],
  },
];

export function EdmingleConsole({ connected, canApply, done, auto, bucket }: { connected: boolean; canApply: boolean; done: { entity: string; migrated: number }[]; auto: boolean; bucket: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [results, setResults] = useState<Record<string, EdmingleStepState>>({});
  const [connection, setConnection] = useState<ActionState>({});
  const [confirming, setConfirming] = useState<EdmingleStep | null>(null);
  const [autoState, setAutoState] = useState<ActionState>({});
  const [move, setMove] = useState<StorageMoveState | null>(null);
  const [confirmMove, setConfirmMove] = useState(false);
  const count = new Map(done.map((row) => [row.entity, row.migrated]));

  function run(step: EdmingleStep, apply: boolean) {
    start(async () => {
      const result = await runEdmingleStep(step, apply);
      setResults((prev) => ({ ...prev, [step]: result }));
      setConfirming(null);
      if (apply) router.refresh();
    });
  }

  const docsWaiting = count.get('documents waiting') ?? 0;
  const docsUnmatched = count.get('documents unmatched') ?? 0;
  const videosWaiting = count.get('videos waiting') ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Is Edmingle reachable</p>
            <p className="t-small muted">The key is the one from your own admin session, so a refusal here usually means it has been signed out since it was copied.</p>
          </div>
          <Button variant="secondary" disabled={busy || !connected} onClick={() => start(async () => setConnection(await testEdmingle()))}>
            {busy ? 'Checking...' : 'Check'}
          </Button>
        </div>
        <FormError message={connection.error} />
        <FormSuccess message={connection.ok ? connection.message : undefined} />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-medium">
              Carry on in the background
              {auto ? <Badge tone="ok">on</Badge> : <Badge tone="warn">off</Badge>}
            </p>
            <p className="t-small muted">
              Edmingle allows only a few calls a minute, so the whole library takes hours of presses. With this on, the scheduled job does a little of the next step each run, in
              order, until every step below reports nothing left: every five minutes with the messaging job alone, most of every minute once the host also calls <code>/api/cron/edmingle</code> each minute. What each run did shows on the Edmingle card&rsquo;s history under Integrations.
            </p>
            <p className="t-small faint mt-1">Same as pressing &ldquo;Do it for real&rdquo; on each step in turn: rehearse the steps you care about before switching it on.</p>
          </div>
          {canApply && (
            <Button
              variant={auto ? 'secondary' : 'primary'}
              disabled={busy || !connected}
              onClick={() =>
                start(async () => {
                  setAutoState(await setEdmingleAuto(!auto));
                  router.refresh();
                })
              }
            >
              {busy ? 'Working...' : auto ? 'Switch off' : 'Switch on'}
            </Button>
          )}
        </div>
        <FormError message={autoState.error} />
        <FormSuccess message={autoState.ok ? autoState.message : undefined} />
      </Card>

      <Card>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          Move earlier uploads to the bucket
          {bucket ? <Badge tone="ok">bucket connected</Badge> : <Badge tone="warn">no bucket yet</Badge>}
        </p>
        <p className="t-small muted mt-1">
          Files uploaded before the bucket existed sit on this server&rsquo;s disk and vanish with the next deployment. This copies them into the bucket under the same
          keys; nothing is deleted and nothing in the database changes, so it is safe to run while the site is up and safe to run twice. About a minute a press.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={busy || !bucket} onClick={() => start(async () => setMove(await moveFilesToBucket(false)))}>
            {busy ? 'Working...' : 'Rehearse'}
          </Button>
          {canApply && !confirmMove && (
            <Button disabled={busy || !bucket || !move} onClick={() => setConfirmMove(true)}>
              Copy them
            </Button>
          )}
          {canApply && confirmMove && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setMove(await moveFilesToBucket(true));
                    setConfirmMove(false);
                  })
                }
              >
                {busy ? 'Copying...' : 'Yes, copy'}
              </Button>
              <button type="button" className="t-small faint hover:underline" onClick={() => setConfirmMove(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
        {move && (
          <div className="mt-3 border-t pt-3">
            <FormError message={move.error} />
            <FormSuccess message={move.ok ? move.message : undefined} />
            {move.report && move.report.problems.length > 0 && (
              <div className="t-small muted mt-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">
                <ul className="space-y-1">
                  {move.report.problems.slice(0, 8).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                {move.report.problems.length > 8 && <p className="faint mt-1">and {move.report.problems.length - 8} more.</p>}
              </div>
            )}
          </div>
        )}
      </Card>

      {STEPS.map((step) => {
        const result = results[step.key];
        const across = step.counts.filter((c) => !c.endsWith('waiting')).reduce((n, c) => n + (count.get(c) ?? 0), 0);
        const waiting = step.key === 'files' ? docsWaiting : step.key === 'videos' ? videosWaiting : 0;
        return (
          <Card key={step.key}>
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {step.title}
              {across > 0 && step.key === 'catalogue' && (
                <Badge tone="ok">
                  {count.get('course') ?? 0} courses, {count.get('module') ?? 0} modules, {count.get('material') ?? 0} lessons across
                </Badge>
              )}
              {step.key === 'files' && (count.get('file') ?? 0) > 0 && <Badge tone="ok">{count.get('file')} files attached</Badge>}
              {step.key === 'questions' && across > 0 && (
                <Badge tone="ok">
                  {count.get('qbank') ?? 0} banks, {count.get('question') ?? 0} questions across
                </Badge>
              )}
              {['prices', 'learners', 'batches', 'enrolments', 'staff', 'sessions', 'certificates'].includes(step.key) && across > 0 && <Badge tone="ok">{across} across</Badge>}
              {['attendance', 'progress'].includes(step.key) && across > 0 && <Badge tone="ok">{count.get(step.counts[0]) ?? 0} classes read</Badge>}
              {waiting > 0 && <Badge tone="warn">{waiting} waiting</Badge>}
              {step.key === 'files' && docsUnmatched > 0 && <Badge tone="neutral">{docsUnmatched} without a file in Edmingle</Badge>}
            </p>
            <p className="t-small muted mt-1">{step.blurb}</p>
            {step.caution && <p className="t-small faint mt-1">{step.caution}</p>}
            {step.key === 'files' && docsUnmatched > 0 && (
              <p className="t-small mt-1">
                <a href="/admin/settings/migration/unmatched-documents.csv" className="underline">
                  Download the list of lessons whose file Edmingle&rsquo;s library does not have
                </a>{' '}
                <span className="faint">(the lesson, the file name it expects, and why it was set aside)</span>
              </p>
            )}
            {step.key === 'videos' && videosWaiting > 0 && (
              <p className="t-small mt-1">
                <a href="/admin/settings/migration/waiting-videos.csv" className="underline">
                  Download the list of video files the lessons are waiting for
                </a>{' '}
                <span className="faint">(send it with the export request to Edmingle)</span>
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={busy || !connected} onClick={() => run(step.key, false)}>
                {busy ? 'Working...' : 'Rehearse'}
              </Button>
              {canApply && confirming !== step.key && (
                <Button disabled={busy || !connected || !result} onClick={() => setConfirming(step.key)}>
                  Do it for real
                </Button>
              )}
              {canApply && confirming === step.key && (
                <>
                  <Button disabled={busy} onClick={() => run(step.key, true)}>
                    {busy ? 'Running...' : 'Yes, write it'}
                  </Button>
                  <button type="button" className="t-small faint hover:underline" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </>
              )}
              {!result && canApply && <span className="t-small faint">Rehearse it first.</span>}
            </div>

            {result && (
              <div className="mt-3 border-t pt-3">
                <FormError message={result.error} />
                <FormSuccess message={result.ok ? result.message : undefined} />
                {result.report && (
                  <div className="t-small muted mt-2 space-y-1">
                    <p>
                      Looked at {result.report.looked}. {result.report.wouldCreate} new, {result.report.wouldUpdate} attached, {result.report.alreadyDone} already done.
                    </p>
                    {result.report.samples.length > 0 && (
                      <ul className="font-mono text-xs">
                        {result.report.samples.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    )}
                    {result.report.problems.length > 0 && (
                      <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">
                        <p className="font-medium">Worth knowing</p>
                        <ul className="mt-1 space-y-1">
                          {result.report.problems.slice(0, 10).map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                        {result.report.problems.length > 10 && <p className="faint mt-1">and {result.report.problems.length - 10} more.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
