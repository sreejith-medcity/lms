'use client';

import { useState } from 'react';

/** A read-only value with a Copy button beside it, for links people paste elsewhere. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <p className="t-small font-medium">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-3 font-mono text-xs"
          aria-label={label}
        />
        <button
          type="button"
          className="h-9 shrink-0 rounded-[var(--radius-sm)] border px-3 text-sm font-medium hover:bg-[var(--surface-2)]"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* the field is selectable, so a manual copy still works */
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-sm)] border px-3 text-sm font-medium hover:bg-[var(--surface-2)]"
        >
          Open
        </a>
      </div>
    </div>
  );
}
