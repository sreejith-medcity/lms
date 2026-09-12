import { addDays, dayKey, dayStart, minutesOfDay } from '@/lib/clock';

/**
 * What a learner has agreed to hear, and when.
 *
 * Two kinds of message. Service messages are the ones the learner would
 * complain about not getting: a receipt, a class reminder, a sign-in code,
 * a marked paper. Marketing messages are the ones they may complain about
 * getting: a campaign, an automation's nudge, a note about a cart they
 * left. Only the second kind honours an opt-out or waits for the morning.
 */

export type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH' | 'IN_APP';

/** Campaigns, automations and cart recovery. Everything else is service. */
export function isMarketing(eventKey: string): boolean {
  return eventKey.startsWith('campaign:') || eventKey.startsWith('workflow:') || eventKey === 'cart.abandoned';
}

export interface OptOuts {
  emailOptOut: boolean;
  smsOptOut: boolean;
  whatsappOptOut: boolean;
}

export function optedOut(person: OptOuts, channel: Channel): boolean {
  if (channel === 'EMAIL') return person.emailOptOut;
  if (channel === 'SMS') return person.smsOptOut;
  if (channel === 'WHATSAPP') return person.whatsappOptOut;
  return false;
}

/** "21:00" to minutes of the day, or null for blank or nonsense. */
export function parseClock(value: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * When a marketing message queued at `at` may leave: now, or the end of the
 * quiet window it falls in. The window may cross midnight (21:00 to 08:00).
 * With no window, or a window of no length, everything goes now.
 */
export function releaseAfterQuietHours(at: Date, timeZone: string, from: string, to: string): Date {
  const start = parseClock(from);
  const end = parseClock(to);
  if (start === null || end === null || start === end) return at;

  const minute = minutesOfDay(at, timeZone);
  const today = dayKey(at, timeZone);

  const endsOn = (key: string) => new Date(dayStart(key, timeZone).getTime() + end * 60_000);

  if (start < end) {
    // Same-day window, 13:00 to 15:00.
    return minute >= start && minute < end ? endsOn(today) : at;
  }
  // Overnight window, 21:00 to 08:00.
  if (minute >= start) return endsOn(addDays(today, 1));
  if (minute < end) return endsOn(today);
  return at;
}

/** The line under a marketing email, with the one-click way out. */
export function unsubscribeFooter(url: string): string {
  return `\n\nYou are getting this because you have an account with us. To stop these messages: ${url}`;
}
