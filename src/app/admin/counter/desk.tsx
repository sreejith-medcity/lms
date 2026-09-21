'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { counterCheckIn, lookupMember, type CounterCard } from '@/server/counter';
import type { ActionState } from '@/server/courses';
import { Avatar } from '@/components/avatar';
import { Badge, Button, Card, FormError, FormSuccess, Input } from '@/components/ui';
import { formatMoney } from '@/lib/money';

/**
 * Three ways in, one result. The text box has focus at all times so a
 * barcode reader, which types and presses Enter, lands in it without a
 * click; the camera button uses the browser's own barcode reader where
 * there is one (Chrome on Android and desktop, not Safari), and stays
 * out of the way where there is not; a registration number typed by hand
 * is the fallback for the desk with neither.
 */

interface Detector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

function detectorFor(): Detector | null {
  const ctor = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  return ctor ? new ctor({ formats: ['qr_code'] }) : null;
}

function timeOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone });
}

export function CounterDesk({ canCheckIn, canSeeFees, timezone }: { canCheckIn: boolean; canSeeFees: boolean; timezone: string }) {
  const [code, setCode] = useState('');
  const [state, setState] = useState<ActionState & { card?: CounterCard }>({});
  const [checkIn, setCheckIn] = useState<Record<string, ActionState>>({});
  const [busy, start] = useTransition();
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canScan = typeof window !== 'undefined' && detectorFor() !== null;

  function look(raw: string) {
    const text = raw.trim();
    if (!text) return;
    start(async () => {
      const r = await lookupMember(text);
      setState(r);
      setCheckIn({});
      setCode('');
      input.current?.focus();
    });
  }

  // The camera: frames are handed to the browser's detector a few times a
  // second until one carries a QR, then the camera is put away.
  useEffect(() => {
    if (!camera) return;
    const detector = detectorFor();
    const el = video.current;
    if (!detector || !el) {
      setCamera(false);
      return;
    }
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        el.srcObject = s;
        void el.play();
        timer = setInterval(async () => {
          if (el.readyState < 2) return;
          try {
            const found = await detector.detect(el);
            const hit = found.find((f) => f.rawValue);
            if (hit) {
              setCamera(false);
              look(hit.rawValue);
            }
          } catch {
            /* a frame that could not be read; the next one will be */
          }
        }, 300);
      })
      .catch(() => setCamera(false));
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const card = state.card;

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            look(code);
          }}
          className="space-y-3"
        >
          <label className="t-small font-medium" htmlFor="counter-code">
            Card code or registration number
          </label>
          <Input id="counter-code" ref={input} value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" inputMode="numeric" placeholder="Scan, or type the number" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !code.trim()}>
              {busy ? 'Looking...' : 'Look up'}
            </Button>
            {canScan && (
              <Button type="button" size="sm" variant="secondary" onClick={() => setCamera((c) => !c)}>
                {camera ? 'Stop camera' : 'Use the camera'}
              </Button>
            )}
          </div>
          {camera && <video ref={video} muted playsInline className="mt-2 w-full rounded-[var(--radius-sm)] bg-black" aria-label="Camera, looking for a card" />}
          {!canScan && <p className="t-small faint">This browser has no barcode reader of its own; a USB or Bluetooth scanner still works in the box above.</p>}
        </form>
        <div className="mt-3">
          <FormError message={state.error} />
        </div>
      </Card>

      <div>
        {!card && !state.error && (
          <Card>
            <p className="font-medium">Nobody yet</p>
            <p className="t-small faint mt-1">Scan a card and the learner appears here: their classes today, their batches, and what is owed.</p>
          </Card>
        )}
        {card && (
          <Card>
            <div className="flex flex-wrap items-start gap-4">
              <Avatar name={card.name} src={card.avatarUrl} size={64} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                  {card.name}
                  <Badge tone={card.status === 'ACTIVE' || card.status === 'REGISTERED' ? 'ok' : card.status === 'ON_LEAVE' ? 'warn' : 'bad'}>{card.status.toLowerCase().replace('_', ' ')}</Badge>
                </p>
                <p className="t-small faint">
                  {card.registrationNo ? `Registration ${card.registrationNo}` : 'No registration number'}
                  {card.phoneMasked ? ` · ${card.phoneMasked}` : ''} · since {new Date(card.since).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </p>
                <p className="mt-2 flex flex-wrap gap-3">
                  <Link href={`/admin/learners/${card.userId}`} className="t-small font-medium underline">
                    Open the record
                  </Link>
                  {canSeeFees && (
                    <Link href={`/admin/learners/${card.userId}#fees`} className="t-small font-medium underline">
                      Fees and receipts
                    </Link>
                  )}
                </p>
              </div>
              {canSeeFees && card.duePaise !== null && (
                <div className="text-right">
                  <p className="t-eyebrow faint">Owed</p>
                  <p className={`text-xl font-semibold tabular-nums ${card.overdueCount ? 'text-[var(--bad)]' : ''}`}>{formatMoney(card.duePaise)}</p>
                  {card.overdueCount > 0 && <p className="t-small text-[var(--bad)]">{card.overdueCount} overdue</p>}
                </div>
              )}
            </div>

            <div className="mt-5">
              <p className="t-eyebrow faint">Today</p>
              {card.today.length === 0 ? (
                <p className="t-small faint mt-1">No class of theirs today.</p>
              ) : (
                <ul className="mt-2 divide-y">
                  {card.today.map((s) => {
                    const r = checkIn[s.sessionId];
                    const mark = r?.ok ? 'PRESENT' : s.mark;
                    return (
                      <li key={s.sessionId} className="flex flex-wrap items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{s.title}</p>
                          <p className="t-small faint">
                            {timeOf(s.startsAt, timezone)} to {timeOf(s.endsAt, timezone)}
                            {s.batch ? ` · ${s.batch}` : ''}
                          </p>
                        </div>
                        {mark ? (
                          <Badge tone={mark === 'PRESENT' ? 'ok' : mark === 'LATE' ? 'warn' : 'bad'}>{mark.toLowerCase()}</Badge>
                        ) : canCheckIn ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              start(async () => {
                                const out = await counterCheckIn(s.sessionId, card.userId);
                                setCheckIn((prev) => ({ ...prev, [s.sessionId]: out }));
                                input.current?.focus();
                              })
                            }
                          >
                            Check in
                          </Button>
                        ) : (
                          <Badge tone="neutral">not marked</Badge>
                        )}
                        {r && (
                          <span className="basis-full">
                            <FormError message={r.error} />
                            <FormSuccess message={r.ok ? r.message : undefined} />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-5">
              <p className="t-eyebrow faint">Batches</p>
              {card.batches.length === 0 ? (
                <p className="t-small faint mt-1">Not in any batch.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {card.batches.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/batches/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                        {b.name}
                      </Link>
                      <span className="t-small faint">{b.course}</span>
                      <Badge tone={b.status === 'ACTIVE' ? 'brand' : 'neutral'}>{b.status.toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
