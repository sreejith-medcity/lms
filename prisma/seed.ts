/**
 * Seeds the platform: permission catalogue, plans, the Medcity tenant, default
 * roles, notification events, custom fields, and a small demo course so the
 * admin has something to look at on first run.
 *
 * Run: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { allPermissionKeys } from '../src/lib/permissions';
import { hashPassword } from '../src/lib/password';

const db = new PrismaClient();

const NOTIFICATION_EVENTS = [
  // Login & signup
  'auth.signup_confirmation', 'auth.signup_otp', 'auth.login_otp',
  'auth.forgot_password', 'auth.reset_password_link', 'auth.secondary_validation',
  // Sessions
  'session.scheduled', 'session.updated', 'session.manual_reminder',
  'session.reminder', 'session.start', 'session.holiday', 'session.cancelled',
  'session.absentee',
  // Payments
  'payment.received', 'payment.reminder', 'payment.failed', 'payment.refunded',
  // Courses
  'course.welcome', 'course.completion', 'course.drip_released',
  // Memberships
  'membership.activated', 'membership.expiring', 'membership.expired',
  // Community
  'community.new_post', 'community.reply', 'community.mention',
  // Misc
  'certificate.issued', 'assessment.evaluated', 'cart.abandoned',
];

/** The 25 learner fields the Edmingle account carries, so nothing is lost later. */
const LEARNER_FIELDS: Array<[string, string, 'TEXT' | 'NUMBER' | 'DATE' | 'DROPDOWN' | 'FILE', boolean]> = [
  ['username', 'Username', 'TEXT', false],
  ['country', 'Country', 'DROPDOWN', false],
  ['student_mobile', 'Student Mobile Number', 'NUMBER', true],
  ['student_name', 'Student Name', 'TEXT', true],
  ['date_of_birth', 'Date of Birth', 'DATE', false],
  ['gender', 'Gender', 'DROPDOWN', false],
  ['alternate_contact', 'Alternate Contact', 'NUMBER', false],
  ['permanent_address', 'Permanent Address', 'TEXT', false],
  ['city', 'City', 'TEXT', false],
  ['state', 'State', 'DROPDOWN', false],
  ['pincode', 'Pincode', 'NUMBER', false],
  ['student_source', 'Student Source', 'DROPDOWN', false],
  ['religion', 'Religion', 'DROPDOWN', false],
  ['occupation', 'Occupation', 'DROPDOWN', false],
  ['timezone', 'TimeZone', 'DROPDOWN', false],
  ['parent_name', 'Parent Name', 'TEXT', false],
  ['parent_contact', 'Parent Contact No.', 'NUMBER', false],
  ['parent_email', 'Parent Email', 'TEXT', false],
  ['area', 'Area', 'DROPDOWN', false],
  ['school_college', 'School/College Name', 'DROPDOWN', false],
  ['residential_address', 'Residential Address', 'TEXT', false],
  ['registration_number', 'Registration Number', 'TEXT', false],
  ['resume', 'Resume', 'FILE', false],
  ['student_email', 'Student Email', 'TEXT', true],
  ['standard', 'Standard', 'TEXT', false],
];

async function main() {
  console.log('Seeding permissions...');
  const permissions = allPermissionKeys();
  for (const p of permissions) {
    await db.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, group: p.group, label: p.label },
      update: { group: p.group, label: p.label },
    });
  }

  console.log('Seeding plans...');
  const plans = [
    { code: 'starter', name: 'Starter', monthly: 499000, learners: 500, storage: 100 },
    { code: 'growth', name: 'Growth', monthly: 999000, learners: 2000, storage: 500 },
    { code: 'power', name: 'Power', monthly: 1999000, learners: 10000, storage: 1500 },
  ];

  for (const [i, p] of plans.entries()) {
    const plan = await db.plan.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        monthlyPaise: p.monthly,
        quarterlyPaise: Math.round(p.monthly * 3 * 0.95),
        annualPaise: Math.round(p.monthly * 12 * 0.85),
        sortOrder: i,
      },
      update: {},
    });

    const limits: Array<[string, number, number | null]> = [
      ['ACTIVE_LEARNERS', p.learners, null],
      ['STORAGE_BYTES', p.storage * 1024 ** 3, null],
      ['STAFF_SEATS', (i + 1) * 10, null],
      ['BRANCHES', (i + 1) * 5, null],
      ['AI_TOKENS', 1_000_000 * (i + 1), null],
    ];

    for (const [metric, included, hardCap] of limits) {
      await db.planLimit.upsert({
        where: { planId_metric: { planId: plan.id, metric: metric as never } },
        create: {
          planId: plan.id,
          metric: metric as never,
          included: BigInt(included),
          hardCap: hardCap ? BigInt(hardCap) : null,
        },
        update: { included: BigInt(included) },
      });
    }

    const features = ['events', 'memberships', 'community', 'ai_companion', 'proctoring', 'white_label', 'sso', 'api'];
    for (const f of features) {
      const enabled = p.code === 'power' ? true : !['sso', 'proctoring', 'white_label'].includes(f);
      await db.planFeature.upsert({
        where: { planId_feature: { planId: plan.id, feature: f } },
        create: { planId: plan.id, feature: f, enabled },
        update: { enabled },
      });
    }
  }

  console.log('Seeding Medcity tenant...');
  const tenant = await db.tenant.upsert({
    where: { slug: 'medcity' },
    create: {
      slug: 'medcity',
      name: 'Medcity International Academy',
      ownerEmail: 'lms.support@miak.in',
      status: 'ACTIVE',
      currency: 'INR',
      timezone: 'Asia/Calcutta',
    },
    update: {},
  });

  const powerPlan = await db.plan.findUniqueOrThrow({ where: { code: 'power' } });
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 3);

  await db.tenantSubscription.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      planId: powerPlan.id,
      status: 'ACTIVE',
      billingCycle: 'QUARTERLY',
      amountPaise: powerPlan.quarterlyPaise ?? powerPlan.monthlyPaise * 3,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
    update: {},
  });

  // Every hostname the app answers on needs a row here. APP_HOSTNAME lets each
  // environment add its own without editing the seed.
  const hostnames = [
    'medcity.localhost',
    ...(process.env.APP_HOSTNAME ? [process.env.APP_HOSTNAME] : ['demo.medcitylms.in']),
  ];

  for (const [i, hostname] of hostnames.entries()) {
    await db.tenantDomain.upsert({
      where: { hostname },
      create: {
        tenantId: tenant.id,
        hostname,
        isPrimary: i === 0,
        isCustom: !hostname.endsWith('.localhost'),
        sslStatus: 'ISSUED',
      },
      update: { tenantId: tenant.id },
    });
  }

  const org = await db.organization.upsert({
    where: { slug: 'medcity' },
    create: {
      tenantId: tenant.id,
      slug: 'medcity',
      name: 'Medcity International Academy',
      supportEmail: 'lms.support@miak.in',
      brandColor: '#322046',
      city: 'Kannur',
      state: 'Kerala',
    },
    update: { tenantId: tenant.id },
  });

  const branch = await db.branch.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
    create: { organizationId: org.id, code: 'MAIN', name: 'Medcity' },
    update: {},
  });

  console.log('Seeding tax config...');
  await db.taxConfig.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      enabled: true,
      state: 'KERALA',
      cgstPercent: 9,
      sgstPercent: 9,
      igstPercent: 18,
      pricesAreExclusive: true,
    },
  }).catch(() => undefined);

  console.log('Seeding roles...');
  const allPerms = await db.permission.findMany();

  const roleDefs = [
    { name: 'Super Admin', description: 'Full access to every module', all: true, restrict: false },
    { name: 'Admin', description: 'Branch level admin', all: true, restrict: false },
    {
      name: 'Instructor',
      description: 'Edits batches and curriculum; for sessions can sign in, remind and cancel',
      all: false,
      restrict: true,
      grants: ['batches.', 'module.', 'scheduling.sessions', 'submission.', 'class_recording.view_recordings'],
    },
  ];

  for (const def of roleDefs) {
    const role = await db.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name: def.name } },
      create: {
        organizationId: org.id,
        name: def.name,
        description: def.description,
        isSystem: true,
        restrictBatchAccess: def.restrict,
      },
      update: {},
    });

    for (const perm of allPerms) {
      const granted = def.all || (def.grants ?? []).some((g) => perm.key.startsWith(g));
      if (!granted) continue;
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: {
          roleId: role.id,
          permissionId: perm.id,
          canView: true,
          canEdit: true,
          canDelete: def.all,
        },
        update: {},
      });
    }
  }

  console.log('Seeding super admin...');
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@medcitylms.in').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) {
    console.warn(
      'SEED_ADMIN_PASSWORD is not set, so no admin was created. ' +
        'Set it and run the seed again to be able to sign in.',
    );
  } else {
    const superAdminRole = await db.role.findUniqueOrThrow({
      where: { organizationId_name: { organizationId: org.id, name: 'Super Admin' } },
    });

    const admin = await db.user.upsert({
      where: { organizationId_email: { organizationId: org.id, email: adminEmail } },
      create: {
        organizationId: org.id,
        name: process.env.SEED_ADMIN_NAME ?? 'Medcity Admin',
        email: adminEmail,
        emailVerifiedAt: new Date(),
        kind: 'STAFF',
        status: 'ACTIVE',
        passwordHash: await hashPassword(adminPassword),
      },
      update: { passwordHash: await hashPassword(adminPassword), kind: 'STAFF', status: 'ACTIVE' },
    });

    await db.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: superAdminRole.id } },
      create: { userId: admin.id, roleId: superAdminRole.id },
      update: {},
    });

    await db.branchMembership.upsert({
      where: { userId_branchId: { userId: admin.id, branchId: branch.id } },
      create: { userId: admin.id, branchId: branch.id, isPrimary: true },
      update: {},
    });

    console.log(`  admin ready: ${adminEmail}`);
  }

  console.log('Seeding notification settings...');
  for (const eventKey of NOTIFICATION_EVENTS) {
    await db.notificationSetting.upsert({
      where: {
        organizationId_eventKey_productId: {
          organizationId: org.id,
          eventKey,
          productId: null as never,
        },
      },
      create: { organizationId: org.id, eventKey, emailEnabled: true, pushEnabled: true },
      update: {},
    }).catch(() => undefined);
  }

  console.log('Seeding learner custom fields...');
  for (const [i, [key, label, type, required]] of LEARNER_FIELDS.entries()) {
    await db.customFieldDefinition.upsert({
      where: {
        organizationId_entity_key: { organizationId: org.id, entity: 'LEARNER', key },
      },
      create: {
        organizationId: org.id,
        entity: 'LEARNER',
        key,
        label,
        type: type as never,
        showOnSignup: required,
        signupTiming: required ? 'BEFORE' : null,
        signupRequired: required,
        showOnOfflineForm: true,
        sortOrder: i,
      },
      update: {},
    });
  }

  console.log('Seeding categories...');
  const categories = ['Language', 'Banking', 'Marketing', 'Nursing', 'Medical', 'Paramedical', 'PSC', 'Healthcare'];
  for (const [i, name] of categories.entries()) {
    await db.category.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: slugify(name) } },
      create: { organizationId: org.id, name, slug: slugify(name), sortOrder: i },
      update: {},
    });
  }

  console.log('Seeding a demo course...');
  const product = await db.product.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'german-a1' } },
    create: {
      organizationId: org.id,
      type: 'COURSE',
      title: 'German Language - A1',
      slug: 'german-a1',
      status: 'PUBLISHED',
      course: {
        create: {
          organizationId: org.id,
          description: 'Beginner German. Everyday vocabulary, basic grammar, exam preparation.',
          level: 'Beginner',
          language: 'de',
          durationMinutes: 3000,
        },
      },
    },
    update: {},
    include: { course: true },
  });

  await db.pricingPlan.create({
    data: {
      productId: product.id,
      branchId: branch.id,
      name: 'Full Fees',
      planType: 'ONE_TIME',
      pricePaise: 700000,
      mrpPaise: 1000000,
      validityDays: 45,
    },
  }).catch(() => undefined);

  const mod = await db.module.create({
    data: {
      organizationId: org.id,
      name: 'German Language - A1',
      sections: {
        create: [
          {
            title: 'A1 Books',
            sortOrder: 0,
            materials: {
              create: [
                { title: 'A1 Textbook (Kursbuch)', type: 'PDF', sortOrder: 0 },
                { title: 'A1 Workbook', type: 'PDF', sortOrder: 1 },
              ],
            },
          },
          {
            title: 'Pronunciation & Speaking Basics',
            sortOrder: 1,
            materials: {
              create: [{ title: 'Alphabet and sounds', type: 'VIDEO', durationSeconds: 900, sortOrder: 0 }],
            },
          },
        ],
      },
    },
  });

  await db.courseModule.upsert({
    where: { courseId_moduleId: { courseId: product.course!.id, moduleId: mod.id } },
    create: { courseId: product.course!.id, moduleId: mod.id },
    update: {},
  });

  await db.batch.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      courseId: product.course!.id,
      name: 'A1 Group - Demo',
      status: 'ACTIVE',
      isDefault: true,
      startDate: new Date(),
    },
  }).catch(() => undefined);

  console.log('Done.');
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
