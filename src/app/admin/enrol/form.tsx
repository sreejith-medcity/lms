'use client';

import { useActionState, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { enrolManually } from '@/server/enrolments';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState & { temporaryPassword?: string } = {};

interface Product {
  id: string;
  title: string;
  courseId: string;
  plans: { id: string; name: string; price: string; validityDays: number | null }[];
}

const PAYMENT = [
  { value: 'NONE', label: 'No payment (free or scholarship)' },
  { value: 'CASH', label: 'Cash at the counter' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'ALREADY_PAID', label: 'Paid another way' },
];

export function EnrolForm({
  products,
  learners,
  batches,
}: {
  products: Product[];
  learners: { id: string; name: string; email: string | null; phone: string | null }[];
  batches: { id: string; name: string; courseId: string; seatsLeft: number | null }[];
}) {
  const [state, action, pending] = useActionState(enrolManually, initial);
  const router = useRouter();

  const [mode, setMode] = useState<'existing' | 'new'>(learners.length > 0 ? 'existing' : 'new');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const product = products.find((p) => p.id === productId);
  const courseBatches = useMemo(
    () => batches.filter((b) => b.courseId === product?.courseId),
    [batches, product?.courseId],
  );

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return learners.slice(0, 50);
    return learners
      .filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.email ?? '').toLowerCase().includes(q) ||
          (l.phone ?? '').includes(q),
      )
      .slice(0, 50);
  }, [learners, search]);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <FormSuccess message={state.message} />

        {state.temporaryPassword && (
          <div className="rounded-[var(--radius)] border bg-[var(--surface-2)] p-4">
            <p className="t-micro faint uppercase tracking-wide">One-time password</p>
            <code className="mt-2 block break-all font-mono text-base">
              {state.temporaryPassword}
            </code>
            <button
              type="button"
              className="t-small mt-3 underline"
              onClick={() => {
                navigator.clipboard?.writeText(state.temporaryPassword ?? '');
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <p className="t-small faint mt-3">
              Shown once. They are asked to change it when they first sign in.
            </p>
          </div>
        )}

        <Button
          onClick={() => {
            router.refresh();
            window.location.reload();
          }}
        >
          Enrol someone else
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />

      <div>
        <span className="t-small block font-medium">Learner</span>
        <div className="mt-2 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
              disabled={learners.length === 0}
            />
            Existing
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
            New account
          </label>
        </div>
      </div>

      {mode === 'existing' ? (
        <>
          <Field label="Find them">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email or phone"
            />
          </Field>
          <Field label="Learner">
            <Select name="userId" required defaultValue="">
              <option value="" disabled>
                Choose from {matches.length}
              </option>
              {matches.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l.email ? `· ${l.email}` : l.phone ? `· ${l.phone}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <>
          <Field label="Name">
            <Input name="name" required maxLength={120} autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input name="email" type="email" autoComplete="off" />
            </Field>
            <Field label="Phone">
              <Input name="phone" type="tel" maxLength={20} autoComplete="off" />
            </Field>
          </div>
          <p className="t-small faint -mt-2">
            One of the two is enough. An email that already exists is matched rather than
            duplicated.
          </p>
        </>
      )}

      <Field label="Course">
        <Select
          name="productId"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          required
        >
          {products.length === 0 && <option value="">No courses yet</option>}
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </Select>
      </Field>

      {product && product.plans.length > 0 && (
        <Field label="Plan">
          <Select name="pricingPlanId" defaultValue={product.plans[0].id}>
            {product.plans.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name} · {pl.price}
                {pl.validityDays ? ` · ${pl.validityDays} days` : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Batch" hint="Leave blank and they go into the default batch for the course.">
        <Select name="batchId" defaultValue="">
          <option value="">Default batch</option>
          {courseBatches.map((b) => (
            <option key={b.id} value={b.id} disabled={b.seatsLeft != null && b.seatsLeft <= 0}>
              {b.name}
              {b.seatsLeft != null ? ` · ${b.seatsLeft} seats left` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Payment"
        hint="Anything other than the first writes a real order, payment and invoice, so collections stay true."
      >
        <Select name="payment" defaultValue="NONE">
          {PAYMENT.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Note" hint="Why. Recorded against your name in the audit trail.">
        <Textarea name="note" rows={2} maxLength={500} placeholder="Receipt 1042, paid at Kannur" />
      </Field>

      <Button type="submit" disabled={pending || products.length === 0}>
        {pending ? 'Enrolling...' : 'Enrol'}
      </Button>
    </form>
  );
}
