'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBundle, deleteBundle } from '@/server/learning-paths';
import type { ActionState } from '@/server/courses';
import { Button, Card, Checkbox, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';
import { Uploader } from '@/components/uploader';
import { IMAGE_ACCEPT } from '@/lib/image-formats';

const initial: ActionState = {};

export interface BundleCourseOption {
  productId: string;
  title: string;
  priceLabel: string;
  published: boolean;
}

/**
 * A bundle is a name, a picture, a blurb and an ordered list of courses.
 * Its price lives in pricing plans like any product, set on the same page,
 * and the saving against buying the courses one by one is computed from
 * those, never typed in.
 */
export function BundleForm({
  bundle,
  courses,
  canDelete,
}: {
  bundle: {
    id: string;
    title: string;
    description: string;
    thumbnailAssetId: string | null;
    isFeatured: boolean;
    courseProductIds: string[];
  } | null;
  courses: BundleCourseOption[];
  canDelete: boolean;
}) {
  const [state, action, pending] = useActionState(saveBundle, initial);
  const [thumbnail, setThumbnail] = useState(bundle?.thumbnailAssetId ?? '');
  const [chosen, setChosen] = useState<string[]>(bundle?.courseProductIds ?? []);
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string>();
  const router = useRouter();

  const byId = new Map(courses.map((c) => [c.productId, c]));
  const available = courses.filter((c) => !chosen.includes(c.productId));

  function move(id: string, dir: -1 | 1) {
    setChosen((list) => {
      const i = list.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <form action={action} className="space-y-5">
      {bundle && <input type="hidden" name="id" value={bundle.id} />}
      <input type="hidden" name="thumbnailAssetId" value={thumbnail} />
      {chosen.map((id) => (
        <input key={id} type="hidden" name="courseProductId" value={id} />
      ))}

      <Card>
        <h2 className="t-heading">What it is</h2>
        <div className="mt-5 space-y-4">
          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />
          <Field label="Name" hint="What buyers see on the card and the page, for example German A1 + A2.">
            <Input name="title" defaultValue={bundle?.title ?? ''} required maxLength={100} />
          </Field>
          <Field label="Description" hint="Two or three sentences on why these courses belong together.">
            <Textarea name="description" rows={4} maxLength={2000} defaultValue={bundle?.description ?? ''} />
          </Field>
          <Checkbox
            name="isFeatured"
            label="Feature it"
            hint="Featured products come first in the catalogue."
            defaultChecked={bundle?.isFeatured ?? false}
          />
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">Courses inside</h2>
        <p className="t-small muted mt-1">
          In the order a learner should take them. Buying the bundle enrols them in each one.
        </p>

        {chosen.length > 0 && (
          <ol className="mt-4 divide-y rounded-[var(--radius-sm)] border">
            {chosen.map((id, i) => {
              const c = byId.get(id);
              return (
                <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="t-small w-6 tabular-nums faint">{i + 1}.</span>
                  <span className="t-small min-w-0 flex-1 font-medium">
                    {c?.title ?? 'Course'}
                    {c && !c.published && <span className="faint font-normal"> · not published</span>}
                  </span>
                  <span className="t-small faint tabular-nums">{c?.priceLabel}</span>
                  <span className="flex gap-1">
                    <button type="button" className="t-small px-1" onClick={() => move(id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" className="t-small px-1" onClick={() => move(id, 1)} disabled={i === chosen.length - 1} aria-label="Move down">↓</button>
                    <button type="button" className="t-small px-1 underline" style={{ color: 'var(--bad)' }} onClick={() => setChosen((l) => l.filter((x) => x !== id))}>
                      Remove
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {available.length > 0 ? (
          <div className="mt-4">
            <Field label="Add a course">
              <select
                className="h-10 w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm"
                value=""
                onChange={(e) => {
                  if (e.target.value) setChosen((l) => [...l, e.target.value]);
                }}
              >
                <option value="">Pick a course</option>
                {available.map((c) => (
                  <option key={c.productId} value={c.productId}>
                    {c.title} · {c.priceLabel}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          chosen.length === 0 && <p className="t-small faint mt-4">No courses to choose from yet.</p>
        )}
      </Card>

      <Card>
        <h2 className="t-heading">Picture</h2>
        <p className="t-small muted mt-1">On the catalogue card and at the top of the bundle page. Leave it out to use the first course&apos;s.</p>
        <div className="mt-4">
          {thumbnail ? (
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${thumbnail}`} alt="" className="h-24 w-40 rounded-[var(--radius-sm)] border object-cover" />
              <button type="button" className="t-small underline" onClick={() => setThumbnail('')}>
                Replace it
              </button>
            </div>
          ) : (
            <Uploader accept={IMAGE_ACCEPT} label="Drop an image" hint="Landscape works best." onUploaded={(asset) => setThumbnail(asset.id)} />
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : bundle ? 'Save' : 'Create the bundle'}
        </Button>
        {bundle && canDelete && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await deleteBundle(bundle.id);
                if (r.error) setProblem(r.error);
                else router.push('/admin/bundles');
              })
            }
          >
            Delete
          </Button>
        )}
        {problem && <FormError message={problem} />}
      </div>
    </form>
  );
}
