'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { linkParent, linkParentFromRecord, revokeParentLink } from '@/server/parent-links';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Checkbox, Field, FormError, FormSuccess, Input } from '@/components/ui';

/**
 * Who may sign in as this learner's parent. A link is made by the office
 * after checking the contact; revoking it ends the parent's view of this
 * child on their next request. The contacts on the learner's own record
 * are offered as one-press links, marked as coming from the record.
 */

export interface ParentLinkRow {
  id: string;
  name: string;
  relationship: string | null;
  contactMasked: string;
  status: 'ACTIVE' | 'REVOKED';
  verifiedHow: string | null;
  verifiedBy: string | null;
  verifiedOn: string | null;
  revokedOn: string | null;
  revokedReason: string | null;
}

export interface OnRecord {
  contact: string;
  masked: string;
  kind: 'phone' | 'email';
}

const initial: ActionState = {};

export function ParentLinks({
  learnerId,
  links,
  onRecord,
  limit,
  canEdit,
}: {
  learnerId: string;
  links: ParentLinkRow[];
  onRecord: OnRecord[];
  limit: number;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(linkParent, initial);
  const active = links.filter((l) => l.status === 'ACTIVE');
  const revoked = links.filter((l) => l.status === 'REVOKED');
  const full = active.length >= limit;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="font-medium">Linked parents</h3>
        <p className="t-small muted mt-1">
          These contacts can sign in at /parent and see this learner. Up to {limit} per child.
        </p>
        {active.length === 0 ? (
          <p className="t-small faint mt-4">No parent is linked. Nobody can see this learner from the parent view.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {active.map((l) => (
              <LinkRow key={l.id} link={l} canEdit={canEdit} />
            ))}
          </ul>
        )}
        {onRecord.length > 0 && canEdit && !full && (
          <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed p-3">
            <p className="t-small">On the learner&rsquo;s record, not yet linked:</p>
            <ul className="mt-2 space-y-2">
              {onRecord.map((r) => (
                <FromRecord key={r.contact} learnerId={learnerId} item={r} />
              ))}
            </ul>
          </div>
        )}
        {revoked.length > 0 && (
          <details className="mt-4">
            <summary className="t-small faint cursor-pointer">{revoked.length} revoked</summary>
            <ul className="mt-2 divide-y opacity-70">
              {revoked.map((l) => (
                <li key={l.id} className="py-2">
                  <p className="t-small">
                    {l.name} · {l.contactMasked}
                  </p>
                  <p className="t-micro faint">
                    Revoked {l.revokedOn}
                    {l.revokedReason ? `: ${l.revokedReason}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {canEdit && (
        <Card>
          <h3 className="font-medium">Link a parent</h3>
          <p className="t-small muted mt-1">
            Check the number or email against the file before linking: this is what opens the
            child&rsquo;s attendance, marks and fees to them.
          </p>
          {full ? (
            <p className="t-small mt-4 text-[var(--warn)]">This learner already has {limit} linked. Revoke one to add another.</p>
          ) : (
            <form action={action} className="mt-4 space-y-4">
              <input type="hidden" name="learnerId" value={learnerId} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Parent's name">
                  <Input name="name" required maxLength={120} />
                </Field>
                <Field label="Relationship" hint="Mother, father, guardian">
                  <Input name="relationship" maxLength={40} />
                </Field>
              </div>
              <Field label="Mobile number or email" hint="What they will sign in with">
                <Input name="contact" required autoComplete="off" />
              </Field>
              <Checkbox name="verified" label="I have checked this contact against the learner's file" />
              <FormError message={state.error} />
              <FormSuccess message={state.ok ? state.message : undefined} />
              <Button type="submit" disabled={pending}>
                {pending ? 'Linking…' : 'Link parent'}
              </Button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}

function LinkRow({ link, canEdit }: { link: ParentLinkRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {link.name}
            {link.relationship && <span className="t-small faint"> · {link.relationship}</span>}
          </p>
          <p className="t-small faint">
            {link.contactMasked}
            {' · '}
            {link.verifiedHow === 'record' ? 'from the record' : `checked by ${link.verifiedBy ?? 'the office'}`}
            {link.verifiedOn ? ` on ${link.verifiedOn}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="ok">can sign in</Badge>
          {canEdit && !asking && (
            <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
              Revoke
            </Button>
          )}
        </div>
      </div>
      {asking && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Field label="Why" hint="Goes on the record">
              <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await revokeParentLink(link.id, reason);
                if (res.error) setError(res.error);
                else {
                  setAsking(false);
                  router.refresh();
                }
              })
            }
          >
            {pending ? 'Revoking…' : 'Revoke access'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="t-small mt-1 text-[var(--bad)]">{error}</p>}
    </li>
  );
}

function FromRecord({ learnerId, item }: { learnerId: string; item: OnRecord }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="t-small">
        {item.masked} <span className="faint">({item.kind})</span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await linkParentFromRecord(learnerId, item.contact);
            if (res.error) setError(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? 'Linking…' : 'Link'}
      </Button>
      {error && <p className="t-small w-full text-[var(--bad)]">{error}</p>}
    </li>
  );
}
