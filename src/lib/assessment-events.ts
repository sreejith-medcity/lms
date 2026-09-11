import { happened, notifyLearner } from '@/lib/events';

/**
 * A marked paper, said once, whoever marked it: the trainer on the
 * submissions screen or the AI examiner a minute after hand-in. The
 * learner gets their note, and the automations get the outcome, so a
 * "failed the mock, book a call" rule has something to run on.
 */
export async function announceMarked(input: {
  organizationId: string;
  attemptId: string;
  userId: string;
  assessmentId: string;
  title: string;
  scorePercent: number;
  passed: boolean;
}): Promise<void> {
  await happened({
    organizationId: input.organizationId,
    key: 'assessment.marked',
    userId: input.userId,
    subjectId: input.attemptId,
    data: { attemptId: input.attemptId, assessmentId: input.assessmentId, item: input.title, scorePercent: input.scorePercent, passed: input.passed },
  });
  await notifyLearner({
    organizationId: input.organizationId,
    eventKey: 'assessment.marked',
    userId: input.userId,
    subjectId: input.attemptId,
    context: { item: input.title, score: `${input.scorePercent}%`, url: `/learn/assessment/${input.assessmentId}` },
  });
}
