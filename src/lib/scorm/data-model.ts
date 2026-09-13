/**
 * The bit of the SCORM data model that decides anything: whether the
 * lesson is done, the score, and what to keep for next time. Both
 * versions' keys map onto one small record.
 */

export interface AttemptSummary {
  lessonStatus: string;
  scoreRaw: number | null;
  scoreMax: number | null;
  scoreMin: number | null;
  suspendData: string | null;
  location: string | null;
  totalSeconds: number;
  /** Done, for the course's progress: completed or passed. */
  done: boolean;
}

export type Cmi = Record<string, string>;

const STATUSES = new Set(['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted']);

function num(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "PT1H2M3.5S" (2004) or "0001:02:03.50" (1.2) to seconds. */
export function parseDuration(v: string | undefined): number {
  if (!v) return 0;
  const iso = v.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso) return Math.floor((Number(iso[1] ?? 0) * 86400) + Number(iso[2] ?? 0) * 3600 + Number(iso[3] ?? 0) * 60 + Number(iso[4] ?? 0));
  const clock = v.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (clock) return Math.floor(Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]));
  return 0;
}

export function formatDuration12(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(4, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.00`;
}

export function formatDuration2004(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `PT${h}H${m}M${s}S`;
}

export function summarise(standard: string, cmi: Cmi, masteryScore: number | null, previousTotal = 0, sessionSeconds = 0): AttemptSummary {
  const is12 = standard === 'SCORM_1_2';
  let lessonStatus: string;
  let scoreRaw: number | null;
  let scoreMax: number | null;
  let scoreMin: number | null;
  let suspendData: string | null;
  let location: string | null;
  let sessionTime: number;
  if (is12) {
    lessonStatus = cmi['cmi.core.lesson_status'] ?? 'not attempted';
    scoreRaw = num(cmi['cmi.core.score.raw']);
    scoreMax = num(cmi['cmi.core.score.max']);
    scoreMin = num(cmi['cmi.core.score.min']);
    suspendData = cmi['cmi.suspend_data'] ?? null;
    location = cmi['cmi.core.lesson_location'] ?? null;
    sessionTime = parseDuration(cmi['cmi.core.session_time']);
  } else {
    const completion = cmi['cmi.completion_status'] ?? 'unknown';
    const success = cmi['cmi.success_status'] ?? 'unknown';
    lessonStatus = success === 'passed' ? 'passed' : success === 'failed' ? 'failed' : completion === 'completed' ? 'completed' : completion === 'incomplete' ? 'incomplete' : 'not attempted';
    scoreRaw = num(cmi['cmi.score.raw']);
    scoreMax = num(cmi['cmi.score.max']);
    scoreMin = num(cmi['cmi.score.min']);
    const scaled = num(cmi['cmi.score.scaled']);
    if (scoreRaw === null && scaled !== null) {
      scoreRaw = Math.round(scaled * 100);
      scoreMax = scoreMax ?? 100;
    }
    suspendData = cmi['cmi.suspend_data'] ?? null;
    location = cmi['cmi.location'] ?? null;
    sessionTime = parseDuration(cmi['cmi.session_time']);
  }
  if (!STATUSES.has(lessonStatus)) lessonStatus = 'incomplete';

  // 1.2 packages that only report a score leave the LMS to judge it against the mastery score.
  if (is12 && masteryScore !== null && scoreRaw !== null && (lessonStatus === 'completed' || lessonStatus === 'incomplete')) {
    const pct = scoreMax && scoreMax > 0 ? (scoreRaw / scoreMax) * 100 : scoreRaw;
    lessonStatus = pct >= masteryScore ? 'passed' : lessonStatus === 'completed' ? 'failed' : lessonStatus;
  }
  const totalSeconds = previousTotal + (sessionTime || sessionSeconds);
  return { lessonStatus, scoreRaw, scoreMax, scoreMin, suspendData, location, totalSeconds, done: lessonStatus === 'completed' || lessonStatus === 'passed' };
}

/** What the package reads on launch: the saved values plus the learner and the mode. */
export function initialCmi(standard: string, input: { learnerId: string; learnerName: string; saved: Cmi | null; lessonStatus: string; suspendData: string | null; location: string | null; totalSeconds: number; masteryScore: number | null; scoreRaw: number | null }): Cmi {
  const saved = input.saved ?? {};
  if (standard === 'SCORM_1_2') {
    return {
      ...saved,
      'cmi.core.student_id': input.learnerId,
      'cmi.core.student_name': input.learnerName,
      'cmi.core.lesson_status': input.lessonStatus === 'not attempted' ? 'not attempted' : input.lessonStatus,
      'cmi.core.entry': input.lessonStatus === 'not attempted' ? 'ab-initio' : input.suspendData ? 'resume' : '',
      'cmi.core.lesson_location': input.location ?? '',
      'cmi.core.lesson_mode': 'normal',
      'cmi.core.credit': 'credit',
      'cmi.core.total_time': formatDuration12(input.totalSeconds),
      'cmi.core.score.raw': input.scoreRaw === null ? '' : String(input.scoreRaw),
      'cmi.suspend_data': input.suspendData ?? '',
      'cmi.launch_data': '',
      'cmi.student_data.mastery_score': input.masteryScore === null ? '' : String(input.masteryScore),
      'cmi.core.session_time': '00:00:00',
    };
  }
  return {
    ...saved,
    'cmi.learner_id': input.learnerId,
    'cmi.learner_name': input.learnerName,
    'cmi.completion_status': input.lessonStatus === 'completed' || input.lessonStatus === 'passed' ? 'completed' : input.lessonStatus === 'not attempted' ? 'not attempted' : 'incomplete',
    'cmi.success_status': input.lessonStatus === 'passed' ? 'passed' : input.lessonStatus === 'failed' ? 'failed' : 'unknown',
    'cmi.entry': input.lessonStatus === 'not attempted' ? 'ab-initio' : input.suspendData ? 'resume' : '',
    'cmi.location': input.location ?? '',
    'cmi.mode': 'normal',
    'cmi.credit': 'credit',
    'cmi.total_time': formatDuration2004(input.totalSeconds),
    'cmi.suspend_data': input.suspendData ?? '',
    'cmi.launch_data': '',
    'cmi.session_time': 'PT0S',
    'cmi.scaled_passing_score': input.masteryScore === null ? '' : String(input.masteryScore / 100),
    'cmi.score.raw': input.scoreRaw === null ? '' : String(input.scoreRaw),
  };
}

/** The verbs in a statement that mean the activity is done. */
export const XAPI_DONE_VERBS = new Set(['http://adlnet.gov/expapi/verbs/completed', 'http://adlnet.gov/expapi/verbs/passed', 'http://adlnet.gov/expapi/verbs/mastered']);
export const XAPI_FAILED_VERB = 'http://adlnet.gov/expapi/verbs/failed';
