import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { dnsRecordsFor } from '@/lib/email-domain-rules';
import { spfInclude } from '@/lib/email-domain';
import { Badge, Card } from '@/components/ui';
import { CheckButtons, CopyValue, DomainForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Sending as the academy rather than as the platform. Three DNS records,
 * shown with a copy button each, checked from here, and applied to every
 * email the moment they resolve.
 */
export default async function EmailDomainPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.integrations', 'view');
  const canEdit = me.permissions['settings.integrations']?.edit ?? false;
  const onPlan = tenant.features.white_label !== false;
  const row = await db.emailDomain.findUnique({ where: { organizationId: tenant.organizationId }, select: { domain: true, fromLocal: true, fromName: true, dkimSelector: true, dkimPublicKey: true, status: true, spfOk: true, dkimOk: true, dmarcOk: true, lastCheckedAt: true, lastCheckNote: true, verifiedAt: true } });
  const records = row ? dnsRecordsFor(row.domain, row.dkimSelector, row.dkimPublicKey, spfInclude()) : [];
  const okOf = { DKIM: row?.dkimOk, SPF: row?.spfOk, DMARC: row?.dmarcOk } as Record<string, boolean | undefined>;
  const day = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="t-heading">Send from your own domain</h2>
            <p className="t-small muted mt-1 max-w-prose">
              Receipts, reminders and codes go out as {row ? <span className="font-mono">{row.fromLocal}@{row.domain}</span> : 'you'} instead of the provider's address, signed with a key that is yours. Three DNS records and a check.
            </p>
          </div>
          {row && <Badge tone={row.status === 'VERIFIED' ? 'ok' : 'warn'}>{row.status === 'VERIFIED' ? 'Verified, in use' : 'Waiting on DNS'}</Badge>}
        </div>
        {!onPlan ? (
          <p className="t-small mt-4 text-[var(--warn)]">Sending from your own domain is not on your plan. See Settings, Billing.</p>
        ) : canEdit ? (
          <div className="mt-4"><DomainForm draft={row ? { domain: row.domain, fromLocal: row.fromLocal, fromName: row.fromName ?? '' } : null} /></div>
        ) : null}
      </Card>

      {row && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="t-heading">DNS records</h2>
              <p className="t-small muted mt-1">Add these at your domain registrar or DNS host. They take from a few minutes to a day to resolve.</p>
            </div>
            {canEdit && onPlan && <CheckButtons hasDomain />}
          </div>
          <div className="mt-4 space-y-3">
            {records.map((r) => (
              <div key={r.kind} className="rounded-[var(--radius-sm)] border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{r.kind} <span className="t-micro faint">TXT</span></p>
                  {row.lastCheckedAt && <Badge tone={okOf[r.kind] ? 'ok' : r.kind === 'DMARC' ? 'neutral' : 'bad'}>{okOf[r.kind] ? 'resolves' : r.kind === 'DMARC' ? 'not yet (optional)' : 'not yet'}</Badge>}
                </div>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[6rem_1fr]">
                  <dt className="faint">Host</dt>
                  <dd className="flex items-center gap-2 break-all font-mono">{r.host} <CopyValue value={r.host} /></dd>
                  <dt className="faint">Value</dt>
                  <dd className="flex items-start gap-2 break-all font-mono">{r.value} <CopyValue value={r.value} /></dd>
                </dl>
                <p className="t-micro faint mt-2">{r.why}</p>
              </div>
            ))}
          </div>
          <p className="t-small muted mt-4">
            {row.lastCheckedAt ? `Last checked ${day(row.lastCheckedAt)}: ${row.lastCheckNote ?? ''}` : 'Not checked yet.'}
            {row.verifiedAt ? ` Verified ${day(row.verifiedAt)}.` : ''}
          </p>
          <p className="t-micro faint mt-2">
            With SMTP the platform signs each email with your key. With an API provider (Resend, SendGrid, Postmark, SES) the From changes here and the provider's own domain verification, done on their dashboard, does the signing.
          </p>
        </Card>
      )}
    </div>
  );
}
