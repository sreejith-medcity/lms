import Link from 'next/link';
import { requireTenant } from '@/lib/tenant';
import { dayKey } from '@/lib/clock';
import { hoursLabel, monthWindow, recentMonthKeys } from '@/lib/payouts';
import { resolveIntegration } from '@/lib/integration-store';
import { Badge, Card, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { tutorHours } from '@/lib/tutoring/data';

export const dynamic = 'force-dynamic';

export default async function TutoringHours({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireTenant();
  const now = new Date();
  const months = recentMonthKeys(now, tenant.timezone, 6);
  const key = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : dayKey(now, tenant.timezone).slice(0, 7);
  const window = monthWindow(key, tenant.timezone)!;
  const [rows, hrms] = await Promise.all([tutorHours(tenant.organizationId, window.from, window.to, tenant.timezone, now), resolveIntegration(tenant.organizationId, 'hrms')]);
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  const unconfirmed = rows.reduce((n, r) => n + r.unconfirmed, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => (
          <Link
            key={m}
            href={`/admin/tutoring/hours?month=${m}`}
            className={`rounded-full border px-3 py-1 text-[0.8125rem] ${m === key ? 'border-transparent bg-[var(--brand)] text-[var(--brand-ink)]' : 'bg-[var(--surface)]'}`}
          >
            {monthWindow(m, tenant.timezone)?.label ?? m}
          </Link>
        ))}
        <a href={`/admin/tutoring/hours.csv?month=${key}`} className="t-small ml-auto underline">
          Download as CSV
        </a>
      </div>

      <Section title={`Online class hours, ${window.label}`}>
        {rows.length === 0 ? (
          <EmptyState title="No online classes in this month" hint="Hours appear once classes are held: the register is in, or the meeting ended on Zoom." />
        ) : (
          <Table head={['Tutor', 'Employee code', 'Classes held', 'Hours', 'Not confirmed']}>
            {rows.map((r) => (
              <Row key={r.userId}>
                <Cell>
                  <span className="font-medium">{r.name}</span>
                  <p className="t-small faint">{r.email}</p>
                </Cell>
                <Cell>{r.employeeCode ?? <span className="t-small text-[var(--warn)]">not set</span>}</Cell>
                <Cell className="tabular-nums">{r.classes}</Cell>
                <Cell className="tabular-nums">
                  {r.hours} <span className="t-small faint">({hoursLabel(r.minutes)})</span>
                </Cell>
                <Cell className="tabular-nums">{r.unconfirmed ? <Badge tone="warn">{r.unconfirmed} without a register</Badge> : '0'}</Cell>
              </Row>
            ))}
          </Table>
        )}
        <p className="t-small faint">
          {hoursLabel(total)} in all. An hour counts once the class is held: the tutor submitted the register, or the Zoom meeting ended. {unconfirmed > 0 ? `${unconfirmed} classes have passed with neither and add nothing until the register is in.` : ''}
        </p>
      </Section>

      <Section title="Payroll (HRMS)">
        <Card>
          <p className="t-small">
            {hrms?.values.apiKey ? <Badge tone="ok">key set</Badge> : <Badge tone="warn">no key yet</Badge>} The HRMS fetches these hours itself from{' '}
            <code>/api/hrms/tutor-hours?month={key}</code> on this site, sending the key as <code>Authorization: Bearer</code>. Set the key on the HRMS card under{' '}
            <Link href="/admin/settings/integrations" className="underline">
              Settings, Integrations
            </Link>
            , and the same key in the HRMS. Tutors are matched there by employee code, then by email.
          </p>
        </Card>
      </Section>
    </div>
  );
}
