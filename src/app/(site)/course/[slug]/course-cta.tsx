'use client';

import { useEffect, useState } from 'react';
import { EnrolButton } from './enrol-button';
import { LinkButton } from '@/components/ui';

/**
 * The call to action, decided in the browser.
 *
 * Everything else on a course page is the same for every visitor: the
 * curriculum, the price, the batches. Only this corner differs, and while it
 * was rendered on the server the whole page had to be marked private and no
 * cache could hold it. Course pages are where search traffic lands, so that
 * was the worst page in the product to be uncacheable.
 *
 * The server now renders the anonymous case, which is correct for almost
 * everyone who ever sees it, and the browser corrects it for the few who are
 * signed in. An enrolled learner sees "Enrol now" for the fraction of a second
 * before the answer comes back, which is the price of the page arriving from
 * an edge cache instead of a database.
 */
export interface CourseState {
  signedIn: boolean;
  enrolled: boolean;
  pointsWorthPaise: number;
}

export function CourseCta({
  productId,
  isPaid,
  pricingPlanId,
  pricePaise,
  currency,
  learnHref,
  fullWidth = false,
  continueLabel = 'Continue learning',
}: {
  productId: string;
  isPaid: boolean;
  pricingPlanId?: string;
  pricePaise: number;
  currency: string;
  learnHref: string;
  fullWidth?: boolean;
  continueLabel?: string;
}) {
  const [state, setState] = useState<CourseState>({
    signedIn: false,
    enrolled: false,
    pointsWorthPaise: 0,
  });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/course-state?productId=${encodeURIComponent(productId)}`, {
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: CourseState | null) => {
        if (!cancelled && data) setState(data);
      })
      .catch(() => {
        // The anonymous call to action is already on screen and works. A
        // failure here should never take the buy button away from somebody.
      });

    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (state.enrolled) {
    return (
      <LinkButton
        href={learnHref}
        className={fullWidth ? 'w-full justify-center' : undefined}
        size={fullWidth ? 'lg' : undefined}
      >
        {continueLabel}
      </LinkButton>
    );
  }

  return (
    <EnrolButton
      productId={productId}
      signedIn={state.signedIn}
      isPaid={isPaid}
      pricingPlanId={pricingPlanId}
      pricePaise={pricePaise}
      currency={currency}
      pointsWorthPaise={state.pointsWorthPaise}
      fullWidth={fullWidth}
    />
  );
}
