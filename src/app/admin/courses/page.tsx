import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { Badge, Cell, EmptyState, LinkButton, PageHeader, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const tenant = await requireTenant();

  const products = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
    include: {
      course: { select: { modules: { select: { moduleId: true } } } },
      pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
      _count: { select: { enrollments: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div>
      <PageHeader
        title="Courses"
        description="Everything you sell and teach. Curriculum is built from the shared module library."
        action={<LinkButton href="/admin/courses/new">New course</LinkButton>}
      />

      {products.length === 0 ? (
        <EmptyState
          title="No courses yet"
          hint="Create the first one and add its curriculum."
          action={<LinkButton href="/admin/courses/new" size="sm">New course</LinkButton>}
        />
      ) : (
        <Table head={['Course', 'Status', 'Modules', 'Price', 'Enrolments']}>
          {products.map((p) => (
            <Row key={p.id}>
              <Cell>
                <Link href={`/admin/courses/${p.id}`} className="font-medium hover:underline">
                  {p.title}
                </Link>
                <span className="t-small faint block">/{p.slug}</span>
              </Cell>
              <Cell>
                <Badge tone={p.status === 'PUBLISHED' ? 'ok' : p.status === 'DRAFT' ? 'neutral' : 'warn'}>
                  {p.status.toLowerCase()}
                </Badge>
              </Cell>
              <Cell className="tabular-nums">{p.course?.modules.length ?? 0}</Cell>
              <Cell className="tabular-nums">
                {p.pricingPlans[0]
                  ? formatMoney(p.pricingPlans[0].pricePaise, p.pricingPlans[0].currency)
                  : <span className="faint">not priced</span>}
              </Cell>
              <Cell className="tabular-nums">{p._count.enrollments}</Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  );
}
