import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { FeeTypeActions, FeeTypeForm, type FeeTypeDraft } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The catalogue of charges beyond the course fee.
 *
 * Named once with a usual amount, so raising an exam fee against a learner
 * is a pick from a list rather than a number typed from memory, and the
 * collections report can say how much came in as exam fees.
 */
export default async function FeeTypesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('sales.fee_tracking', 'view');
  const canEdit = me.permissions['sales.fee_tracking']?.edit ?? false;
  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit : '';

  const types = await db.feeType.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
    select: { id: true, name: true, amountPaise: true, taxable: true, description: true, isActive: true, _count: { select: { fees: true } } },
  });
  const editing = types.find((t) => t.id === editId);
  const draft: FeeTypeDraft | null = editing ? { id: editing.id, name: editing.name, amountPaise: editing.amountPaise, taxable: editing.taxable, description: editing.description ?? '' } : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee types"
        description="The charges besides the course fee: an exam fee, study material, a certificate reissued. Raise one against a learner from their fee statement."
        action={
          <Link href="/admin/fees" className="t-small underline">
            All dues
          </Link>
        }
      />

      {canEdit && (
        <Card>
          <h2 className="t-heading">{draft ? `Editing: ${draft.name}` : 'Add a fee type'}</h2>
          <div className="mt-4">
            <FeeTypeForm key={draft?.id ?? 'new'} draft={draft} currency={tenant.currency} />
          </div>
        </Card>
      )}

      {types.length === 0 ? (
        <EmptyState title="No fee types yet" hint="Add the ones the counter raises most, with their usual amounts." />
      ) : (
        <Card padded={false}>
          <Table head={['Fee', 'Usual amount', 'GST', 'Raised', '']}>
            {types.map((t) => (
              <Row key={t.id}>
                <Cell>
                  <span className={`font-medium ${t.isActive ? '' : 'muted'}`}>{t.name}</span>
                  {t.description && <span className="t-small faint block">{t.description}</span>}
                  {!t.isActive && <Badge tone="neutral">retired</Badge>}
                </Cell>
                <Cell className="tabular-nums">{t.amountPaise > 0 ? formatMoney(t.amountPaise, tenant.currency) : <span className="faint">set each time</span>}</Cell>
                <Cell>{t.taxable ? 'applies' : 'none'}</Cell>
                <Cell className="tabular-nums">{t._count.fees}</Cell>
                <Cell>{canEdit && <FeeTypeActions id={t.id} isActive={t.isActive} />}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
