# Edmingle Teardown: What Medcity Actually Has

Full extraction of the Medcity International Academy LMS account before building the replacement.
Captured 9 Sep 2026 from `lms.medcitylms.in` (Edmingle v2 admin, org ID 11912, API `medcity-api.edmingle.com/nuSource/api/v1`).

---

## 1. The headline numbers

| Item | Value |
|---|---|
| Subscription | Edmingle **Power Plan**, quarterly |
| Cost | **₹1,41,596.46 per quarter** (≈ ₹5.66 L / year), renewed 05 Sep 2026, next 05 Dec 2026 |
| Payment status | Reminder banner: settle on or before **12/09/2026** |
| Learners | **4,003** (registration numbers now at 3999+) |
| Staff users | **8** (4 Super Admin, 4 Instructor) |
| Branches (sub-orgs) | **1** ("Medcity") |
| Courses | **88** (59 counted as active on the branch) |
| Batches | **141** total, 21 on the A1 course alone |
| Modules (curriculum) | 100+ in the Module Library, 3 pages at 50/page |
| Session recordings | **1,089** |
| Assets | **3,758** files, **281.33 GB** used of a 1,500 GB plan, largest file 1 GB |
| Announcements | 11 |
| Testimonials | 15 (all unpublished) |
| Certificates issued | 17, from 1 template (prefix MIAK001) |
| Abandoned checkouts | 19, worth ₹60,002 |
| Notification wallet | **₹0.00 — empty** (AI credits: 500) |

**Two things worth acting on regardless of the clone:** the notification wallet is at zero, so transactional email/SMS (session reminders, OTPs, payment receipts) may be silently failing; and 281 GB of the 1.5 TB storage is mostly auto-uploaded class recordings that keep growing ~2 GB/day.

---

## 2. Module map (every screen, with routes)

The v2 app is a React/Vite SPA, hash-routed under `#/organization/…`. Several modules still bounce to the **legacy v1 app** at `/app/#/…` — those are flagged **[v1]**, and they are the ones Edmingle never finished migrating.

### Veda AI — `#/organization/min/usage-analytics`
- Usage Analytics dashboard (messages, chat sessions, AI interviews, summaries, assignments evaluated, courses embedded, credits used, penetration %, message volume over time)
- **Learner agents:** AI Companion, AI Interviewer, AI Summarizer
- **Admin agents:** Content Generator, AI Evaluation
- General Settings
- *Current use:* 694 AI summaries generated, everything else at 0. 500 AI credits unused.

### Home — `#/organization/dashboard`
- Weekly performance tiles: Average Time Spent, Total Views, Average Rating, Average Attendance (each with 7-day sparkline and WoW delta)
- Daily Active Users (473 avg / 10 days), Enrollments (1,058 last 30 days) with Signup-vs-Enrollments / Sales toggle
- Today's Sessions panel: sessions scheduled, cancelled, total sign-ins with in-time %, not signed-in, average attendance, per-session table with topics
- Quick actions: Schedule Session, View Calendar, Mark as Holiday, View Session Licenses, What's New, wallet balance chip

### Products
| Screen | Route | State in the account |
|---|---|---|
| Courses | `/courses` | 88 courses; filters by sub-category, membership, more filters; columns Sr, name, status (Published *n/n* / Unpublished), created by, enrollments; All / Archived tabs |
| Events | `/events` | Module **INACTIVE**, 0 events. Fields: event name, date, visibility, status |
| Memberships | `/memberships` | Module **INACTIVE**, 3 plans exist (Premium Card, Gold, Diamond — 10 courses each, 0 active members) |
| Mentorships | `/mentorships` | **INACTIVE** — 1-on-1 bookable sessions, 30–75 min, paid or free, mentor assignment, revenue dashboard |
| eBooks | `/ebooks` | Coming soon (Edmingle roadmap) |
| Test Series | `/testseries` | Coming soon |
| Playlists | `/playlists` | Coming soon |

### Learning
| Screen | Route | State |
|---|---|---|
| Batches | `/batches` | 141; tabs Active/Completed/Archived/All; filters status, course, module, instructor; columns name, DEFAULT flag, learner count, OLD/UPCOMING badge, course, duration, module & instructor, batch manager, batch progress % |
| Sessions | `/schedule/calendar` | Calendar with Day/Week/Month/List views, trainer and batch filters, Create Session; recurring group classes, ~24 sessions/day currently |
| Announcements | `/announcements` | 11; date & time, name, urgency (HIGH/NA), tags; filters by date range, urgency, tags |
| Feedback Forms | `/feedback-forms` | Custom forms with response-rate donut and response timeline; form name, created on, type, conversions. 0 views/submissions |
| Module Library | `/module-library` | Reusable curriculum modules, each with N sections; filter by course and batch. 100+ modules (OET CHAMPION 24 sections, CCM 5 MONTHS 16, IELTS CHAMPION 12, per-session German modules, etc.) |
| Question Bank | `/question-bank` | Banks with ID, name, question count, difficulty (EASY/MEDIUM), exam, subject, topic; filters on all four |
| Asset Library | `/assets-library` | 3,758 assets, 76 pages. Columns: asset name, file name, uploaded by, uploaded on, size, type, usage (N products), downloads. Types on upload: Video, Audio, PDF, YouTube, Image, Doc, Sheet, Slide, Text/HTML, Zip, **SCORM Zip**, Link/Embed, Epub |
| Assessments | `/assessments` | Empty. Tabs Assignment Based / Custom Link; columns name, linked courses, price, total attempts, unique attempts, registered |
| Submissions | `/submissions` | Live. Tabs Not Evaluated / Evaluated / All; filters date, course, batch, instructor, assessment; columns learner, assessment, evaluation status, submission date, timeliness, assessment type, review action; Download CSV |
| Session Recordings | `/organization/…/session-recordings` (menu) | 1,089 recordings, 228.65 GB of 1,500 GB; tabs Active/Completed/Archived batches; class name, batches, instructor, status (Published), bulk Actions |
| Certificates | `/certificates` | 1 template: Course Completion Certificate, serial prefix MIAK001, 17 issued, auto-issued on course completion, no expiry |

### Users
| Screen | Route | State |
|---|---|---|
| Learners | `/users/learners` | 4,003. Tabs All / Registered / Enrolled / Completed / On Leave / Archived; filters date range, course, batch, more filters; configurable columns (contact details, date added, status, registration no.); Export |
| Team | `/users/team` | 8 users, Active/Archived tabs; name, role, contact, date added, branch; Export |
| Segments | `/segments` | 1 dynamic segment ("Disengaged", 15 learners); segment name, type (DYNAMIC/static), learners, created on |
| New Enrolment | `/users/new-enrollments` | 4 modes: **Single Enrollment**, **Bulk Enrollment**, **Learner Registration**, **Advanced Bulk Enrollment**. Single = identify by email or mobile → course → batch |

### Engage
| Screen | Route | State |
|---|---|---|
| Community | `/…/community` | Module toggle **enabled**, no community created yet |
| Loyalty Program | `/engage/loyalty-program` | 1 manual credit entry (15,000 pts). Settings: enable toggle, max credit allowed, max redeemable % per transaction, credit conversion (1 pt = ₹1.00), referral signup credit, normal signup credit, referrer credit, referral course-purchase credit |
| Discussions | **[v1]** `/app/#/organization/discussions` | Per course-package threads; 0 records |

### Marketing
| Screen | Route | State |
|---|---|---|
| Campaigns | `/marketing/campaigns` | 3, all DRAFT. Channels WhatsApp + Email; type Immediately vs scheduled; columns name, type, channel, status, scheduled time, created on, sent count |
| Workflows | `/marketing/workflows` | Empty. Workflow name, learners, status — automation journeys |
| Blogs | `/marketing/blogs` | **INACTIVE**, empty. Blog name, status, views, created on |
| Marketing Banners | `/marketing/marketing-banners` | Empty. Thumbnail, banner name, status |
| Leads | **[v1]** `/app/#/organization/enquiries` | Three tabs: **Leads** (live — date, name/email/phone, message, follow-ups, owner, source=WEB, status), **Enquiry** (0, with Import Enquiries + Add New), **Follow-Ups** (0; date criteria, status Pending, counsellor owner). Most current leads are support complaints coming through the website |
| Promotional Templates | `/marketing/templates` | Empty. Tabs Email / SMS / WhatsApp / Push templates |
| Promo Codes | `/marketing/promo-codes` | Empty. Tabs Multiple Use / Single Use; code, discount %, max discount, start/end date, status; filter by course |
| Testimonials | `/marketing/testimonials` | 15, all UNPUBLISHED. Learner name + email, product type, star rating, comment, status; Export |

### Sales
| Screen | Route | State |
|---|---|---|
| Abandoned Cart | `/sales/abandoned-cart` | 19 abandons, ₹60,002 value, 1 in last 30 days. Tabs Abandoned / Completed; learner, checkout items + visit count, cart value, abandoned on; Export |
| Cheque Management | `/sales/cheque-management` | Empty. Student, parent, bank, amount, status, remark; filters date, status, bank |
| Fee Details | **[v1]** `/app/#/organization/sales/fee-details` | Opens the whole legacy finance suite (below) |

**Legacy finance suite [v1]** — the money actually lives here:
- **Payment Transactions** — receipt no., student (reg no./phone/email), date, course, mode (Cash/online), amount, actual amount, credits used, earnings; Day/Month date criteria; Export
- **Payment Settlements** — gateway settlement records
- **Fee Tracking** — per-student outstanding by package or batch, payment status filter, **Send Reminder**, More Filters, Export
- **Promo Codes [v1]**
- **Cheque Management [v1]**
- **Referral Wallet** — wallet system **enabled**; referral signup 1,000 credits, normal signup 0, referral joins 0, referral books package 0, max credits 20,000
- **Pricing Templates** — 1 template "Full Fees", 1 instalment, invoice generated from date of class commencement
- **Miscellaneous Fees** — none created

### Analytics — `/analytics/sales-enrollment`
One "Analytics Suite" catalogue, 8 categories, ~30 reports:
- **Sales & Enrollment:** Product Enrollments, Sales Overview, Payments Received, Payment Settlements, Course Wise Enrollments, Event Enrollments, Membership Enrollments, GST Report
- **Batch & Progress:** Batch Performance, Sessions, Batch Attendance, Batch Module Progress, Batch Assessment, Assessments Report, Certificate Report
- **Feedback & Rating:** Sessions Feedback, Batch Rating, Trainer Feedback, Event Feedback
- **Marketing:** Promocode Statistics
- **Trainer:** Trainer Reports
- **Notification Logs:** Email Logs, SMS Logs, WhatsApp Logs
- **Advanced Analytics:** User Analytics, Test Analytics, Course Analytics
- **More Reports:** Branch Statistics, Storage Consumption, Bandwidth Consumption, Scheduled Tasks, User Time Stats, Wallet Recharges

### Settings
**Profile & Organization** — My Profile (personal details, contact, address, timezone Asia/Calcutta, change password) · Institution Profile (name, website, contact, address, country/state/city/pin) · **Sub-Organizations** (branches: 1 branch, 4 managers, 4 instructors, 59 courses, 4,003 learners; Create Branch) · **Taxes** (tax system ON, GSTIN + PAN on file, Kerala, SGST 9% / CGST 9% / IGST 18%, **GST-exclusive pricing**, branch-level tax rates supported)

**System Notifications** — per-event notification matrix across **Email / SMS / WhatsApp** with editable templates, grouped: Login & Signup (signup confirmation, signup OTP, login OTP, forgot password, reset password link, secondary field validation), Sessions, Events, Payments, Courses, Memberships, Community System, Miscellaneous. Transactional sends debit the utility wallet.

**Website & App Setup** — five tabs: General Settings, Website, Brand settings, Social media, Policies.
- Sign-up primary field: **Email** (mobile alternative), sign-ups allowed from mobile app
- Login modes: **Google SSO on**, **OTP-based on**, 2FA off; OTP-based signup/login/secondary validation; optional category signup
- Website: built-in **website builder** (last edited 7 Apr 2026), `*.edmingle.com` URL + custom domain via CNAME, hide instructor name, enable messages module, free-preview button text, support email, custom Explore Courses URL
- Security & Privacy, Miscellaneous sections

**Setup & Customization**
- **Categories** — 11 categories (In-Demand, Featured, Premium, Language, Banking…) + Sub-Categories, reorderable, active/inactive
- **Preferences** — *Learner profile:* instructor access to recordings, learner profile editing, mandatory-field editing, profile image upload, profile-completion nudge (on), access restriction on incomplete profile, forced password reset, learner recording downloads (off). *Course content:* disable default YouTube controls, text/HTML masking for teaching materials (off) and for assessments (on), **leaderboards on**, **complete-and-continue video threshold 70%**. *DRM and dynamic watermark settings*
- **Custom Fields** — per entity: Learner Profile, Instructor, Course, Batch, Certificate, Question, Announcement, Enquiry. Learner profile has **25 fields**, each typed (Text / Number / Date / Dropdown / Upload) and independently enabled for **Website & App Signup** vs **Offline Admission Form**, with before/after-signup timing and mandatory flags:
  Username, Country, Student Mobile Number, Student Name, Date of Birth, Gender, Alternate Contact, Permanent Address, City, State, Pincode, Student Source, Religion, Occupation, TimeZone, Parent Name, Parent Contact No., Parent Email, Area, School/College Name, Residential Address, Registration Number, Resume (file), Student Email, Standard
- **Grading System** — off
- **Fees Templates / Miscellaneous Fees** — mirror of the v1 screens
- **International Selling** — **off**; branch currency INR, active gateway Razorpay, fixed per-currency pricing, auto rate conversion `((amount + (amount × adjustment_rate/100)) × manual_conversion_rate)`
- **Learner Experience** — drag-order the learner portal sidebar with visibility toggles and custom items: My Learning, Community, Announcements, Calendar, Exams, Certificates, Membership, My Purchases, Refer and Earn, Help, Inbox; plus Class Records, At a Glance, Change password, Preferences, Profile toggles

**Security & Compliance — Roles & Permissions:** Super Admin (all functionality, 4 users), Admin (branch-scoped, 0 users), Instructor (edit batches and curriculum; for sessions can only sign in, send reminders, cancel — 4 users). Custom roles supported.

**Integrations (Apps)** — connected: **Razorpay** (all currencies), **Edmingle Mail**, **Edmingle SMS**. Available but not connected: Edmingle Pay, Stripe, PayPal, Easebuzz, AiSensy Pro (WhatsApp), MSG91, Mercer Mettl, Exam Online, Webhooks, Zapier (soon), Pabbly (soon), GA4, WebEngage, SSO, external tool integration (LTI-style), Judge0, Freshdesk, Woolf, Zoho Desk, Google OAuth.

**Manage Billing** — My Subscription (plan, amount, renewal cycle, invoices, Pay Now) · **Utility Wallet** (Notification Credits ₹0.00, AI Credits 500, Coding Compiler coming soon; ledger charges ~₹0.08 per email notification; Recharge History, Credit Usage Info, Export)

---

## 3. The two structures the clone lives or dies on

### Course editor — `/courses/{id}/…`
Six tabs: **Details · Modules · Batches · Pricing and Publishing · Learners · Drip**

- **Details:** name (≤100), description (≤2000), thumbnail, pretty name (slug), linked assessments · overview blocks (paragraph + weight) and promo video URL · sub-categories, memberships that include the product · progress settings: milestone celebrations at 25/50/75/100 %, content access after batch completion, **Enable Course Context for AI** (costs 200 AI credits), learner-marked completion, **modules as prerequisites** (sequential unlock)
- **Modules:** links Module Library modules to the course. Module editor has Module / Tests tabs; sections carry material count, per-batch visibility (e.g. 22/22), Clone Section, Rearrange sections, Add Material. Example: German A1 = 7 sections, **70 materials, 11 h 35 m**
- **Pricing and Publishing:** publish independently to **Web / Android app / iOS app**; enable free preview; **On-Demand Course** (admin-only enrolment); Mark as Featured; Apple IAP product ID; custom courses-overview link; **pricing plans per branch** — name, plan type (one-time / instalment), price, expiry (e.g. Full Fees ₹7,000, 45 days)
- **Learners:** per batch — enrolled on, attendance %, module progress %
- **Drip:** release relative to **Learner Enrollment Date / Batch start date / Specific Date**, with a day offset per individual material

### Batch (classroom) — `/classroom/{id}/…`
Header: learners, start date, end date, class progress (sessions done / total, % curriculum). Tabs: **Learners · Sessions · Attendance Report · Content Progress · Assessment Progress**. Learner states: All / Enrolled / Leave / Completed / Free Enrolled / Archived. Session KPIs: scheduled, cancelled, in-time sign-ins, not signed-in, average attendance; per session — attendance, status, topics. Plus Edit batch and a Batch Actions menu, batch-level module linking, batch manager and instructor assignment, DEFAULT-batch flag.

---

## 4. Entities the replacement has to carry

Organization → Branch → (Users: learner / instructor / admin / super-admin, with role-permission sets)
Category → Sub-category → **Course** → **Module** (shared library) → Section → Material (13 types incl. SCORM)
Course → **PricingPlan** (one-time / instalment, currency, validity days, per branch) → **Enrollment** → **Batch** → **Session** (recurring, Zoom-style live, recording) → **Attendance**
**Assessment** → Question Bank → Question → Attempt → Submission → Evaluation → Grade
**Certificate template** → issued certificate (serial series)
**Payment** → receipt → settlement → invoice → GST lines → promo code / coupon → wallet credits → referral ledger
**Lead** → enquiry → follow-up → counsellor
**Announcement**, **feedback form + response**, **testimonial**, **segment**, **campaign** (email/SMS/WhatsApp/push) + **template**, **workflow**
**CustomFieldDefinition** (per entity, typed, per-context visibility) — this one is structural, not cosmetic; 25 learner fields already depend on it
**Asset** (file, size, type, usage count, downloads) + storage accounting
**NotificationLog** per channel, **AI agent usage**, audit trail

---

## 5. Flags worth raising before any build

1. **Notification wallet is empty (₹0.00).** Every transactional email/SMS debits it at ~₹0.08. Session reminders, OTPs and payment notifications are likely not going out.
2. **The finance module is still on the legacy v1 UI.** Payments, settlements, fee tracking, referral wallet and pricing templates all live there — meaning Edmingle's own migration is unfinished, and a migration export has to cover both apps.
3. **Course catalogue is messy.** 88 courses but many are unpublished duplicates created by one staff account (multiple "IELTS Standard", package variants). Worth deciding what actually migrates — this is a chance to clean rather than copy.
4. **Assets are the real cost driver.** 3,758 files / 281 GB, growing by the recorded class every day. Self-hosting means an object-storage + CDN plan and a recording pipeline from day one, or the clone's storage bill replaces the SaaS bill.
5. **Leads coming in as support complaints.** The v1 Leads tab is mostly "my LMS portal is not working" — worth wiring the clone's support path separately from sales enquiries.
6. **Memberships, Events, Mentorships, Blogs, International Selling are all inactive.** They can be phase-2 in the clone rather than launch scope.
7. **Data portability.** Export buttons exist on learners, team, submissions, testimonials, abandoned cart, payments, wallet and every analytics report — that plus the API is the migration path. Nothing seen so far offers a single full-account dump.

---

*Captured by walking every module of the live admin; no learner personal data is reproduced in this document.*

---

## 6. Second pass: the details the first sweep left open

### RBAC, in full
Roles are created through a 2-step wizard: **Role Details** (name, description, and a **Restrict Batch Access** toggle: when on, a user only sees batches where they are Primary Tutor / Batch Manager / Additional Batch Manager) then **Role Permissions**.

The permission matrix has **30 permission groups**, each with granular items carrying **View / Edit / Delete** flags:

Analytics · Feedback Form · Dashboard · Scheduling (Sessions & Events) · Courses · Batches · Announcements · Reports · New Enrollment · Question Bank · Module · Class Recording · Category · Submission · Learner · Instructor · Membership · Banner · Settings · Certificates · Promocode · Email · Discussions · Blogs · Testimonials · Leads and Enquiries · Marketing · Sales · Community · Asset Library

Examples of the granularity: *Analytics* → Manage Course Analytics, Manage Analytics, Learner Analytics, Test Analytics. *Courses* → Course Management (V/E/D), Pricing and Publish (Edit only), Events (V/E/D), Assessments (Edit only). The three default roles cannot be edited, only viewed for assigned users; custom roles are where real permissioning happens.

### System notification events (per channel: Email / SMS / WhatsApp / **Mobile Push**, each with an editable template)
- **Login & Signup:** Signup Confirmation, Signup OTP, Login OTP, Forgot Password, Reset Password Link, Secondary Field Validation
- **Sessions:** Session Schedule, Session Update, Manual Session Reminder, Session Reminder (auto at 24 h and 1 h before, to learners *and* instructors), Session Start Reminder, Mark Holiday, Session Cancel, Notify Absentees
- **Payments:** Payment Received (receipt), Payment Reminder (due)
- **Courses:** Course Welcome and Course Completion, configured **per course** (all 88 listed individually), channels Email + WhatsApp
- Plus: Events, Memberships, Community System, Miscellaneous categories

### Branding and public-facing config
- **Brand settings:** brand logo, favicon (2 MB max, 16×16 / 32×32), **brand colour `#30B15F`**, toggle to theme the learner dashboard with it
- **Social media:** Facebook, Instagram, X, YouTube, LinkedIn URLs (Facebook, Instagram, YouTube and LinkedIn populated; X empty)
- **Policies:** rich-text editor for Privacy Policy (custom copy already written), plus the other policy documents; falls back to Edmingle defaults if blank

### The learner-facing side, and a structural surprise
`lms.medcitylms.in/courses` is the Edmingle learner storefront: nav (Courses, Contact Us, Membership, My Account), category filter chips (Language, Banking, Marketing, Nursing, Medical, Paramedical, PSC, Healthcare), price filter, and course cards with MRP, discount % and **FREE WITH PASS** membership badges. Published pricing: German A1 ₹7,000 (MRP ₹10,000, 30% off), A2 ₹8,000, most others ₹5,000 against ₹10,000, and roughly ten free courses.

**But the course cards link out to WordPress.** `/course/A1Group-100677` redirects to `medcitylms.in/german-a1-course/`, the WooCommerce site, which carries its own cart, its own Login/Register, its own Razorpay checkout and its own landing-page copy (about, curriculum outline, FAQs, related courses, ₹7,000 vs ₹10,000).

So the current stack is genuinely two systems:

| | Marketing, catalogue, checkout | Delivery, admin, operations |
|---|---|---|
| Platform | WordPress + WooCommerce + Elementor | Edmingle |
| Domain | medcitylms.in | lms.medcitylms.in |
| Payments | Razorpay (Woo) | Razorpay (Edmingle) |
| Cart | Woo cart | Edmingle cart (19 abandoned, ₹60 k) |
| Accounts | Woo customers | 4,003 Edmingle learners |

Two carts, two payment paths, two learner identities, two content sources for the same course. **The strongest single argument for the clone is not saving the ₹5.66 L a year, it is collapsing these two systems into one.** Any build plan should treat the WooCommerce storefront as in-scope, not as something to keep bolted on.

### Appendix: full course catalogue (88, as named in the system)
IELTS Nano Plus · German Language- A1 · German Language- A2 · German Language- B1 · German Language- B2 · IELTS Academic · Banking Course · Digital Marketing Course · German Language Exams · PSC · PTE Academic · Nursing Course · IELTS Course · TOEFL Course · LanguageCert Course · German B2 TELC Mock Test · OET Course · NCLEX-RN · MLT · Pharmacy (DHA&Prometric) · Medical German · Spoken English · OET Medicine · OET Pharmacy · IELTS SILVER PACKAGE (General) · CBT · IELTS Standard (×2) · IELTS NANO PLUS GENERAL · IELTS STANDARD - GENERAL · IELTS ALL IN ONE (GENERAL) · IELTS COMBO (GENERAL) · IELTS COMBO ACADEMIC · IELTS ALL IN ONE ACADEMIC · IELTS NANO PLUS ACADEMIC · IELTS STANDARD ACADEMIC · OET COMBO · OET -ALL IN ONE · OET SILVER · OET STANDARD · OET NANO PLUS · OET MEDICINE ALL IN ONE · OET MEDICINE NANO · OET PHARMACY ALL IN ONE · OET PHARMACY NANO · IELTS SILVER ACADEMIC · NCLEX-RN 12 WEEKS · NCLEX-RN ONE YEAR PACKAGE · PTE CORE · B2 TELC · CCM GERMANY · Conversational English Course · DUOLINGO English Test (DET) · OET LISTENINGANDREADINGINTENSIVE · CBT- MENTAL HEALTH · OET test · GERMAN BEGINNER'S PACK · IELTS LISTENING AND READING INTENSIVE · IELTS WRITING AND SPEAKING INTENSIVE · OET WRITING AND SPEAKING INTENSIVE · IELTS WRITING AND SPEAKING GT · German Teacher's Training · OET INTENSIVE WRITING · German Language A1 Recordings (Batch 37) · test · IELTS WRITING · IELTS SPEAKING INTENSIVE · A1 FINAL TEST · IELTS READING INTENSIVE · OET READING INTENSIVE · IELTS - CHAMPION · IELTS CHAMPION (GENERAL) · OET BEGINNERS PACK · OET CHAMPION · OET LRWS-LIMITED · US ADAPTATION PROGRAM · CCM 3 MONTHS · CCM 4 MONTHS · CCM 5 MONTHS · OET MEDICINE WRITING · OET SPEAKING · OET MOCK EXAM · IELTS WRITING GT · OET LISTENING · OET MEDICINE WRITING & SPEAKING · OET MED SPEAKING · PHARMACIST GR II - HEALTH SERVICES / MEDICAL EDUCATION DEPARTMENT · OET WRITING & READING

*(Names carried over verbatim, duplicates and test entries included, since that is what a migration would actually face.)*
