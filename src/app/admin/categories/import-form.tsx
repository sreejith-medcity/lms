'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importSubjects, type SubjectImportResult } from '@/server/import-subjects';
import { Badge, Button, Card, FormError, Textarea } from '@/components/ui';

/**
 * Bringing the subject cards in from a file.
 *
 * Two buttons, in order, and the second one does not appear until the first
 * has run. Reading the file and writing from it are different decisions, and
 * an importer that does both on one click is one misread column away from
 * rewriting a catalogue.
 */
export function SubjectImportForm() {
  const [csv, setCsv] = useState('');
  const [checked, setChecked] = useState<SubjectImportResult | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = (apply: boolean) =>
    start(async () => {
      setError(undefined);
      const result = await importSubjects(csv, apply);
      if (!result.ok) {
        setError(result.error);
        setChecked(null);
        return;
      }
      setChecked(result);
      if (apply) {
        setCsv('');
        router.refresh();
      }
    });

  return (
    <Card>
      <h2 className="t-heading">Import subjects from a file</h2>
      <p className="t-small muted mt-1 max-w-prose">
        One row per subject, with a header row. Columns: <code>Name</code>, <code>Tagline</code>,{' '}
        <code>Button</code>, <code>Image URL</code>, <code>Coming soon</code>, <code>Order</code>.
        Only the name is required. A picture is fetched from its address and saved here, so the
        old site can be turned off later without the artwork going with it.
      </p>

      <div className="mt-4 space-y-3">
        <input
          type="file"
          accept=".csv,text/csv"
          className="t-small block w-full"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setChecked(null);
            setCsv(await file.text());
          }}
        />

        <Textarea
          rows={6}
          value={csv}
          placeholder="or paste the file here"
          className="font-mono text-[0.75rem]"
          onChange={(e) => {
            setChecked(null);
            setCsv(e.target.value);
          }}
        />

        <FormError message={error} />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !csv.trim()}
            onClick={() => run(false)}
          >
            {pending ? 'Reading...' : 'Check the file'}
          </Button>

          {checked && !checked.applied && (
            <Button type="button" disabled={pending} onClick={() => run(true)}>
              {pending
                ? 'Importing...'
                : `Import ${checked.wouldCreate + checked.wouldUpdate} subject${
                    checked.wouldCreate + checked.wouldUpdate === 1 ? '' : 's'
                  }`}
            </Button>
          )}
        </div>

        {checked && (
          <div className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={checked.applied ? 'ok' : 'neutral'}>
                {checked.applied ? 'done' : 'nothing written yet'}
              </Badge>
              <span className="t-small tabular-nums">
                {checked.wouldCreate} new, {checked.wouldUpdate} updated, {checked.imagesFetched}{' '}
                picture{checked.imagesFetched === 1 ? '' : 's'}
              </span>
            </div>

            {checked.problems.length > 0 && (
              <ul className="t-small mt-3 space-y-1" style={{ color: 'var(--warn)' }}>
                {checked.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}

            <ul className="t-small muted mt-3 max-h-52 space-y-1 overflow-y-auto">
              {checked.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
