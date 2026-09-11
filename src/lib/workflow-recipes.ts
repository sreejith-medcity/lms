/**
 * Starting points. An empty automations page is a blank page, and a blank
 * page is where people decide the feature is for someone else. Each recipe
 * is a complete automation an academy would actually run; the editor opens
 * with it filled in and nothing is saved until they say so.
 */

export interface RecipeStep {
  actionType: string;
  delayMinutes: number;
  config: Record<string, unknown>;
}

export interface Recipe {
  key: string;
  name: string;
  triggerType: string;
  blurb: string;
  description: string;
  runOnce: boolean;
  steps: RecipeStep[];
}

export const RECIPES: Recipe[] = [
  {
    key: 'welcome',
    name: 'Welcome sequence',
    triggerType: 'enrolment.created',
    blurb: 'A note on day one, a check-in on day three, a nudge on day seven if they have not started.',
    description: 'Runs once per learner when they are enrolled in any course.',
    runOnce: true,
    steps: [
      { actionType: 'SEND_MESSAGE', delayMinutes: 0, config: { channel: 'EMAIL', subject: 'Welcome to {{item}}', body: 'Hello {{name}}, welcome to {{item}} at {{organization}}. Your course is ready at {{url}}. Start with the first lesson today; the first week is where habits are made.' } },
      { actionType: 'SEND_MESSAGE', delayMinutes: 3 * 1440, config: { channel: 'EMAIL', subject: 'How is {{item}} going?', body: 'Hello {{name}}, three days in. If anything in {{item}} is unclear, reply to this and a trainer will get back to you.' } },
      { actionType: 'CONDITION', delayMinutes: 4 * 1440, config: { condition: 'INACTIVE_FOR', days: 5 } },
      { actionType: 'ADD_TAG', delayMinutes: 0, config: { tag: 'slow start' } },
      { actionType: 'FOLLOW_UP', delayMinutes: 0, config: { followUpChannel: 'CALL', daysFromNow: 1, note: 'Enrolled a week ago and has not started. Call and ask what is in the way.' } },
    ],
  },
  {
    key: 'abandoned-cart',
    name: 'Abandoned cart recovery',
    triggerType: 'cart.abandoned',
    blurb: 'A reminder an hour after the cart goes quiet, and a second one the next day.',
    description: 'Runs once per cart. Stops on its own if they buy, because the cart is no longer abandoned.',
    runOnce: false,
    steps: [
      { actionType: 'SEND_MESSAGE', delayMinutes: 60, config: { channel: 'EMAIL', subject: 'Your seat is still open', body: 'Hello {{name}}, you left a course in your cart. It is still there at {{url}}, and the batch dates have not changed. Any question, reply to this.' } },
      { actionType: 'CONDITION', delayMinutes: 1440, config: { condition: 'HAS_PAID' } },
      { actionType: 'ADD_TAG', delayMinutes: 0, config: { tag: 'came back' } },
    ],
  },
  {
    key: 'gone-quiet',
    name: 'Gone quiet',
    triggerType: 'learner.inactive',
    blurb: 'Fourteen days without a lesson or a class: a message, then a call if that changes nothing.',
    description: 'Looked for hourly. Runs once per learner per course per month.',
    runOnce: false,
    steps: [
      { actionType: 'SEND_MESSAGE', delayMinutes: 0, config: { channel: 'EMAIL', subject: 'We have kept your place in {{item}}', body: 'Hello {{name}}, it has been a couple of weeks since you were last in {{item}}. Your progress is saved exactly where you left it: {{url}}. Twenty minutes today is enough to get back into it.' } },
      { actionType: 'CONDITION', delayMinutes: 3 * 1440, config: { condition: 'INACTIVE_FOR', days: 3 } },
      { actionType: 'ADD_TAG', delayMinutes: 0, config: { tag: 'at risk' } },
      { actionType: 'FOLLOW_UP', delayMinutes: 0, config: { followUpChannel: 'CALL', daysFromNow: 0, note: 'Quiet for over two weeks and did not respond to the nudge. Worth a call.' } },
    ],
  },
  {
    key: 'failed-mock',
    name: 'Failed a mock test',
    triggerType: 'assessment.marked',
    blurb: 'When a paper comes back below the pass mark, a counsellor gets a follow-up the same day.',
    description: 'Runs on every failed paper, not once per learner: each one is worth a conversation.',
    runOnce: false,
    steps: [
      { actionType: 'SEND_MESSAGE', delayMinutes: 0, config: { channel: 'EMAIL', subject: 'Your {{item}} result', body: 'Hello {{name}}, your paper for {{item}} has been marked: {{score}}. Not the mark you wanted, and not the last word. Your trainer will go through it with you; the feedback is at {{url}}.' } },
      { actionType: 'FOLLOW_UP', delayMinutes: 0, config: { followUpChannel: 'CALL', daysFromNow: 0, note: 'Failed a mock. Go through the feedback with them and agree a plan.' } },
    ],
  },
  {
    key: 'finished',
    name: 'Finished a course',
    triggerType: 'course.completed',
    blurb: 'Points for finishing, and a word about what comes next.',
    description: 'Runs once per completed enrolment.',
    runOnce: false,
    steps: [
      { actionType: 'ADD_POINTS', delayMinutes: 0, config: { points: 200, note: 'For finishing a course' } },
      { actionType: 'SEND_MESSAGE', delayMinutes: 0, config: { channel: 'EMAIL', subject: 'You finished {{item}}', body: 'Hello {{name}}, you have finished {{item}}. 200 credit points are in your wallet towards whatever you take on next. Have a look at what follows on from this one at {{organization}}.' } },
    ],
  },
  {
    key: 'overdue',
    name: 'Overdue instalment',
    triggerType: 'instalment.overdue',
    blurb: 'The reminders already go out on their own; this adds a call for the office once it is a week late.',
    description: 'Runs once per instalment.',
    runOnce: false,
    steps: [
      { actionType: 'ADD_TAG', delayMinutes: 0, config: { tag: 'fees overdue' } },
      { actionType: 'FOLLOW_UP', delayMinutes: 6 * 1440, config: { followUpChannel: 'CALL', daysFromNow: 0, note: 'An instalment is a week overdue. Call about it before the next reminder goes out.' } },
    ],
  },
];

export const recipeFor = (key: string | null | undefined) => RECIPES.find((r) => r.key === key) ?? null;
