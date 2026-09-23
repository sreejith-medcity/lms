import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { ExamError, storeRecording } from '@/lib/exams/sittings';

export const dynamic = 'force-dynamic';

/** A speaking task's recording, sent by the player the moment it stops. */
export async function POST(request: Request, { params }: { params: Promise<{ sittingId: string }> }) {
  const { sittingId } = await params;
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant || !user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const blockId = String(form?.get('task') ?? '');
  const seconds = Number(form?.get('seconds') ?? 0) || 0;
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: 'The recording was empty.' }, { status: 400 });
  try {
    await storeRecording({
      organizationId: tenant.organizationId,
      userId: user.id,
      userName: user.name,
      sittingId,
      blockId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: (file.type || 'audio/webm').split(';')[0],
      seconds,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof ExamError ? err.message : 'The recording did not arrive. Try once more.';
    if (!(err instanceof ExamError)) console.error('[tests] recording', err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
