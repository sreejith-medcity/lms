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

## Phase 2 — scheduling and recordings (built, awaiting a push)

Typechecks clean. Not yet exercised against the database.

**Calendar** at `/admin/calendar`: day, week, month and list, filtered to one
batch or one trainer. Week and day are a real time grid rather than seven lists,
because where a class sits vertically is how a trainer reads a gap. All of it
does its date arithmetic in the academy's timezone (`src/lib/clock.ts`), not the
server's, so a 7pm class in Kochi belongs to that Tuesday whether the box is in
Mumbai or UTC.

**Holidays.** Mark a day or a run of days off, for one batch or the whole
academy. The classes are cancelled with a flag that says why, so attendance
stops counting them and the learner sees a holiday rather than a cancellation.
Wrongly marked days can be put back.

**Recordings library** at `/admin/recordings`: every recording across every
batch, searchable, filtered by batch and by whether anyone has released it, with
inline rename and bulk publish. Held-back recordings are counted at the top,
because that pile is the one nobody remembers to work through.

**Feedback.** A form builder (`/admin/feedback`) with five answer types, and a
results page with the average, the rating distribution, a per-day submission
timeline and a response rate whose denominator is printed rather than implied.
Questions lock once answers exist, since rewriting them would leave answers
pointing at labels nobody was asked. On the learner's side a class they actually
sat asks "how was it" on their own dashboard, one tap for a complete answer.

**The outbox.** `src/lib/notify.ts` writes a queued row per intended message,
respecting the academy's per-event channel settings, deduplicated per class so a
second press sends nothing twice. Notify absentees appears once a class has
finished; remind the roster only before it starts. Nothing is sent until Phase 7
connects a provider, which is the point: the hard part of messaging is deciding
who gets what, and that is decided and recorded now.

Housekeeping done along the way: `STAGES` was being exported from a
`'use server'` file, which publishes a list of strings as a callable endpoint.
Moved to `src/lib/leads.ts`, and every `'use server'` file re-audited.

## Phase 3 — marketing and sales (built, awaiting a push)

Typechecks clean. Not yet exercised against the database.

**Promo codes** (`/admin/promo-codes`), end to end. Percent with a ceiling or a
flat amount, scoped to courses or everything, a date window, single-use or
capped, and a per-person limit. The interesting part is the limit rather than
the arithmetic: a code stamped "first fifty" that lets in sixty-three is worse
than no code, so the claim takes a row lock on the code before it counts
anything, and the redemption is reserved alongside the order and released if the
payment fails. The discount comes off before GST, because tax is owed on what
was charged. The learner sees the code field on the course page and the applied
discount on checkout.

**Testimonials** (`/admin/testimonials`). Unread first, because a queue sorted
by date is how fifteen of them sat unread in the incumbent. Learners are asked
for one when they finish a course, and it arrives unpublished: a quote on a
public page is the academy speaking, whoever typed it.

**Banners** (`/admin/banners`), per placement, one shown at a time. Rendered
with a read URL minted per request rather than through the entitlement route,
since a banner is aimed at people not yet entitled to anything.

**Abandoned carts** (`/admin/carts`). A cart is written when a learner opens the
payment screen, aged after six hours of quiet, and sorted by how many times they
came back rather than by date: someone who reached checkout three times and
stopped is a different conversation. Nudges go through the outbox. Converted
automatically when they pay.

**Cheques** (`/admin/cheques`). A cheque is money handed over and not yet
arrived, so it is a PENDING payment with the paper's details beside it; only
clearing makes it collected. Bouncing is recorded rather than edited over, so a
second bounce is not a surprise. Overdue is judged against the date on the
cheque.

**Settlements** (`/admin/settlements`). Collections and settlements are
different numbers, and an institute that treats them as one cannot say why the
bank is short. A payout is entered gross, fee and GST; captured payments attach
oldest first until the gross is used up, and whatever is unmatched stays
visibly unsettled rather than being absorbed.

**Campaigns and templates** (`/admin/campaigns`, `/admin/templates`). Templates
name the variables they use and refuse one nothing can fill, which is what stops
"Hi {{first_name}}," going out literally to four hundred people. Working out a
campaign's audience is its own press, so the number of people — and the number
with no address on that channel — is visible before anything is scheduled. The
last "soon" marker is gone from the sidebar.

**Parked, deliberately.** Pricing templates and miscellaneous fees have no
models in the schema. Adding them needs `npx prisma generate && npm run db:push`
on the Mac before the code can be typechecked or deployed, and a push that lands
code the database cannot serve is a broken site. They belong with the Phase 7
schema work. Workflows are parked for the same reason in reverse: the models
exist, but an automation engine with no provider to act through is a table
nobody reads.

## Phase 4 — engagement (built, awaiting a push)

Typechecks clean. Not yet exercised against the database.

**Segments** (`/admin/segments`). Eight conditions, joined with and or or, and
compiled to a query rather than kept as a list: "disengaged learners" maintained
by hand is wrong the day after it is written. The count carries the date it was
worked out beside it, because a number with no date is one nobody should act on,
and a campaign resolves its members afresh at the moment it is prepared rather
than trusting the cache.

**Community** (`/admin/community`, `/learn/community`). Rooms with posts,
replies, pinning and a reported-first moderation queue. A flag is not a verdict
and hides nothing on its own; letting one annoyed learner silence another is
worse than the post they objected to. Nothing a learner types is treated as
markup: it is escaped into paragraphs, which removes a class of problem rather
than filtering for it. Each course gets a room made on first use, so there is no
wall of empty ones.

**Points and referrals** (`/admin/loyalty`, `/learn/wallet`). A ledger rather
than a balance: every change is a row with a reason, because "why do I have 400
points" always arrives eventually. Referral codes are made on first ask, both
sides are credited, and the referrer's cut on a first purchase is paid once.
Points come off the payable total inside the same transaction as the order that
spends them, and are returned if the payment never lands. Redemption is capped
as a share of the order, so a course can never be had for nothing.

**Learner export** (`/admin/learners/export`). One row per learner, not per
enrolment, since the thing people do with this is mail-merge and a duplicated
name breaks it. Collections and credit balance are included so it answers "who
still owes us" without a second file. Exporting personal data is itself recorded.

**Impersonation.** An hour, learners only, inside your own academy. The staff
session is parked in a second cookie while a short-lived learner session takes
its place, which means every permission check already in the product applies
with no special case. A banner sits across every learner page, both ends go to
the audit log, and the borrowed session is destroyed on return rather than left
to expire. "It does not show up for me" is unanswerable from the admin side,
because the admin side is a different application.

**Instructor profiles** (`/admin/instructors`). Headline, bio and subjects on
the public course page, because a name on its own makes a course look unstaffed.
A trainer can ask not to be named publicly and still teach the batch.

**Learner portal menu** (`/admin/settings/learner-portal`). Ordered keys in an
org setting, resolved against a catalogue, so an unknown key is dropped rather
than rendered as a dead link. My learning cannot be removed.

## Phase 5 — the analytics suite (built, awaiting a push)

Typechecks clean. Not yet exercised against the database.

**31 reports** at `/admin/analytics/reports`, across sales and enrolment,
batches and progress, feedback, marketing, trainers, notifications, assessments
and operations.

The shape matters more than the count. Thirty hand-built pages is thirty places
for a definition to drift, thirty exports to remember and thirty layouts to keep
in step, so a report here is a declaration: what question it answers, what its
columns mean, and a function returning rows. One page renders any of them, one
route exports any of them, and the thirty-second is a function rather than a
screen.

Three things fall out of that. Every report prints its own definitions, because
they are part of the declaration rather than something to remember to add. Every
report exports, and the CSV carries the report's title, its window and its
definitions in the preamble, since a file opened three weeks later on somebody
else's laptop has no page around it to explain itself. And the catalogue is
gated per category against the existing permission keys, so a role with trainer
reports does not quietly also get collections; a person is never offered a door
that refuses them.

The reports themselves are written to be hard to misquote. Nothing is called
revenue. Ratings are shown with the number of answers behind them, and one built
from three is marked as such rather than ranked as if it were solid. Drop-off
ignores lessons fewer than three people reached, because one person stopping is
not a pattern. The lists that exist to be acted on are sorted worst first.

## Phase 6 — settings depth (part built, awaiting a push)

Typechecks clean. Not yet exercised against the database.

**Preferences** (`/admin/settings/preferences`) are declared in a registry, the
same shape as the report catalogue and for the same reason. A setting that lives
only in a form has no visible default, no explanation of what it changes, no
history and nothing to search. Declaring them buys all four at once, and the
screen is rendered from the declaration.

Four things follow that Edmingle does not do.

A setting says what it *does*, not what it is called: "a video counts as watched
at 70%, so a forty-minute lesson needs twenty-eight minutes of it", updated live
as the number changes. Each row carries who last moved it and when, read from
the audit trail. Only values that differ from the default are stored, so an
improved default reaches every academy that never touched that setting rather
than freezing them on the day they signed up, and one press puts a setting back
to it. And a setting nothing reads yet is labelled *not connected yet*, says
what it waits on, and refuses to save: a switch that quietly does nothing is
worse than an absent one, because somebody will flip it and believe the product
changed.

The whole configuration exports and imports as JSON. That is the first thing
that makes this multi-tenant in practice rather than only in the schema: the
second academy should not have to rediscover what the first one worked out.

**Custom fields** (`/admin/settings/custom-fields`) across all eight entities,
seven types, with signup timing whose trade-off is written on the form rather
than assumed: a field asked *before* signup is a barrier to signing up, one
asked *after* is a form somebody fills in when they already have a reason to
care. The key is frozen at creation, so renaming a field is free and answers can
never be orphaned; a field somebody has answered can be switched off but not
deleted.

**The notification matrix** (`/admin/settings/notifications`): sixteen events in
four groups against four channels, saved a cell at a time. Events nothing emits
yet are marked and say what they wait on, and a channel switched on with no
template behind it says so.

**What actually changed behaviour.** The settings are wired, not decorative: the
video threshold now completes lessons server-side (surviving a closed tab), the
watermark overlays the viewer's registration number and wanders between corners
every thirty seconds so it cannot be cropped in one cut, downloads and
right-click follow their switches, the leaderboard appears with the scope and
name-shortening the academy chose, and the signup form asks for email or mobile
according to the primary-field setting, with the academy's own custom fields
underneath.

**Still to do in this phase:** the grading system, international selling, and
the website and app setup page (brand, social links, policies editor). Next
sitting rather than parked: none of them need schema or a provider.

## Next runnable step

**Push what is done of Phase 6.**

```
cd ~/Documents/lms && rm -f .git/index.lock* && git push origin main
```

Then open `/admin/settings/preferences`, search for "watermark", switch it on,
and open a video lesson as a learner. Drop the video threshold to 30 and watch a
lesson tick itself off. Then add a custom field on learners, asked after signup,
and check it appears where you expect.

Still open from before Phase 1: the two stuck INR 8,260 orders. Razorpay's
dashboard will say whether they were captured at 8,260, captured at another
amount, or only authorised, and that answer picks between two very different
bugs.
