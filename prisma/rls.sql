-- Row-level security for the LMS. Written by `npm run rls:sql` from prisma/schema.prisma; do not edit by hand.
--
-- Apply after the app is running with DATABASE_RLS=1 (it sets app.scope on every query),
-- never before: with these policies on and no scope set, every table is empty.
--   npx prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma
-- Undo with prisma/rls-off.sql. Safe to apply again after a schema change.

CREATE OR REPLACE FUNCTION lms_scope_platform() RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT coalesce(current_setting('app.scope', true), '') = 'platform' $$;
CREATE OR REPLACE FUNCTION lms_scope_org() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT CASE WHEN coalesce(current_setting('app.scope', true), '') LIKE 'tenant:%' THEN substr(current_setting('app.scope', true), 8) END $$;

-- 111 tables that name the academy

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "branches";
CREATE POLICY lms_tenant ON "branches" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "org_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "org_settings";
CREATE POLICY lms_tenant ON "org_settings" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "policies";
CREATE POLICY lms_tenant ON "policies" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "feature_flags";
CREATE POLICY lms_tenant ON "feature_flags" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "users";
CREATE POLICY lms_tenant ON "users" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "parent_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "parent_sessions";
CREATE POLICY lms_tenant ON "parent_sessions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "help_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "help_tickets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "help_tickets";
CREATE POLICY lms_tenant ON "help_tickets" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "badge_awards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "badge_awards" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "badge_awards";
CREATE POLICY lms_tenant ON "badge_awards" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "learner_streaks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learner_streaks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "learner_streaks";
CREATE POLICY lms_tenant ON "learner_streaks" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "scorm_packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scorm_packages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "scorm_packages";
CREATE POLICY lms_tenant ON "scorm_packages" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "xapi_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "xapi_statements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "xapi_statements";
CREATE POLICY lms_tenant ON "xapi_statements" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "email_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_domains" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "email_domains";
CREATE POLICY lms_tenant ON "email_domains" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "api_tokens";
CREATE POLICY lms_tenant ON "api_tokens" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "device_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "device_tokens";
CREATE POLICY lms_tenant ON "device_tokens" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "roles";
CREATE POLICY lms_tenant ON "roles" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "instructor_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instructor_payouts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "instructor_payouts";
CREATE POLICY lms_tenant ON "instructor_payouts" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "custom_field_definitions";
CREATE POLICY lms_tenant ON "custom_field_definitions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "categories";
CREATE POLICY lms_tenant ON "categories" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "products";
CREATE POLICY lms_tenant ON "products" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "bundles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bundles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "bundles";
CREATE POLICY lms_tenant ON "bundles" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "product_addons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_addons" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "product_addons";
CREATE POLICY lms_tenant ON "product_addons" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "courses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "courses";
CREATE POLICY lms_tenant ON "courses" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "course_prerequisites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_prerequisites" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "course_prerequisites";
CREATE POLICY lms_tenant ON "course_prerequisites" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "mentor_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentor_availability" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "mentor_availability";
CREATE POLICY lms_tenant ON "mentor_availability" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "mentor_blackouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentor_blackouts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "mentor_blackouts";
CREATE POLICY lms_tenant ON "mentor_blackouts" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "one_to_one_credits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "one_to_one_credits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "one_to_one_credits";
CREATE POLICY lms_tenant ON "one_to_one_credits" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "modules";
CREATE POLICY lms_tenant ON "modules" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assets";
CREATE POLICY lms_tenant ON "assets" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "batches";
CREATE POLICY lms_tenant ON "batches" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "live_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "live_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "live_sessions";
CREATE POLICY lms_tenant ON "live_sessions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "flashcards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flashcards" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "flashcards";
CREATE POLICY lms_tenant ON "flashcards" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "report_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "report_schedules";
CREATE POLICY lms_tenant ON "report_schedules" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "report_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "report_runs";
CREATE POLICY lms_tenant ON "report_runs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "wishlists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wishlists" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "wishlists";
CREATE POLICY lms_tenant ON "wishlists" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "affiliates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "affiliates";
CREATE POLICY lms_tenant ON "affiliates" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "affiliate_sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_sales" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "affiliate_sales";
CREATE POLICY lms_tenant ON "affiliate_sales" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "data_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "data_requests";
CREATE POLICY lms_tenant ON "data_requests" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "lesson_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson_questions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "lesson_questions";
CREATE POLICY lms_tenant ON "lesson_questions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "attendance_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_changes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "attendance_changes";
CREATE POLICY lms_tenant ON "attendance_changes" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "parent_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "parent_notifications";
CREATE POLICY lms_tenant ON "parent_notifications" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "parent_device_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_device_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "parent_device_tokens";
CREATE POLICY lms_tenant ON "parent_device_tokens" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "parent_push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_push_subscriptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "parent_push_subscriptions";
CREATE POLICY lms_tenant ON "parent_push_subscriptions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "recording_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recording_shares" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "recording_shares";
CREATE POLICY lms_tenant ON "recording_shares" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrollments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "enrollments";
CREATE POLICY lms_tenant ON "enrollments" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "question_banks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "question_banks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "question_banks";
CREATE POLICY lms_tenant ON "question_banks" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessments";
CREATE POLICY lms_tenant ON "assessments" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "assessment_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_grants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessment_grants";
CREATE POLICY lms_tenant ON "assessment_grants" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "assessment_pools" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_pools" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessment_pools";
CREATE POLICY lms_tenant ON "assessment_pools" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "assessment_pool_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_pool_grants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessment_pool_grants";
CREATE POLICY lms_tenant ON "assessment_pool_grants" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "practice_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "practice_attempts";
CREATE POLICY lms_tenant ON "practice_attempts" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "partner_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_results" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "partner_results";
CREATE POLICY lms_tenant ON "partner_results" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "exam_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_sets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "exam_sets";
CREATE POLICY lms_tenant ON "exam_sets" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "exam_sittings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_sittings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "exam_sittings";
CREATE POLICY lms_tenant ON "exam_sittings" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "exam_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_submissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "exam_submissions";
CREATE POLICY lms_tenant ON "exam_submissions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "exam_allowances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_allowances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "exam_allowances";
CREATE POLICY lms_tenant ON "exam_allowances" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "exam_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "exam_assignments";
CREATE POLICY lms_tenant ON "exam_assignments" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "test_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_packs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "test_packs";
CREATE POLICY lms_tenant ON "test_packs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "grade_scales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grade_scales" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "grade_scales";
CREATE POLICY lms_tenant ON "grade_scales" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "programs";
CREATE POLICY lms_tenant ON "programs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "parent_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_links" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "parent_links";
CREATE POLICY lms_tenant ON "parent_links" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "notices";
CREATE POLICY lms_tenant ON "notices" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assignments";
CREATE POLICY lms_tenant ON "assignments" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "assignment_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_submissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assignment_submissions";
CREATE POLICY lms_tenant ON "assignment_submissions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "mark_sheets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark_sheets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "mark_sheets";
CREATE POLICY lms_tenant ON "mark_sheets" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "report_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_cards" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "report_cards";
CREATE POLICY lms_tenant ON "report_cards" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "certificate_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certificate_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "certificate_templates";
CREATE POLICY lms_tenant ON "certificate_templates" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "pricing_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricing_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "pricing_templates";
CREATE POLICY lms_tenant ON "pricing_templates" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "carts";
CREATE POLICY lms_tenant ON "carts" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "orders";
CREATE POLICY lms_tenant ON "orders" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "fee_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_types" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "fee_types";
CREATE POLICY lms_tenant ON "fee_types" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "misc_fees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "misc_fees" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "misc_fees";
CREATE POLICY lms_tenant ON "misc_fees" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "payments";
CREATE POLICY lms_tenant ON "payments" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "settlements";
CREATE POLICY lms_tenant ON "settlements" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "tax_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "tax_configs";
CREATE POLICY lms_tenant ON "tax_configs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "promo_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_codes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "promo_codes";
CREATE POLICY lms_tenant ON "promo_codes" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "loyalty_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "loyalty_configs";
CREATE POLICY lms_tenant ON "loyalty_configs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "pass_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pass_plans" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "pass_plans";
CREATE POLICY lms_tenant ON "pass_plans" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "prepaid_passes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prepaid_passes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "prepaid_passes";
CREATE POLICY lms_tenant ON "prepaid_passes" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "stamp_schemes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stamp_schemes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "stamp_schemes";
CREATE POLICY lms_tenant ON "stamp_schemes" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "stamp_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stamp_cards" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "stamp_cards";
CREATE POLICY lms_tenant ON "stamp_cards" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "vouchers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vouchers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "vouchers";
CREATE POLICY lms_tenant ON "vouchers" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "achievements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "achievements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "achievements";
CREATE POLICY lms_tenant ON "achievements" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "leads";
CREATE POLICY lms_tenant ON "leads" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "announcements";
CREATE POLICY lms_tenant ON "announcements" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "feedback_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_forms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "feedback_forms";
CREATE POLICY lms_tenant ON "feedback_forms" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "testimonials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "testimonials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "testimonials";
CREATE POLICY lms_tenant ON "testimonials" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "communities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communities" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "communities";
CREATE POLICY lms_tenant ON "communities" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "segments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "segments";
CREATE POLICY lms_tenant ON "segments" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "message_templates";
CREATE POLICY lms_tenant ON "message_templates" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "campaigns";
CREATE POLICY lms_tenant ON "campaigns" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflows" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "workflows";
CREATE POLICY lms_tenant ON "workflows" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "workflow_runs";
CREATE POLICY lms_tenant ON "workflow_runs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "notification_settings";
CREATE POLICY lms_tenant ON "notification_settings" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "push_subscriptions";
CREATE POLICY lms_tenant ON "push_subscriptions" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "notification_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "notification_logs";
CREATE POLICY lms_tenant ON "notification_logs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "banners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banners" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "banners";
CREATE POLICY lms_tenant ON "banners" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "storefront_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storefront_pages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "storefront_pages";
CREATE POLICY lms_tenant ON "storefront_pages" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blog_posts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "blog_posts";
CREATE POLICY lms_tenant ON "blog_posts" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "navigation_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "navigation_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "navigation_items";
CREATE POLICY lms_tenant ON "navigation_items" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "redirects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "redirects" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "redirects";
CREATE POLICY lms_tenant ON "redirects" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "ai_agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_agents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "ai_agents";
CREATE POLICY lms_tenant ON "ai_agents" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "content_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_embeddings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "content_embeddings";
CREATE POLICY lms_tenant ON "content_embeddings" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "ai_usage";
CREATE POLICY lms_tenant ON "ai_usage" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "integrations";
CREATE POLICY lms_tenant ON "integrations" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "integration_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "integration_events";
CREATE POLICY lms_tenant ON "integration_events" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "utility_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "utility_wallets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "utility_wallets";
CREATE POLICY lms_tenant ON "utility_wallets" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "provider_events";
CREATE POLICY lms_tenant ON "provider_events" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "gateway_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gateway_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "gateway_events";
CREATE POLICY lms_tenant ON "gateway_events" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "webhooks";
CREATE POLICY lms_tenant ON "webhooks" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "audit_logs";
CREATE POLICY lms_tenant ON "audit_logs" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

ALTER TABLE "storage_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_usage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "storage_usage";
CREATE POLICY lms_tenant ON "storage_usage" USING (lms_scope_platform() OR "organizationId" = lms_scope_org()) WITH CHECK (lms_scope_platform() OR "organizationId" = lms_scope_org());

-- 77 tables that belong to a row in one of those

-- auth_accounts.userId -> users
ALTER TABLE "auth_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_accounts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "auth_accounts";
CREATE POLICY lms_tenant ON "auth_accounts" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "auth_accounts"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "auth_accounts"."userId"));

-- auth_sessions.userId -> users
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "auth_sessions";
CREATE POLICY lms_tenant ON "auth_sessions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "auth_sessions"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "auth_sessions"."userId"));

-- help_messages.ticketId -> help_tickets
ALTER TABLE "help_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "help_messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "help_messages";
CREATE POLICY lms_tenant ON "help_messages" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "help_tickets" p WHERE p."id" = "help_messages"."ticketId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "help_tickets" p WHERE p."id" = "help_messages"."ticketId"));

-- scorm_attempts.packageId -> scorm_packages
ALTER TABLE "scorm_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scorm_attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "scorm_attempts";
CREATE POLICY lms_tenant ON "scorm_attempts" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "scorm_packages" p WHERE p."id" = "scorm_attempts"."packageId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "scorm_packages" p WHERE p."id" = "scorm_attempts"."packageId"));

-- otp_tokens.userId -> users
ALTER TABLE "otp_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otp_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "otp_tokens";
CREATE POLICY lms_tenant ON "otp_tokens" USING (lms_scope_platform() OR "otp_tokens"."userId" IS NULL OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "otp_tokens"."userId")) WITH CHECK (lms_scope_platform() OR "otp_tokens"."userId" IS NULL OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "otp_tokens"."userId"));

-- role_permissions.roleId -> roles
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "role_permissions";
CREATE POLICY lms_tenant ON "role_permissions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "roles" p WHERE p."id" = "role_permissions"."roleId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "roles" p WHERE p."id" = "role_permissions"."roleId"));

-- user_roles.userId -> users
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "user_roles";
CREATE POLICY lms_tenant ON "user_roles" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "user_roles"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "user_roles"."userId"));

-- branch_memberships.userId -> users
ALTER TABLE "branch_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_memberships" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "branch_memberships";
CREATE POLICY lms_tenant ON "branch_memberships" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "branch_memberships"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "branch_memberships"."userId"));

-- learner_profiles.userId -> users
ALTER TABLE "learner_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learner_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "learner_profiles";
CREATE POLICY lms_tenant ON "learner_profiles" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "learner_profiles"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "learner_profiles"."userId"));

-- instructor_profiles.userId -> users
ALTER TABLE "instructor_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instructor_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "instructor_profiles";
CREATE POLICY lms_tenant ON "instructor_profiles" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "instructor_profiles"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "instructor_profiles"."userId"));

-- custom_field_values.definitionId -> custom_field_definitions
ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "custom_field_values";
CREATE POLICY lms_tenant ON "custom_field_values" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "custom_field_definitions" p WHERE p."id" = "custom_field_values"."definitionId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "custom_field_definitions" p WHERE p."id" = "custom_field_values"."definitionId"));

-- bundle_items.bundleId -> bundles
ALTER TABLE "bundle_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bundle_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "bundle_items";
CREATE POLICY lms_tenant ON "bundle_items" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "bundles" p WHERE p."id" = "bundle_items"."bundleId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "bundles" p WHERE p."id" = "bundle_items"."bundleId"));

-- course_categories.courseId -> courses
ALTER TABLE "course_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_categories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "course_categories";
CREATE POLICY lms_tenant ON "course_categories" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "course_categories"."courseId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "course_categories"."courseId"));

-- events.productId -> products
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "events";
CREATE POLICY lms_tenant ON "events" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "events"."productId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "events"."productId"));

-- memberships.productId -> products
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "memberships";
CREATE POLICY lms_tenant ON "memberships" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "memberships"."productId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "memberships"."productId"));

-- membership_courses.courseId -> courses
ALTER TABLE "membership_courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_courses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "membership_courses";
CREATE POLICY lms_tenant ON "membership_courses" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "membership_courses"."courseId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "membership_courses"."courseId"));

-- mentorships.productId -> products
ALTER TABLE "mentorships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentorships" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "mentorships";
CREATE POLICY lms_tenant ON "mentorships" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "mentorships"."productId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "mentorships"."productId"));

-- mentorship_mentors.mentorshipId -> mentorships (2 links to the academy)
ALTER TABLE "mentorship_mentors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentorship_mentors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "mentorship_mentors";
CREATE POLICY lms_tenant ON "mentorship_mentors" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "mentorships" p WHERE p."id" = "mentorship_mentors"."mentorshipId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "mentorships" p WHERE p."id" = "mentorship_mentors"."mentorshipId"));

-- course_modules.courseId -> courses
ALTER TABLE "course_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_modules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "course_modules";
CREATE POLICY lms_tenant ON "course_modules" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "course_modules"."courseId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "course_modules"."courseId"));

-- sections.moduleId -> modules
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "sections";
CREATE POLICY lms_tenant ON "sections" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "modules" p WHERE p."id" = "sections"."moduleId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "modules" p WHERE p."id" = "sections"."moduleId"));

-- materials.sectionId -> sections (2 links to the academy)
ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "materials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "materials";
CREATE POLICY lms_tenant ON "materials" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "sections" p WHERE p."id" = "materials"."sectionId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "sections" p WHERE p."id" = "materials"."sectionId"));

-- material_progress.userId -> users
ALTER TABLE "material_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_progress" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "material_progress";
CREATE POLICY lms_tenant ON "material_progress" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "material_progress"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "material_progress"."userId"));

-- drip_rules.courseId -> courses
ALTER TABLE "drip_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drip_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "drip_rules";
CREATE POLICY lms_tenant ON "drip_rules" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "drip_rules"."courseId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "courses" p WHERE p."id" = "drip_rules"."courseId"));

-- batch_modules.batchId -> batches
ALTER TABLE "batch_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_modules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "batch_modules";
CREATE POLICY lms_tenant ON "batch_modules" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "batches" p WHERE p."id" = "batch_modules"."batchId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "batches" p WHERE p."id" = "batch_modules"."batchId"));

-- batch_staff.batchId -> batches
ALTER TABLE "batch_staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_staff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "batch_staff";
CREATE POLICY lms_tenant ON "batch_staff" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "batches" p WHERE p."id" = "batch_staff"."batchId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "batches" p WHERE p."id" = "batch_staff"."batchId"));

-- session_instructors.sessionId -> live_sessions
ALTER TABLE "session_instructors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_instructors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "session_instructors";
CREATE POLICY lms_tenant ON "session_instructors" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "live_sessions" p WHERE p."id" = "session_instructors"."sessionId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "live_sessions" p WHERE p."id" = "session_instructors"."sessionId"));

-- flashcard_reviews.cardId -> flashcards
ALTER TABLE "flashcard_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flashcard_reviews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "flashcard_reviews";
CREATE POLICY lms_tenant ON "flashcard_reviews" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "flashcards" p WHERE p."id" = "flashcard_reviews"."cardId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "flashcards" p WHERE p."id" = "flashcard_reviews"."cardId"));

-- affiliate_clicks.affiliateId -> affiliates
ALTER TABLE "affiliate_clicks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_clicks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "affiliate_clicks";
CREATE POLICY lms_tenant ON "affiliate_clicks" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "affiliates" p WHERE p."id" = "affiliate_clicks"."affiliateId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "affiliates" p WHERE p."id" = "affiliate_clicks"."affiliateId"));

-- learner_notes.userId -> users
ALTER TABLE "learner_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learner_notes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "learner_notes";
CREATE POLICY lms_tenant ON "learner_notes" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "learner_notes"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "learner_notes"."userId"));

-- attendances.sessionId -> live_sessions
ALTER TABLE "attendances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "attendances";
CREATE POLICY lms_tenant ON "attendances" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "live_sessions" p WHERE p."id" = "attendances"."sessionId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "live_sessions" p WHERE p."id" = "attendances"."sessionId"));

-- recordings.sessionId -> live_sessions
ALTER TABLE "recordings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recordings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "recordings";
CREATE POLICY lms_tenant ON "recordings" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "live_sessions" p WHERE p."id" = "recordings"."sessionId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "live_sessions" p WHERE p."id" = "recordings"."sessionId"));

-- transcripts.assetId -> assets
ALTER TABLE "transcripts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transcripts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "transcripts";
CREATE POLICY lms_tenant ON "transcripts" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assets" p WHERE p."id" = "transcripts"."assetId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assets" p WHERE p."id" = "transcripts"."assetId"));

-- questions.bankId -> question_banks
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "questions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "questions";
CREATE POLICY lms_tenant ON "questions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "question_banks" p WHERE p."id" = "questions"."bankId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "question_banks" p WHERE p."id" = "questions"."bankId"));

-- question_options.questionId -> questions (2 links to the academy)
ALTER TABLE "question_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "question_options" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "question_options";
CREATE POLICY lms_tenant ON "question_options" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "questions" p WHERE p."id" = "question_options"."questionId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "questions" p WHERE p."id" = "question_options"."questionId"));

-- assessment_pool_items.poolId -> assessment_pools
ALTER TABLE "assessment_pool_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_pool_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessment_pool_items";
CREATE POLICY lms_tenant ON "assessment_pool_items" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessment_pools" p WHERE p."id" = "assessment_pool_items"."poolId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessment_pools" p WHERE p."id" = "assessment_pool_items"."poolId"));

-- assessment_sections.assessmentId -> assessments
ALTER TABLE "assessment_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_sections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessment_sections";
CREATE POLICY lms_tenant ON "assessment_sections" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "assessment_sections"."assessmentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "assessment_sections"."assessmentId"));

-- assessment_questions.assessmentId -> assessments
ALTER TABLE "assessment_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_questions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessment_questions";
CREATE POLICY lms_tenant ON "assessment_questions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "assessment_questions"."assessmentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "assessment_questions"."assessmentId"));

-- assessment_courses.assessmentId -> assessments
ALTER TABLE "assessment_courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_courses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assessment_courses";
CREATE POLICY lms_tenant ON "assessment_courses" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "assessment_courses"."assessmentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "assessment_courses"."assessmentId"));

-- exam_blocks.setId -> exam_sets
ALTER TABLE "exam_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_blocks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "exam_blocks";
CREATE POLICY lms_tenant ON "exam_blocks" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "exam_sets" p WHERE p."id" = "exam_blocks"."setId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "exam_sets" p WHERE p."id" = "exam_blocks"."setId"));

-- exam_audio.assetId -> assets
ALTER TABLE "exam_audio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_audio" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "exam_audio";
CREATE POLICY lms_tenant ON "exam_audio" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assets" p WHERE p."id" = "exam_audio"."assetId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assets" p WHERE p."id" = "exam_audio"."assetId"));

-- attempts.assessmentId -> assessments
ALTER TABLE "attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "attempts";
CREATE POLICY lms_tenant ON "attempts" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "attempts"."assessmentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assessments" p WHERE p."id" = "attempts"."assessmentId"));

-- answers.attemptId -> attempts (2 links to the academy)
ALTER TABLE "answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "answers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "answers";
CREATE POLICY lms_tenant ON "answers" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "attempts" p WHERE p."id" = "answers"."attemptId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "attempts" p WHERE p."id" = "answers"."attemptId"));

-- submissions.userId -> users
ALTER TABLE "submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "submissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "submissions";
CREATE POLICY lms_tenant ON "submissions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "submissions"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "submissions"."userId"));

-- assignment_attachments.assignmentId -> assignments
ALTER TABLE "assignment_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_attachments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assignment_attachments";
CREATE POLICY lms_tenant ON "assignment_attachments" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assignments" p WHERE p."id" = "assignment_attachments"."assignmentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assignments" p WHERE p."id" = "assignment_attachments"."assignmentId"));

-- mark_sheet_entries.sheetId -> mark_sheets
ALTER TABLE "mark_sheet_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark_sheet_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "mark_sheet_entries";
CREATE POLICY lms_tenant ON "mark_sheet_entries" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "mark_sheets" p WHERE p."id" = "mark_sheet_entries"."sheetId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "mark_sheets" p WHERE p."id" = "mark_sheet_entries"."sheetId"));

-- assignment_files.submissionId -> assignment_submissions
ALTER TABLE "assignment_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_files" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "assignment_files";
CREATE POLICY lms_tenant ON "assignment_files" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assignment_submissions" p WHERE p."id" = "assignment_files"."submissionId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "assignment_submissions" p WHERE p."id" = "assignment_files"."submissionId"));

-- issued_certificates.templateId -> certificate_templates
ALTER TABLE "issued_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "issued_certificates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "issued_certificates";
CREATE POLICY lms_tenant ON "issued_certificates" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "certificate_templates" p WHERE p."id" = "issued_certificates"."templateId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "certificate_templates" p WHERE p."id" = "issued_certificates"."templateId"));

-- pricing_plans.productId -> products
ALTER TABLE "pricing_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricing_plans" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "pricing_plans";
CREATE POLICY lms_tenant ON "pricing_plans" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "pricing_plans"."productId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "pricing_plans"."productId"));

-- cart_items.cartId -> carts
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "cart_items";
CREATE POLICY lms_tenant ON "cart_items" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "carts" p WHERE p."id" = "cart_items"."cartId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "carts" p WHERE p."id" = "cart_items"."cartId"));

-- order_items.orderId -> orders
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "order_items";
CREATE POLICY lms_tenant ON "order_items" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "orders" p WHERE p."id" = "order_items"."orderId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "orders" p WHERE p."id" = "order_items"."orderId"));

-- instalments.enrollmentId -> enrollments
ALTER TABLE "instalments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instalments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "instalments";
CREATE POLICY lms_tenant ON "instalments" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "enrollments" p WHERE p."id" = "instalments"."enrollmentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "enrollments" p WHERE p."id" = "instalments"."enrollmentId"));

-- refunds.paymentId -> payments
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "refunds";
CREATE POLICY lms_tenant ON "refunds" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "payments" p WHERE p."id" = "refunds"."paymentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "payments" p WHERE p."id" = "refunds"."paymentId"));

-- cheques.paymentId -> payments
ALTER TABLE "cheques" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cheques" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "cheques";
CREATE POLICY lms_tenant ON "cheques" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "payments" p WHERE p."id" = "cheques"."paymentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "payments" p WHERE p."id" = "cheques"."paymentId"));

-- invoices.orderId -> orders
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "invoices";
CREATE POLICY lms_tenant ON "invoices" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "orders" p WHERE p."id" = "invoices"."orderId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "orders" p WHERE p."id" = "invoices"."orderId"));

-- promo_code_products.promoCodeId -> promo_codes
ALTER TABLE "promo_code_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_code_products" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "promo_code_products";
CREATE POLICY lms_tenant ON "promo_code_products" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "promo_codes" p WHERE p."id" = "promo_code_products"."promoCodeId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "promo_codes" p WHERE p."id" = "promo_code_products"."promoCodeId"));

-- promo_redemptions.promoCodeId -> promo_codes
ALTER TABLE "promo_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_redemptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "promo_redemptions";
CREATE POLICY lms_tenant ON "promo_redemptions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "promo_codes" p WHERE p."id" = "promo_redemptions"."promoCodeId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "promo_codes" p WHERE p."id" = "promo_redemptions"."promoCodeId"));

-- wallet_accounts.userId -> users
ALTER TABLE "wallet_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_accounts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "wallet_accounts";
CREATE POLICY lms_tenant ON "wallet_accounts" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "wallet_accounts"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "wallet_accounts"."userId"));

-- wallet_transactions.walletId -> wallet_accounts (2 links to the academy)
ALTER TABLE "wallet_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_transactions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "wallet_transactions";
CREATE POLICY lms_tenant ON "wallet_transactions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "wallet_accounts" p WHERE p."id" = "wallet_transactions"."walletId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "wallet_accounts" p WHERE p."id" = "wallet_transactions"."walletId"));

-- pass_uses.passId -> prepaid_passes
ALTER TABLE "pass_uses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pass_uses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "pass_uses";
CREATE POLICY lms_tenant ON "pass_uses" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "prepaid_passes" p WHERE p."id" = "pass_uses"."passId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "prepaid_passes" p WHERE p."id" = "pass_uses"."passId"));

-- stamps.cardId -> stamp_cards
ALTER TABLE "stamps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stamps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "stamps";
CREATE POLICY lms_tenant ON "stamps" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "stamp_cards" p WHERE p."id" = "stamps"."cardId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "stamp_cards" p WHERE p."id" = "stamps"."cardId"));

-- achievement_awards.achievementId -> achievements
ALTER TABLE "achievement_awards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "achievement_awards" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "achievement_awards";
CREATE POLICY lms_tenant ON "achievement_awards" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "achievements" p WHERE p."id" = "achievement_awards"."achievementId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "achievements" p WHERE p."id" = "achievement_awards"."achievementId"));

-- referral_codes.userId -> users
ALTER TABLE "referral_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_codes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "referral_codes";
CREATE POLICY lms_tenant ON "referral_codes" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "referral_codes"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "referral_codes"."userId"));

-- referrals.referrerId -> users
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "referrals";
CREATE POLICY lms_tenant ON "referrals" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "referrals"."referrerId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "referrals"."referrerId"));

-- follow_ups.leadId -> leads
ALTER TABLE "follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_ups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "follow_ups";
CREATE POLICY lms_tenant ON "follow_ups" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "leads" p WHERE p."id" = "follow_ups"."leadId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "leads" p WHERE p."id" = "follow_ups"."leadId"));

-- lead_activities.leadId -> leads
ALTER TABLE "lead_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_activities" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "lead_activities";
CREATE POLICY lms_tenant ON "lead_activities" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "leads" p WHERE p."id" = "lead_activities"."leadId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "leads" p WHERE p."id" = "lead_activities"."leadId"));

-- announcement_targets.announcementId -> announcements
ALTER TABLE "announcement_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcement_targets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "announcement_targets";
CREATE POLICY lms_tenant ON "announcement_targets" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "announcements" p WHERE p."id" = "announcement_targets"."announcementId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "announcements" p WHERE p."id" = "announcement_targets"."announcementId"));

-- feedback_responses.formId -> feedback_forms
ALTER TABLE "feedback_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_responses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "feedback_responses";
CREATE POLICY lms_tenant ON "feedback_responses" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "feedback_forms" p WHERE p."id" = "feedback_responses"."formId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "feedback_forms" p WHERE p."id" = "feedback_responses"."formId"));

-- community_posts.communityId -> communities
ALTER TABLE "community_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_posts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "community_posts";
CREATE POLICY lms_tenant ON "community_posts" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "communities" p WHERE p."id" = "community_posts"."communityId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "communities" p WHERE p."id" = "community_posts"."communityId"));

-- community_comments.authorId -> users
ALTER TABLE "community_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_comments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "community_comments";
CREATE POLICY lms_tenant ON "community_comments" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "community_comments"."authorId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "community_comments"."authorId"));

-- campaign_recipients.campaignId -> campaigns
ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipients" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "campaign_recipients";
CREATE POLICY lms_tenant ON "campaign_recipients" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "campaigns" p WHERE p."id" = "campaign_recipients"."campaignId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "campaigns" p WHERE p."id" = "campaign_recipients"."campaignId"));

-- workflow_steps.workflowId -> workflows
ALTER TABLE "workflow_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_steps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "workflow_steps";
CREATE POLICY lms_tenant ON "workflow_steps" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "workflows" p WHERE p."id" = "workflow_steps"."workflowId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "workflows" p WHERE p."id" = "workflow_steps"."workflowId"));

-- ai_conversations.agentId -> ai_agents
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "ai_conversations";
CREATE POLICY lms_tenant ON "ai_conversations" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "ai_agents" p WHERE p."id" = "ai_conversations"."agentId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "ai_agents" p WHERE p."id" = "ai_conversations"."agentId"));

-- ai_messages.conversationId -> ai_conversations (2 links to the academy)
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "ai_messages";
CREATE POLICY lms_tenant ON "ai_messages" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "ai_conversations" p WHERE p."id" = "ai_messages"."conversationId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "ai_conversations" p WHERE p."id" = "ai_messages"."conversationId"));

-- skill_mastery.userId -> users
ALTER TABLE "skill_mastery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_mastery" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "skill_mastery";
CREATE POLICY lms_tenant ON "skill_mastery" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "skill_mastery"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "skill_mastery"."userId"));

-- study_plan_items.userId -> users
ALTER TABLE "study_plan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "study_plan_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "study_plan_items";
CREATE POLICY lms_tenant ON "study_plan_items" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "study_plan_items"."userId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "users" p WHERE p."id" = "study_plan_items"."userId"));

-- utility_transactions.walletId -> utility_wallets
ALTER TABLE "utility_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "utility_transactions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "utility_transactions";
CREATE POLICY lms_tenant ON "utility_transactions" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "utility_wallets" p WHERE p."id" = "utility_transactions"."walletId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "utility_wallets" p WHERE p."id" = "utility_transactions"."walletId"));

-- webhook_deliveries.webhookId -> webhooks
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_tenant ON "webhook_deliveries";
CREATE POLICY lms_tenant ON "webhook_deliveries" USING (lms_scope_platform() OR EXISTS (SELECT 1 FROM "webhooks" p WHERE p."id" = "webhook_deliveries"."webhookId")) WITH CHECK (lms_scope_platform() OR EXISTS (SELECT 1 FROM "webhooks" p WHERE p."id" = "webhook_deliveries"."webhookId"));

-- Left open, nothing of one academy's in them: organizations, permissions, session_recurrences, scheduled_jobs, migration_records, tenants, tenant_domains, plans, plan_limits, plan_features, tenant_entitlements, tenant_subscriptions, tenant_invoices, usage_records, platform_users, impersonation_logs, provisioning_jobs, support_tickets
