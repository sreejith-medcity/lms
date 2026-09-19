import { ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** The map of the API, for whoever is holding the app's source. */
export async function GET() {
  return ok({
    version: 1,
    auth: 'Bearer <accessToken> from POST /api/v1/auth/login, /auth/code/request + /auth/code/verify; refresh with POST /auth/refresh; sign out with POST /auth/logout; open a web page signed in with POST /auth/web.',
    endpoints: [
      'GET /api/v1/tenant',
      'GET /api/v1/me',
      'PATCH /api/v1/me { locale?, timezone? }',
      'GET /api/v1/courses',
      'GET /api/v1/courses/:productId',
      'GET /api/v1/lessons/:materialId',
      'POST /api/v1/lessons/:materialId/progress { positionSeconds?, durationSeconds?, complete? }',
      'GET /api/v1/classes?days=14',
      'POST /api/v1/classes/:id/join',
      'GET /api/v1/calendar?from=YYYY-MM-DD&days=7',
      'GET /api/v1/fees',
      'GET /api/v1/notifications',
      'POST /api/v1/notifications/read { id? }',
      'POST /api/v1/push { platform, token }',
      'DELETE /api/v1/push { token }',
      'GET /api/v1/badges',
      'GET /api/v1/help',
      'POST /api/v1/help { subject, body, category?, enrollmentId? }',
      'GET /api/v1/help/:id',
      'POST /api/v1/help/:id { body }',
      'GET /api/v1/teacher/desk',
      'GET /api/v1/teacher/register/:sessionId',
      'POST /api/v1/teacher/register/:sessionId { marks: [{ userId, status }] }',
      'POST /api/v1/teacher/register/:sessionId/correct { userId, status, reason }',
      'POST /api/v1/parent/code/request { contact }',
      'POST /api/v1/parent/code/verify { contact, code, device? }',
      'POST /api/v1/parent/refresh { refreshToken }',
      'POST /api/v1/parent/logout { refreshToken }',
      'GET /api/v1/parent/children',
      'GET /api/v1/parent/children/:childId',
      'GET /api/v1/parent/children/:childId/fees',
      'GET /api/v1/parent/children/:childId/progress?enrollmentId=',
      'GET /api/v1/parent/notices',
      'POST /api/v1/parent/notices/read { id? }',
      'GET /api/v1/parent/notices/:id',
      'POST /api/v1/parent/web { path }',
    ],
    parents: 'A parent signs in with a code to the contact on the child\'s record; the refresh token is the same parent session the web view uses, so "sign out everywhere" covers the phone. Send the bearer token plus x-parent-session: <sessionId>.',
    staff: 'A teacher signs in like a learner (POST /auth/login) and gets the teacher endpoints with the same scope as the web admin.',
    shape: '{ ok: true, data } or { ok: false, error: { code, message } }. Money in paise. Times in ISO 8601 UTC.',
  });
}
