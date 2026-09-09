# Progress

Running log. `BUILD_PLAN.md` holds the requirement tracker and the status of every
feature; this file holds what happened, what is blocked, and the next runnable step.

## Where the project stands

Phase 1 of the build order is roughly half done. The foundation, authoring and
delivery paths work; the public website and most of the admin surface do not exist.
Fifteen admin navigation entries currently lead to blank routes, which is the single
most misleading thing about the current build.

## Done and verified

- **Tenancy.** Hostname to tenant in one resolver, `organizationId` on every row.
  An unrecognised host explains itself instead of showing an error digest.
- **Schema.** 127 Prisma models covering the whole product, well ahead of the code.
  Validated with the Prisma schema WASM linter, since the Prisma CLI cannot fetch its
  engines through this network.
- **Auth.** Register, login, logout. scrypt from `node:crypto`, chosen over argon2
  because Hostinger shared hosting cannot reliably compile native modules. Login
  returns the same message whether the address or the password was wrong.
- **RBAC.** 30 permission groups, resolved once per request into a flat set, enforced
  in server actions via `requireStaff(key, action)`.
- **Metering.** `checkLimit()` before a metered action, `meter()` after it. Storage
  and bandwidth are already metered by the file layer.
- **Design system.** CSS custom property tokens, a component set, light and dark.
- **Course and curriculum authoring.** Product, course, modules from a shared library,
  sections, materials, pricing plans. Plans with enrolments are retired, not deleted.
- **Learner journey (free).** Signup, enrol, player, per-material completion, progress
  recomputed on the server.
- **Live classes.** Weekly series generation, cancellation, and attendance that
  records itself when a learner joins, with a ten-minute in-time grace. This is a
  deliberate correction of Edmingle, whose attendance depends on someone remembering
  to sign in, which is why their own dashboard shows 24% average attendance.
- **Files.** Two storage drivers behind one interface. Chunked resumable upload on the
  local driver, presigned direct-to-bucket on S3. Delivery is entitlement-checked at
  `/api/assets/<id>` and only then redirected. Media library with search, rename,
  unused-file detection and a refusal to delete anything still in use.

## Verified how

`npx tsc --noEmit` runs clean before every commit. This matters more than it sounds:
the Prisma query engine cannot be downloaded in this environment, but the generated
*types* are enough for a full typecheck, so type errors are caught here rather than
one failed Hostinger deploy at a time.

No automated test suite exists yet. No browser journey has been walked and
screenshotted. Both are Phase 6 items that should start earlier.

## Blocked, waiting on a credential or an account

| What | Needs | Effect while blocked |
| --- | --- | --- |
| Object storage | `S3_*` (Cloudflare R2, or GCS with an HMAC key) | Falls back to server disk behind the CDN. Fine for the demo, wrong for 281 GB. |
| Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `enrol` refuses anything priced. |
| Live classes | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Join URLs are pasted by hand; no recording pull, no join/leave webhooks. |
| Notifications | `SMTP_URL`, `MSG91_AUTH_KEY`, `AISENSY_API_KEY` | Nothing is sent to anyone. |
| AI layer | `ANTHROPIC_API_KEY` | Tutor, writing and speaking feedback, transcription all unbuilt. |

## Open decisions

- **Brand colour.** medcityacademy.com is blue `#0B5294`; medcitylms.in is green
  `#087447`. One value in the organisation record switches the entire product, so this
  is cheap to change but should be settled before the leadership demo.
- **Production host.** Hostinger now, GCP once production is ready. The storage layer
  is already written so that move is five environment variables and a file copy.
- **WooCommerce ownership.** The storefront is to be absorbed. Until it is, order and
  account ownership between the two systems is undefined, and that has to be settled
  before any synchronisation is attempted rather than after.

## Housekeeping still owed

- Rotate the Neon `neondb_owner` password. A connection URI was pasted into a chat and
  should be treated as burned.
- Delete the old Ohio Neon project `wild-dew-63814576`.
- Remove the three `SEED_*` variables from the Hostinger environment and change the
  seeded admin password.

## Shipped since the tracker was written

- **The dead navigation is gone.** Fifteen entries removed until their pages
  exist. They return one at a time.
- **The public website exists.** Homepage, catalogue with search and facets,
  category pages, a rebuilt course page, a real sample lesson, about, contact,
  help and policy pages, under a shared shell with a skip link and a mobile menu.
- **The course page answers a buyer's questions.** Format, language, level,
  access period, tax treatment, refund terms, curriculum tree, the batches
  actually running with branch and seats left, and the trainers assigned to them.
- **Nothing is invented.** Testimonials render only from published rows;
  instructors only where assigned; the about page and any unwritten policy say so
  rather than filling the space; the homepage numbers are counted from the
  database.
- **The enquiry form writes a Lead**, with a honeypot and a requirement that a
  reply is possible at all.
- **SEO.** Sitemap and robots from live data, canonical URLs, per-page metadata,
  Course JSON-LD limited to what is visible, noindex on the app surfaces.
- **Auth hardening** (from a parallel session, read and committed separately):
  cross-tenant cookie rejection, immediate effect for suspended accounts, and
  rate limiting on sign-in and sign-up.

## Next runnable step

**Cart and checkout.**

The course page now sends a buyer somewhere, and that somewhere is a button that
refuses anything priced. This is the journey the definition of done checks first
and the largest remaining hole in the product.

In order:

1. Cart and checkout, with every price, discount and tax computed on the server.
   The client sends product and plan ids, never amounts.
2. Razorpay order creation, signature verification, and a webhook that records
   every event durably and processes it idempotently, so a replayed or
   out-of-order event cannot grant access twice. A client-side success screen
   grants nothing by itself.
3. Entitlement written separately from payment state, so a refund revokes access
   without deleting learning history.
4. GST invoices with sequential numbering, using the tax config already seeded.

This is built and testable in Razorpay test mode without live keys; only the
switch to live is blocked.

After that, the two-pane player described under **Design benchmark** in
`BUILD_PLAN.md`, which is the next visible jump in how the product feels.
