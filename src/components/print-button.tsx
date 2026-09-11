'use client';

import { Button } from '@/components/ui';

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
