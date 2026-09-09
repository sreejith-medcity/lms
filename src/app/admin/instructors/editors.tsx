'use client';

import { useActionState, useState } from 'react';
import { saveInstructorProfile } from '@/server/instructors';
import type { ActionState } from '@/server/courses';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Input,
  Textarea,
} from '@/components/ui';

const initial: ActionState = {};

export function InstructorCard({
  instructor,
  canEdit,
  currency,
}: {
  instructor: {
    id: string;
    name: string;
    email: string | null;
    headline: string;
    bio: string;
    expertise: string;
    hourlyRateRupees: number;
    isMentor: boolean;
    hideNameOnCards: boolean;
    batches: string[];
  };
  canEdit: boolean;
  currency: string;
}) {
  const [state, action, pending] = useActionState(saveInstructorProfile, initial);
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{instructor.name}</p>
          <p className="t-micro faint truncate">{instructor.email}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {instructor.isMentor && <Badge tone="brand">mentor</Badge>}
          {instructor.hideNameOnCards && <Badge tone="warn">not listed</Badge>}
        </div>
      </div>

      <p className="t-small muted mt-2">
        {instructor.batches.length > 0
          ? `Teaches ${instructor.batches.slice(0, 2).join(', ')}${instructor.batches.length > 2 ? ` and ${instructor.batches.length - 2} more` : ''}`
          : 'Not assigned to a batch'}
      </p>

      {!open ? (
        <>
          {instructor.headline ? (
            <p className="t-small mt-3">{instructor.headline}</p>
          ) : (
            <p className="t-small faint mt-3">No profile written yet.</p>
          )}
          {canEdit && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
              {instructor.headline ? 'Edit profile' : 'Write a profile'}
            </Button>
          )}
        </>
      ) : (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="userId" value={instructor.id} />

          <Field label="Headline" hint="One line, shown under their name.">
            <Input
              name="headline"
              defaultValue={instructor.headline}
              maxLength={120}
              placeholder="Goethe-certified B2 trainer, eleven years teaching"
            />
          </Field>

          <Field label="About them" hint="Two or three sentences.">
            <Textarea name="bio" rows={3} defaultValue={instructor.bio} maxLength={600} />
          </Field>

          <Field label="Subjects" hint="Separated by commas.">
            <Input
              name="expertise"
              defaultValue={instructor.expertise}
              maxLength={300}
              placeholder="German A1, A2, B1, exam technique"
            />
          </Field>

          <Field label={`Hourly rate (${currency})`} hint="Internal only. Zero to leave it unset.">
            <Input
              name="hourlyRateRupees"
              type="number"
              min={0}
              step="0.01"
              defaultValue={instructor.hourlyRateRupees}
            />
          </Field>

          <Checkbox name="isMentor" label="Available as a mentor" defaultChecked={instructor.isMentor} />
          <Checkbox
            name="hideNameOnCards"
            label="Do not name them publicly"
            hint="They still teach the batch; the public course page just does not list them."
            defaultChecked={instructor.hideNameOnCards}
          />

          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <button type="button" className="t-small faint hover:underline" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
