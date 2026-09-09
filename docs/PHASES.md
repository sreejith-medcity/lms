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

## Phase 1 — Course and batch depth

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

## Phase 2 — Scheduling and recordings

Calendar with day, week, month and list views, filtered by trainer and batch,
which is Edmingle's actual scheduling screen and the one trainers live in. Mark
holiday. A recordings library across batches with bulk publish, rather than only
per session. Session feedback and rating. Feedback forms with a response rate and
a submission timeline. Notify absentees and manual reminders, queued now and sent
when Phase 7 connects a provider.

## Phase 3 — Marketing and sales completeness

Promo codes: single and multiple use, percent and cap, date window, per course,
with redemptions. Marketing banners. Testimonials moved into the admin so the 15
sitting unpublished in Edmingle can be reviewed and published. Abandoned cart,
which needs the cart to persist first, with a recovery list. Cheque management.
Payment settlements. Pricing templates and miscellaneous fees. Campaigns,
workflows and message templates, composed and logged here, sending in Phase 7.

## Phase 4 — Engagement

Segments, dynamic and static, so "Disengaged" becomes a rule rather than a list
someone maintains. Community with posts, comments and moderation. Per-course
discussions. Loyalty points and the referral wallet with its credit ledger.
Learner portal sidebar ordering. Learner export and impersonation. Instructor
profiles.

## Phase 5 — The analytics suite

Roughly thirty reports across eight categories: sales and enrolment, batch and
progress, feedback and rating, marketing, trainer, notification logs, advanced,
and the operational ones (branch statistics, storage, bandwidth, scheduled
tasks). Every one with its metric definitions on the page and a CSV export,
which is also the migration path out of here.

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
