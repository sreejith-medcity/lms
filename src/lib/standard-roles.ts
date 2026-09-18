/**
 * The roles every academy starts with. One list, read by the seed, by
 * tenant provisioning and by `ensureStandardRoles`, which adds any that an
 * older academy is missing without touching the ones it has: a role
 * somebody has already edited is theirs.
 *
 * Grants are prefixes over the permission catalogue. `excludes` wins over
 * `grants`. `viewOnly` gives view without edit; `all` gives delete too.
 */

export interface StandardRole {
  name: string;
  description: string;
  all: boolean;
  /** Only the batches they are assigned to today. */
  restrictBatch: boolean;
  /** Only the branches they are a member of. */
  restrictBranch: boolean;
  viewOnly?: boolean;
  grants: string[];
  excludes?: string[];
}

export const STANDARD_ROLES: StandardRole[] = [
  { name: 'Super Admin', description: 'Full access to every module', all: true, restrictBatch: false, restrictBranch: false, grants: [] },
  { name: 'Admin', description: 'Head Office: every module across every branch', all: true, restrictBatch: false, restrictBranch: false, grants: [] },
  {
    name: 'Instructor',
    description: 'Edits batches and curriculum; for sessions can sign in, remind and cancel',
    all: false,
    restrictBatch: true,
    restrictBranch: false,
    grants: ['batches.', 'module.', 'scheduling.sessions', 'submission.', 'class_recording.view_recordings', 'learner.learner_management'],
  },
  {
    name: 'Teacher',
    description: 'Keeps the register and enters marks for assigned batches, on a phone. Never sees fees.',
    all: false,
    restrictBatch: true,
    restrictBranch: false,
    grants: ['batches.batch_learners', 'batches.batch_progress', 'scheduling.sessions', 'scheduling.calendar', 'submission.', 'courses.assessments', 'class_recording.view_recordings', 'learner.learner_management'],
    excludes: ['learner.learner_export', 'learner.learner_impersonate'],
  },
  {
    name: 'Branch Head',
    description: 'Runs one branch: assignments, approvals, learners, fees and notices for that branch only',
    all: false,
    restrictBatch: false,
    restrictBranch: true,
    grants: ['dashboard.', 'scheduling.', 'batches.', 'announcements.', 'reports.', 'new_enrollment.', 'submission.', 'learner.', 'instructor.', 'class_recording.', 'sales.payments', 'sales.fee_tracking', 'sales.cheques', 'feedback_form.', 'certificates.issue_certificates', 'leads_and_enquiries.', 'analytics.'],
    excludes: ['learner.learner_impersonate'],
  },
  {
    name: 'Academic Manager',
    description: 'Academic reports for assigned branches. No fees, no approvals, no accounts.',
    all: false,
    restrictBatch: false,
    restrictBranch: true,
    viewOnly: true,
    grants: ['dashboard.view_dashboard', 'analytics.', 'reports.batch_reports', 'reports.trainer_reports', 'reports.feedback_reports', 'batches.batch_learners', 'batches.batch_progress', 'scheduling.calendar', 'feedback_form.view_responses'],
  },
];

export function roleGrants(def: StandardRole, key: string): { canView: boolean; canEdit: boolean; canDelete: boolean } | null {
  if (def.excludes?.some((e) => key.startsWith(e))) return null;
  const granted = def.all || def.grants.some((g) => key.startsWith(g));
  if (!granted) return null;
  return { canView: true, canEdit: !def.viewOnly, canDelete: def.all };
}
