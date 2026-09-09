'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importLearners, type ImportResult } from '@/server/import';
import { toCsv } from '@/lib/csv';
import { Badge, Button, Card, Cell, Row, Table, Textarea } from '@/components/ui';

/**
 * Dry run, then apply. The result of the dry run is what the apply promises to
 * do, so the second button is never a leap of faith.
 */
export function Importer() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult>();

  function run(apply: boolean) {
    start(async () => {
      const res = await importLearners(csv, apply);
      setResult(res);
      if (res.applied) router.refresh();
    });
  }

  function download() {
    if (!result) return;
    const rows = [
      ['line', 'name', 'email', 'phone', 'course', 'outcome', 'detail', 'password'],
      ...result.rows.map((r) => [
        r.line,
        r.name,
        r.email,
        r.phone,
        r.course,
        r.outcome,
        r.detail,
        r.password ?? '',
      ]),
    ];
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-result.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <label className="t-small block font-medium" htmlFor="csv">
          Paste the file
        </label>
        <p className="t-small faint mt-0.5">
          Open the CSV in a text editor and paste it here, header row included.
        </p>
        <div className="mt-3">
          <Textarea
            id="csv"
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setResult(undefined);
            }}
            rows={10}
            className="font-mono text-xs"
            placeholder="name,email,phone,course"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending || csv.trim().length < 10} onClick={() => run(false)}>
            {pending ? 'Checking...' : 'Check the file'}
          </Button>

          {result?.ok && !result.applied && (
            <Button disabled={pending} onClick={() => run(true)}>
              {pending
                ? 'Importing...'
                : `Import ${result.summary.created + result.summary.matched} learner${
                    result.summary.created + result.summary.matched === 1 ? '' : 's'
                  }`}
            </Button>
          )}
        </div>
      </Card>

      {result?.error && (
        <Card>
          <p className="t-small text-[var(--bad)]">{result.error}</p>
        </Card>
      )}

      {result?.ok && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="t-heading">
                {result.applied ? 'Imported' : 'What this would do'}
              </h2>
              <Badge tone="ok">{result.summary.created} new</Badge>
              <Badge tone="neutral">{result.summary.matched} matched</Badge>
              <Badge tone="brand">{result.summary.enrolled} enrolled</Badge>
              {result.summary.skipped > 0 && (
                <Badge tone="warn">{result.summary.skipped} skipped</Badge>
              )}
              {result.summary.failed > 0 && (
                <Badge tone="bad">{result.summary.failed} with errors</Badge>
              )}
            </div>
            <button type="button" className="t-small underline" onClick={download}>
              Download the result
            </button>
          </div>

          {result.applied && result.summary.created > 0 && (
            <p className="t-small border-b bg-[var(--warn-soft)] px-5 py-3 text-[var(--warn)]">
              The one-time passwords are in this table and in the download, and are not shown
              again. Nothing was emailed.
            </p>
          )}

          <div className="max-h-[28rem] overflow-y-auto">
            <Table head={['Line', 'Learner', 'Outcome', 'What happens', 'Password']}>
              {result.rows.map((r) => (
                <Row key={r.line}>
                  <Cell className="t-small faint tabular-nums">{r.line}</Cell>
                  <Cell>
                    <span className="text-sm">{r.name || <span className="faint">—</span>}</span>
                    <span className="t-small faint block">{r.email || r.phone}</span>
                  </Cell>
                  <Cell>
                    <Badge
                      tone={
                        r.outcome === 'error'
                          ? 'bad'
                          : r.outcome === 'skip'
                            ? 'warn'
                            : r.outcome === 'match'
                              ? 'neutral'
                              : 'ok'
                      }
                    >
                      {r.outcome}
                    </Badge>
                  </Cell>
                  <Cell className="t-small muted">{r.detail}</Cell>
                  <Cell className="font-mono text-xs">{r.password ?? ''}</Cell>
                </Row>
              ))}
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
