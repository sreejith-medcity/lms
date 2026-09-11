import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { PrintButton } from '@/components/print-button';

/**
 * A receipt or an invoice, laid out to be printed.
 *
 * The same shape for both, because the office prints them the same way and
 * files them in the same drawer: who issued it, who it is for, what it is
 * for, and the number that makes it findable again. The page chrome around
 * it is hidden when printing, so what comes out of the printer is the
 * document and nothing else.
 */

export interface DocumentLine {
  title: string;
  detail?: string;
  amountPaise: number;
}

export interface MoneyDocumentProps {
  kind: 'RECEIPT' | 'INVOICE';
  number: string;
  issuedAt: Date;
  currency: string;
  issuer: {
    name: string;
    legalName?: string | null;
    addressLine?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    gstin?: string | null;
    pan?: string | null;
    supportEmail?: string | null;
    contactNumber?: string | null;
    logoUrl?: string | null;
  };
  recipient: { name: string; email?: string | null; phone?: string | null };
  lines: DocumentLine[];
  /** Subtotal, tax rows and the total, in order. */
  totals: { label: string; amountPaise: number; strong?: boolean }[];
  /** How it was paid, and any reference: cheque number, UTR, gateway id. */
  paidBy?: string | null;
  reference?: string | null;
  note?: string | null;
  /** Where the learner goes back to. */
  backHref: string;
  backLabel: string;
}

const dateLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export function MoneyDocument(props: MoneyDocumentProps) {
  const { issuer, recipient } = props;
  const address = [issuer.addressLine, issuer.city, issuer.state, issuer.pincode].filter(Boolean).join(', ');
  const title = props.kind === 'RECEIPT' ? 'Receipt' : 'Tax invoice';

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <style>{`@media print {
        body * { visibility: hidden; }
        .print-doc, .print-doc * { visibility: visible; }
        .print-doc { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
        .print-doc a { text-decoration: none; color: inherit; }
      }`}</style>

      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={props.backHref} className="t-small underline">
          {props.backLabel}
        </Link>
        <PrintButton label={`Print ${title.toLowerCase()}`} />
      </div>

      <div className="print-doc rounded-[var(--radius)] border bg-white p-6 text-[#111] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {issuer.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={issuer.logoUrl} alt="" className="h-12 w-12 rounded object-contain" />
            )}
            <div>
              <p className="text-lg font-semibold">{issuer.legalName || issuer.name}</p>
              {issuer.legalName && issuer.legalName !== issuer.name && (
                <p className="text-sm text-[#555]">{issuer.name}</p>
              )}
              {address && <p className="text-sm text-[#555]">{address}</p>}
              <p className="text-sm text-[#555]">
                {[issuer.contactNumber, issuer.supportEmail].filter(Boolean).join(' · ')}
              </p>
              {issuer.gstin && <p className="text-sm text-[#555]">GSTIN {issuer.gstin}</p>}
              {!issuer.gstin && issuer.pan && <p className="text-sm text-[#555]">PAN {issuer.pan}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#777]">{title}</p>
            <p className="text-lg font-semibold tabular-nums">{props.number}</p>
            <p className="text-sm text-[#555]">{dateLabel(props.issuedAt)}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 border-t pt-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#777]">
              {props.kind === 'RECEIPT' ? 'Received from' : 'Billed to'}
            </p>
            <p className="mt-1 font-medium">{recipient.name}</p>
            {recipient.phone && <p className="text-sm text-[#555]">{recipient.phone}</p>}
            {recipient.email && <p className="text-sm text-[#555]">{recipient.email}</p>}
          </div>
          {(props.paidBy || props.reference) && (
            <div className="sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#777]">Paid by</p>
              <p className="mt-1 font-medium capitalize">{props.paidBy ?? ''}</p>
              {props.reference && <p className="text-sm text-[#555]">Ref. {props.reference}</p>}
            </div>
          )}
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-[#777]">
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((line, i) => (
              <tr key={i} className="border-b">
                <td className="py-2.5">
                  <span className="block">{line.title}</span>
                  {line.detail && <span className="block text-xs text-[#777]">{line.detail}</span>}
                </td>
                <td className="py-2.5 text-right tabular-nums">{formatMoney(line.amountPaise, props.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {props.totals.map((t, i) => (
              <tr key={i}>
                <td className={`py-1.5 text-right ${t.strong ? 'pt-3 font-semibold' : 'text-[#555]'}`}>{t.label}</td>
                <td className={`py-1.5 text-right tabular-nums ${t.strong ? 'pt-3 text-base font-semibold' : ''}`}>
                  {formatMoney(t.amountPaise, props.currency)}
                </td>
              </tr>
            ))}
          </tfoot>
        </table>

        {props.note && <p className="mt-4 text-sm text-[#555]">{props.note}</p>}

        <p className="mt-8 text-xs text-[#777]">
          {props.kind === 'RECEIPT'
            ? 'This receipt was generated by the academy’s system and is valid without a signature.'
            : 'Computer generated. Valid without a signature.'}
        </p>
      </div>
    </div>
  );
}
