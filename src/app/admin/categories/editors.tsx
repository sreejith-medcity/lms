'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  deleteCategory,
  saveCategory,
  setCategoryActive,
  setCourseCategories,
} from '@/server/catalogue';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
  _count: { courses: number; children: number };
}

interface Course {
  id: string;
  title: string;
  published: boolean;
  categoryIds: string[];
}

export function NewCategoryForm({ parents }: { parents: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveCategory, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Name">
        <Input name="name" required maxLength={80} placeholder="Nursing" />
      </Field>

      {parents.length > 0 && (
        <Field label="Inside" hint="Optional. Leave blank for a top-level category.">
          <Select name="parentId" defaultValue="">
            <option value="">Top level</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create category'}
      </Button>
    </form>
  );
}

export function CategoryList({
  categories,
  courses,
}: {
  categories: Category[];
  courses: Course[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {categories.map((c) => {
        const inside = courses.filter((course) => course.categoryIds.includes(c.id));
        const published = inside.filter((course) => course.published).length;

        return (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{c.name}</p>
                  {!c.isActive && <Badge tone="warn">hidden</Badge>}
                  {c.isActive && published === 0 && <Badge tone="neutral">nothing published</Badge>}
                </div>
                <p className="t-small faint mt-1 font-mono">/courses/{c.slug}</p>
                <p className="t-small faint mt-1 tabular-nums">
                  {inside.length} course{inside.length === 1 ? '' : 's'}
                  {inside.length > 0 ? `, ${published} published` : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOpen((o) => (o === c.id ? null : c.id))}
                >
                  {open === c.id ? 'Close' : 'Courses'}
                </Button>
                <ToggleActive id={c.id} isActive={c.isActive} />
                {c._count.courses === 0 && c._count.children === 0 && <Remove id={c.id} />}
              </div>
            </div>

            {open === c.id && (
              <div className="mt-4 border-t pt-4">
                <CoursePicker categoryId={c.id} courses={courses} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function CoursePicker({ categoryId, courses }: { categoryId: string; courses: Course[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <ul className="space-y-1">
      {courses.map((course) => {
        const inIt = course.categoryIds.includes(categoryId);
        return (
          <li key={course.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]">
              <input
                type="checkbox"
                checked={inIt}
                disabled={pending}
                onChange={() =>
                  start(async () => {
                    const next = inIt
                      ? course.categoryIds.filter((id) => id !== categoryId)
                      : [...course.categoryIds, categoryId];
                    const res = await setCourseCategories(course.id, next);
                    setError(res.error);
                    if (!res.error) router.refresh();
                  })
                }
                className="h-4 w-4 accent-[var(--brand)]"
              />
              {course.title}
              {!course.published && <span className="t-micro faint">draft</span>}
            </label>
          </li>
        );
      })}
      {error && <li className="t-small text-[var(--bad)]">{error}</li>}
    </ul>
  );
}

function ToggleActive({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setCategoryActive(id, !isActive);
          router.refresh();
        })
      }
    >
      {isActive ? 'Hide' : 'Show'}
    </Button>
  );
}

function Remove({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteCategory(id);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        Delete
      </Button>
      {error && <p className="t-small mt-1 text-[var(--bad)]">{error}</p>}
    </span>
  );
}
