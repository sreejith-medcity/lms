import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Badge, EmptyState, Table, Row, Cell } from '@/components/ui';
import { examFormat } from '@/lib/exams/registry';
import { LISTENING_LAYOUTS } from '@/lib/exams/types';
import { listeningParts, type ScriptLine } from '@/lib/exams/listening';
import { TEST_PERMS } from '@/lib/exams/perms';
import { SetToggle } from '../../editors';

export const dynamic = 'force-dynamic';

export default async function FormatSets({ params }: { params: Promise<{ formatCode: string }> }) {
  const { formatCode } = await params;
  const format = examFormat(formatCode);
  if (!format) notFound();
  const tenant = await requireTenant();
  const user = await getSessionUser();
  const mayEdit = Boolean(user && can(user.permissions, TEST_PERMS.content, 'edit'));

  const sets = await db.examSet.findMany({
    where: { organizationId: tenant.organizationId, formatCode: format.code },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, title: true, active: true, updatedAt: true, blocks: { select: { blockId: true, content: true, _count: { select: { audio: true } } } } },
  });
  const listening = format.blocks.filter((b) => LISTENING_LAYOUTS.includes(b.layout));

  return (
    <div className="space-y-4">
      <p className="t-small">
        <Link href="/admin/tests" className="underline">
          Content
        </Link>{' '}
        / {format.name}
      </p>
      <p className="t-small muted max-w-prose">
        The draw takes each part of a paper from one of the sets in the draw, by the paper&apos;s code. Taking a set out changes which paper a code gives from then on; papers
        already sat keep theirs.
      </p>
      {sets.length === 0 ? (
        <EmptyState title="No sets yet" hint="Bring in a content file on the Content tab." />
      ) : (
        <Table head={['Set', 'Parts', 'Listening recorded', 'Updated', '']}>
          {sets.map((s) => {
            let parts = 0;
            let recorded = 0;
            for (const def of listening) {
              const b = s.blocks.find((x) => x.blockId === def.id);
              if (!b) continue;
              const n = listeningParts((b.content as { script?: ScriptLine[] } | null)?.script, def.textCount).length;
              parts += n;
              recorded += Math.min(n, b._count.audio);
            }
            const missing = format.blocks.filter((d) => !s.blocks.some((b) => b.blockId === d.id)).map((d) => d.id);
            return (
              <Row key={s.id}>
                <Cell>
                  <span className="font-medium">{s.name}</span> {s.title && <span className="faint">{s.title}</span>}{' '}
                  {s.active ? <Badge tone="ok">in the draw</Badge> : <Badge>out</Badge>}
                </Cell>
                <Cell className="tabular-nums">
                  {s.blocks.length} <span className="faint">of {format.blocks.length}</span>
                  {missing.length > 0 && <p className="t-small faint">without {missing.join(', ')}</p>}
                </Cell>
                <Cell className="tabular-nums">{parts ? `${recorded} of ${parts}` : '–'}</Cell>
                <Cell className="t-small faint">{s.updatedAt.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: tenant.timezone })}</Cell>
                <Cell className="text-right">{mayEdit && <SetToggle id={s.id} active={s.active} />}</Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </div>
  );
}
