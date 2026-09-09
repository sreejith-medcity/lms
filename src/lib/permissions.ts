/**
 * The permission catalogue. 30 groups, mirroring what the Edmingle role builder
 * exposes, each item flagged for view / edit / delete.
 */
export const PERMISSION_GROUPS = {
  analytics: ['manage_course_analytics', 'manage_analytics', 'learner_analytics', 'test_analytics'],
  feedback_form: ['manage_forms', 'view_responses'],
  dashboard: ['view_dashboard', 'view_revenue_widgets'],
  scheduling: ['sessions', 'events', 'calendar', 'mark_holiday', 'session_licenses'],
  courses: ['course_management', 'pricing_and_publish', 'events', 'assessments'],
  batches: ['batch_management', 'batch_learners', 'batch_progress', 'batch_staff'],
  announcements: ['manage_announcements'],
  reports: ['sales_reports', 'batch_reports', 'feedback_reports', 'trainer_reports', 'notification_logs'],
  new_enrollment: ['single', 'bulk', 'learner_registration', 'advanced_bulk'],
  question_bank: ['manage_banks', 'manage_questions'],
  module: ['module_library', 'sections', 'materials', 'drip'],
  class_recording: ['view_recordings', 'download_recordings', 'publish_recordings'],
  category: ['manage_categories'],
  submission: ['view_submissions', 'evaluate_submissions'],
  learner: ['learner_management', 'learner_export', 'learner_impersonate'],
  instructor: ['instructor_management'],
  membership: ['manage_memberships'],
  banner: ['manage_banners'],
  settings: ['organization', 'branches', 'taxes', 'custom_fields', 'preferences', 'notifications', 'integrations', 'roles'],
  certificates: ['manage_templates', 'issue_certificates', 'revoke_certificates'],
  promocode: ['manage_promocodes', 'view_redemptions'],
  email: ['manage_templates', 'send_campaigns'],
  discussions: ['moderate_discussions'],
  blogs: ['manage_blogs'],
  testimonials: ['manage_testimonials'],
  leads_and_enquiries: ['manage_leads', 'manage_followups', 'import_leads'],
  marketing: ['campaigns', 'workflows', 'segments'],
  sales: ['payments', 'settlements', 'fee_tracking', 'cheques', 'refunds', 'abandoned_cart'],
  community: ['manage_communities', 'moderate_posts'],
  asset_library: ['manage_assets', 'upload_assets', 'delete_assets'],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;

export function permissionKey(group: PermissionGroup, item: string) {
  return `${group}.${item}`;
}

export function allPermissionKeys(): { group: string; key: string; label: string }[] {
  return Object.entries(PERMISSION_GROUPS).flatMap(([group, items]) =>
    (items as readonly string[]).map((item) => ({
      group,
      key: `${group}.${item}`,
      label: `${titleize(group)}: ${titleize(item)}`,
    })),
  );
}

function titleize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type Action = 'view' | 'edit' | 'delete';

export interface PermissionSet {
  [key: string]: { view: boolean; edit: boolean; delete: boolean };
}

export function can(perms: PermissionSet, key: string, action: Action): boolean {
  const entry = perms[key];
  if (!entry) return false;
  return entry[action];
}
