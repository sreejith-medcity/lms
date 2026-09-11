/**
 * Every event this product can tell somebody about.
 *
 * Declared rather than discovered, so the matrix shows an event before anything
 * emits it and says so, instead of a row appearing the first time one fires and
 * an academy wondering why they were never asked.
 */

export interface NotificationEvent {
  key: string;
  label: string;
  who: string;
  /** False when nothing emits it yet. */
  live: boolean;
  waitingOn?: string;
}

export const NOTIFICATION_EVENTS: { group: string; events: NotificationEvent[] }[] = [
  {
    group: 'Classes',
    events: [
      { key: 'session.reminder', label: 'A class is coming up', who: 'Everyone on the roll', live: true },
      { key: 'session.absent', label: 'They missed a class', who: 'Whoever did not sign in', live: true },
      { key: 'session.cancelled', label: 'A class was called off', who: 'Everyone on the roll', live: true },
      { key: 'session.recording', label: 'A recording was published', who: 'The batch that sat it', live: false, waitingOn: 'the publish flow to emit it' },
    ],
  },
  {
    group: 'Money',
    events: [
      { key: 'payment.received', label: 'A payment went through', who: 'The learner who paid', live: true },
      { key: 'payment.failed', label: 'A payment failed', who: 'The learner who tried', live: false, waitingOn: 'the fulfilment path to emit it' },
      { key: 'instalment.due', label: 'An instalment is due', who: 'The learner who owes it', live: true },
      { key: 'cart.abandoned', label: 'They left a cart', who: 'The learner who left it', live: true },
    ],
  },
  {
    group: 'Learning',
    events: [
      { key: 'course.welcome', label: 'They were enrolled', who: 'The new learner', live: false, waitingOn: 'the enrolment path to emit it' },
      { key: 'course.completed', label: 'They finished a course', who: 'The learner', live: false, waitingOn: 'the completion path to emit it' },
      { key: 'certificate.issued', label: 'A certificate was issued', who: 'The learner', live: false, waitingOn: 'the certificate path to emit it' },
      { key: 'assessment.marked', label: 'Their paper was marked', who: 'The learner', live: false, waitingOn: 'the marking path to emit it' },
    ],
  },
  {
    group: 'Account',
    events: [
      { key: 'account.otp', label: 'A one-time code was asked for', who: 'Whoever asked for it', live: true },
      { key: 'account.two_factor', label: 'A sign-in code was asked for', who: 'The account holder', live: true },
      { key: 'account.welcome', label: 'They created an account', who: 'The new account', live: false, waitingOn: 'the signup path to emit it' },
      { key: 'account.password_reset', label: 'A password was reset', who: 'The account holder', live: false, waitingOn: 'the reset flow to emit it' },
      { key: 'announcement.published', label: 'An announcement went out', who: 'Its targets', live: false, waitingOn: 'the announcement path to emit it' },
    ],
  },
];

export const ALL_EVENTS = NOTIFICATION_EVENTS.flatMap((g) => g.events);

export const CHANNELS = [
  { key: 'email', label: 'Email', column: 'emailEnabled' as const },
  { key: 'sms', label: 'SMS', column: 'smsEnabled' as const },
  { key: 'whatsapp', label: 'WhatsApp', column: 'whatsappEnabled' as const },
  { key: 'push', label: 'Push', column: 'pushEnabled' as const },
] as const;
