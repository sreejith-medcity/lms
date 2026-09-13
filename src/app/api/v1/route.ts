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
    ],
    shape: '{ ok: true, data } or { ok: false, error: { code, message } }. Money in paise. Times in ISO 8601 UTC.',
  });
}
