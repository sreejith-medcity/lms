# Build plan and requirement tracker

The single source of truth for what this platform must do, what it currently does,
and what is left. `PROGRESS.md` holds the running log and the next runnable step.

## How to read the status column

| Status | Means |
| --- | --- |
| `done` | Interface, business logic, persistence, authorisation and error handling all work together, and the journey has been walked. |
| `partial` | Works for the main path. A named gap remains. |
| `ui-only` | A screen exists. It is not wired to real data, or the write path is missing. |
| `stub` | A route or nav entry exists and leads nowhere. Worse than missing, because it looks finished. |
| `missing` | Not built. Schema may already model it. |
| `blocked` | Built to the integration boundary, waiting on a credential or an external account. |

A feature is not `done` because its page renders. It is `done` when the data
survives a refresh, an unauthorised user is refused by the server rather than by a
hidden menu item, and the failure states say something useful.

## Audit summary, 9 September 2026

The foundation is real and the surface is thin. That is the honest shape of it.

**What is genuinely built.** Multi-tenant resolution from hostname, with
`organizationId` on every row and one resolver that decides it. A 127-model Prisma
schema covering the entire product, well past what is implemented. Session auth with
scrypt hashing. A 30-group permission catalogue resolved per request into a flat set,
enforced in server actions. Plan limits and usage metering. A design token layer and a
component set. Course and curriculum authoring, learner enrolment and a working player
with durable progress. Live class scheduling with attendance that records itself on
join. File storage with two drivers, chunked uploads, entitlement-checked delivery and
a media library.

**What is not built.** Fifteen of the twenty-one admin navigation entries lead
nowhere: events, memberships, module library, assessments, submissions, certificates,
team, enrolments, leads, campaigns, storefront, payments, fee tracking, analytics,
settings. There is no commerce at all, so `enrol` refuses anything with a price. There
is no public website beyond a course grid on `/` and a course page. There is no
assessment engine, no certificates, no notifications, no AI, no B2B, no PWA. Roles
exist in the database and are seeded, but there is no screen to edit them.

**The three things that most misrepresent progress right now.**

1. The dead navigation. A demo that clicks into fifteen blank routes reads as broken,
   not as early. Every stub either gets a real page or comes out of the nav.
2. `enrol` accepting free products only. The purchase-to-learning journey, the one
   thing section 15 checks first, does not exist end to end.
3. No public site. `/` is a course grid, not a homepage. Nothing a visitor could use
   to choose a course.

**Stack decisions already made and being kept.** Next.js 15 App Router with server
actions, Prisma 6 on Neon Postgres (Singapore), Tailwind with CSS custom property
tokens, scrypt from `node:crypto` (shared hosting cannot reliably compile argon2),
money as integer paise, no AWS SDK. Deployment is Hostinger shared hosting from a
GitHub push, with GCP as the stated production target. `docs/architecture.md` carries
the reasoning; `docs/edmingle-inventory.md` carries what is being replaced.

---

## Phase 1 — Audit, design, first working journey

| # | Requirement | Routes | Data and backend | Permissions | Acceptance | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1 | Tenant resolution from hostname | all | `Tenant`, `TenantDomain`, `Organization` | none | Unknown host gets a real explanation, not a digest | `done` |
| 1.2 | Design tokens and component set | all | none | none | Light and dark, focus rings, one accent from `Organization.brandColor` | `partial` — dark mode not audited for contrast; no motion tokens |
| 1.3 | Auth: register, login, logout, session, recovery | `/signup` `/login` `/logout` `/forgot` `/reset` | `User`, `AuthSession`, `OtpToken`, scrypt | none | Same failure text either way, so neither the sign-in nor the reset form can enumerate accounts | `partial` — recovery is built end to end: hashed single-use token, one hour, all sessions dropped on change. Delivery waits on email, and staff can reset a password and read it out meanwhile. No email verification, OTP, SSO or admin MFA |
| 1.4 | RBAC catalogue and enforcement | server actions | `Role`, `Permission`, `RolePermission` | n/a | `requireStaff(key, action)` refuses server-side | `partial` — enforced where used; no UI to edit roles; `restrictBatchAccess` not yet applied to list queries |
| 1.5 | Course authoring | `/admin/courses`, `/[id]`, `/curriculum`, `/pricing` | `Product`, `Course`, `Module`, `Section`, `Material`, `PricingPlan` | `courses.*`, `module.*` | Admin creates, edits, publishes; learner sees it | `done` |
| 1.6 | Shared module library across courses | `/admin/modules` | `CourseModule`, `BatchModule` | `module.module_library` | The same OET module serves two courses, edited once | `partial` — link and unlink work from inside a course; no library screen |
| 1.7 | Learner shell and course player | `/learn`, `/learn/[p]`, `/learn/[p]/[m]` | `Enrollment`, `MaterialProgress`, `LearnerNote` | learner | Progress survives refresh and another device; the player resumes where it stopped | `partial` — two-pane with a persistent rail, resume position, bookmarks and timestamped notes. Captions and transcripts wait on the AI layer |
| 1.8 | Public course page | `/course/[slug]` | `Product`, `PricingPlan`, `Batch`, `BatchStaff` | public | Format, language, level, access period, tax treatment, refund terms, curriculum tree, real batches, assigned trainers, sticky purchase on desktop and a bottom bar on mobile, Course JSON-LD | `done` |
| 1.9 | Admin dashboard | `/admin` | payments, enrolments, attendance, sessions, orders, materials | `dashboard.view_dashboard`, `dashboard.view_revenue_widgets` | Every number traceable to a query; revenue gated by permission; an action queue rather than only figures | `partial` — no date-range control, and the metric definitions are in code comments rather than on the page |
| 1.10 | Media library and uploads | `/admin/library`, `/api/uploads`, `/media`, `/api/assets` | `Asset` | `asset_library.*` | 2 GB file uploads, plays, seeks; unauthorised viewer refused | `done` |
| 1.11 | **Public website** | `/`, `/courses`, `/courses/[category]`, `/sample`, `/about`, `/contact`, `/help`, `/policies/[kind]` | `Product`, `Category`, `Policy`, `StorefrontPage`, `Lead` | public | A visitor can search, filter, compare, preview a real lesson and enquire | `partial` — built and wired to live data; no instructor profile pages, no blog, and checkout does not exist yet |
| 1.12 | **Navigation tells the truth** | admin sidebar | — | — | Nothing navigates to a blank route | `done` — one entry left marked: Campaigns, which is blocked on messaging rather than unbuilt |
| 1.13 | SEO surface | public pages, `/sitemap.xml`, `/robots.txt` | `Product`, `Category`, `Policy` | public | Unique metadata, canonical, sitemap generated from live data, Course JSON-LD matching visible content, `/admin` `/learn` `/platform` noindex | `done` — Open Graph images still to come |

## Phase 2 — Learning and commerce

| # | Requirement | Routes | Data and backend | Permissions | Acceptance | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1 | Checkout | `/checkout/[orderId]` | `Order`, `OrderItem` | learner | Server prices everything; the client sends ids, never amounts | `partial` — single-course checkout works end to end. No multi-item cart yet, and no billing address, so supply is treated as intra-state |
| 2.2 | Razorpay order, verification, webhook | `/api/payments/razorpay/verify`, `/webhook` | `Payment`, `GatewayEvent` | none (signed) | Signature checked, payment re-fetched from the API, every delivery recorded, processing idempotent, a client success screen alone grants nothing | `done` in test mode — live keys and `RAZORPAY_WEBHOOK_SECRET` still to be set |
| 2.3 | Entitlement separate from payment state | — | `Enrollment`, `Order`, `Payment`, `Refund` | — | Refund revokes access without deleting progress | `done` — a full refund expires the enrolment and leaves progress and attendance untouched |
| 2.4 | GST invoices | `/learn/purchases` | `Invoice`, `TaxConfig` | learner | CGST/SGST 9+9, IGST 18, exclusive; sequential invoice numbers | `partial` — issued and numbered on payment, listed on the purchases page. No PDF, and no admin view |
| 2.5 | Coupons | checkout | `PromoCode` | `promocode.*` | Eligibility and redemption limits enforced atomically | `missing` |
| 2.6 | Instalments and fee tracking | `/admin/fees`, course pricing tab | `Instalment`, `Payment`, `PricingPlan` | `sales.fee_tracking` | Due dates, part payments, reminders | `partial` — plans, overdue totals, and a collected instalment written as a real payment. A course can now be sold on an instalment plan whose dues are written out at creation, per branch, anchored to the batch start or the enrolment date. Reminders wait on messaging |
| 2.7 | Manual enrolment with audit trail | `/admin/enrol` | `Enrollment`, `Order`, `Payment`, `Invoice`, `AuditLog` | `new_enrollment.single` | Who enrolled whom, when, and why | `done` — existing or new learner, batch with seats-left, and an offline payment written as a real order, payment and invoice so collections stay true. Bulk import is separate and still missing |
| 2.8 | Assessment engine | `/admin/question-bank`, `/admin/assessments`, `/learn/assessment/[id]`, `/learn/attempt/[id]` | `QuestionBank`, `Question`, `Assessment`, `Attempt`, `Answer` | `question_bank.*`, `courses.assessments` | Per-answer autosave, server-authoritative deadline, reconnect resumes rather than burning an attempt, attempt limits, deterministic shuffle, answers withheld until release | `partial` — single/multi choice, true-false and written answers. Match, fill-in-the-blank, file upload, speaking and coding still to come, as is per-question media |
| 2.9 | Submissions and grading | `/admin/submissions`, `/[attemptId]` | `Submission` | `submission.*` | Grading queue, bulk operations, publication control, history preserved | `partial` — oldest-first queue with the wait in days, per-question marking on top of the auto-scored half, feedback published to the learner. No bulk operations, and re-marking a released score is deliberately not built |
| 2.10 | Certificates | `/admin/certificates`, `/verify/[token]` | `CertificateTemplate`, `IssuedCertificate` | `certificates.*` | Verifiable id, revocation, controlled disclosure | `done` — sequential serials claimed in a transaction, a public verify page showing only holder, course and date, withdrawal that stays on the record, and auto-issue on course completion. PDF export still missing |
| 2.11 | Drip release | `/admin/courses/[id]/drip` | `DripRule` | `module.drip` | Material locked until its date or its prerequisite | `done` — per lesson: from the start, N days after enrolment, N days after the batch starts, or on a date. Enforced in the outline, the player, the progress actions and `/api/assets/[id]`, so a locked file is not one URL away. Prerequisite-based release is not built; only time-based |

## Phase 3 — Academy operations

| # | Requirement | Routes | Data and backend | Permissions | Acceptance | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 3.1 | Branches | `/admin/settings/branches` | `Branch`, `BranchMembership` | `settings.branches` | A branch manager sees only their branches, enforced in queries | `partial` — create, edit and deactivate work, and the last active branch cannot be deactivated. Query scoping by branch is still not applied |
| 3.2 | Batches | `/admin/batches`, `/admin/batches/[id]` | `Batch`, `BatchStaff`, `BatchModule` | `batches.*` | Roster, staff, per-batch curriculum | `done` — the classroom screen: attendance and on-time KPIs, learners sorted worst-first by attendance, progress and scores, enrolment states, classes with per-class turnout, per-batch module selection (empty means the whole course), staff by role, dates, seats and the default flag |
| 3.3 | Live classes and attendance | `/admin/sessions`, `/[id]` | `LiveSession`, `SessionRecurrence`, `Attendance` | `scheduling.sessions` | Weekly series; attendance recorded on join with a ten-minute grace | `done` |
| 3.4 | Zoom integration | — | `Integration` | `settings.integrations` | Real meeting creation, recording pull, join/leave webhooks | `blocked` — needs `ZOOM_*`; currently a manually pasted join URL |
| 3.5 | Recordings | session page, `/learn/[p]` | `Recording`, `Asset` | `class_recording.*` | Published to the batch that sat the class | `done` |
| 3.6 | Transcription | — | `Transcript` | — | Segments, summary, chapters, searchable | `missing` |
| 3.7 | Team and roles UI | `/admin/team`, `/admin/settings/roles` | `Role`, `UserRole`, `RolePermission` | `settings.roles` | Create a role, tick permissions, assign a person, see it take effect | `done` — full 30-group matrix with edit implying view and delete implying edit, enforced client and server side; built-in roles are copy-only; suspension drops live sessions |
| 3.8 | Learner management | `/admin/learners`, `/[id]` | `User`, `LearnerProfile`, `CustomFieldDefinition` | `learner.*` | Search, filter, custom fields, export, impersonate | `partial` — a per-learner page with their enrolments, orders, attendance, certificates and a password reset. Custom field values, export and impersonation still missing |
| 3.9 | CSV import | `/admin/learners/import` | staged rows, `AuditLog` | `new_enrollment.bulk` | Validation, preview, duplicate handling, row-level errors, downloadable result | `missing` |
| 3.10 | Storefront CMS | `/admin/storefront`, `/blog`, `/blog/[slug]` | `StorefrontPage`, `BlogPost` | `blogs.manage_blogs` | Constrained editor, preview, publish, SEO fields | `partial` — pages as heading-and-prose blocks, posts as plain text, draft and publish, SEO fields, both in the sitemap. No preview, no images, no redirects on a slug change |
| 3.11 | Announcements, feedback forms, testimonials | `/admin/announcements` | `Announcement`, `FeedbackForm`, `Testimonial` | respective | Targeted at a batch or a course | `partial` — announcements target batches and appear on the learner dashboard. Feedback forms and testimonials still missing |
| 3.12 | Reporting | `/admin/analytics`, `/learning`, `/attendance` | payments, orders, enrolments, attempts, attendance | `analytics.*` | Metric definitions documented; collections distinguished from revenue | `partial` — three sections with a date range, each printing what every figure counts. Nothing is called revenue: money that arrived is collections, money promised is invoiced. Export and scheduled reports still missing |
| 3.13 | Settings | `/admin/settings`, `/branches`, `/taxes`, `/roles`, `/integrations` | `Organization`, `Branch`, `TaxConfig`, `Role` | `settings.*` | Organisation details, live brand-colour preview, branches, GST with a worked example, roles, and integration health read from the running process | `partial` — custom fields and notification preferences still to come |

## Phase 4 — Advanced learning

Each of these needs its own data flow, interface, permissions and acceptance tests.
None is started; the schema anticipates all of them.

| # | Requirement | Data | Acceptance | Status |
| --- | --- | --- | --- | --- |
| 4.1 | Personalised learning path | `SkillMastery`, `Enrollment` | Rule-based first; the skill map explains why each recommendation appears | `missing` |
| 4.2 | Smart study planner | `StudyPlanItem` | Editable, reschedulable, recalculates after missed work and says what changed | `missing` |
| 4.3 | Course-grounded AI tutor | `ContentEmbedding` (pgvector), `AiConversation` | Cites lesson or video timestamp; retrieval permission checked before generation; unpublished material and assessment answers unreachable | `blocked` — needs `ANTHROPIC_API_KEY` |
| 4.4 | Speaking practice studio | `Submission`, `Answer` | CEFR-aligned German and IELTS/OET English; consent before recording; scored as practice, never as an exam result; text fallback | `missing` |
| 4.5 | Writing feedback studio | `Submission.aiDraftFeedback` | Rubric-driven, highlighted, revision history, teacher review distinct from AI draft | `missing` |
| 4.6 | Intelligent lesson tools | `Transcript`, `Question` | Generated material linked to its source, instructor approval before publishing | `missing` |
| 4.7 | Spaced revision | new model needed | Editable cards, due queue, learner controls daily load | `missing` |
| 4.8 | Early support signals | `LearnerProfile.riskScore` | Each flag explains itself and suggests an intervention; no exam-outcome predictions | `missing` |
| 4.9 | Instructor copilot | — | Drafts only; educator publishes and grades | `missing` |
| 4.10 | Ask-your-data | — | Read-only validated reporting tools with enforced scope; never free-form SQL | `missing` |
| 4.11 | Focus and motivation | — | Distraction-free mode, opt-in groups, optional rankings, no artificial urgency | `missing` |

## Phase 5 — Organisational growth and mobile

| # | Requirement | Data | Acceptance | Status |
| --- | --- | --- | --- | --- |
| 5.1 | B2B organisation workspaces | `Tenant`, `Organization`, seat models needed | Cross-organisation access impossible even on a shared catalogue | `missing` |
| 5.2 | Seat allocation and bulk invite | new models | Invitations, cohort progress, scoped reports | `missing` |
| 5.3 | Custom domains | `TenantDomain` | Ownership validated before enabling | `partial` — resolution works; no validation flow, no SSL job |
| 5.4 | Notification engine | `MessageTemplate`, `Campaign`, `Workflow`, `NotificationLog` | Preferences, consent, quiet hours, opt-out, duplicate prevention | `blocked` — needs `SMTP_URL`, `MSG91_AUTH_KEY`, `AISENSY_API_KEY` |
| 5.5 | Leads pipeline | `Lead`, `FollowUp` | Source attribution, owner, follow-up, enrolment outcome | `stub` |
| 5.6 | PWA and offline | — | Installable; download and sync state visible; conflict resolution and logout cleanup defined | `missing` |

## Phase 6 — Release validation

| # | Requirement | Acceptance | Status |
| --- | --- | --- | --- |
| 6.1 | Postgres row-level security | `SET LOCAL app.org_id` per transaction; a missing `where` returns nothing rather than everything | `missing` — the second belt, required before the first external tenant |
| 6.2 | Automated tests | Unit for money, permissions, signing; integration for the payment and entitlement journeys | `missing` — no test runner installed |
| 6.3 | Accessibility review | WCAG 2.2 AA at 360 / 768 / 1280 / 1440, keyboard, focus, contrast, reduced motion | `missing` |
| 6.4 | Rate limiting, CSRF, upload validation, sanitisation | Enumerated and verified | `partial` — server actions carry CSRF protection; sign-in and sign-up are rate limited per address and per identifier, in an in-process store that must move to Redis or Postgres before a second instance; upload validation is extension and size only; no HTML sanitisation on `bodyHtml` yet |
| 6.5 | Observability, backup and restore, rollback | Rehearsed, not assumed | `missing` |
| 6.6 | Migration from Edmingle | Dry run writes `MigrationRecord` without touching live tables; cutover is a DNS change with the old system read-only for a month | `missing` — deliberately after the build |

---

## Verification journeys from the definition of done

None of these has been walked end to end yet. They are the acceptance gate, and
`PROGRESS.md` records the result of each attempt.

1. Admin creates, previews, publishes and updates a course. — *creates and publishes: yes. Preview: no.*
2. Learner registers, recovers access, discovers a course, completes a test purchase, receives entitlement once. — *no recovery, no purchase.*
3. Invalid or duplicate payment events cannot grant access. — *not applicable yet.*
4. Learner plays a lesson, saves notes, resumes after refresh. — *plays and resumes. No notes.*
5. Assessment survives reconnect, respects the server deadline, is graded, feedback reaches the right learner. — *no assessments.*
6. Certificate issuance follows completion rules and supports revocation. — *none.*
7. Branch and partner users cannot reach unauthorised records, files, exports, search or AI context. — *file delivery is checked; list queries are not branch-scoped.*
8. AI answers link to accessible sources and handle an unavailable provider honestly. — *no AI.*
9. Public and authenticated screens usable on mobile, by keyboard, in empty and error states. — *not audited.*

## Design benchmark

The reference for the learner-facing surfaces is Coursera and Udemy, not Edmingle
and not RocketLMS. Worth being precise about what that does and does not mean:
those two are consumer course marketplaces, and they have nothing at all for
batches, branches, attendance, fee instalments or GST invoicing, which is most of
what an academy actually runs on. So the benchmark applies to three surfaces and
stops there.

- **Course page.** Udemy's shape: outcomes as a scannable grid, a curriculum tree
  that expands with lesson counts and durations, free-preview lessons playable
  from the tree, and a purchase card that stays with you as you scroll. *Built.*
- **Catalogue.** Coursera's shape: facets that narrow rather than a wall of
  cards, a live result count, and every card carrying level, language, format and
  the next start date. *Built.*
- **Player.** Coursera's shape: a persistent curriculum rail on the left with
  progress against each item, the lesson filling the rest, and next and previous
  always reachable. Below it, tabs for notes and transcript. *Built, except the
  transcript, which needs the AI layer.*

What is deliberately not copied: their catalogue is a marketplace optimised for
browsing thousands of courses from strangers. This is one academy with a
knowable catalogue, so the pages lead with what a specific learner needs to
decide, and batch dates and trainers get the space a marketplace gives to ratings
and enrolment counts.

## Working agreements

- Money is integer paise with an explicit currency. No floats near currency, ever.
- Prices, discounts and tax are computed on the server. The client sends ids.
- Nothing financial is hard-deleted. Orders, payments and invoices have no delete path.
- A hidden menu item is not access control. Every read and write checks server-side.
- Uploaded and retrieved content is data, never instructions.
- An integration without credentials is built to its boundary and marked `blocked`,
  not simulated and called done.
