'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importQuestions, type QuestionImportResult } from '@/server/question-import';
import { Badge, Button, Card, Cell, Row, Table, Textarea } from '@/components/ui';

/**
 * Check, then import. The check is the same parse the import runs, so the
 * table it shows is exactly what the second button will create.
 */
export function QuestionImporter({ bankId }: { bankId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [result, setResult] = useState<QuestionImportResult>();
  const form = useRef<HTMLFormElement>(null);

  function run(apply: boolean) {
    if (!form.current) return;
    const data = new FormData(form.current);
    start(async () => {
      const res = await importQuestions(bankId, data, apply);
      setResult(res);
      if (res.applied) router.refresh();
    });
  }

  const ready = text.trim().length > 0 || Boolean(fileName);
  const importable = result?.ok && !result.applied ? result.summary.parsed - result.summary.duplicates : 0;

  return (
    <div className="space-y-4">
      <form ref={form} onSubmit={(e) => e.preventDefault()}>
        <Card>
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="t-small block font-medium" htmlFor="file">
                A file
              </label>
              <p className="t-small faint mt-0.5">Word (.docx), CSV or plain text.</p>
              <input
                id="file"
                name="file"
                type="file"
                accept=".docx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="mt-3 block w-full text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border file:bg-[var(--surface)] file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(e) => {
                  setFileName(e.target.files?.[0]?.name);
                  setResult(undefined);
                }}
              />
            </div>
            <div>
              <label className="t-small block font-medium" htmlFor="text">
                Or paste the questions
              </label>
              <p className="t-small faint mt-0.5">Ignored when a file is chosen.</p>
              <div className="mt-3">
                <Textarea
                  id="text"
                  name="text"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setResult(undefined);
                  }}
                  rows={9}
                  className="font-mono text-xs"
                  placeholder={'1. Which vitamin is fat soluble?\na) Vitamin C\n*b) Vitamin D\nc) Vitamin B12\nExplanation: A, D, E and K.\nTags: nutrition'}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={pending || !ready} onClick={() => run(false)}>
              {pending ? 'Reading...' : 'Check the file'}
            </Button>
            {importable > 0 && (
              <Button type="button" disabled={pending} onClick={() => run(true)}>
                {pending ? 'Importing...' : `Import ${importable} question${importable === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
        </Card>
      </form>

      {result?.error && (
        <Card>
          <p className="t-small text-[var(--bad)]">{result.error}</p>
        </Card>
      )}

      {result && (result.rows.length > 0 || result.problems.length > 0) && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
            <h2 className="t-heading">{result.applied ? 'Imported' : 'What this would do'}</h2>
            {result.format && <Badge tone="neutral">{result.format === 'CSV' ? 'spreadsheet' : 'numbered list'}</Badge>}
            {result.applied ? (
              <Badge tone="ok">{result.summary.created} created</Badge>
            ) : (
              <Badge tone="ok">{result.summary.parsed - result.summary.duplicates} new</Badge>
            )}
            {result.summary.duplicates > 0 && <Badge tone="warn">{result.summary.duplicates} already in the bank</Badge>}
            {result.summary.problems > 0 && <Badge tone="bad">{result.summary.problems} with problems</Badge>}
          </div>

          {result.problems.length > 0 && (
            <div className="border-b bg-[var(--bad-soft)] px-5 py-3">
              <p className="t-small font-medium text-[var(--bad)]">
                These lines were not read as questions. Fix them in the file and check again; everything else
                {result.applied ? ' was' : ' will be'} imported without them.
              </p>
              <ul className="t-small mt-1.5 space-y-0.5 text-[var(--bad)]">
                {result.problems.slice(0, 40).map((p, i) => (
                  <li key={i}>
                    <span className="tabular-nums">Line {p.line}:</span> {p.message}
                  </li>
                ))}
                {result.problems.length > 40 && <li>and {result.problems.length - 40} more.</li>}
              </ul>
            </div>
          )}

          {result.rows.length > 0 && (
            <div className="max-h-[32rem] overflow-y-auto">
              <Table head={['Line', 'Question', 'Type', 'Answer', 'Level', 'Marks', 'Tags', '']}>
                {result.rows.map((r) => (
                  <Row key={r.line}>
                    <Cell className="t-small faint tabular-nums">{r.line}</Cell>
                    <Cell>
                      <span className="line-clamp-2 text-sm">{r.prompt}</span>
                    </Cell>
                    <Cell className="t-small">{r.type.toLowerCase().replace('_', ' ')}</Cell>
                    <Cell className="t-small tabular-nums">{r.answer}</Cell>
                    <Cell className="t-small">{r.difficulty.toLowerCase()}</Cell>
                    <Cell className="t-small tabular-nums">{r.marks}</Cell>
                    <Cell className="t-small">{r.tags.join(', ')}</Cell>
                    <Cell>{r.duplicate && <Badge tone="warn">skipped</Badge>}</Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
