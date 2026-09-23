import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, EmptyState, Input, Select, Button, Table, Row, Cell } from '@/components/ui';
import { EXAM_FORMATS } from '@/lib/exams/registry';
import { TEST_PERMS } from '@/lib/exams/perms';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' }> = {
  IN_PROGRESS: { label: 'under way', tone: 'brand' },
  SUBMITTED: { label: 'being marked', tone: 'warn' },
  EVALUATED: { label: 'marked', tone: 'ok' },
  EXPIRED: { label: 'ran out', tone: 'neutral' },
  VOID: { label: 'taken off', tone: 'bad' },
};

const fmt = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(n * 10) / 10));

export default async function Sittings({ searchParams }: { searchParams: Promise<{ status?: string; format?: string; q?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireTenant();
  await requireStaff(TEST_PERMS.sittings, 'view');
  const where: Prisma.ExamSittingWhereInput = { organizationId: tenant.organizationId };
  if (sp.status && STATUS[sp.status]) where.status = sp.status as Prisma.ExamSittingWhereInput['status'];
  if (sp.format && EXAM_FORMATS.some((f) => f.code === sp.format)) where.formatCode = sp.format;
  const q = (sp.q ?? '').trim();
  if (q) where.user = { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] };
  const rows = await db.examSitting.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: 150,
    select: {
      id: true,
      formatCode: true,
      mode: true,
      status: true,
      startedAt: true,
      total: true,
      maxPoints: true,
      passed: true,
      sectionId: true,
      assignmentId: true,
      user: { select: { name: true, email: true, kind: true } },
    },
  });
  const nameOf = (code: string) => EXAM_FORMATS.find((f) => f.code === code)?.name ?? code;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={q} placeholder="Name, email or phone" className="max-w-xs" />
        <Select name="format" defaultValue={sp.format ?? ''} className="max-w-[14rem]">
          <option value="">Every test</option>
          {EXAM_FORMATS.map((f) => (
            <option key={f.code} value={f.code}>
              {f.name}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ''} className="max-w-[12rem]">
          <option value="">Any state</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No papers" hint="Papers appear here the moment a learner starts one." />
      ) : (
        <Table head={['Learner', 'Test', 'Started', 'State', 'Score', '']}>
          {rows.map((s) => (
            <Row key={s.id}>
              <Cell>
                <span className="font-medium">{s.user.name}</span>
                {s.user.kind === 'STAFF' && <Badge>staff</Badge>}
                <p className="t-small faint">{s.user.email}</p>
              </Cell>
              <Cell>
                {nameOf(s.formatCode)}
                <p className="t-small faint">
                  {s.mode === 'practice' ? 'practice' : 'exam'}
                  {s.sectionId ? `, ${s.sectionId} only` : ''}
                  {s.assignmentId ? ', set paper' : ''}
                </p>
              </Cell>
              <Cell className="t-small tabular-nums">{s.startedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone })}</Cell>
              <Cell>
                <Badge tone={STATUS[s.status]?.tone}>{STATUS[s.status]?.label ?? s.status}</Badge>
              </Cell>
              <Cell className="tabular-nums">
                {s.total == null ? '–' : `${fmt(s.total)} / ${fmt(s.maxPoints)}`}
                {s.passed != null && <span className={`t-small ml-1 ${s.passed ? 'text-[var(--ok)]' : 'text-[var(--bad)]'}`}>{s.passed ? 'pass' : 'not yet'}</span>}
              </Cell>
              <Cell className="text-right">
                <Link href={`/admin/tests/sittings/${s.id}`} className="t-small underline">
                  Open
                </Link>
              </Cell>
            </Row>
          ))}
        </Table>
      )}
      {rows.length === 150 && <p className="t-small faint">The latest 150. Narrow the search to see older papers.</p>}
    </div>
  );
}
