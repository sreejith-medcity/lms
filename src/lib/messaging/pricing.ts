/**
 * What a message costs.
 *
 * Providers price per message, per segment, per conversation and per country,
 * and none of them tell you the number at send time. So this is the academy's
 * own estimate, written on the log row and debited from the utility wallet, and
 * it is described as an estimate everywhere it is shown. An estimate that is
 * visible beats an exact figure that arrives on an invoice five weeks later.
 *
 * Overridable per deployment because the rate is negotiated, and a hard-coded
 * 20 paise is wrong for anyone who bought volume.
 */

import type { $Enums } from '@prisma/client';

function paise(env: string, fallback: number): number {
  const raw = Number(process.env[env]);
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : fallback;
}

/** True when the body forces a unicode SMS, which cuts the segment size. */
function needsUnicode(body: string): boolean {
  return [...body].some((character) => character.charCodeAt(0) > 127);
}

export function estimatedCostPaise(channel: $Enums.Channel, body: string): number {
  switch (channel) {
    case 'SMS': {
      // Indian transactional SMS is billed per 160-character segment, and a
      // single emoji or a Malayalam character drops that to 70 by forcing
      // unicode. Counting it here is the difference between a wallet that
      // drains as expected and one that empties three times faster.
      const perSegment = needsUnicode(body) ? 70 : 160;
      const segments = Math.max(1, Math.ceil(body.length / perSegment));
      return segments * paise('SMS_COST_PAISE', 20);
    }
    case 'WHATSAPP':
      return paise('WHATSAPP_COST_PAISE', 85);
    case 'EMAIL':
      return paise('EMAIL_COST_PAISE', 0);
    default:
      return 0;
  }
}

/** For the screen, not for accounting. */
export function formatPaise(value: number): string {
  return `INR ${(value / 100).toFixed(2)}`;
}
