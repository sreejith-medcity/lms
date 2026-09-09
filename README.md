# Medcity LMS

A multi-tenant learning platform, built to replace Edmingle for Medcity International Academy
and to be sold as a SaaS product to other institutes afterwards.

## Why this exists

Medcity currently runs on two systems: Edmingle for delivery and admin
(₹1.41 L per quarter), and WordPress + WooCommerce for the catalogue and checkout.
That means two carts, two payment paths, two learner identities and two copies of
every course description. This app collapses both into one, and is multi-tenant from
the first commit so the same codebase can host other institutes.

`docs/edmingle-inventory.md` is the full teardown of the system being replaced.
`docs/architecture.md` explains the design decisions.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, React Server Components |
| Language | TypeScript, strict |
| Database | PostgreSQL 16 with `pgvector` and `pg_trgm` |
| ORM | Prisma 6 |
| Styling | Tailwind CSS |
| Auth | Session cookies, OTP, Google SSO, optional 2FA |
| Storage | S3-compatible (R2 or S3) with a CDN in front |
| Payments | Razorpay first, Stripe and PayPal behind the same interface |
| AI | RAG over course materials and class transcripts |

## Tenancy

Every tenant-scoped row carries `organizationId`. Tenant resolution happens in
`src/middleware.ts` from the request hostname:

- `admin.<base>` is the platform control plane, no tenant
- `<slug>.<base>` is a tenant by subdomain
- any custom domain resolves through the `TenantDomain` table

`getTenantContext()` in `src/lib/tenant.ts` is the single entry point. Nothing below
it queries without a tenant scope.

The `SAAS CONTROL PLANE` section of the schema holds the other half: plans, limits,
feature gates, subscriptions, invoices, per-day usage metering and platform staff
with logged impersonation.

## Getting started

```bash
cp .env.example .env          # set DATABASE_URL at minimum
npm install
npm run db:push               # or db:migrate for a tracked migration
npm run db:seed               # permissions, plans, Medcity tenant, a demo course
npm run dev
```

Then open `http://medcity.localhost:3000` for the tenant and
`http://admin.localhost:3000` for the platform console. On macOS and Linux
`*.localhost` resolves automatically; on Windows add entries to your hosts file.

> Prisma is pinned to 6.x. Prisma 7 moved the datasource URL into `prisma.config.ts`;
> if you upgrade, move `url` out of `schema.prisma` at the same time.

## Layout

```
prisma/schema.prisma     the whole data model, ~90 models
prisma/seed.ts           permissions, plans, tenant, roles, demo content
src/middleware.ts        hostname to tenant
src/lib/tenant.ts        request-scoped tenant context
src/lib/auth.ts          session, roles, permission set
src/lib/permissions.ts   the 30 permission groups
src/lib/usage.ts         metering and plan limits
src/lib/money.ts         paise arithmetic and GST
src/app/admin/*          tenant admin
src/app/platform/*       platform control plane
src/app/page.tsx         tenant storefront
```

## Status

Phase 0. The data model, tenancy, RBAC, metering and the admin shell are in place.
Migration from Edmingle and WooCommerce is deliberately deferred until the product
is built; `MigrationRecord` exists so the cutover can be verified row by row when
that time comes.

## Deploying

### Database first, wherever the app runs

The schema needs PostgreSQL with the `pgvector` extension. Shared hosting gives you
MySQL, so the database lives off-host. Neon's free tier supports pgvector and is the
default choice here; Supabase works identically.

```sql
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
```

Then from your machine, pointed at that database:

```bash
npm run db:push
npm run db:seed
```

### Hostinger shared hosting, Node.js app

hPanel > Advanced > Node.js. Create an app with Node 20 or newer, application root
`lms`, and the startup file `server.js`.

```bash
# locally, or in CI
npm ci
npm run build

# what gets uploaded to the application root:
.next/standalone/*      -> becomes server.js and node_modules at the root
.next/static/           -> .next/static/
public/                 -> public/
prisma/                 -> prisma/
```

`output: 'standalone'` keeps the upload small and means the server starts with plain
`node server.js` on the PORT hPanel supplies. Build locally rather than on shared
hosting: `next build` wants more memory than these plans like to give.

Environment variables, set in the Node.js app panel:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | the Neon pooled connection string |
| `DIRECT_URL` | Neon unpooled, used by `prisma migrate` |
| `APP_BASE_DOMAIN` | the subdomain's parent, e.g. `medcitylms.in` |
| `PLATFORM_HOST` | e.g. `platform.medcitylms.in` |
| `AUTH_SECRET` | any 32+ character random string |
| `NODE_ENV` | `production` |

Point the subdomain at the Node.js app in hPanel, and add its hostname as a
`TenantDomain` row so tenant resolution matches it.

### Known limits of shared hosting

Fine for building and demoing, not for the live academy:

- one process, so background work (transcription, campaign sends, nightly rollups)
  has nowhere to run
- no Postgres, hence the external database
- disk is not the place for 281 GB of recordings; that belongs in S3 or R2 from the start
- restarts are manual and cold starts are slow

A VPS becomes necessary before real learners arrive. Nothing in the code changes when
that happens, only where it runs.

### Vercel, if you prefer

Same environment variables. `postinstall` runs `prisma generate` during the install
step, and every database-touching page is `force-dynamic`, so the build does not need
a database. Add `*.<APP_BASE_DOMAIN>` as a wildcard domain so tenant subdomains resolve
without adding each one by hand.
