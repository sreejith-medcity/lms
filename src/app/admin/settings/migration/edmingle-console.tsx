'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runEdmingleStep, testEdmingle, type EdmingleStep, type EdmingleStepState } from '@/server/migration';
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
    caution: 'A document whose file name matches several assets of different sizes is reported rather than guessed at.',
    counts: ['file'],
  },
  {
    key: 'videos',
    title: 'Videos',
    blurb:
      'Videos sit on Vimeo under Edmingle’s account and cannot be pulled. Ask Edmingle for the originals (the list of file names is below), upload them to this library, then press this: each lesson still waiting is matched to the video with the same file name.',
    counts: ['videos waiting'],
  },
];

export function EdmingleConsole({ connected, canApply, done }: { connected: boolean; canApply: boolean; done: { entity: string; migrated: number }[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [results, setResults] = useState<Record<string, EdmingleStepState>>({});
  const [connection, setConnection] = useState<ActionState>({});
  const [confirming, setConfirming] = useState<EdmingleStep | null>(null);
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
              {waiting > 0 && <Badge tone="warn">{waiting} waiting</Badge>}
            </p>
            <p className="t-small muted mt-1">{step.blurb}</p>
            {step.caution && <p className="t-small faint mt-1">{step.caution}</p>}
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
