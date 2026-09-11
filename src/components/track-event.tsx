'use client';

import { useEffect } from 'react';
import { track, trackOnce } from '@/lib/track-browser';
import type { TrackEvent as Event } from '@/lib/tracking-events';

/**
 * Raises one storefront event when the page it sits on is shown. Server
 * components render it with the data they already have, so the browser
 * never has to work out a price.
 */
export function TrackEvent({ event, once }: { event: Event; once?: string }) {
  useEffect(() => {
    if (once) trackOnce(once, event);
    else track(event);
    // The event object is built fresh by the server each render; keying on
    // its serialised form keeps a re-render from double firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [once, JSON.stringify(event)]);
  return null;
}
