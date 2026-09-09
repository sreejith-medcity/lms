'use client';

import { useActionState, useState } from 'react';
import { importSettings } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { Button, Card, FormError, FormSuccess, Textarea } from '@/components/ui';

const initial: ActionState = {};

/**
 * Starting a second academy from the first one's choices.
 *
 * This is a multi-tenant product, and the honest test of that is whether the
 * second tenant has to rediscover everything the first one worked out.
 */
export function ImportSettings() {
  const [state, action, pending] = useActionState(importSettings, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Import a configuration
      </Button>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="t-heading">Import a configuration</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Paste a file exported from another academy. Settings this version does not have are
            named rather than silently dropped, and anything not in the file stays as it is.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      <form action={action} className="mt-4 space-y-3">
        <Textarea name="json" rows={6} required placeholder='{ "settings": { … } }' />
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Applying…' : 'Apply'}
        </Button>
      </form>
    </Card>
  );
}
