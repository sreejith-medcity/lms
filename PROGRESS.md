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

## Commerce, in test mode

The purchase journey now exists end to end. Razorpay test keys are set locally.

- Prices, discounts and tax are computed on the server. The browser sends a
  product id and a plan id and nothing else, so there is no amount on the client
  worth tampering with.
- The order is written before the gateway is called, so a payment always has
  something on our side to reconcile against.
- Two paths reach the same state. The browser callback verifies the signature,
  then asks Razorpay's API what actually happened rather than believing the
  browser. The webhook does the same job server-side, so a learner who closes the
  tab mid-payment still ends up enrolled.
- Every webhook delivery is recorded in `GatewayEvent` before anything is
  processed, signature failures included, and processing is idempotent: a fourth
  delivery of the same capture changes nothing and still answers 200, because
  answering anything else makes Razorpay retry forever.
- The gateway's amount is checked against the order total. A mismatch grants
  nothing.
- A full refund marks the payment refunded and expires the enrolment. It does not
  delete it: progress and attendance are history.

Untested against a live gateway. The next thing to do with it is walk a test
card through and confirm the enrolment appears exactly once.

## Phase 1 — course and batch depth (built, awaiting a push)

Typechecks clean. Not yet exercised against the database.

**Course editor.** Details split into what it is / thumbnail / overview blocks
with weights / how it behaves. Publishing moved onto the pricing tab as its own
form: web, Android, iOS, on-demand-only, free preview, featured, Apple IAP id.
A published course that is off the web and not admin-only is refused, because it
would be reachable by nobody and look like a bug rather than a setting.

**Pricing.** Plans can now be per branch (blank means every branch) and paid in
full, in instalments or as a subscription. An instalment plan writes out the
actual dues rather than storing a count: 10,000 in three parts is 3,334 + 3,333
+ 3,333, and the form shows the office that schedule before it saves. Counted
either from the batch start date or the day they enrol. A struck-through price
below the real price is refused.

**Drip.** Per lesson: open from the start, so many days after enrolment, so many
days after the batch starts, or on a date. `src/lib/drip.ts` answers "is this
open yet" for every screen that asks.

**Batch classroom.** `/admin/batches/[id]`, which did not exist. Header KPIs
(learners, classes held, attendance, on time), then Learners — sorted worst-first
by attendance, progress and scores together, because the list exists to find the
people about to drop out — Classes, Curriculum (which modules this batch
teaches; empty means all of them) and Team and settings (staff by role, dates,
seats, default flag). Batch rows on `/admin/batches` now lead here.

**Curriculum.** Sections can be renamed in place, reordered, hidden while they
are being written, duplicated with their materials, and deleted once empty.
Modules can be reordered on the course.

**The locks are real, not decorative.** Drip and section visibility are enforced
in four places, not just in the rail: the outline, the player, the progress
actions, and `/api/assets/[id]`, so a locked video is not one URL away. Progress
percentage now counts only the curriculum this enrolment was actually given, so a
batch teaching four of six modules can still reach 100%.

## Next runnable step

**Push Phase 1, then walk it.**

Nothing here has met the database yet. On the Mac:

```
cd ~/Documents/lms && npx tsc --noEmit && git add -A && git commit && git push
```

Then, once deployed: open a course, set an instalment plan and a drip rule on one
lesson, open the batch classroom, and confirm the locked lesson shows "opens on"
in the learner rail and refuses to play.

Still open from before Phase 1: the two stuck ₹8,260 orders. Razorpay's dashboard
will say whether they were captured at 8,260, captured at another amount, or only
authorised — and that answer picks between two very different bugs.
