/**
 * Every setting, declared in one place.
 *
 * The same shape as the report catalogue, for the same reasons. A setting that
 * lives only in a form has no default anybody can see, no explanation of what
 * it changes, no history, and no way to be searched for at the moment somebody
 * needs it. Declaring them buys all four at once.
 *
 * Two rules the incumbent does not follow, and this does.
 *
 * A setting says what it *does*, not what it is called. "Video completion
 * threshold: 70" tells you nothing; "a video counts as watched at 70%, so a
 * forty-minute lesson needs twenty-eight minutes" tells you what will happen.
 *
 * A setting nothing reads yet says so. A switch that quietly does nothing is
 * worse than an absent one, because somebody will flip it and believe the
 * product changed.
 */

export type SettingKind = 'boolean' | 'number' | 'select' | 'text';

export interface SettingDef {
  key: string;
  group: SettingGroupKey;
  label: string;
  /** What flipping it actually changes, in plain words. */
  help: string;
  kind: SettingKind;
  default: boolean | number | string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  unit?: string;
  /** False when nothing reads it yet, so the screen cannot imply otherwise. */
  live: boolean;
  /** Named when the setting waits on a later phase. */
  waitingOn?: string;
  /** A sentence showing the current value's consequence. */
  effect?: (value: boolean | number | string) => string;
  /** Text that will not fit on one line, such as an embed snippet. */
  multiline?: boolean;
  /** Shown in the empty field, as an example rather than as a default. */
  placeholder?: string;
}

export const SETTING_GROUPS = [
  { key: 'learning', label: 'Learning', blurb: 'What counts as done, and what learners can see about each other.' },
  { key: 'player', label: 'The player', blurb: 'How material is protected once somebody is watching it.' },
  { key: 'profile', label: 'Learner profiles', blurb: 'What a learner may change about themselves.' },
  { key: 'auth', label: 'Signing up and in', blurb: 'How people get an account and how they come back to it.' },
  { key: 'community', label: 'Community', blurb: 'What learners may post, and whether anybody reads it first.' },
  { key: 'commerce', label: 'Selling', blurb: 'Where you sell, and in what currency.' },
  { key: 'loyalty', label: 'Loyalty', blurb: 'Who runs the points, and who does the arithmetic.' },
  { key: 'website', label: 'The public site', blurb: 'What a stranger sees before they have an account.' },
  { key: 'ai', label: 'The AI examiner', blurb: 'What learners may practise with it, and how much.' },
  { key: 'messaging', label: 'Messaging', blurb: 'When promotional messages may go out, and when they wait.' },
  { key: 'attendance', label: 'Attendance', blurb: 'What counts as late, when an online no-show is absent, and how long a register may be corrected.' },
  { key: 'academics', label: 'Marks and approval', blurb: 'What reaches a parent only after the Branch Head has approved it.' },
  { key: 'notices', label: 'Notices and parents\' devices', blurb: 'How notices reach parents, how long a phone stays signed in, and what teachers may keep.' },
] as const;

export type SettingGroupKey = (typeof SETTING_GROUPS)[number]['key'];

export const SETTINGS: SettingDef[] = [
  /* Learning ---------------------------------------------------------------- */
  {
    key: 'learning.videoCompletePercent',
    group: 'learning',
    label: 'A video counts as watched at',
    help: 'Below this, a learner has started it. At or above it, the lesson is theirs and the course moves on.',
    kind: 'number',
    default: 70,
    min: 25,
    max: 100,
    unit: '%',
    live: true,
    effect: (v) =>
      `A forty-minute lesson needs ${Math.round((Number(v) / 100) * 40)} minutes of it watched.`,
  },
  {
    key: 'learning.testsFreeSample',
    group: 'learning',
    label: 'One free mock test paper per level',
    help: 'On the public test pages (/tests), somebody who creates an account may sit one paper of each level free, once. Each one arrives under Leads as an enquiry from the web, with the test named. Off, the pages still describe the tests and sell the packs.',
    kind: 'boolean',
    default: true,
    live: true,
    effect: (v) => (v ? 'A free paper per level, once per person.' : 'No free paper; the test pages sell packs only.'),
  },
  {
    key: 'learning.autoComplete',
    group: 'learning',
    label: 'Mark a lesson done automatically',
    help: 'When somebody passes the threshold above, tick it off without asking. Off means they press the button themselves.',
    kind: 'boolean',
    default: true,
    live: true,
    effect: (v) =>
      v
        ? 'Progress keeps itself up to date.'
        : 'Learners must tick each lesson, which they will forget to do.',
  },
  {
    key: 'learning.badges',
    group: 'learning',
    label: 'Badges and streaks',
    help: 'Learners earn badges for lessons finished, classes attended, days in a row, full marks and the like, each with the number that earns the next tier shown plainly. Off hides the page and stops awarding.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'learning.badgePoints',
    group: 'learning',
    label: 'Credit points per badge tier',
    help: 'Loyalty credit given when a badge is earned, multiplied by the tier (bronze 1, silver 2, gold 3). Zero gives badges without credit. Needs loyalty switched on.',
    kind: 'number',
    default: 0,
    min: 0,
    max: 1000,
    live: true,
  },
  {
    key: 'learning.showLeaderboard',
    group: 'learning',
    label: 'Show a leaderboard',
    help: 'A short ranking on the learner dashboard. Motivating for a competitive cohort, discouraging for everybody at the bottom of it.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'learning.leaderboardScope',
    group: 'learning',
    label: 'Rank people against',
    help: 'Their own batch is usually fairer than the whole academy, where a beginner is measured against somebody six months ahead.',
    kind: 'select',
    default: 'BATCH',
    options: [
      { value: 'BATCH', label: 'Their own batch' },
      { value: 'COURSE', label: 'Everyone on the course' },
      { value: 'ACADEMY', label: 'The whole academy' },
    ],
    live: true,
  },
  {
    key: 'learning.showOthersNames',
    group: 'learning',
    label: 'Use real names on the leaderboard',
    help: 'Off shows first names and an initial, which is usually enough to recognise yourself without publishing a class list.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'learning.languages',
    group: 'learning',
    label: 'Languages the learner side is offered in',
    help: 'Besides English. Codes separated by commas: ml for Malayalam, hi for Hindi. A learner picks from the menu in their portal and on the sign-in page; what they pick is remembered on their account.',
    kind: 'text',
    default: 'ml, hi',
    live: true,
  },
  {
    key: 'learning.reviewAfterPercent',
    group: 'learning',
    label: 'Ask for a review once a learner is this far through',
    help: 'A review from somebody two lessons in tells the next person nothing. 100 asks only those who finished; lower it for long courses where few finish but many learn.',
    kind: 'number',
    default: 100,
    min: 10,
    max: 100,
    unit: '%',
    live: true,
    effect: (v) => (Number(v) >= 100 ? 'Only learners who finished are asked.' : `Asked once ${v}% of the course is done.`),
  },
  {
    key: 'learning.reviewsPublish',
    group: 'learning',
    label: 'When a review goes on the course page',
    help: 'Reviews that wait sit under Marketing, Testimonials, until somebody publishes them. Whatever you choose, you can take any review down, and answer it in public.',
    kind: 'select',
    default: 'REVIEW',
    options: [
      { value: 'REVIEW', label: 'Every review waits for the team to read it' },
      { value: 'FOUR_UP', label: 'Four and five stars go live at once; the rest wait' },
      { value: 'ALL', label: 'Every review goes live at once' },
    ],
    live: true,
  },

  /* The player -------------------------------------------------------------- */
  {
    key: 'video.provider',
    group: 'player',
    label: 'Video platform',
    help: 'Where uploaded videos are sent to be encoded for adaptive streaming and served with expiring links. Add the platform’s keys under Integrations first; until then videos play straight from the bucket.',
    kind: 'select',
    default: 'none',
    options: [
      { value: 'none', label: 'None: play from the bucket' },
      { value: 'bunny', label: 'Bunny Stream' },
      { value: 'cloudflare_stream', label: 'Cloudflare Stream' },
      { value: 'mux', label: 'Mux' },
    ],
    live: true,
  },
  {
    key: 'video.sendOnUpload',
    group: 'player',
    label: 'Send every new video for encoding',
    help: 'Off means each video is sent by hand from the media library, which is useful while trying a platform out.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'video.playbackMinutes',
    group: 'player',
    label: 'A playback link lives for',
    help: 'Long enough to watch a class in one sitting, short enough that a copied link dies. The player asks for a fresh one each time it opens a lesson, and again if one expires mid-way.',
    kind: 'number',
    default: 240,
    min: 30,
    max: 1440,
    unit: 'minutes',
    live: true,
  },
  {
    key: 'video.autoCaptions',
    group: 'player',
    label: 'Write captions for every encoded video',
    help: 'Asks the video platform to transcribe the audio once the encode is ready. Billed by the platform per minute; off means captions are asked for by hand from the media library, or uploaded.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'video.captionLanguage',
    group: 'player',
    label: 'Caption language',
    help: 'The language spoken in most recordings, as a code: en, de, hi, ml. The platform transcribes in this language.',
    kind: 'text',
    default: 'en',
    live: true,
  },
  {
    key: 'player.watermark',
    group: 'player',
    label: 'Watermark video with the viewer',
    help: 'Overlays who is watching, moving slowly so it cannot be cropped out. It does not stop a recording; it makes one traceable, which is what actually deters sharing.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'player.watermarkShows',
    group: 'player',
    label: 'The watermark shows',
    help: 'A registration number is traceable by you and meaningless to anybody the recording is passed to, which is the right trade.',
    kind: 'select',
    default: 'REGISTRATION',
    options: [
      { value: 'REGISTRATION', label: 'Their registration number' },
      { value: 'NAME', label: 'Their name' },
      { value: 'EMAIL', label: 'Their email address' },
      { value: 'PHONE', label: 'Their mobile number' },
    ],
    live: true,
  },
  {
    key: 'player.blockDownload',
    group: 'player',
    label: 'Hide the download button',
    help: 'Only applies to material not already marked downloadable. Anybody determined can still capture a stream; this stops the casual case.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'player.blockContextMenu',
    group: 'player',
    label: 'Disable right-click on video',
    help: 'Stops "save video as" in a browser. Honest about what it is: friction, not protection.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'player.drm',
    group: 'player',
    label: 'Encrypted playback (DRM)',
    help: 'Widevine and FairPlay, which is the only thing here that actually prevents copying rather than discouraging it.',
    kind: 'boolean',
    default: false,
    live: false,
    waitingOn: 'a DRM licence server, which is a Phase 7 integration',
  },

  /* Learner profiles -------------------------------------------------------- */
  {
    key: 'profile.canEditName',
    group: 'profile',
    label: 'Learners may change their own name',
    help: 'Off where the name has to match an exam registration, which is most of what this academy sells.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'profile.canEditEmail',
    group: 'profile',
    label: 'Learners may change their own email',
    help: 'The email is how they sign in and where receipts go, so changing it is an account change rather than a profile edit.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'profile.canEditPhone',
    group: 'profile',
    label: 'Learners may change their own mobile',
    help: 'Safe to allow: it is used for reminders rather than identity.',
    kind: 'boolean',
    default: true,
    live: true,
  },

  /* Signing up and in ------------------------------------------------------- */
  {
    key: 'auth.primaryField',
    group: 'auth',
    label: 'People sign up with',
    help: 'The field that must be filled and must be unique. Mobile suits a walk-in intake; email suits one that buys online.',
    kind: 'select',
    default: 'EMAIL',
    options: [
      { value: 'EMAIL', label: 'An email address' },
      { value: 'PHONE', label: 'A mobile number' },
      { value: 'BOTH', label: 'Both, required' },
    ],
    live: true,
    effect: (v) =>
      v === 'PHONE'
        ? 'Email becomes optional, and receipts will have nowhere to go for anybody who leaves it blank.'
        : v === 'BOTH'
          ? 'Nobody can sign up without giving you both.'
          : 'Mobile stays optional.',
  },
  {
    key: 'auth.verifySecondary',
    group: 'auth',
    label: 'Confirm the second contact with a code',
    help: 'After signing up, a learner is asked to confirm the contact they did not sign up with (the mobile when email is primary) with a six-digit code, so reminders and receipts have a working destination. Off, the second contact is still checked for shape and for being unused here.',
    kind: 'boolean',
    default: false,
    live: true,
    effect: (v) => (v ? 'Needs an SMS or email provider under Messaging; without one the card on the account page says the code could not be sent.' : 'The second contact is taken as typed.'),
  },
  {
    key: 'auth.selfSignup',
    group: 'auth',
    label: 'Anybody may create an account',
    help: 'Off means only the office enrols people, and the sign-up page says so rather than failing at the end.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'auth.parentPortal',
    group: 'auth',
    label: 'Parents may sign in to see their child',
    help: 'A parent signs in at /parent with a contact the office has linked to the learner, by a code sent there, and sees attendance, fees, marks and report cards. Read-only; nothing is changed from there. Links are made and revoked on the learner\'s page.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'auth.parentCodeOnScreen',
    group: 'auth',
    label: 'Pilot: show a parent\'s sign-in code on the screen when it cannot be sent',
    help: 'For the pilot only, while no SMS, WhatsApp or email provider is connected. When a code cannot be delivered, it is shown on the sign-in screen and in the app instead, which means anyone who knows a parent\'s number can sign in as them. Switch off before parents use the sign-in for real; once a provider is connected the code is sent and never shown.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'auth.parentsPerChild',
    group: 'auth',
    label: 'Parents linked to one child, at most',
    help: 'Two lets both parents sign in with their own phone. One means a single contact per child. The office cannot link past this without revoking one first.',
    kind: 'number',
    default: 2,
    min: 1,
    max: 4,
    live: true,
  },
  {
    key: 'auth.parentSessionDays',
    group: 'auth',
    label: 'A parent stays signed in for, in days',
    help: 'After this many days without signing in again the phone is signed out on its own. A parent can sign out every device at once from their account page, and the office can from the sessions page.',
    kind: 'number',
    default: 30,
    min: 1,
    max: 365,
    live: true,
  },
  {
    key: 'auth.staffSessionDays',
    group: 'auth',
    label: 'A teacher or staff member stays signed in for, in days',
    help: 'Applies from the next sign-in. Shorter is safer on a shared phone; the office can sign a person out of every device from the sessions page.',
    kind: 'number',
    default: 30,
    min: 1,
    max: 365,
    live: true,
  },
  {
    key: 'auth.otpLogin',
    group: 'auth',
    label: 'Sign in with a one-time code',
    help: 'A code by SMS instead of a password, which removes the single largest support burden an institute has.',
    kind: 'boolean',
    default: false,
    live: false,
    waitingOn: 'an SMS provider, connected in Phase 7',
  },
  {
    key: 'auth.twoFactorStaff',
    group: 'auth',
    label: 'Two-factor for staff',
    help: 'Staff accounts can move money and see every learner, so this matters more than it does for learners.',
    kind: 'boolean',
    default: false,
    live: false,
    waitingOn: 'the authenticator work in Phase 7',
  },

  /* Community --------------------------------------------------------------- */
  {
    key: 'community.learnerCanPost',
    group: 'community',
    label: 'Learners may start discussions',
    help: 'Off leaves rooms readable but silent, which is occasionally what an exam cohort wants.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'community.holdFirstPost',
    group: 'community',
    label: 'Hold a learner’s first post for review',
    help: 'Only their first. It costs a moderator one decision per person and stops the failure mode where a room is spammed before anybody notices.',
    kind: 'boolean',
    default: false,
    live: true,
  },

  /* Selling ----------------------------------------------------------------- */
  {
    key: 'affiliates.cookieDays',
    group: 'commerce',
    label: 'A partner’s referral is remembered for',
    help: 'Somebody who arrives through a partner’s link and buys within this many days counts as the partner’s sale.',
    kind: 'number',
    default: 30,
    min: 1,
    max: 365,
    unit: 'days',
    live: true,
  },
  {
    key: 'payments.gateway',
    group: 'commerce',
    label: 'Payment gateway',
    help: 'Where Indian buyers pay. Razorpay opens in a window on the checkout page; PhonePe and PayU send the buyer to their page and back. The chosen one needs its keys (Razorpay from the environment, the others on their Integrations card); without them, Razorpay is used.',
    kind: 'select',
    default: 'razorpay',
    options: [
      { value: 'razorpay', label: 'Razorpay' },
      { value: 'phonepe', label: 'PhonePe' },
      { value: 'payu', label: 'PayU' },
    ],
    live: true,
  },
  {
    key: 'payments.international',
    group: 'commerce',
    label: 'Cards from abroad',
    help: 'Offer Stripe beside the Indian gateway for learners paying from outside India. Needs the Stripe card under Integrations.',
    kind: 'select',
    default: 'none',
    options: [
      { value: 'none', label: 'Not offered' },
      { value: 'stripe', label: 'Stripe' },
    ],
    live: true,
  },
  {
    key: 'payments.emiNote',
    group: 'commerce',
    label: 'Say that EMI is available',
    help: 'A line on the checkout page that card EMI options appear in the payment window. Only switch it on once your gateway account has EMI enabled, or it is a promise the window will not keep.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'security.captchaMinScore',
    group: 'auth',
    label: 'reCAPTCHA score to accept',
    help: 'reCAPTCHA v3 scores a visitor from 0 (a bot) to 1 (a person). Sign-ups and enquiries below this are refused. 0.5 is Google’s own suggestion; lower it if real people are being turned away.',
    kind: 'number',
    default: 0.5,
    min: 0.1,
    max: 0.9,
    live: true,
  },
  {
    key: 'commerce.invoiceSeries',
    group: 'commerce',
    label: 'Invoice series',
    help: 'A short tag in every invoice number (INV-ACME-2026-00001). Invoice numbers are unique across this whole deployment, so every academy but the first needs one; a new academy is given its own on sign-up. Leave blank to keep a plain INV-2026-00001 series. Changing it starts a new series from 00001, which a GST return should be told about.',
    kind: 'text',
    default: '',
    live: true,
  },
  {
    key: 'commerce.customerBearsGatewayFee',
    group: 'commerce',
    label: 'The learner pays the payment gateway fee',
    help: 'Set this to match your Razorpay account, because Razorpay decides it, not us: Account and Settings, then Payment configuration. On, Razorpay adds its fee to the card at the moment of payment, so a 8,260 course is charged as about 8,552, and this site says so before they pay rather than letting them discover it on a statement. The invoice stays the course price either way, because the fee is Razorpay charging the buyer rather than something you sold.',
    kind: 'boolean',
    default: false,
    live: true,
    effect: (value) =>
      value
        ? 'Checkout shows the fee as a separate line and quotes the larger figure the card will be charged.'
        : 'Checkout quotes the course price, and the fee comes out of what the academy receives.',
  },
  {
    key: 'commerce.gatewayFeePercent',
    group: 'commerce',
    label: 'What that fee comes to, as a percentage',
    help: 'Only used to show a figure before payment, since the exact fee depends on how they pay: cards cost more than UPI, and international cards more again. Include the GST charged on the fee. Razorpay\u2019s common Indian card rate is 2% plus 18% GST, which is 2.36; a 3% account comes to 3.54.',
    kind: 'number',
    default: 2.36,
    min: 0,
    max: 15,
    unit: '%',
    live: true,
    effect: (value) =>
      `A 10,000 course would be quoted as about ${(10000 * (1 + Number(value) / 100)).toFixed(0)} at checkout.`,
  },
  {
    key: 'commerce.international',
    group: 'commerce',
    label: 'Sell outside India',
    help: 'Shows prices to visitors abroad and lets them buy. Off, the catalogue still reads; only checkout refuses.',
    kind: 'boolean',
    default: false,
    live: false,
    waitingOn: 'a billing address at checkout, which arrives with the cart in Phase 8',
  },
  {
    key: 'commerce.allowedCountries',
    group: 'commerce',
    label: 'Countries you will sell to',
    help: 'Two-letter codes separated by commas. Blank means anywhere, once selling outside India is on.',
    kind: 'text',
    default: '',
    live: false,
    waitingOn: 'a billing address at checkout, which arrives with the cart in Phase 8',
  },
  {
    key: 'commerce.priceRounding',
    group: 'commerce',
    label: 'Round converted prices to',
    help: 'A course at 7,000 rupees converts to an ugly number in dollars. This is what to round it to.',
    kind: 'select',
    default: 'NEAREST_10',
    options: [
      { value: 'EXACT', label: 'Nothing, show the exact conversion' },
      { value: 'NEAREST_10', label: 'The nearest ten' },
      { value: 'NEAREST_100', label: 'The nearest hundred' },
      { value: 'ENDING_99', label: 'The next number ending in 99' },
    ],
    live: false,
    waitingOn: 'live exchange rates, which are a Phase 7 integration',
  },
  {
    key: 'loyalty.engine',
    group: 'loyalty',
    label: 'Who runs the scheme',
    help:
      'Two engines must never both be crediting, or a learner earns twice for one purchase and the two ledgers disagree forever. Whichever is chosen, the separate platform is still told what happened through the outbound webhooks, so switching loses no history.',
    kind: 'select',
    default: 'built-in',
    options: [
      { value: 'built-in', label: 'The points and referrals built into this product' },
      { value: 'external', label: 'A separate loyalty platform' },
      { value: 'off', label: 'No scheme at all' },
    ],
    live: true,
    effect: (value) =>
      value === 'external'
        ? 'This product awards nothing and reports everything. Connect the platform on the Integrations screen, or nothing is listening.'
        : value === 'off'
          ? 'Nobody awards anything. Existing balances are left alone rather than cleared.'
          : 'The wallet in this product awards and redeems, which is what runs today.',
  },
  /* Attendance ---------------------------------------------------------------- */
  {
    key: 'attendance.lateAfterMinutes',
    group: 'attendance',
    label: 'Late after',
    help: 'A join this many minutes after the class starts is marked late rather than present. A program can set its own number.',
    kind: 'number',
    default: 10,
    min: 0,
    max: 120,
    unit: 'min',
    live: true,
    effect: (v) => `A learner joining ${Number(v) + 1} minutes after the start is late; at ${Number(v)} minutes they are on time.`,
  },
  {
    key: 'attendance.onlineAbsentAfterMinutes',
    group: 'attendance',
    label: 'Online no-show counts as absent after',
    help: 'Only for online classes the platform has confirmed started. A learner who has not joined by then is marked absent by the system and their parents are told. When the platform has said nothing, nobody is marked absent: the register shows "awaiting attendance data" instead.',
    kind: 'number',
    default: 20,
    min: 5,
    max: 180,
    unit: 'min',
    live: true,
  },
  {
    key: 'attendance.correctionDays',
    group: 'attendance',
    label: 'Teachers may correct a register for',
    help: 'After this many days a correction needs a Branch Head or Head Office. Every correction keeps the old value, the new one, who and why.',
    kind: 'number',
    default: 7,
    min: 0,
    max: 90,
    unit: 'days',
    live: true,
  },
  {
    key: 'attendance.parentAlerts',
    group: 'attendance',
    label: 'Tell parents at once when their child is absent or late',
    help: 'One message per child, class and status, sent the moment a register is confirmed or the platform reports it. Off means attendance still records and shows in the parent view, but nothing is sent.',
    kind: 'boolean',
    default: true,
    live: true,
  },

  /* Academics ----------------------------------------------------------------- */
  {
    key: 'academics.gateRemarks',
    group: 'academics',
    label: 'Teacher remarks and homework feedback wait for approval too',
    help: 'On, a remark or homework feedback reaches a parent only through a published mark sheet, the same gate as marks. Off, homework feedback shows to parents as soon as the teacher writes it; marks still wait.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'notices.push',
    group: 'notices',
    label: 'Push notices and alerts to parents\' phones',
    help: 'A parent who turns push on in their browser is told on the lock screen when a notice, an absence alert or a result arrives. The lock-screen text names the child and nothing else; the detail is inside. Off, the inbox still fills and messages still go by the channels set per event.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'notices.feeReminders',
    group: 'notices',
    label: 'Send fee reminders to parents',
    help: 'On the same schedule as the learner\'s reminders: three days before an instalment, the day after, a week after and a fortnight after. Off by default until management approves the schedule; the fees page always shows the next due either way.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'notices.teacherDownloads',
    group: 'notices',
    label: 'Teachers may download learner files to their phones',
    help: 'Off, a file on a mark sheet, a hand-in or a learner record opens in the browser for viewing and is served with a no-store header, so nothing stays in the phone\'s cache. On, the browser is allowed to save it.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'academics.notifyResults',
    group: 'academics',
    label: 'Tell parents when a result is published',
    help: 'One message per child and sheet, the moment the Branch Head publishes. Off, results still appear in the parent view without a message.',
    kind: 'boolean',
    default: true,
    live: true,
  },

  /* Messaging ----------------------------------------------------------------- */
  {
    key: 'messaging.quietFrom',
    group: 'messaging',
    label: 'Quiet hours start',
    help: 'Campaigns, automations and cart nudges queued after this time wait until the morning. Service messages (receipts, class reminders, sign-in codes) are not held. Leave blank for no quiet hours. In the academy\u2019s timezone, 24-hour clock.',
    kind: 'text',
    default: '21:00',
    placeholder: '21:00',
    live: true,
  },
  {
    key: 'messaging.quietTo',
    group: 'messaging',
    label: 'Quiet hours end',
    help: 'When held messages are released.',
    kind: 'text',
    default: '08:00',
    placeholder: '08:00',
    live: true,
  },

  /* The AI examiner ---------------------------------------------------------- */
  {
    key: 'ai.practiceEnabled',
    group: 'ai',
    label: 'Learners can practise writing and speaking with the AI examiner',
    help: 'Adds Practice to the learner portal, with tasks generated on demand and marked to the exam criteria. Needs the Anthropic key under Integrations; without it the page explains itself rather than failing.',
    kind: 'boolean',
    default: true,
    live: true,
    effect: (v) => (v ? 'Practice is on the learner portal.' : 'Practice is hidden.'),
  },
  {
    key: 'ai.practicePerDay',
    group: 'ai',
    label: 'Practice attempts per learner per day',
    help: 'Each attempt is a paid model call. A cap keeps one enthusiastic learner from spending the month\u2019s budget in an afternoon.',
    kind: 'number',
    default: 5,
    min: 1,
    max: 50,
    live: true,
    effect: (v) => `A learner can submit ${v} pieces a day.`,
  },
  {
    key: 'ai.autoMarkWriting',
    group: 'ai',
    label: 'Mark written answers on assessments automatically',
    help: 'Only on assessments with AI evaluation switched on. The mark counts as the result and the trainer can change it on the submissions page; the examiner\u2019s notes are kept beside it.',
    kind: 'boolean',
    default: true,
    live: true,
    effect: (v) => (v ? 'Written answers are marked within a minute of submission.' : 'Written answers wait for a trainer.'),
  },
  {
    key: 'ai.tutorEnabled',
    group: 'ai',
    label: 'The course tutor',
    help: 'A Tutor tab beside every lesson. It answers only from the course’s own transcripts and text, says which lesson and minute it took the answer from, and sends anything else to the trainer’s Q&A. Needs the Anthropic key.',
    kind: 'boolean',
    default: true,
    live: true,
  },
  {
    key: 'ai.tutorPerDay',
    group: 'ai',
    label: 'Tutor questions per learner per day',
    help: 'Each question reads the lesson and costs tokens. Thirty is a lot of asking; five is a taste.',
    kind: 'number',
    default: 30,
    min: 1,
    max: 200,
    live: true,
  },
  {
    key: 'ai.autoSummaries',
    group: 'ai',
    label: 'Write a summary and chapters for every new transcript',
    help: 'One call per lesson, when its captions arrive. Off means the summary is written by hand from the media library, Lesson tools.',
    kind: 'boolean',
    default: false,
    live: true,
  },
  {
    key: 'ai.model',
    group: 'ai',
    label: 'Model',
    help: 'The Anthropic model name. Sonnet is the sensible default: fast, and more than accurate enough to apply a rubric. Change it only when Anthropic retires the name.',
    kind: 'text',
    default: 'claude-sonnet-4-5',
    live: true,
  },

  /* The public site -------------------------------------------------------- */
  {
    key: 'website.googleRating',
    group: 'website',
    label: 'Your Google rating',
    help: 'Shown as a small badge on course cards and on the course page. Blank hides the badge entirely, which is the right answer until the number is real: a five star badge with nothing behind it is worse than no badge.',
    kind: 'text',
    default: '',
    placeholder: '4.8',
    live: true,
    effect: (v) => (String(v).trim() ? `Cards will show ${String(v).trim()} out of 5.` : 'No badge is shown.'),
  },
  {
    key: 'website.googleReviewCount',
    group: 'website',
    label: 'How many Google reviews that is from',
    help: 'The count beside the rating. The badge needs both, so a rating with no count is not shown.',
    kind: 'text',
    default: '',
    placeholder: '14593',
    live: true,
  },
  {
    key: 'website.heroEyebrow',
    group: 'website',
    label: 'A short line above the headline',
    help: 'For something time-bound: an intake opening, a launch. Blank hides it, which is the right answer most of the time.',
    kind: 'text',
    default: '',
    placeholder: 'January intake now open',
    live: true,
  },
  {
    key: 'website.heroTitle',
    group: 'website',
    label: 'Home page headline',
    help: 'The first thing a stranger reads. Say what they get, not what you are.',
    kind: 'text',
    default: 'Learn a language, clear the exam,',
    live: true,
  },
  {
    key: 'website.heroHighlight',
    group: 'website',
    label: 'The second line of the headline',
    help: 'Shown underneath in amber. Blank leaves the headline as one line.',
    kind: 'text',
    default: 'get to work.',
    live: true,
  },
  {
    key: 'website.heroBlurb',
    group: 'website',
    label: 'The sentence under the headline',
    help: 'Two lines at most. What the courses are and who they are for.',
    kind: 'text',
    multiline: true,
    default:
      'Structured courses with live classes, recorded lessons and practice you can schedule around a job. One place for your batch, your material and your progress.',
    live: true,
  },
  {
    key: 'website.heroImageAssetId',
    group: 'website',
    label: 'Home page photograph',
    help: 'Set from the Website settings screen rather than typed here. The hero works without one, so an academy setting up today is not left with a hole in the page.',
    kind: 'text',
    default: '',
    live: true,
  },
  {
    key: 'website.reviewBadgeHtml',
    group: 'website',
    label: 'Review badge embed, for the hero',
    help: 'The small badge or button version of your reviews widget. It sits in the hero on the home page, where a full slider would not fit, on a light chip so a badge that ships black text stays readable on the dark panel. Leave it blank to use the plain rating badge built from the two fields above, which costs no third-party script at all.',
    kind: 'text',
    multiline: true,
    default: '',
    placeholder: '<script defer async src="https://cdn.example.com/loader.js?..."></script>',
    live: true,
  },
  {
    key: 'website.reviewBadgeOnLight',
    group: 'website',
    label: 'That badge needs a white background',
    help: 'Reviews badges arrive with their own colours and only you know which one you picked. Most ship dark text, so the badge sits on a white chip by default. If it looks like stars with no numbers, its text is white: switch this off and it sits straight on the purple panel.',
    kind: 'boolean',
    default: true,
    live: true,
    effect: (value) =>
      value
        ? 'The badge sits on a white chip, which suits a badge that writes in dark text.'
        : 'The badge sits straight on the purple panel, which suits a badge that writes in white.',
  },
  {
    key: 'website.reviewWidgetHtml',
    group: 'website',
    label: 'Live reviews embed, for course pages',
    help: 'The full slider or grid version. It appears once on each course page, under the learner reviews. Scripts in it do run, so paste only what your provider gave you and nothing you were sent by anybody else.',
    kind: 'text',
    multiline: true,
    default: '',
    placeholder: '<div data-widget-id="..."></div><script src="https://cdn.example.com/widget.js" defer></script>',
    live: true,
  },

];

export function settingByKey(key: string): SettingDef | undefined {
  return SETTINGS.find((s) => s.key === key);
}

export function settingsInGroup(group: SettingGroupKey): SettingDef[] {
  return SETTINGS.filter((s) => s.group === group);
}

/** Free-text search over label, help and key, for the moment somebody knows the word but not the screen. */
export function searchSettings(query: string): SettingDef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return SETTINGS.filter((s) =>
    `${s.label} ${s.help} ${s.key} ${s.effect?.(s.default) ?? ''}`.toLowerCase().includes(needle),
  );
}
