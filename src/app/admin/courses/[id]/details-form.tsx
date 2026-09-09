'use client';

import { useActionState } from 'react';
import { updateCourse, type ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, Input, Textarea, brandStyle } from '@/components/ui';

const initial: ActionState = {};

interface CourseFields {
  description: string;
  level: string;
  language: string;
  promoVideoUrl: string;
  modulesArePrerequisite: boolean;
  learnerCanComplete: boolean;
  milestoneCelebrations: boolean;
  accessAfterCompletion: boolean;
}

export function DetailsForm({
  productId,
  title,
  course,
}: {
  productId: string;
  title: string;
  course: CourseFields;
}) {
  const [state, action, pending] = useActionState(updateCourse, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />

      <Card className="space-y-4">
        <FormError message={state.error} />
        {state.ok && <p className="text-sm text-[var(--ok)]">Saved.</p>}

        <Field label="Course name">
          <Input name="title" defaultValue={title} required maxLength={100} />
        </Field>

        <Field label="Description">
          <Textarea name="description" rows={5} maxLength={2000} defaultValue={course.description} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Level" hint="Beginner, Intermediate, and so on">
            <Input name="level" defaultValue={course.level} maxLength={50} />
          </Field>
          <Field label="Language" hint="The language of instruction">
            <Input name="language" defaultValue={course.language} maxLength={50} />
          </Field>
        </div>

        <Field label="Promo video URL" hint="Shown on the course landing page">
          <Input name="promoVideoUrl" type="url" defaultValue={course.promoVideoUrl} />
        </Field>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold muted">Progress and completion</h2>

        <Toggle
          name="modulesArePrerequisite"
          defaultChecked={course.modulesArePrerequisite}
          label="Modules must be completed in order"
          hint="Learners unlock each module by finishing the one before it."
        />
        <Toggle
          name="learnerCanComplete"
          defaultChecked={course.learnerCanComplete}
          label="Learners can mark the course complete"
        />
        <Toggle
          name="milestoneCelebrations"
          defaultChecked={course.milestoneCelebrations}
          label="Celebrate milestones"
          hint="Shows a moment at 25, 50, 75 and 100 percent."
        />
        <Toggle
          name="accessAfterCompletion"
          defaultChecked={course.accessAfterCompletion}
          label="Keep content available after the batch ends"
        />
      </Card>

      <Button type="submit" disabled={pending} style={brandStyle}>
        {pending ? 'Saving...' : 'Save changes'}
      </Button>
    </form>
  );
}

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1" />
      <span>
        <span className="block text-sm text-[var(--ink)]">{label}</span>
        {hint && <span className="block t-small faint">{hint}</span>}
      </span>
    </label>
  );
}
