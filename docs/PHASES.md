# Parity phases

Everything Edmingle does that this does not, split into runs. Say "start phase N"
and that phase gets built; nothing else is touched until it is done and pushed.

Source of truth for what Edmingle has: `edmingle-inventory.md`. Source of truth
for what this has: `BUILD_PLAN.md`.

## Already at parity or past it

Courses · module library · question bank · assessments and the sitting · marking
queue · certificates with public verification · media library · batches list ·
sessions and self-recording attendance · announcements · learners and team ·
single and bulk enrolment · categories · payments, invoices, fee plans, refunds ·
enquiries · storefront pages and blog · events · memberships · roles and the
permission matrix · branches · taxes · integrations health · three analytics
sections.

Past it in four places worth naming: attendance records itself on join rather
than waiting for someone to keep a register, every refusal to grant access after
a payment is written down, every analytics figure prints what it counts, and
certificates can be checked by a stranger with only the code.

---

## Phase 1 — Course and batch depth · DONE, DEPLOYED

The audit calls these "the two structures the clone lives or dies on", and both
are currently shallower here than in Edmingle.

**Course editor.** Thumbnail, pretty name, overview blocks with weights, promo
video. Progress settings: milestone celebrations, access after batch completion,
learner-marked completion, modules as prerequisites. Publishing per channel: web,
Android, iOS, plus on-demand, free preview, featured, Apple IAP id, custom
overview link. Pricing plans per branch with one-time or instalment plan types.
A Learners tab showing, per batch, enrolled on, attendance and module progress.
Drip: release relative to enrolment date, batch start or a specific date, with a
per-material day offset.

**Batch classroom.** The screen that does not exist yet: header KPIs (learners,
dates, sessions done, curriculum percent), then tabs for Learners, Sessions,
Attendance report, Content progress and Assessment progress. Learner states,
batch staff assignment, batch-level module linking, default flag, edit batch.

**Curriculum.** Clone a section, rearrange sections, per-batch section
visibility.

Built, and past the brief in one place worth naming: the drip and visibility
locks are enforced on the asset route and the progress actions as well as in the
UI, and progress percentage counts only the curriculum a given enrolment was
actually handed.

## Phase 2 — Scheduling and recordings · DONE, DEPLOYED

Calendar with day, week, month and list views, filtered by trainer and batch,
which is Edmingle's actual scheduling screen and the one trainers live in. Mark
holiday. A recordings library across batches with bulk publish, rather than only
per session. Session feedback and rating. Feedback forms with a response rate and
a submission timeline. Notify absentees and manual reminders, queued now and sent
when Phase 7 connects a provider.

Built. Two departures from the brief, both deliberate: the calendar does its own
date arithmetic in the academy's timezone rather than the server's, because a
7pm class in Kochi belongs to that Tuesday wherever the box lives; and the
outbox writes a row per intended message before any provider exists, so "did she
get the reminder" stays answerable rather than becoming a provider's problem.

## Phase 3 — Marketing and sales completeness · DONE, DEPLOYED (two items parked)

Promo codes: single and multiple use, percent and cap, date window, per course,
with redemptions. Marketing banners. Testimonials moved into the admin so the 15
sitting unpublished in Edmingle can be reviewed and published. Abandoned cart,
which needs the cart to persist first, with a recovery list. Cheque management.
Payment settlements. Pricing templates and miscellaneous fees. Campaigns,
workflows and message templates, composed and logged here, sending in Phase 7.

## Phase 4 — Engagement · DONE, DEPLOYED

Segments, dynamic and static, so "Disengaged" becomes a rule rather than a list
someone maintains. Community with posts, comments and moderation. Per-course
discussions. Loyalty points and the referral wallet with its credit ledger.
Learner portal sidebar ordering. Learner export and impersonation. Instructor
profiles.

## Phase 5 — The analytics suite · BUILT, AWAITING PUSH

Roughly thirty reports across eight categories: sales and enrolment, batch and
progress, feedback and rating, marketing, trainer, notification logs, advanced,
and the operational ones (branch statistics, storage, bandwidth, scheduled
tasks). Every one with its metric definitions on the page and a CSV export,
which is also the migration path out of here.

Built as a catalogue rather than thirty pages: a report is a declaration with a
run function, one page renders any of them and one route exports any of them.
Thirty-one so far, and the thirty-second is a function rather than a screen.

## Phase 6 — Settings depth

Custom fields across eight entities, typed, independently visible on signup and
on the offline form, with before-or-after timing and mandatory flags. This is
structural rather than cosmetic: the 25 learner fields depend on it. The system
notification matrix, every event by every channel with an editable template.
Preferences: learner profile rules, course content rules, the seventy percent
video threshold, leaderboards, DRM and dynamic watermark. Website and app setup:
signup primary field, login modes, brand, social links, policies editor. Grading
system. International selling.

## Phase 7 — Auth and integrations

The phase that makes several earlier ones actually send. OTP signup and login,
Google SSO, two-factor, secondary field validation. Zoom server-to-server for
real meetings, recording pull and join webhooks. Email, SMS and WhatsApp
providers, and the notification engine behind them. Webhooks, Zapier, GA4.
Utility wallet metering, so notification cost is visible rather than a surprise.

## Phase 8 — One system, and go-live

The strongest argument for this whole build, per the audit: collapsing two
systems into one. Absorb the WooCommerce storefront, one cart and one identity,
a landing page per course, and a redirect for every old URL so the SEO survives.
Then the release work: Postgres row-level security, a test suite, an
accessibility pass, performance measurement, and the migration itself.

## Phase 9 — Loyalty as a product of its own

Modelled on Reward Loyalty (rewardloyalty.co/docs/5.x), a self-hosted loyalty
platform, and scoped to the parts that make sense for an institute rather than a
coffee shop. Phase 4 already built the half that an LMS needs on its own: a
points ledger, referral codes, and redemption capped at checkout. This is the
rest of it, and it is the first phase that is not about catching Edmingle.

**Stamp cards.** Attend eight classes, get the ninth free. Closer to how a
coaching institute actually rewards regulars than a points balance is, because
it is legible without arithmetic.

**Vouchers.** Batch-generated codes with QR claiming, distinct from promo codes:
a promo code is a price rule anybody may use, a voucher is an instrument issued
to one person and spent once. Both exist in mature systems and conflating them
is why refunds get argued about.

**Prepaid passes.** A ten-class pass sold at the counter and drawn down by
attendance, with an expiry. Medcity sells this shape already; it currently lives
in a register.

**Achievements.** Finished a module, sat every class in a month, passed at the
first attempt. Optional credit attached. Worth building only after Phase 5,
because an achievement nobody can measure is a badge nobody trusts.

**Member cards.** One identity a learner can present at the counter: QR,
barcode, NFC, or a plain number for the branch that has no scanner. This is the
piece that makes the front desk faster rather than the app prettier.

**Wallet passes.** Apple and Google Wallet, which needs an Apple developer
certificate and a Google service account before a line of it is worth writing.

**A QR studio** to make the codes look like Medcity's rather than like a
default, and **POS or counter mode** for staff issuing and redeeming at a branch.

Sequencing: this needs new models for every noun above, so it belongs after
Phase 8's migration rather than in the middle of it. Two pieces could be pulled
forward if the front desk wants them sooner, and both are self-contained: member
cards, and prepaid passes.

---

## Ordering, and why

Phases 1 and 2 are the daily surface for staff and trainers, so they come first.
Phase 3 is the money surface. Phase 4 is engagement, which matters less than
either until people are actually in the system. Phase 5 reads everything the
first four wrote, so it is worth doing after them rather than before. Phase 6 is
deep and mostly configuration. Phase 7 unblocks the sending that phases 2, 3 and
6 stub out. Phase 8 is the cutover.

Two things are worth pulling forward out of order if the demo needs them, and
both are one sitting each: the calendar from Phase 2, and promo codes from
Phase 3.

Phase 9 sits outside that ordering on purpose. It is the first phase that is not
parity work, it needs schema of its own, and none of it is load-bearing for a
migration off Edmingle.
