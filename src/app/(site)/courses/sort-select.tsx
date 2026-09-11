'use client';

import { useRouter } from 'next/navigation';

/** The sort order as a select, which changes the URL so the page stays a link. */
export function SortSelect({ value, hrefFor }: { value: string; hrefFor: Record<string, string> }) {
  const router = useRouter();
  return (
    <label className="t-small flex items-center gap-2">
      <span className="faint">Sort by</span>
      <select
        value={value}
        onChange={(e) => router.push(hrefFor[e.target.value] ?? hrefFor[''])}
        className="h-9 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-sm font-medium"
      >
        <option value="">Recommended</option>
        <option value="newest">Newest</option>
        <option value="price">Price: low to high</option>
        <option value="price-desc">Price: high to low</option>
        <option value="title">A to Z</option>
      </select>
    </label>
  );
}
