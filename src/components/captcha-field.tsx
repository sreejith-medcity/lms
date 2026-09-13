'use client';

import { useEffect, useId, useRef, useState } from 'react';

declare global {
  interface Window {
    grecaptcha?: { ready: (cb: () => void) => void; execute: (siteKey: string, opts: { action: string }) => Promise<string> };
    turnstile?: { render: (el: string | HTMLElement, opts: Record<string, unknown>) => string; reset: (id: string) => void };
  }
}

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) return resolve();
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('captcha script failed to load'));
    document.head.appendChild(s);
  });
}

/**
 * The bot check as a hidden field. reCAPTCHA v3 mints a token in the
 * background and again every ninety seconds, since tokens die at two
 * minutes and a person takes longer than that to write an enquiry.
 * Turnstile renders an invisible widget that calls back with a token.
 * Nothing is asked of the visitor either way.
 */
export function CaptchaField({ provider, siteKey, action }: { provider: 'recaptcha' | 'turnstile'; siteKey: string; action: 'signup' | 'enquiry' }) {
  const [token, setToken] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    if (provider === 'recaptcha') {
      const mint = () => {
        window.grecaptcha?.ready(() => {
          window.grecaptcha?.execute(siteKey, { action }).then((t) => {
            if (!cancelled) setToken(t);
          }).catch(() => {});
        });
      };
      loadScript(`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`, 'recaptcha-v3')
        .then(() => {
          mint();
          timer = setInterval(mint, 90_000);
        })
        .catch(() => {});
    } else {
      loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', 'turnstile')
        .then(() => {
          if (cancelled || !box.current || !window.turnstile) return;
          window.turnstile.render(box.current, {
            sitekey: siteKey,
            action,
            size: 'invisible',
            callback: (t: string) => setToken(t),
            'expired-callback': () => setToken(''),
            'error-callback': () => setToken(''),
          });
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [provider, siteKey, action]);

  return (
    <>
      <input type="hidden" name="captchaToken" value={token} readOnly />
      {provider === 'turnstile' && <div ref={box} id={id} />}
      {provider === 'recaptcha' && (
        <p className="t-micro faint">
          Protected by reCAPTCHA: Google&rsquo;s{' '}
          <a href="https://policies.google.com/privacy" className="underline" target="_blank" rel="noreferrer">
            privacy policy
          </a>{' '}
          and{' '}
          <a href="https://policies.google.com/terms" className="underline" target="_blank" rel="noreferrer">
            terms
          </a>{' '}
          apply.
        </p>
      )}
    </>
  );
}
