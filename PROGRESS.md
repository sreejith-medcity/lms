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

There is now a test suite as well: `npm test`, 49 tests, no framework. It
covers the pure logic that decides something consequential and would fail
quietly rather than loudly. Anything needing the database is not covered yet and
is named as such in `tests/README.md`.

No browser journey has been walked and screenshotted.

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

**Grading** (`/admin/settings/grading`). Bands with points and a plain-English
meaning, validated as they are typed: a gap, an overlap or a backwards band
cannot be saved. That check is the feature. A hole between 79 and 80 is
invisible until the day somebody scores in it, and then it appears as a blank
grade on a report card in front of a parent rather than in front of whoever set
the bands. A live preview says what any score you type would be called.

**Website** (`/admin/settings/website`). Social links, which the footer already
reads, with blank ones simply not appearing rather than linking nowhere. And the
five policies a storefront needs, each saying why it exists, showing its word
count and last edit, and publishing to the public page that was already there.

**The brand.** The token layer is rebuilt on the 2026 brand board: #322046 as
the interface colour, #FDB85B as an accent reserved for the one action a page
exists for, a warm off-white canvas instead of the old blue-white, #6F6378 as
secondary ink, and a dark mode built from the same purple rather than the old
navy.

**International selling** is the one thing in this phase that needed something
it does not have. Without a billing address at checkout there is nothing to
decide a country from, so the switch is marked as waiting on the cart in Phase 8
rather than shipped as a switch that quietly does nothing — which is the rule
the rest of the screen is built on.

## Integrations (built, awaiting a push)

**49 providers across 11 categories** at `/admin/settings/integrations`,
declared the way the reports and settings are, so the fiftieth is a few lines
rather than a page. Payments, email, SMS, WhatsApp, live classes, storage and
video, sign-in, measurement, AI, automation and CRM, support and accounts.

**Credentials are entered here, not only in hPanel.** That is what makes a
second academy on this build able to use its own payment gateway without a
redeploy. Anything set in the environment still wins: it is deliberate, is the
same for every request, and cannot be changed by whoever gets into the admin.
The form says which fields are coming from the environment and that typing over
them does nothing.

**Secrets are sealed before they touch the database.** AES-256-GCM under a key
derived from AUTH_SECRET, with the authentication tag meaning a tampered value
fails to open rather than decrypting to something wrong. A settings screen that
stores a live gateway key in plain text is a liability: a database dump, a
support export or a misdirected backup hands it over. They are never read back
to a browser either, so the form shows the last four characters and a blank
field means keep this one rather than clear it — the alternative is an academy
wiping its live key by editing the sender name.

**Every card says one of three things**, which is the rule the whole admin now
runs on: it works, it will work the moment you fill it in, or the code for it is
not written yet and here is which phase it lands in. Two cards say a fourth
thing, because it is true: Razorpay and storage run today but read the
environment, and threading them through per academy is Phase 7 work. Payments
are not something to refactor casually at the end of a long day.

Razorpay has a real test button that asks Razorpay whether the keys work and
says whether they are live or test. Everything without a genuine check says so
rather than reporting success for a filled-in form.

## The integration catalogue, rebuilt around what the business runs on

103 providers now, up from 49, and grouped the way you set them out rather than
the way a developer would file them: advertising, analytics and CRM first;
communication and support second; sales, teaching and operations third.

**Priority is a field, not a comment.** Eighteen providers are priority 1, which
is the list a new institute is actually set up with, and the board opens on
"Start here" showing only those. Meta Ads, the Conversions API, Google Ads with
offline conversion upload, your own CRM, Ninja Forms, Razorpay, MSG91, AiSensy,
Zoom, GA4, GTM, the Meta pixel, S3, Google sign-in, reCAPTCHA and SMTP. The
other 85 are there so the catalogue is a map rather than a wishlist, and so the
next institute that already runs on Zoho or Salesforce is a form fill rather
than a sprint.

**Alternatives say so.** Where two providers do the same job, the card names the
other one and warns that connecting both means the same lead arrives twice.

**Every connector states what it needs before you start.** This is the part
usually left out. Not "enter your API key" but which plan, which scopes, which
approval, and which thing has to be done on the provider's side first. MSG91
needs DLT registration or Indian carriers drop the message silently. Zoom needs
a paid plan for classes over forty minutes and a server-to-server app with
three specific scopes. Google Ads offline conversions need a developer token
approved for standard access and gclid already passing through to the enquiry
form. Stripe needs an Indian entity to settle in INR. Finding these out at
connect time rather than three days into a launch is most of the value.

**Field mappings are data, per institute.** Every CRM calls a lead source
something different. So each CRM and forms connector has a mapping panel where
the institute types what its own account calls the lead source, the owner, the
stage, the course and the enrolment reference. That last one is the one that
matters: it is what ties a paid admission back to the enquiry that started it,
which is what makes cost per enrolment a real number instead of a guess.
Mappings are written to `config`, never to `credentials`, so a wrong mapping can
never wipe a sealed key.

**Connection status is history, not a green dot.** A new `integration_events`
table records every attempt, in or out, with what it was, whether it worked and
how many records moved. The board shows the last activity on the card and counts
failures in the last 24 hours, and a "Needs attention" filter shows only the
connectors that errored. A green dot means a key is stored; that is not the same
as leads arriving, and the gap between those two is where a fortnight of
enquiries goes missing.

**Institute subscription billing is a separate category from payments.** Not a
sentence in a doc saying they are different, but a different heading with
different connectors under it. Razorpay and the rest take student fees, which is
the institute's money. Chargebee and Stripe Billing take the institute's
subscription, which is ours. Nothing shared, including the ledger.

Disconnect and reconnect are both there, disconnect gated on the delete
permission rather than edit, so a staff member who can update a key cannot clear
one.

## Phase 7 — the phase that makes everything else send

Six phases have been queueing messages, scheduling classes with a join link
typed in by hand, and reporting conversions only from a browser tag that half
the traffic blocks. This is the phase where all of that becomes real.

**Providers, thirteen of them, behind one interface.** Email through SMTP,
Resend, SendGrid, SES or Postmark. SMS through MSG91, Twilio or Exotel. WhatsApp
through AiSensy, WATI, Gupshup, the Meta Cloud API or Interakt. An academy
connects whichever it has and the first complete one in priority order carries
the channel, rather than making somebody pick a default in a dropdown they will
never revisit.

Each adapter classifies its own failures. A number that is not on WhatsApp will
never be on WhatsApp, and retrying it costs money and buries the real failures
underneath it, so a permanent refusal is not retried and a 503 is. MSG91 with no
DLT template id says so in those words rather than passing on a number, because
that specific misconfiguration is the one that fails silently at the carrier.

**The drain.** Rows are claimed before they are sent, so two overlapping runs
cannot both send the same reminder. Retries back off, one minute then five then
twenty five. A row stuck in SENDING because a run died is put back after ten
minutes. And nothing is sent that cannot be rendered: a template variable with
nothing to fill it stops the message and says which variable it was, because
"Hi ," going out to four hundred people is always caused by rendering being
forgiving.

**A utility wallet, because messages cost money.** Every send writes a ledger
row and debits an estimate, and the balance is a number on a screen rather than
something discovered from an invoice five weeks later. Charged before the
provider is called and refunded if it fails, which is the safe order: a timeout
that actually delivered is worse unbilled than double counted. SMS is costed per
segment and counts unicode, since one Malayalam character cuts the segment from
160 characters to 70 and empties a wallet three times faster than expected.
The whole thing is described as an estimate everywhere it appears.

**Zoom, server to server.** Meetings are created from the class rather than
pasted into it, with the trainer as host where they have their own seat, cloud
recording on where the plan allows it, and a waiting room. Not all at once: a
term of fifty classes is fifty API calls inside one form submission and a
request that times out with half the term provisioned, so a handful are made
immediately and the rest a fortnight before each class. Cancelling a class
deletes the meeting, so a learner with the old email finds nothing rather than
sitting alone in a room that still opens.

**Attendance from the source.** Zoom's join and leave webhooks now mark
attendance directly, signature checked, replay window enforced, every delivery
recorded before it is processed. A rejoin after a dropped connection does not
overwrite the first arrival, so a bad line no longer turns a punctual learner
into a late one.

**One-time codes and two factor, as libraries only.** Codes are hashed before
storage, compared in constant time, burned after five wrong guesses, and a new
request invalidates the old rather than leaving two valid. Wrong code, expired
code and no code give the same sentence, so this cannot be used to find out
which addresses have an account. Two factor is RFC 6238 against node:crypto,
with recovery codes.

Both of these compile and neither is reachable. There is no OTP login screen, no
two-factor enrolment, and no Google or Microsoft callback route, so nothing in
the running product calls them. That is Phase 7b and the board says so on those
cards rather than claiming otherwise.

**Conversions reported from the server.** GA4 through the Measurement Protocol
and Meta through the Conversions API, called from `fulfilPaidOrder` and keyed on
the order number so they deduplicate against the browser tag instead of double
counting. This is the difference between a cost per enrolment that looks
terrible and one that is true.

All of it hangs off the one place a payment becomes access, outside the
transaction and unable to fail it: a conversion that does not reach Meta is a
reporting problem, an enrolment rolled back because Meta was slow is a customer
problem, and the two are not close in seriousness. It is also skipped on a
replay, so a retried Razorpay webhook does not send a second receipt.

**Outbound webhooks**, signed and timestamped, queued rather than sent inline so
a slow endpoint on somebody else's server cannot make enrolling slow here, with
every delivery recorded because "we never got it" is the first thing anyone
says. Two events are raised today, a captured payment and a new enrolment; the
other six in the list are declared and the card says nothing raises them yet.

**Class reminders queue themselves** an hour ahead, deduplicated per class, so
running the job every few minutes queues each reminder exactly once. The manual
button stays for the trainer moving a class at short notice.

**A Messaging screen** under Settings answers the three questions in the order
people ask them: can we send at all, what is waiting, and what has it cost.
Addresses are masked, because that screen is for checking delivery, not for
copying a contact list out of the product.

## Phase 7b — the sign-in flows

Phase 7 shipped OTP and TOTP as libraries with no callers. This is the surface
that uses them.

**Four doors, one gate.** A password, a six digit code, Google, and Microsoft
all now end at the same `completeSignIn`: same suspended-account refusal, same
second factor, same session. Keeping it in one function is the whole point.
The bug it prevents is the ordinary one, two factor enforced on the password
path and forgotten on the other three.

**Sign in with a code**, which is the door most learners here will actually use.
An institute whose students share a family email address and live on WhatsApp
gets more support calls about forgotten passwords than about anything else. The
form never says whether an account exists: a number with no learner behind it
gets the same "if that account exists, a code is on its way". Rate limited four
per fifteen minutes per number and per address, because every one of these costs
the academy money to send. Using a code marks the phone or email verified, since
that is the same proof a separate verification message would have given.

Codes are drained immediately rather than waiting for the scheduled run, for the
obvious reason that nobody stares at a form for five minutes. And the channel is
forced by what the person typed rather than by the academy's notification
settings: a code asked for by mobile number goes by SMS, whatever the setting
says. Honouring an "email only" preference there would queue the code against an
address the caller never gave, find nothing to send to, and report success.

**Two factor, committed only when it is proved.** The secret is generated, shown
once, sealed into the row, and `twoFactorEnabledAt` stays null until the person
types back a code their app produced. Nothing checks it at sign-in until then,
so a mistyped key cannot lock an admin out of their own product. Recovery codes
are generated at that moment, shown once, stored as scrypt hashes like passwords,
and spent when used, because a recovery code that still works after use is just
a shorter password. Turning it off asks for the password, so an unlocked laptop
is not enough.

The half-signed-in state is a separate cookie, signed with AUTH_SECRET, ten
minutes long, and not a session: nothing else in the product accepts it and
`getSessionUser` never looks at it.

**Google and Microsoft**, as plain OAuth 2 with no library, because the protocol
is four HTTP calls and what matters is the three things people leave out. The
state parameter is signed and kept in a cookie and the callback refuses anything
that does not match. The email must come back verified. And the provider is
never allowed to create an account: it matches an existing learner by provider
id, then by verified email, and otherwise turns the person away with the same
message it gives for a wrong account, so this cannot be used to find out who
studies at an academy. The buttons appear only where the academy has actually
connected the provider, so nobody is offered a door that leads to an error page.

**Still not done, and labelled so.** reCAPTCHA has nothing verifying it, and its
card now says Phase 8. Secondary field validation at signup is not built either.

## Phase 8, part one — nothing breaks at cutover

The two pieces of the migration that cannot be repaired afterwards.

**Redirects, as data.** Rankings live on specific paths. A store that
disappears into 404s loses them in weeks and takes months to win back, if ever;
everything else in this build can be corrected on a Tuesday, and this cannot. So
the map is a table an academy maintains, not a config file somebody edits at
cutover.

A rule can cover a whole tree: `/shop/*` to `/courses/*` carries the rest of the
path across, which is how one row replaces the four hundred product URLs a
WooCommerce store accumulates, and the longest matching prefix wins so a
specific rule still beats the sweep it sits inside. Paths are normalised on the
way in and on the way out, because WordPress serves `/Courses/IELTS/` and
`/courses/ielts` as the same page and a map that only matches one of them has
holes in it. A pasted list is accepted in whatever shape a spreadsheet or a
Search Console export produces, and anything unusable comes back with a reason
rather than being dropped, since a rule quietly skipped is a 404 nobody finds
out about until the traffic has gone. Rules that would chain into a second hop
are named rather than accepted.

Hits are counted, which is the only honest way to know the map is finished:
watch which old paths are still being asked for. The lookup runs in a catch-all
route, so it answers exactly where a 404 would have been, and anything genuinely
unknown still gets a 404 rather than being swallowed.

**A read-only WooCommerce client, and a console that rehearses.** Read-only on
purpose: while both systems run, WooCommerce is the record for anything sold
there, and a migration tool that writes back can corrupt the thing it is copying
from. Every step has a dry run that reports exactly what would happen, nothing
is written until somebody has seen it, and the real run needs the delete
permission rather than edit, because importing four thousand accounts is not the
same class of action as changing a setting. Every row that crosses writes a
`MigrationRecord` keyed on the source id, so a second run finds the work already
done. A migration that cannot be re-run is one nobody dares start.

Three refusals in it, each the thing a naive importer gets wrong:

Products are not copied, only their URLs. The courses here are properly authored
with modules and pricing plans; a store product is a title and a price, and
importing them would leave four hundred shells for somebody to delete.

Orders are kept as history and never written into the live ledger, and never
turned into enrolments. Mixing orders taken by another system under another
gateway into this ledger would make every settlement and tax report wrong for
the periods they touch. And what somebody bought there is a question for a
person: a heuristic on a product name either grants access nobody paid for or
withholds access somebody did.

No migrated account is given a password. They sign in with a code, which Phase
7b built, or set one through the forgotten-password flow. Generating passwords
and emailing them to four thousand people is how a migration becomes a security
incident.

## Phase 8, part two — tests, at last

This should have started six phases ago. The argument for doing it now rather
than later is not abstract: this session alone shipped three bugs of exactly the
kind a test catches. A board that said "code lands in Phase 7" after Phase 7
shipped. Three libraries written, described as delivered, and never called by
anything. And a sign-in code that would have been queued against the email
channel when somebody typed a mobile number, found no address to send to, and
reported success.

**No framework.** Node 22 runs TypeScript and has a test runner built in, so
this adds nothing to `package.json` that was not already there. A twenty line
resolver hook teaches it the `@/` alias and extensionless imports, which is the
whole of the infrastructure. `tsx` could not do the job because its esbuild
binary is built for whichever machine ran the install, and these have to run on
a laptop and in CI.

**49 tests, chosen rather than counted.** Everything covered is pure, decides
something that costs money or access, and fails quietly rather than loudly.
Path normalisation, because a redirect map with holes is lost rankings. SMS
segment counting, because one Malayalam character turns a 160 character message
into two and a wallet that misses that drains three times faster than the screen
says. Retry classification, because backwards either way burns money or gives up
on a provider that was down for ten seconds. Sealing, TOTP, template rendering,
and timezone arithmetic where every test names a zone so none of them pass by
accident on a laptop set to IST.

**One design change fell out of it.** `redirects.ts` mixed pure path logic with
database reads, so the path rules could not be tested without Prisma loading.
They now live in `paths.ts`, which imports nothing. That the test was awkward
was the code telling me something true.

**One test was wrong, not the code.** I asserted `dayEnd` returned the last
instant of a day; it returns the next midnight, and all three callers query
`lt`, so the contract was right and my assumption was not. The test now states
the real contract, including that midnight belongs to the following day, which
is the thing a future change could break silently.

**CI runs both.** A GitHub Actions workflow typechecks and tests every push and
pull request. Not a deploy gate, since Hostinger builds from the branch, but the
thing that tells you a push was wrong without waiting for a learner to.

**What is not tested, and is said so in `tests/README.md`:** anything needing
the database. Fulfilment, the drain, entitlement, the curriculum gate. Those are
the highest-value tests in the product and they want a throwaway Postgres to run
against, which is the next piece of work rather than something to fake. A mocked
fulfilment test proves the mock works.

## Next runnable step

**Push, then run the tests once yourself.**

```
cd ~/Documents/lms && rm -f .git/*.lock* && git push origin main
npm test
```

No database change. On your Mac `npm test` should report 49 passing in under a
second, and from now on `npm run check` does the typecheck and the tests
together, which is the command worth running before any push.

Still open from before Phase 1: the two stuck INR 8,260 orders. Razorpay's
dashboard will say whether they were captured at 8,260, captured at another
amount, or only authorised, and that answer picks between two very different
bugs.
