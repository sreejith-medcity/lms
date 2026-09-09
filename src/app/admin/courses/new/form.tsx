'use client';

import { useActionState } from 'react';
import { createCourse, type ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, Input, Select, Textarea, brandStyle } from '@/components/ui';

const initial: ActionState = {};

export function NewCourseForm({ categories }: { categories: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createCourse, initial);

  return (
    <form action={action}>
      <Card className="space-y-4">
        <FormError message={state.error} />

        <Field label="Course name">
          <Input name="title" required maxLength={100} placeholder="German Language - A1" />
        </Field>

        <Field label="Description" hint="Shown on the course page. You can refine this later.">
          <Textarea name="description" rows={4} maxLength={2000} />
        </Field>

        {categories.length > 0 && (
          <Field label="Category">
            <Select name="categoryId" defaultValue="">
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Button type="submit" disabled={pending} style={brandStyle}>
          {pending ? 'Creating...' : 'Create course'}
        </Button>
      </Card>
    </form>
  );
}
