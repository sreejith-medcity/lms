'use client';

import { useState, useTransition } from 'react';
import { saveSetting } from '@/server/settings';
import { Uploader } from '@/components/uploader';
import { IMAGE_ACCEPT } from '@/lib/image-formats';
import { Button, FormError, FormSuccess } from '@/components/ui';

/**
 * The photograph at the top of the home page.
 *
 * It lives here rather than in the settings list because it is a file, and a
 * text box holding an asset id is not something anybody should have to fill
 * in by hand. The hero renders perfectly well without one, so removing it is
 * a first-class action rather than clearing a field.
 */
export function HeroImageForm({ assetId, canEdit }: { assetId: string; canEdit: boolean }) {
  const [current, setCurrent] = useState(assetId);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();

  const save = (value: string, done: string) =>
    start(async () => {
      setError(undefined);
      setMessage(undefined);
      const res = await saveSetting('website.heroImageAssetId', value);
      if (res.error) {
        setError(res.error);
        return;
      }
      setCurrent(value);
      setMessage(done);
    });

  return (
    <div className="space-y-3">
      {current ? (
        <div className="flex flex-wrap items-start gap-4">
          <span className="block w-56 overflow-hidden rounded-[var(--radius)] border bg-[var(--surface-2)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/assets/${current}`} alt="" className="block w-full" />
          </span>
          <div className="space-y-2">
            <p className="t-small muted max-w-sm">
              Shown on the right of the hero on a wide screen and underneath the words on a
              phone. Its edges fade into the panel, so a picture with the subject roughly in the
              middle works best.
            </p>
            {canEdit && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => save('', 'Removed. The hero now runs without a picture.')}
              >
                Remove picture
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="t-small muted max-w-prose">
          No picture yet. The hero works without one, so there is no rush.
        </p>
      )}

      {canEdit && (
        <Uploader
          accept={IMAGE_ACCEPT}
          label="Drop the home page photograph here"
          hint="or click to choose. PNG, JPEG, WebP, AVIF or SVG. Wide pictures work best."
          disabled={pending}
          onUploaded={(asset) => save(asset.id, 'Saved. It is on the home page now.')}
        />
      )}

      <FormError message={error} />
      <FormSuccess message={message} />
    </div>
  );
}
