'use client';

import { useActionState, useState, useTransition } from 'react';
import { addFromVimeo, relockVimeoVideos } from '@/server/assets';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

/**
 * Vimeo is the video platform: uploads here go to it on their own. This adds
 * what is already on the academy's Vimeo without uploading it again, and
 * applies the lock to every video once more after an address is added.
 */
export function VimeoPanel() {
  const [state, action, pending] = useActionState(addFromVimeo, initial);
  const [relock, setRelock] = useState<ActionState>({});
  const [locking, startLock] = useTransition();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form action={action} className="space-y-3">
        <h2 className="t-title">Add a video already on Vimeo</h2>
        <p className="t-small muted">
          Paste its link or number. It is hidden from vimeo.com, allowed to play only on this academy&rsquo;s addresses, and
          its download, comments and share buttons are switched off. Deleting it here later leaves it on Vimeo.
        </p>
        <Field label="Vimeo link">
          <Input name="link" required placeholder="vimeo.com/123456789" maxLength={300} />
        </Field>
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding...' : 'Add to the library'}
        </Button>
      </form>

      <div className="space-y-3">
        <h2 className="t-title">Lock every video again</h2>
        <p className="t-small muted">
          After the academy gets a new address, or after a setting was changed by hand on vimeo.com, this applies the lock
          to every Vimeo video in the library, allowing every current address.
        </p>
        <FormError message={relock.error} />
        <FormSuccess message={relock.ok ? relock.message : undefined} />
        <Button
          type="button"
          variant="secondary"
          disabled={locking}
          onClick={() => startLock(async () => setRelock(await relockVimeoVideos()))}
        >
          {locking ? 'Locking...' : 'Lock every Vimeo video'}
        </Button>
      </div>
    </div>
  );
}
