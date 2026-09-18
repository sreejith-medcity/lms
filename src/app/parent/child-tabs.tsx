import Link from 'next/link';

/**
 * The child pinned at the top of every page about them, with the three
 * views a parent moves between. Overview, Academics (progress), Fees; the
 * inbox is on the header, since it is about the family, not one child.
 */
export function ChildTabs({ child, current }: { child: { id: string; name: string; registrationNo: number | null }; current: 'overview' | 'academics' | 'fees' }) {
  const tabs = [
    { key: 'overview', label: 'Overview', href: `/parent/${child.id}` },
    { key: 'academics', label: 'Academics', href: `/parent/${child.id}/progress` },
    { key: 'fees', label: 'Fees', href: `/parent/${child.id}/fees` },
  ] as const;
  return (
    <div>
      <Link href="/parent" className="t-small faint hover:underline">
        Your children
      </Link>
      <h1 className="mt-1 text-xl font-semibold">{child.name}</h1>
      {child.registrationNo && <p className="t-small faint">Registration no. {child.registrationNo}</p>}
      <nav className="mt-3 flex gap-1 border-b" aria-label="Views of this child">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === current ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === current ? 'border-[var(--brand)] font-medium' : 'border-transparent muted hover:text-[var(--ink)]'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
