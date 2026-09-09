import { db } from '@/lib/db';
import { wooFor, customers, products, orders, type WooCustomer, type WooOrder } from '@/lib/woocommerce';
import { normalisePath } from '@/lib/redirects';

/**
 * Bringing the old store across.
 *
 * Three rules, and they are the whole design.
 *
 * It runs twice safely. Every row that crosses writes a `MigrationRecord`
 * keyed on the source system and the source id, so a second run finds the work
 * already done rather than creating a second copy. A migration that cannot be
 * re-run is a migration nobody dares start.
 *
 * It shows before it does. Every step has a dry run that reports exactly what
 * would happen, and nothing is written until somebody has seen that. The
 * expensive mistake here is not a failed import, it is a successful one that
 * did the wrong thing to four thousand accounts.
 *
 * It never guesses at money. An order is copied as history, matched to a
 * learner where the email matches one, and left visibly unmatched where it does
 * not. It does not create enrolments: what somebody paid for on the old store
 * is a question for a person, not for a heuristic on a product name.
 */

const SOURCE = 'WOOCOMMERCE';

export interface StepReport {
  entity: string;
  looked: number;
  wouldCreate: number;
  wouldUpdate: number;
  alreadyDone: number;
  problems: string[];
  /** A few examples, so a person can sanity check before committing. */
  samples: string[];
}

function name(customer: WooCustomer): string {
  const full = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim();
  return full || customer.username || customer.email.split('@')[0];
}

function phoneOf(customer: WooCustomer): string | null {
  const raw = customer.billing?.phone?.replace(/\D/g, '') ?? '';
  if (raw.length < 10) return null;
  return raw.slice(-10);
}

async function alreadyMigrated(entity: string, sourceIds: string[]): Promise<Set<string>> {
  const rows = await db.migrationRecord.findMany({
    where: { sourceSystem: SOURCE, entity, sourceId: { in: sourceIds }, status: 'MIGRATED' },
    select: { sourceId: true },
  });
  return new Set(rows.map((row) => row.sourceId));
}

/**
 * Customers.
 *
 * Matched on email, which is the only identifier both systems share. A learner
 * who already exists here is updated with the legacy id and nothing else: the
 * record in this product is the newer one, and letting an old store overwrite a
 * name or a phone number somebody has since corrected would be a step backwards.
 */
export async function importCustomers(
  organizationId: string,
  options: { dryRun: boolean; pages?: number },
): Promise<StepReport> {
  const report: StepReport = {
    entity: 'customers',
    looked: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    alreadyDone: 0,
    problems: [],
    samples: [],
  };

  const client = await wooFor(organizationId);
  if (!client) {
    report.problems.push('WooCommerce is not connected. Add the keys in Settings, Integrations.');
    return report;
  }

  const maxPages = options.pages ?? 3;

  for (let page = 1; page <= maxPages; page += 1) {
    let batch: WooCustomer[];
    try {
      batch = await customers(client, page);
    } catch (err) {
      report.problems.push(err instanceof Error ? err.message : String(err));
      break;
    }
    if (!batch.length) break;

    report.looked += batch.length;
    const done = await alreadyMigrated('customer', batch.map((c) => String(c.id)));

    for (const customer of batch) {
      if (done.has(String(customer.id))) {
        report.alreadyDone += 1;
        continue;
      }

      const email = customer.email?.trim().toLowerCase();
      if (!email) {
        report.problems.push(`Customer ${customer.id} has no email address, so nothing can match it.`);
        continue;
      }

      const existing = await db.user.findFirst({
        where: { organizationId, email },
        select: { id: true },
      });

      if (existing) {
        report.wouldUpdate += 1;
        if (report.samples.length < 5) report.samples.push(`${email} is already here, linking`);
        if (!options.dryRun) {
          await db.user.update({
            where: { id: existing.id },
            data: { legacyWooId: String(customer.id) },
          });
          await mark('customer', String(customer.id), existing.id);
        }
        continue;
      }

      report.wouldCreate += 1;
      if (report.samples.length < 5) report.samples.push(`${email} would be created`);

      if (!options.dryRun) {
        const phone = phoneOf(customer);
        // A phone number already belonging to someone else is dropped rather
        // than causing the whole import to stop on a unique constraint.
        const phoneTaken = phone
          ? await db.user.findFirst({ where: { organizationId, phone }, select: { id: true } })
          : null;

        const created = await db.user.create({
          data: {
            organizationId,
            name: name(customer),
            email,
            phone: phoneTaken ? null : phone,
            kind: 'LEARNER',
            status: 'ACTIVE',
            legacyWooId: String(customer.id),
            // No password. They sign in with a code, or set one through the
            // forgotten-password flow. Inventing one and emailing it out is how
            // a migration becomes a security incident.
            createdAt: new Date(customer.date_created),
          },
          select: { id: true },
        });
        await mark('customer', String(customer.id), created.id);
      }
    }
  }

  return report;
}

/**
 * Products, as redirects rather than as courses.
 *
 * The courses here are already authored, properly, with modules and pricing
 * plans; a WooCommerce product is a title and a price. Copying them in would
 * produce four hundred shells somebody then has to delete. What is actually
 * worth keeping is the URL, so this reads the store's permalinks and proposes a
 * redirect for each one.
 */
export async function importProductRedirects(
  organizationId: string,
  options: { dryRun: boolean; pages?: number },
): Promise<StepReport> {
  const report: StepReport = {
    entity: 'product URLs',
    looked: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    alreadyDone: 0,
    problems: [],
    samples: [],
  };

  const client = await wooFor(organizationId);
  if (!client) {
    report.problems.push('WooCommerce is not connected. Add the keys in Settings, Integrations.');
    return report;
  }

  // The slug lives on Product, which is what the public course page is keyed
  // on, so that is what a store URL has to match.
  const catalogue = await db.product.findMany({
    where: { organizationId, deletedAt: null, type: 'COURSE' },
    select: { slug: true, title: true },
  });
  const bySlug = new Map(catalogue.map((row) => [row.slug, row]));

  const maxPages = options.pages ?? 5;

  for (let page = 1; page <= maxPages; page += 1) {
    let batch;
    try {
      batch = await products(client, page);
    } catch (err) {
      report.problems.push(err instanceof Error ? err.message : String(err));
      break;
    }
    if (!batch.length) break;

    report.looked += batch.length;

    for (const product of batch) {
      let fromPath: string;
      try {
        fromPath = normalisePath(new URL(product.permalink).pathname);
      } catch {
        continue;
      }

      // Same slug on both sides is the common case, and the safe one.
      const match = bySlug.get(product.slug);
      const toPath = match ? `/course/${match.slug}` : '/courses';

      if (!match) {
        report.problems.push(
          `${product.name} has no course here with the slug ${product.slug}, so its URL would go to the catalogue rather than to a page about it.`,
        );
      }

      const existing = await db.redirect.findUnique({
        where: { organizationId_fromPath: { organizationId, fromPath } },
        select: { id: true },
      });

      if (existing) {
        report.alreadyDone += 1;
        continue;
      }

      report.wouldCreate += 1;
      if (report.samples.length < 5) report.samples.push(`${fromPath} to ${toPath}`);

      if (!options.dryRun) {
        await db.redirect.create({
          data: { organizationId, fromPath, toPath, statusCode: 301 },
        });
      }
    }
  }

  return report;
}

/**
 * Orders, as history.
 *
 * Copied so that "what did I buy in 2024" has an answer after the old store is
 * switched off. Deliberately not turned into enrolments: what somebody paid for
 * there is a question for a person, and a heuristic that guesses wrong grants
 * access nobody paid for or withholds access somebody did.
 */
export async function importOrders(
  organizationId: string,
  options: { dryRun: boolean; pages?: number },
): Promise<StepReport> {
  const report: StepReport = {
    entity: 'orders',
    looked: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    alreadyDone: 0,
    problems: [],
    samples: [],
  };

  const client = await wooFor(organizationId);
  if (!client) {
    report.problems.push('WooCommerce is not connected. Add the keys in Settings, Integrations.');
    return report;
  }

  const maxPages = options.pages ?? 3;
  let unmatched = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    let batch: WooOrder[];
    try {
      batch = await orders(client, page);
    } catch (err) {
      report.problems.push(err instanceof Error ? err.message : String(err));
      break;
    }
    if (!batch.length) break;

    report.looked += batch.length;
    const done = await alreadyMigrated('order', batch.map((o) => String(o.id)));

    for (const order of batch) {
      if (done.has(String(order.id))) {
        report.alreadyDone += 1;
        continue;
      }

      const email = order.billing?.email?.trim().toLowerCase() ?? null;
      const learner = email
        ? await db.user.findFirst({
            where: { organizationId, email },
            select: { id: true },
          })
        : null;

      if (!learner) unmatched += 1;

      report.wouldCreate += 1;
      if (report.samples.length < 5) {
        report.samples.push(
          `#${order.number}, ${order.currency} ${order.total}${learner ? '' : ', no learner here with that address'}`,
        );
      }

      if (!options.dryRun) {
        // Kept as a migration record rather than written into the live orders
        // table. These were taken by another system under another gateway, and
        // mixing them into this ledger would make settlements and tax reports
        // wrong for every period they touch.
        await db.migrationRecord.upsert({
          where: {
            sourceSystem_entity_sourceId: {
              sourceSystem: SOURCE,
              entity: 'order',
              sourceId: String(order.id),
            },
          },
          create: {
            sourceSystem: SOURCE,
            entity: 'order',
            sourceId: String(order.id),
            targetId: learner?.id ?? null,
            status: 'MIGRATED',
            migratedAt: new Date(),
            payload: {
              number: order.number,
              status: order.status,
              total: order.total,
              currency: order.currency,
              paidAt: order.date_paid,
              email,
              items: (order.line_items ?? []).map((item) => ({
                name: item.name,
                total: item.total,
                quantity: item.quantity,
              })),
            },
          },
          update: { targetId: learner?.id ?? null },
        });
      }
    }
  }

  if (unmatched > 0) {
    report.problems.push(
      `${unmatched} orders have no learner here with that email address. They are kept as history and can be matched by hand.`,
    );
  }

  return report;
}

async function mark(entity: string, sourceId: string, targetId: string): Promise<void> {
  await db.migrationRecord.upsert({
    where: { sourceSystem_entity_sourceId: { sourceSystem: SOURCE, entity, sourceId } },
    create: {
      sourceSystem: SOURCE,
      entity,
      sourceId,
      targetId,
      status: 'MIGRATED',
      migratedAt: new Date(),
    },
    update: { targetId, status: 'MIGRATED', migratedAt: new Date() },
  });
}

export async function migrationSummary(): Promise<{ entity: string; migrated: number }[]> {
  const grouped = await db.migrationRecord.groupBy({
    by: ['entity'],
    where: { sourceSystem: SOURCE, status: 'MIGRATED' },
    _count: { _all: true },
  });
  return grouped.map((row) => ({ entity: row.entity, migrated: row._count._all }));
}
