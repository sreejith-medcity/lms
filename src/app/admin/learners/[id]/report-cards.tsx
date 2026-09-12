'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteReportCard, issueReportCard, sendReportCard } from '@/server/report-cards';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export interface ReportCardRow {
  id: string;
  title: string;
  issuedOn: string;
  sentOn: string | null;
  course: string;
  overall: string;
}

export function ReportCards({
  learnerId,
  enrolments,
  cards,
  canEdit,
  parentOnFile,
}: {
  learnerId: string;
  enrolments: { id: string; label: string }[];
  cards: ReportCardRow[];
  canEdit: boolean;
  parentOnFile: boolean;
}) {
  const [state, action, pending] = useActionState(issueReportCard, initial);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      setOpen(false);
    }
  }, [state, router]);

  return (
    <div className="space-y-3">
      {cards.length === 0 ? (
        <p className="t-small muted">No report cards yet.</p>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {cards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="t-small block font-medium">
                    {c.title} <span className="faint">· {c.course}</span>
                  </span>
                  <span className="t-micro faint block">
                    {c.issuedOn} · {c.overall}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {c.sentOn ? <Badge tone="ok">sent {c.sentOn}</Badge> : <Badge tone="neutral">not sent</Badge>}
                  <a href={`/api/report-cards/${c.id}/pdf`} target="_blank" rel="noreferrer" className="t-small underline">
                    PDF
                  </a>
                  {canEdit && !c.sentOn && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          start(async () => {
                            const r = await sendReportCard(c.id);
                            setNote(r.error ?? r.message);
                            router.refresh();
                          })
                        }
                      >
                        Send
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          start(async () => {
                            const r = await deleteReportCard(c.id);
                            setNote(r.error);
                            router.refresh();
                          })
                        }
                      >
                        Discard
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {note && <p className="t-small muted">{note}</p>}

      {canEdit && enrolments.length > 0 && (
        !open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Issue a report card
          </Button>
        ) : (
          <Card>
            <form action={action} className="space-y-3">
              <FormError message={state.error} />
              <FormSuccess message={state.ok ? state.message : undefined} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="For">
                  <Select name="enrollmentId" required>
                    {enrolments.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Title">
                  <Input name="title" defaultValue="Progress report" maxLength={120} required />
                </Field>
                <Field label="From" hint="Blank means since enrolment.">
                  <Input name="periodFrom" type="date" />
                </Field>
                <Field label="To" hint="Blank means today.">
                  <Input name="periodTo" type="date" />
                </Field>
              </div>
              <Field label="Trainer's remark" hint="The line a parent reads twice. Optional.">
                <Textarea name="remark" rows={3} maxLength={2000} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Working it out...' : 'Issue'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <span className="t-small faint">{parentOnFile ? 'Sending goes to the learner and the parent on file.' : 'No parent contact on file; sending goes to the learner only.'}</span>
              </div>
            </form>
          </Card>
        )
      )}
    </div>
  );
}
