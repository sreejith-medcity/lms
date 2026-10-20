import { readJson } from '@/lib/api/http';
import { answer, notStaff, tutorContext } from '@/lib/api/tutor-api';
import { addHours } from '@/lib/tutoring/tutor';

export const dynamic = 'force-dynamic';

/** POST /api/v1/teacher/tutoring/hours { weekdays: [0..6], from: "HH:MM", to: "HH:MM" }: hours the tutor can teach online. */
export async function POST(request: Request) {
  const ctx = await tutorContext(request);
  if (!ctx) return notStaff();
  const body = await readJson(request);
  const weekdays = Array.isArray(body?.weekdays) ? (body.weekdays as unknown[]).map((d) => Number(d)) : [];
  return answer(ctx.tenant, ctx.actor, await addHours(ctx.tenant, { ...ctx.actor, isOffice: false }, { weekdays, from: body?.from, to: body?.to }));
}
