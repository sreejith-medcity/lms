# Architecture

How this is built and why. Read `edmingle-inventory.md` first for what is being replaced.

## The three shapes this app has to hold at once

1. **A working LMS for Medcity.** 4,000 learners, 88 courses, 141 batches, ~24 live
   sessions a day, recordings piling up at roughly 2 GB a day, GST invoicing, Razorpay.
2. **A storefront.** The WooCommerce site sells the courses today. It gets absorbed,
   so catalogue, landing pages, cart, checkout and delivery stop being two systems.
3. **A SaaS product.** Other institutes sign up, get a subdomain or their own domain,
   pick a plan, and are metered and billed. Medcity is simply tenant number one.

Building 3 last is how most products end up with a tenancy retrofit that never quite
works. So tenancy is in the first commit and everything else is written inside it.

## Tenancy model

**One database, shared schema, `organizationId` on every row.** Not schema-per-tenant,
not database-per-tenant. Reasons: migrations stay single, cross-tenant platform
analytics stay trivial, and connection-pool pressure stays flat as tenant count grows.
The cost is that isolation is enforced in code, so it is enforced in exactly one place:

```
request -> middleware (hostname) -> getTenantContext() -> organizationId -> every query
```

`src/lib/tenant.ts` is the only thing that decides which tenant a request belongs to.
Nothing downstream is allowed to query without that scope. Postgres row-level security
is the second belt and goes in before the first external tenant: a `SET LOCAL app.org_id`
per transaction with RLS policies on every tenant table, so a missing `where` clause
returns nothing instead of everything.

`Tenant` and `Organization` are separate on purpose. A tenant is the contract, the
plan, the invoice. An organization is the academy, its branches, its content. Medcity
has one of each today, but Medcity International Overseas Corporation is a second
organization on the same contract when that day comes.

Custom domains resolve through `TenantDomain`; `lms.medcitylms.in` becomes a row there
at cutover, which is also how the SSL provisioning job knows what to issue.

## Plans, limits, metering

Edmingle charges by learner count, storage and notification credits. The same levers
are modelled here as `UsageMetric`, so a prospect can compare like for like:

- `PlanLimit` sets what a plan includes and where the hard cap sits
- `TenantEntitlement` overrides it per tenant, because sales always cuts a deal
- `PlanFeature` gates whole modules (events, community, AI, SSO, proctoring)
- `UsageRecord` is written by the code path that does the work and rolled up per day

`checkLimit()` runs before a metered action, `meter()` runs after it. Both live in
`src/lib/usage.ts`. This is also what powers the tenant's own usage page, so the number
they see and the number they are billed on are the same number.

The lesson taken directly from the audit: Medcity's notification wallet is sitting at
₹0.00, which means transactional email may be silently failing. Notification credits
here are metered but never a silent failure. Transactional messages send first and
warn loudly; only bulk marketing sends are gated on balance.

## RBAC

The permission catalogue is `src/lib/permissions.ts`: 30 groups, each with granular
items, each with view / edit / delete. That structure comes straight from the Edmingle
role builder because it fits how coaching institutes actually delegate work.

`Role.restrictBatchAccess` is the one non-obvious flag: when on, a user only sees
batches where they are Primary Tutor, Batch Manager or Additional Manager, and every
list in the app filters through that. It is the difference between an instructor who
can see their four batches and one who can see all 141.

Permissions are resolved once per request in `src/lib/auth.ts` and flattened into a
`PermissionSet`. Server actions call `requireStaff('sales.payments', 'edit')`.

## Data model notes worth knowing

- **Money is paise, stored as `Int`.** No floats anywhere near currency. `src/lib/money.ts`
  holds the GST maths, including the exclusive-pricing setup Medcity uses (9 + 9 CGST/SGST,
  18 IGST, prices exclusive).
- **`Product` is the sellable supertype.** Course, Event, Membership and Mentorship
  specialise it. Enrollment, pricing, cart and orders all point at `Product`, so adding
  a product type later does not touch the commerce tables.
- **`Module` is a library, not a child of a course.** Medcity reuses the same OET and
  IELTS modules across many courses and batches, which is why `CourseModule` and
  `BatchModule` are join tables rather than a `courseId` on the module.
- **Nothing financial is hard-deleted.** `deletedAt` everywhere, and orders, payments
  and invoices have no delete path at all.
- **`MigrationRecord`** maps every source row to its target so a cutover can be verified,
  resumed and rolled back. It is unused until the migration phase, which is deliberately
  after the build.

## Storage and video

This is the part that quietly decides the running cost. 281 GB today, growing with
every recorded class.

Two drivers sit behind one interface in `src/lib/storage.ts`, chosen by environment:

- **`local`** writes to disk outside the deploy directory (`STORAGE_DIR`, default
  `~/lms-storage`, so a Hostinger rebuild cannot take the uploads with it) and serves
  through `/media/<signature>/<key>` with `Cache-Control: immutable`, which is what lets
  Hostinger's CDN hold the bytes at the edge. The signature covers the key and does not
  expire, deliberately: a URL that changes every five minutes cannot be cached, and the
  key contains a UUID nobody can guess. Rotating `AUTH_SECRET` invalidates every issued
  link at once. Range requests are answered properly, so seeking inside a ninety-minute
  class works. Uploads arrive in 8 MB chunks appended to `<key>.part`, because a single
  2 GB PUT walks straight into the shared-host proxy body limit, and a dropped connection
  should cost one chunk rather than the whole file. This is the demo footing.
- **`s3`** uploads direct from the browser with a presigned PUT, so the bytes never touch
  the app server. Signing is hand-rolled SigV4 rather than the AWS SDK: 20 MB of
  dependency for sixty lines of HMAC is a bad trade on a shared host where install time is
  most of a deploy. Cloudflare R2 is the cheap answer because egress is free; Google Cloud
  Storage speaks the same XML API with an HMAC key, so the eventual GCP move is five
  environment variables and a file copy rather than a rewrite. This is the production
  footing, and 281 GB of recordings will not survive on a shared plan's disk.

Either way there is no public path to an object. `/api/assets/<id>` resolves the tenant,
checks the viewer is staff, is enrolled in a course that uses the file, is in the batch
whose recording it is, or is looking at a free preview, and only then redirects: to a
signed bucket URL (two hours for video and audio so seeking does not stall mid-class,
five minutes for everything else) or to the cacheable `/media` path. That redirect itself
is never cached, because it is the answer to a question about one person.
- Video is transcoded to HLS with signed, short-lived playback URLs, plus the dynamic
  watermark Edmingle offers (learner name and ID burnt into the player overlay, not the
  file, so one transcode serves everyone).
- Recordings are lifecycle-tiered: hot for the current term, infrequent-access after
  90 days, cold after a year. Most of the 1,089 recordings are never opened again.
- `StorageUsage` is metered daily per tenant, so storage is billable rather than absorbed.

## Live classes

Sessions are provider-agnostic behind one interface: Zoom first, since that is what the
trainers already use, with Meet and a self-hosted option behind the same shape.
Attendance is derived from join and leave webhooks rather than typed in, which is what
makes the in-time percentage on the dashboard real. Recurrence is an iCal RRULE on
`SessionRecurrence`, because the German group classes run on fixed weekly patterns.

## The AI layer

Not a chatbot bolted to the corner. Four things that change outcomes for a language and
test-prep institute:

1. **Transcribe every class.** `Transcript` holds segments, summary, chapters and key
   terms. This alone turns 1,089 opaque video files into searchable material.
2. **RAG over course content.** `ContentEmbedding` (pgvector) indexes materials and
   transcripts per course. The learner-facing companion answers with citations that
   deep-link to the timestamp in the class where it was explained.
3. **Evaluate writing and speaking.** OET and IELTS writing tasks and speaking responses
   scored against a rubric stored on the `Question`, producing `Answer.aiFeedback` and a
   `Submission.aiDraftFeedback` that a trainer edits and approves rather than writes from
   scratch. Given the submissions queue in the audit was sitting unevaluated, this is the
   highest-value AI feature in the product.
4. **Adaptive study plans.** `SkillMastery` tracks per-skill confidence from attempts and
   submissions; `StudyPlanItem` schedules the next thing to work on, including spaced
   repetition and an exam-date countdown.

Admin-side: content generation from existing material, lead scoring on `Lead.score`, and
churn risk on `LearnerProfile.riskScore`. The "Disengaged" segment Medcity already built
by hand becomes a model output.

Every call is metered as `AI_TOKENS` and gated by the `ai_companion` plan feature.

## Deferred, on purpose

**Migration.** No learner, content or payment data moves until the product is built.
When it does, it runs in this order: users and custom fields, catalogue and modules,
assets (the slow part, in the background, by reference first), batches and enrollments,
progress, financial history, then storefront pages with a `Redirect` row per old URL so
the SEO does not take the hit. The dry-run writes `MigrationRecord` rows without touching
live tables, and cutover is a DNS change with the old system left read-only for a month.

## Build order

- **Phase 0 (this commit).** Schema, tenancy, RBAC, metering, admin shell, storefront skeleton.
- **Phase 1.** Auth (OTP, Google SSO), course and module builder, batches, enrollment, the
  learner portal and player, drip.
- **Phase 2.** Live sessions, attendance, recordings, transcription.
- **Phase 3.** Commerce: pricing plans, cart, Razorpay, GST invoices, instalments, fee tracking.
- **Phase 4.** Assessments, question bank, submissions, AI evaluation, certificates.
- **Phase 5.** Storefront and page builder, blogs, SEO, the WooCommerce absorption.
- **Phase 6.** Marketing: campaigns, workflows, segments, leads, notification engine.
- **Phase 7.** Analytics suite, the AI companion, adaptive learning.
- **Phase 8.** SaaS go-live: signup, provisioning, billing, platform console, then migration.
