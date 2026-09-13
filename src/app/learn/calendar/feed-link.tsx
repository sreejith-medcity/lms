'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

export function FeedLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const webcal = url.replace(/^https?:/, 'webcal:');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="t-small max-w-full truncate rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-2 py-1">{url}</code>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          navigator.clipboard?.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy address'}
      </Button>
      <a href={webcal} className="t-small underline">
        Open in calendar app
      </a>
    </div>
  );
}
