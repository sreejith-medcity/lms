'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markAllNotificationsRead, markNotificationRead, removePushSubscription, savePushSubscription } from '@/server/notifications';
import { Button } from '@/components/ui';

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  url: string | null;
  unread: boolean;
  when: string;
}

export function Inbox({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = items.some((i) => i.unread);
  return (
    <div className="space-y-3">
      {unread && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markAllNotificationsRead();
                router.refresh();
              })
            }
          >
            Mark all read
          </Button>
        </div>
      )}
      <ul className="divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
        {items.map((i) => (
          <li key={i.id} className={`px-5 py-3 ${i.unread ? '' : 'opacity-75'}`}>
            <div className="flex items-start gap-3">
              <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${i.unread ? 'bg-[var(--accent)]' : 'bg-transparent'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{i.title}</p>
                <p className="t-small muted mt-0.5 whitespace-pre-wrap">{i.body}</p>
                <p className="t-micro faint mt-1">{i.when}</p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                {i.url && (
                  <Link
                    href={i.url}
                    onClick={() => {
                      if (i.unread) void markNotificationRead(i.id);
                    }}
                    className="t-small font-medium underline"
                  >
                    Open
                  </Link>
                )}
                {i.unread && (
                  <button
                    type="button"
                    className="t-small faint underline"
                    onClick={() =>
                      start(async () => {
                        await markNotificationRead(i.id);
                        router.refresh();
                      })
                    }
                  >
                    Read
                  </button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Push in this browser: a switch that registers the service worker, asks
 * permission once, and stores the subscription. Off again removes it.
 */
export function PushToggle({ available }: { available: boolean }) {
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

  if (!available) return <p className="t-small faint">Push is not set up for this academy yet.</p>;
  if (!supported) return <p className="t-small faint">This browser cannot receive push.</p>;

  async function enable() {
    setBusy(true);
    setNote(undefined);
    try {
      const { key } = (await fetch('/api/push/key').then((r) => r.json())) as { key: string | null };
      if (!key) throw new Error('No key');
      const reg = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNote('Notifications are blocked in this browser. Allow them in the address bar and try again.');
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(key) as BufferSource });
      const json = sub.toJSON();
      const res = await savePushSubscription({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 300) });
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
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setOn(false);
      setNote('This device will no longer be told.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button size="sm" variant={on ? 'secondary' : 'primary'} disabled={busy} onClick={() => (on ? disable() : enable())}>
        {busy ? 'One moment...' : on ? 'Push on for this device' : 'Turn on push for this device'}
      </Button>
      {note && <p className="t-small faint mt-1">{note}</p>}
    </div>
  );
}
