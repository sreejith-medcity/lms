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
