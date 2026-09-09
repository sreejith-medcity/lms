import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { readDesign } from '@/lib/certificate';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { TemplateForm, IssueForm, RevokeButton, VerifyLink } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function CertificatesPage() {
  const tenant = await requireTenant();
  await requireStaff('certificates.manage_templates', 'view');

  const [templates, issued, completions, org] = await Promise.all([
    db.certificateTemplate.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        serialPrefix: true,
        nextSerial: true,
        validityMonths: true,
        autoIssueOn: true,
        designJson: true,
        _count: { select: { issued: true } },
      },
    }),
    db.issuedCertificate.findMany({
      where: { template: { organizationId: tenant.organizationId } },
      orderBy: { issuedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        serialNo: true,
        issuedAt: true,
        expiresAt: true,
        revokedAt: true,
        verifyToken: true,
        user: { select: { name: true, email: true } },
        enrollment: { select: { product: { select: { title: true } } } },
      },
    }),
    // Finished a course and has nothing to show for it.
    db.enrollment.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: 'COMPLETED',
        certificates: { none: { revokedAt: null } },
      },
      orderBy: { completedAt: 'desc' },
      take: 25,
      select: {
        id: true,
        completedAt: true,
        user: { select: { name: true } },
        product: { select: { title: true } },
      },
    }),
    db.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      select: { name: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Certificates"
        description="A certificate is a claim made in public, so every one here has a sequential serial, a page a stranger can check it on, and a withdrawal that stays on the record rather than disappearing."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {completions.length > 0 && templates.length > 0 && (
            <section>
              <h2 className="t-heading mb-3">Finished, nothing issued</h2>
              <Card padded={false}>
                <ul className="divide-y">
                  {completions.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{c.user.name}</p>
                        <p className="t-small faint">
                          {c.product.title}
                          {c.completedAt
                            ? ` · finished ${c.completedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                            : ''}
                        </p>
                      </div>
                      <IssueForm
                        enrollmentId={c.id}
                        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          <section>
            <h2 className="t-heading mb-3">Issued</h2>
            {issued.length === 0 ? (
              <EmptyState
                title="None issued yet"
                hint="Set a template to issue automatically and finishing a course is enough."
              />
            ) : (
              <Table head={['Serial', 'Holder', 'Course', 'Status', '']}>
                {issued.map((c) => {
                  const expired = c.expiresAt != null && c.expiresAt < new Date();
                  return (
                    <Row key={c.id}>
                      <Cell>
                        <span className="font-mono text-xs">{c.serialNo}</span>
                        <span className="t-small faint block">
                          {c.issuedAt.toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </Cell>
                      <Cell>
                        <span className="text-sm">{c.user.name}</span>
                        <span className="t-small faint block">{c.user.email ?? '—'}</span>
                      </Cell>
                      <Cell className="t-small">{c.enrollment?.product.title ?? '—'}</Cell>
                      <Cell>
                        <Badge tone={c.revokedAt ? 'bad' : expired ? 'warn' : 'ok'}>
                          {c.revokedAt ? 'withdrawn' : expired ? 'expired' : 'valid'}
                        </Badge>
                      </Cell>
                      <Cell>
                        <div className="flex items-center gap-3">
                          <VerifyLink token={c.verifyToken} />
                          {!c.revokedAt && <RevokeButton id={c.id} serial={c.serialNo} />}
                        </div>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          </section>
        </div>

        <div className="space-y-5">
          {templates.map((t) => (
            <Card key={t.id}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="t-heading">{t.name}</h2>
                <span className="t-small faint tabular-nums">
                  {t._count.issued} issued · next {t.serialPrefix}-
                  {String(t.nextSerial).padStart(5, '0')}
                </span>
              </div>
              <TemplateForm
                academy={org.name}
                template={{
                  id: t.id,
                  name: t.name,
                  serialPrefix: t.serialPrefix,
                  validityMonths: t.validityMonths,
                  autoIssueOn: t.autoIssueOn ?? 'MANUAL',
                  design: readDesign(t.designJson),
                  locked: t._count.issued > 0,
                }}
              />
            </Card>
          ))}

          <Card>
            <h2 className="t-heading">
              {templates.length === 0 ? 'First template' : 'Another template'}
            </h2>
            <p className="t-small muted mt-1">
              The serial prefix is fixed once anything is issued under it, so two series never
              look like one.
            </p>
            <div className="mt-5">
              <TemplateForm academy={org.name} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
