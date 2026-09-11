'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import type { TrackingTags } from '@/lib/tracking-config';
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_DAYS,
  captureAttribution,
  serialiseAttribution,
} from '@/lib/attribution';

/**
 * The tags, and the memory of where the visitor came from.
 *
 * Loaded after the page is interactive so nothing about a course page waits
 * on Google. Nothing loads in the admin or the platform console: staff
 * clicking around are not traffic. Clarity records sessions, so it stays on
 * the public site and checkout and never inside a learner's account.
 *
 * The click id capture runs on every page, whether or not any tag is set,
 * because the order needs it even when no browser tag exists yet.
 */

const PRIVATE = /^\/(admin|platform|api)(\/|$)/;
const LEARNER = /^\/(learn|account)(\/|$)/;

function readCookie(name: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return m ? m[1] : null;
}

export function Tracking({ tags }: { tags: TrackingTags }) {
  const pathname = usePathname() ?? '/';
  const isPrivate = PRIVATE.test(pathname);
  const isLearner = LEARNER.test(pathname);

  // Remember the click before anything else, on every public page.
  useEffect(() => {
    if (isPrivate) return;
    try {
      const next = captureAttribution(
        new URL(window.location.href),
        document.referrer || null,
        readCookie(ATTRIBUTION_COOKIE) ? decodeURIComponent(readCookie(ATTRIBUTION_COOKIE)!) : null,
        new Date(),
      );
      if (next) {
        const value = encodeURIComponent(serialiseAttribution(next));
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${ATTRIBUTION_COOKIE}=${value}; Max-Age=${ATTRIBUTION_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
      }
    } catch {
      /* a broken URL or blocked cookie is not worth a console error */
    }
  }, [pathname, isPrivate]);

  // Route changes inside the app do not reload the page, so the tags are
  // told about them here. Tag Manager containers handle this themselves.
  useEffect(() => {
    if (isPrivate || tags.gtm) return;
    if (tags.ga4 && window.gtag) {
      window.gtag('event', 'page_view', { page_path: pathname, page_location: window.location.href });
    }
    if (tags.metaPixel && window.fbq) window.fbq('track', 'PageView');
  }, [pathname, isPrivate, tags.gtm, tags.ga4, tags.metaPixel]);

  if (isPrivate) return null;

  const hasAny = Boolean(tags.gtm || tags.ga4 || tags.metaPixel || tags.googleAds || tags.clarity);
  const gtagIds = tags.gtm ? [] : [tags.ga4, tags.googleAds?.conversionId].filter((x): x is string => Boolean(x));

  return (
    <>
      <script
        id="mlms-tags"
        dangerouslySetInnerHTML={{ __html: `window.__mlmsTags=${JSON.stringify(tags)};` }}
      />

      {hasAny && tags.gtm && (
        <Script id="gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${tags.gtm}');`}
        </Script>
      )}

      {gtagIds.length > 0 && (
        <>
          <Script
            id="gtag-lib"
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());${gtagIds
              .map((id) => `gtag('config','${id}'${id.startsWith('G-') ? ",{send_page_view:true}" : ''});`)
              .join('')}`}
          </Script>
        </>
      )}

      {!tags.gtm && tags.metaPixel && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${tags.metaPixel}');fbq('track','PageView');`}
        </Script>
      )}

      {tags.clarity && !isLearner && (
        <Script id="clarity" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${tags.clarity}");`}
        </Script>
      )}
    </>
  );
}
