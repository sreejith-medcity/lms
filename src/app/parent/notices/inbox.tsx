'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markAllParentNotificationsRead, markParentNotificationRead, removeParentPush, saveParentPush } from '@/server/parent-inbox';
import { Badge, Button } from '@/components/ui';

export interface InboxRow {
  id: string;
  title: string;
  body: string;
  href: string | null;
  category: string;
  children: string;
  when: string;
  read: boolean;
  withdrawn: boolean;
}

/**
 * The inbox: unread first and bold, each row saying which child and what
 * kind. Tapping marks it read and opens the record it is about: the
 * child's page for an absence or a result, the notice itself for a notice.
 */
export function ParentInbox({ rows, unread }: { rows: InboxRow[]; unread: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const shown = filter === 'unread' ? rows.filter((r) => !r.read) : rows;

  function open(row: InboxRow) {
    start(async () => {
      if (!row.read) await markParentNotificationRead(row.id);
      if (row.href) router.push(row.href);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>
            All
          </Button>
          <Button size="sm" variant={filter === 'unread' ? 'secondary' : 'ghost'} onClick={() => setFilter('unread')}>
            Unread{unread > 0 ? ` (${unread})` : ''}
          </Button>
        </div>
        {unread > 0 && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await markAllParentNotificationsRead(); router.refresh(); })}>
            Mark all read
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="t-small faint mt-4">{filter === 'unread' ? 'Nothing unread.' : 'Nothing here yet. Notices from the academy, absence alerts and published results arrive here.'}</p>
      ) : (
        <ul className="mt-3 divide-y">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => open(r)} disabled={pending} className="flex w-full items-start gap-3 py-3 text-left hover:bg-[var(--surface-2)]">
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${r.read ? 'bg-transparent' : 'bg-[var(--brand)]'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${r.read ? '' : 'font-semibold'} ${r.withdrawn ? 'line-through' : ''}`}>{r.title}</span>
                  <span className="t-small faint block">{r.body}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={r.withdrawn ? 'bad' : 'neutral'}>{r.withdrawn ? 'withdrawn' : r.category}</Badge>
                    <span className="t-micro faint">{r.children}</span>
                    <span className="t-micro faint">· {r.when}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Push on this phone, for a parent. Same service worker as the learner's; the subscription is stored against the contact. */
export function ParentPushToggle({ available }: { available: boolean }) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.getRegistration('/sw.js').then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setOn(Boolean(sub));
    });
  }, []);

  if (!available) return <p className="t-small faint">Push is not set up for this academy yet; the inbox and messages still work.</p>;
  if (!supported) return <p className="t-small faint">This browser cannot receive push. On an iPhone, add this page to the Home Screen first, then try again.</p>;

  async function enable() {
    setBusy(true);
    setNote(undefined);
    try {
      const { key } = (await fetch('/api/push/key').then((r) => r.json())) as { key: string | null };
      if (!key) throw new Error('No key');
      const reg = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNote('Notifications are blocked in this browser. Allow them in the browser settings and try again.');
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(key) as BufferSource });
      const json = sub.toJSON();
      const res = await saveParentPush({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 300) });
      if (res.error) throw new Error(res.error);
      setOn(true);
      setNote(res.message);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not switch push on.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removeParentPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setOn(false);
      setNote('This device will no longer be told.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button size="sm" variant={on ? 'secondary' : 'primary'} disabled={busy} onClick={() => (on ? disable() : enable())}>
        {busy ? 'One moment...' : on ? 'Push is on for this device' : 'Turn on push for this device'}
      </Button>
      {note && <p className="t-small faint mt-1">{note}</p>}
      {!note && <p className="t-small faint mt-1">The lock screen shows the child&rsquo;s name and the kind of message; the detail waits inside.</p>}
    </div>
  );
}

export function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="t-small underline">
      {children}
    </Link>
  );
}
