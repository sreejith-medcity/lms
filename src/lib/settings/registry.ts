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

  /* The player -------------------------------------------------------------- */
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
    key: 'auth.selfSignup',
    group: 'auth',
    label: 'Anybody may create an account',
    help: 'Off means only the office enrols people, and the sign-up page says so rather than failing at the end.',
    kind: 'boolean',
    default: true,
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
    key: 'website.reviewWidgetHtml',
    group: 'website',
    label: 'Live reviews embed',
    help: 'The snippet your review provider gives you, pasted whole. It appears once on each course page, under the learner reviews. Scripts in it do run, so paste only what your provider gave you and nothing you were sent by anybody else.',
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
