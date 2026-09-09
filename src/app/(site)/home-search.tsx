'use client';

import { Suspense } from 'react';
import { SearchBox } from '@/components/site-nav';

export function HomeSearch() {
  return (
    <Suspense fallback={<div className="h-9 w-52 rounded-full border bg-[var(--surface)]" />}>
      <SearchBox />
    </Suspense>
  );
}
