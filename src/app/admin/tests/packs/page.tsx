import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { examFamilies } from '@/lib/exams/registry';
import { packLine } from '@/lib/exams/packs';
import { TEST_PERMS } from '@/lib/exams/perms';
import { PackActions, PackForm } from './editors';

export const dynamic = 'force-dynamic';

export default async function Packs() {
  const tenant = await requireTenant();
  const user = await requireStaff(TEST_PERMS.packs, 'view');
  const mayEdit = can(user.permissions, TEST_PERMS.packs, 'edit');
  const products = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'TEST_SERIES', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      testPack: true,
      pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1, select: { pricePaise: true, currency: true } },
    },
  });
  const sold = products.length
    ? await db.examAllowance.groupBy({ by: ['productId'], where: { organizationId: tenant.organizationId, source: 'PACK', productId: { in: products.map((p) => p.id) }, revokedAt: null }, _count: { _all: true } })
    : [];
  const soldOf = (id: string) => sold.find((s) => s.productId === id)?._count._all ?? 0;
  const targets = examFamilies().flatMap((f) => [
    ...f.levels.map((l) => ({ value: `${f.family}:${l}`, label: `${f.name} ${l}` })),
    ...(f.levels.length > 1 ? [{ value: `${f.family}:`, label: `${f.name}, any level` }] : f.levels.length ? [] : [{ value: `${f.family}:`, label: f.name }]),
  ]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section title="Packs">
        {products.length === 0 ? (
          <EmptyState title="No packs yet" hint="A pack is so many papers of one test, sold on the public test pages and through the cart. Learners on a course get theirs from the course." />
        ) : (
          <Table head={['Pack', 'Price', 'Sold', '']}>
            {products.map((p) => {
              const plan = p.pricingPlans[0];
              return (
                <Row key={p.id}>
                  <Cell>
                    <span className="font-medium">{p.title}</span> <Badge tone={p.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{p.status === 'PUBLISHED' ? 'on sale' : 'draft'}</Badge>
                    {p.testPack && <p className="t-small faint">{packLine(p.testPack)}</p>}
                  </Cell>
                  <Cell className="tabular-nums">{plan ? formatMoney(plan.pricePaise, plan.currency) : '–'}</Cell>
                  <Cell className="tabular-nums">{soldOf(p.id)}</Cell>
                  <Cell>{mayEdit && <PackActions id={p.id} status={p.status} rupees={plan ? plan.pricePaise / 100 : null} />}</Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Section>
      {mayEdit && (
        <Section title="New pack">
          <Card>
            <PackForm targets={targets} />
          </Card>
        </Section>
      )}
    </div>
  );
}
