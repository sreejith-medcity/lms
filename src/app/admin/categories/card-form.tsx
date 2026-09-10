'use client';

import { useActionState, useState } from 'react';
import { saveCategoryCard } from '@/server/catalogue';
import type { ActionState } from '@/server/courses';
import { Uploader } from '@/components/uploader';
import { IMAGE_ACCEPT } from '@/lib/image-formats';
import { Button, Checkbox, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

export interface CardValues {
  id: string;
  name: string;
  tagline: string | null;
  imageAssetId: string | null;
  ctaLabel: string | null;
  comingSoon: boolean;
  showOnHome: boolean;
  sortOrder: number;
}

/**
 * How a subject appears on the home page.
 *
 * Everything here is optional and the card degrades rather than breaks: no
 * picture gives a designed fallback, no tagline gives a shorter card, no
 * button label gives "Browse <name>". An academy can fill these in over a
 * week rather than having to do all of it before the page looks right.
 */
export function CategoryCardForm({ values }: { values: CardValues }) {
  const [state, action, pending] = useActionState(saveCategoryCard, initial);
  const [imageAssetId, setImageAssetId] = useState(values.imageAssetId ?? '');

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={values.id} />
      <input type="hidden" name="imageAssetId" value={imageAssetId} />

      <div className="flex flex-wrap items-start gap-4">
        <span className="block w-40 shrink-0 overflow-hidden rounded-[var(--radius)] border bg-[var(--surface-2)]">
          {imageAssetId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/api/assets/${imageAssetId}`} alt="" className="block w-full" />
          ) : (
            <span className="t-small faint grid aspect-[4/3] place-items-center px-2 text-center">
              No picture yet
            </span>
          )}
        </span>

        <div className="min-w-[16rem] flex-1 space-y-3">
          <Field label="One line about it" hint="Shown under the name on the card.">
            <Input
              name="tagline"
              defaultValue={values.tagline ?? ''}
              maxLength={160}
              placeholder="Build A1 to C2 speaking, listening, reading and writing skills."
            />
          </Field>

          <Field label="Button wording" hint={`Blank uses "Browse ${values.name}".`}>
            <Input
              name="ctaLabel"
              defaultValue={values.ctaLabel ?? ''}
              maxLength={48}
              placeholder={`Browse ${values.name} courses`}
            />
          </Field>

          <Field label="Position" hint="Lower numbers come first on the home page.">
            <Input
              name="sortOrder"
              type="number"
              min={0}
              max={999}
              defaultValue={values.sortOrder}
              className="w-24"
            />
          </Field>
        </div>
      </div>

      <Uploader
        accept={IMAGE_ACCEPT}
        label="Drop the card picture here"
        hint="or click to choose. A wide picture works best. PNG, JPEG, WebP, AVIF or SVG."
        onUploaded={(asset) => setImageAssetId(asset.id)}
      />

      <div className="space-y-2 border-t pt-3">
        <Checkbox
          name="showOnHome"
          label="Show this subject on the home page"
          defaultChecked={values.showOnHome}
        />
        <Checkbox
          name="comingSoon"
          label="Announce it as coming soon"
          hint="It gets a card and no link, which is the honest version of a subject with nothing published behind it yet."
          defaultChecked={values.comingSoon}
        />
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.message} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save card'}
      </Button>
    </form>
  );
}
