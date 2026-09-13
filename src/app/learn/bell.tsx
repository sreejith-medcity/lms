import Link from 'next/link';

/** The bell in the learner's header, with the unread count on it. */
export function Bell({ unread }: { unread: number }) {
  return (
    <Link href="/learn/notifications" className="relative grid h-9 w-9 place-items-center rounded-full hover:bg-[var(--surface-2)]" aria-label={unread ? `${unread} unread notifications` : 'Notifications'} title="Notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5" aria-hidden>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full px-1 text-center text-[0.625rem] font-bold leading-[1.1rem] text-[var(--accent-ink)]" style={{ background: 'var(--accent)' }}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
