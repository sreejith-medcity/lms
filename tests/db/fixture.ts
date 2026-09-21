/**
 * A throwaway academy in a real Postgres, for the tests that cannot be
 * honest without one: fulfilment, refunds, the promo cap. Each of those
 * decides something about money against a uniqueness constraint or a row
 * lock, and a mock of Prisma would be testing the mock.
 *
 * Needs TEST_DATABASE_URL pointing at a database with the schema pushed
 * (`prisma db push`), never the live one: the fixture creates and deletes
 * its own tenant and nothing else, but a wrong URL is still a wrong URL.
 * Without the variable every test here skips, so `npm test` on a laptop
 * with no Postgres stays green and says why.
 */
import { randomBytes } from 'node:crypto';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? '';

if (TEST_URL) {
  process.env.DATABASE_URL = TEST_URL;
  process.env.DATABASE_URL_UNPOOLED = TEST_URL;
}

export interface Academy {
  tenantId: string;
  organizationId: string;
  branchId: string;
  learnerId: string;
  productId: string;
  courseId: string;
  planId: string;
  /** Removes the tenant and, by cascade, everything the tests wrote under it. */
  drop(): Promise<void>;
}

/** Builds one academy with one learner, one course and one one-time price. */
export async function makeAcademy(): Promise<Academy> {
  const { db } = await import('../../src/lib/db');
  const tag = randomBytes(4).toString('hex');
  const tenant = await db.tenant.create({ data: { name: `Test ${tag}`, slug: `test-${tag}`, ownerEmail: `owner-${tag}@example.test`, status: 'ACTIVE' }, select: { id: true } });
  const org = await db.organization.create({ data: { tenantId: tenant.id, name: `Test academy ${tag}`, slug: `test-${tag}` }, select: { id: true } });
  const branch = await db.branch.create({ data: { organizationId: org.id, name: 'Main', code: `MAIN${tag}` }, select: { id: true } });
  const learner = await db.user.create({ data: { organizationId: org.id, name: 'Test Learner', email: `learner-${tag}@example.test`, kind: 'LEARNER', status: 'ACTIVE', branchMemberships: { create: { branchId: branch.id, isPrimary: true } } }, select: { id: true } });
  const product = await db.product.create({
    data: { organizationId: org.id, type: 'COURSE', title: 'German A1', slug: `german-a1-${tag}`, status: 'PUBLISHED', course: { create: { organizationId: org.id } } },
    select: { id: true, course: { select: { id: true } } },
  });
  const plan = await db.pricingPlan.create({ data: { productId: product.id, name: 'Full fee', planType: 'ONE_TIME', pricePaise: 1_000_000 }, select: { id: true } });
  return {
    tenantId: tenant.id,
    organizationId: org.id,
    branchId: branch.id,
    learnerId: learner.id,
    productId: product.id,
    courseId: product.course!.id,
    planId: plan.id,
    drop: async () => {
      // Money rows hold their learner without a cascade, on purpose, so
      // they go first; the tenant then takes the rest down with it.
      await db.refund.deleteMany({ where: { payment: { organizationId: org.id } } });
      await db.payment.deleteMany({ where: { organizationId: org.id } });
      await db.invoice.deleteMany({ where: { order: { organizationId: org.id } } });
      await db.enrollment.deleteMany({ where: { organizationId: org.id } });
      await db.order.deleteMany({ where: { organizationId: org.id } });
      await db.gatewayEvent.deleteMany({ where: { organizationId: org.id } });
      await db.promoCode.deleteMany({ where: { organizationId: org.id } });
      await db.tenant.delete({ where: { id: tenant.id } });
    },
  };
}

/** A pending order for the course at its full price, as checkout would leave it. */
export async function makeOrder(a: Academy, totalPaise = 1_000_000): Promise<{ orderId: string; orderNo: string }> {
  const { db } = await import('../../src/lib/db');
  const orderNo = `T${randomBytes(3).toString('hex').toUpperCase()}`;
  const order = await db.order.create({
    data: {
      organizationId: a.organizationId,
      branchId: a.branchId,
      userId: a.learnerId,
      orderNo,
      status: 'PENDING',
      subtotalPaise: totalPaise,
      totalPaise,
      gatewayOrderId: `order_${orderNo}`,
      gateway: 'razorpay',
      items: { create: { productId: a.productId, pricingPlanId: a.planId, titleSnapshot: 'German A1', pricePaise: totalPaise, totalPaise } },
    },
    select: { id: true },
  });
  return { orderId: order.id, orderNo };
}
