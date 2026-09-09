'use client';

import { useState, useTransition } from 'react';
import { setCourseStatus } from '@/server/courses';
import { Button } from '@/components/ui';

export function PublishToggle({ productId, published }: { productId: string; published: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button
        variant={published ? 'secondary' : 'primary'}
        style={published ? undefined : { background: 'var(--brand)' }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setCourseStatus(productId, !published);
            setError(res.error);
          })
        }
      >
        {pending ? 'Saving...' : published ? 'Unpublish' : 'Publish'}
      </Button>
    </div>
  );
}
