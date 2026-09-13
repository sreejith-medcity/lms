'use client';

import { useActionState, useEffect, useState } from 'react';
import { checkSlug, startAcademy, type SignupState } from '@/server/platform';
import { suggestSlug } from '@/lib/platform/signup';
import { Button, Card, Field, FormError, Input } from '@/components/ui';

export interface PlanChoice {
  code: string;
  name: string;
  description: string | null;
  monthlyLabel: string;
  trialDays: number;
}

/**
 * One screen, no wizard. The address is suggested from the name and
 * checked as it is typed, because "taken" after pressing the button is
 * the one thing that makes people give up.
 */
export function StartForm({ plans, base }: { plans: PlanChoice[]; base: string }) {
  const [state, action, pending] = useActionState(startAcademy, {} as SignupState);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [slugNote, setSlugNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [plan, setPlan] = useState(plans[0]?.code ?? '');

  useEffect(() => {
    if (!touched) setSlug(name ? suggestSlug(name) : '');
  }, [name, touched]);

  useEffect(() => {
    if (!slug) {
      setSlugNote(null);
      return;
    }
    const handle = setTimeout(() => {
      checkSlug(slug).then(setSlugNote).catch(() => setSlugNote(null));
    }, 400);
    return () => clearTimeout(handle);
  }, [slug]);

  if (state.ok && state.hostname) {
    return (
      <Card>
        <h2 className="t-heading">Your academy is ready</h2>
        <p className="t-small muted mt-2">
          It lives at <a href={`https://${state.hostname}/login`} className="font-medium underline">{state.hostname}</a>. Sign in there with the email and password you just chose. Your trial has started; nothing is charged until you pick a paid plan.
        </p>
        <a href={`https://${state.hostname}/login`} className="mt-4 inline-block rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
          Go to {state.hostname}
        </a>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      {/* The honeypot. Hidden from people; a bot fills it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <Card>
        <h2 className="t-heading">The academy</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Academy name">
            <Input name="academyName" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Bright Path Academy" />
          </Field>
          <Field label="Web address" hint={slugNote ? slugNote.message : `Where your learners sign in: yourname.${base}`} error={slugNote && !slugNote.ok ? slugNote.message : undefined}>
            <span className="flex items-center gap-1">
              <Input name="slug" value={slug} onChange={(e) => { setTouched(true); setSlug(e.target.value.toLowerCase()); }} required maxLength={40} className="font-mono" />
              <span className="t-small faint whitespace-nowrap">.{base}</span>
            </span>
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">You</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><Input name="ownerName" required maxLength={120} autoComplete="name" /></Field>
          <Field label="Mobile number"><Input name="phone" type="tel" required autoComplete="tel" /></Field>
          <Field label="Email" hint="How you sign in, and where the receipts go."><Input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="Password" hint="At least eight characters."><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">Plan</h2>
        <p className="t-small muted mt-1">Every plan starts with a free trial. Change it any time from Settings, Billing.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <label key={p.code} className={`cursor-pointer rounded-[var(--radius)] border p-4 ${plan === p.code ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]'}`}>
              <input type="radio" name="planCode" value={p.code} checked={plan === p.code} onChange={() => setPlan(p.code)} className="sr-only" />
              <p className="font-medium">{p.name}</p>
              <p className="text-lg font-semibold tabular-nums">{p.monthlyLabel}<span className="t-small faint font-normal"> / month</span></p>
              {p.description && <p className="t-small muted mt-1">{p.description}</p>}
              <p className="t-micro faint mt-2">{p.trialDays} day free trial</p>
            </label>
          ))}
        </div>
      </Card>

      <Button type="submit" size="lg" disabled={pending || (slugNote !== null && !slugNote.ok)}>
        {pending ? 'Setting up…' : 'Start my academy'}
      </Button>
      <p className="t-small faint">By starting you agree to the platform terms. No card is needed for the trial.</p>
    </form>
  );
}
