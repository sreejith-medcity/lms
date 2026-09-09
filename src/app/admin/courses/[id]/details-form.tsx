'use client';

import { useActionState, useState } from 'react';
import { updateCourse } from '@/server/courses';
import type { ActionState } from '@/server/courses';
import { Uploader } from '@/components/uploader';
import {
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

export interface OverviewBlock {
  heading?: string;
  body?: string;
  weight?: number;
}

export function DetailsForm({
  productId,
  title,
  course,
}: {
  productId: string;
  title: string;
  course: {
    description: string;
    level: string;
    language: string;
    prettyName: string;
    durationHours: number;
    promoVideoUrl: string;
    overviewLinkOverride: string;
    thumbnailAssetId: string | null;
    overviewBlocks: OverviewBlock[];
    modulesArePrerequisite: boolean;
    learnerCanComplete: boolean;
    milestoneCelebrations: boolean;
    accessAfterCompletion: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateCourse, initial);
  const [thumbnail, setThumbnail] = useState(course.thumbnailAssetId ?? '');
  const [blocks, setBlocks] = useState<OverviewBlock[]>(
    course.overviewBlocks.length ? course.overviewBlocks : [{ heading: '', body: '', weight: 0 }],
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="thumbnailAssetId" value={thumbnail} />

      <Card>
        <h2 className="t-heading">What it is</h2>
        <div className="mt-5 space-y-4">
          <FormError message={state.error} />
          <FormSuccess message={state.ok ? 'Saved.' : undefined} />

          <Field label="Name" hint="What learners see everywhere.">
            <Input name="title" defaultValue={title} required maxLength={100} />
          </Field>

          <Field label="Description" hint="Two or three sentences. It carries the course card.">
            <Textarea name="description" rows={4} maxLength={2000} defaultValue={course.description} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Level">
              <Input name="level" defaultValue={course.level} maxLength={50} placeholder="A1" />
            </Field>
            <Field label="Language">
              <Input name="language" defaultValue={course.language} maxLength={50} placeholder="German" />
            </Field>
            <Field label="Hours" hint="Total teaching time">
              <Input
                name="durationHours"
                type="number"
                min={0}
                max={2000}
                step="0.5"
                defaultValue={course.durationHours || ''}
              />
            </Field>
          </div>

          <Field label="Pretty name" hint="A shorter name for tight spaces. Optional.">
            <Input name="prettyName" defaultValue={course.prettyName} maxLength={120} />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">Thumbnail</h2>
        <p className="t-small muted mt-1">
          The image on the course card and at the top of the course page.
        </p>

        <div className="mt-4">
          {thumbnail ? (
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/assets/${thumbnail}`}
                alt=""
                className="h-24 w-40 rounded-[var(--radius-sm)] border object-cover"
              />
              <button type="button" className="t-small underline" onClick={() => setThumbnail('')}>
                Replace it
              </button>
            </div>
          ) : (
            <Uploader
              accept="image/*"
              label="Drop an image"
              hint="Landscape works best. It is cropped to fit a card."
              onUploaded={(asset) => setThumbnail(asset.id)}
            />
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="t-heading">Overview</h2>
          <span className="t-small faint">Ordered by weight, lowest first</span>
        </div>
        <p className="t-small muted mt-1">
          The blocks that make up the course page under the description: what it covers, who it is
          for, what you need before starting.
        </p>

        <div className="mt-4 space-y-3">
          {blocks.map((b, i) => (
            <div key={i} className="space-y-2 rounded-[var(--radius-sm)] border p-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    name="blockHeading"
                    value={b.heading ?? ''}
                    onChange={(e) =>
                      setBlocks((all) =>
                        all.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)),
                      )
                    }
                    maxLength={160}
                    placeholder="What this course covers"
                  />
                </div>
                <div className="w-20">
                  <Input
                    name="blockWeight"
                    type="number"
                    min={0}
                    max={99}
                    value={b.weight ?? i}
                    onChange={(e) =>
                      setBlocks((all) =>
                        all.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)),
                      )
                    }
                    aria-label="Weight"
                  />
                </div>
              </div>
              <Textarea
                name="blockBody"
                value={b.body ?? ''}
                onChange={(e) =>
                  setBlocks((all) => all.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))
                }
                rows={3}
                maxLength={2000}
              />
              {blocks.length > 1 && (
                <button
                  type="button"
                  className="t-small faint underline"
                  onClick={() => setBlocks((all) => all.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="t-small faint underline"
            onClick={() =>
              setBlocks((all) => [...all, { heading: '', body: '', weight: all.length }])
            }
          >
            Add a block
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">How it behaves</h2>
        <div className="mt-5 space-y-4">
          <Checkbox
            name="modulesArePrerequisite"
            label="Modules unlock in order"
            hint="A learner has to finish one module before the next opens."
            defaultChecked={course.modulesArePrerequisite}
          />
          <Checkbox
            name="learnerCanComplete"
            label="Learners mark lessons complete themselves"
            hint="Off, and only watching to the end counts."
            defaultChecked={course.learnerCanComplete}
          />
          <Checkbox
            name="milestoneCelebrations"
            label="Celebrate at 25, 50, 75 and 100 percent"
            defaultChecked={course.milestoneCelebrations}
          />
          <Checkbox
            name="accessAfterCompletion"
            label="Access continues after the batch ends"
            hint="Off, and access stops when the batch completes."
            defaultChecked={course.accessAfterCompletion}
          />

          <Field label="Promo video" hint="A YouTube link shown on the course page.">
            <Input name="promoVideoUrl" type="url" defaultValue={course.promoVideoUrl} placeholder="https://" />
          </Field>

          <Field
            label="Custom overview link"
            hint="Sends the Explore button somewhere else. Leave blank to use this course's own page."
          >
            <Input
              name="overviewLinkOverride"
              type="url"
              defaultValue={course.overviewLinkOverride}
              placeholder="https://"
            />
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save changes'}
        </Button>
        <FormSuccess message={state.ok ? 'Saved.' : undefined} />
      </div>
    </form>
  );
}
