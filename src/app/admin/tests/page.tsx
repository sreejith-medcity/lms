import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Badge, Card, Section, Table, Row, Cell } from '@/components/ui';
import { EXAM_FORMATS, FAMILY_NAMES } from '@/lib/exams/registry';
import { contentStatus } from '@/lib/exams/content-admin';
import { geminiReady } from '@/lib/exams/gemini';
import { TEST_PERMS } from '@/lib/exams/perms';
import { ImportForm, PullAudioButton, TryButton } from './editors';

export const dynamic = 'force-dynamic';

export default async function TestsContent() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  const mayEdit = Boolean(user && can(user.permissions, TEST_PERMS.content, 'edit'));
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [status, ai, sat] = await Promise.all([
    contentStatus(tenant.organizationId),
    geminiReady(tenant.organizationId),
    db.examSitting.groupBy({ by: ['formatCode'], where: { organizationId: tenant.organizationId, startedAt: { gte: since }, status: { not: 'VOID' } }, _count: { _all: true } }),
  ]);
  const satBy = Object.fromEntries(sat.map((s) => [s.formatCode, s._count._all]));
  const families = [...new Set(EXAM_FORMATS.map((f) => f.family))];

  return (
    <div className="space-y-8">
      {!ai && (
        <Card className="border-[var(--warn)]/40">
          <p className="t-small">
            <b>Writing and speaking are not being marked.</b> Add a Gemini API key on the{' '}
            <Link className="underline" href="/admin/settings/integrations">
              Google AI card
            </Link>
            . Until then those parts wait for a tutor under Marking; the objective parts count as usual.
          </p>
        </Card>
      )}

      {families.map((fam) => (
        <Section key={fam} title={FAMILY_NAMES[fam] ?? fam}>
          <Table head={['Test', 'Sets in the draw', 'Listening recorded', 'Sat, 30 days', '']}>
            {EXAM_FORMATS.filter((f) => f.family === fam).map((f) => {
              const s = status[f.code];
              const missing = s ? s.parts - s.recorded : 0;
              return (
                <Row key={f.code}>
                  <Cell>
                    <Link href={`/admin/tests/sets/${f.code}`} className="font-medium hover:underline">
                      {f.name}
                    </Link>
                    <p className="t-small faint">{f.subtitle}</p>
                  </Cell>
                  <Cell className="tabular-nums">
                    {s ? (
                      <>
                        {s.active} <span className="faint">of {s.sets}</span>
                      </>
                    ) : (
                      <Badge>no content</Badge>
                    )}
                  </Cell>
                  <Cell className="tabular-nums">
                    {s && s.parts ? (
                      <>
                        {s.recorded} <span className="faint">of {s.parts}</span> {missing === 0 && <Badge tone="ok">all</Badge>}
                      </>
                    ) : (
                      <span className="faint">–</span>
                    )}
                    {s && missing > 0 && <p className="t-small faint">The rest is read aloud by the browser.</p>}
                  </Cell>
                  <Cell className="tabular-nums">{satBy[f.code] ?? 0}</Cell>
                  <Cell className="space-y-2 text-right">
                    {s?.active ? <TryButton formatCode={f.code} /> : null}
                    {mayEdit && f.family === 'telc' && s && missing > 0 ? <PullAudioButton formatCode={f.code} missing={missing} /> : null}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        </Section>
      ))}

      {mayEdit && (
        <Section title="Bring in content">
          <Card>
            <ImportForm />
            <p className="t-small faint mt-4">
              The content (texts, questions and answer keys) lives only in this academy&apos;s database, never in the code. A set taken out of the draw stays here, and a paper already
              sat keeps the version it was drawn from.
            </p>
          </Card>
        </Section>
      )}
    </div>
  );
}
