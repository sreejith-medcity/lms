import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { checkFile } from '@/lib/exams/import';
import { importContent } from '@/lib/exams/content-admin';
import { TEST_PERMS } from '@/lib/exams/perms';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * A file of exam content, read and (unless only checked) written. A route
 * rather than a server action because the telc export is nearly two
 * megabytes and a server action's body stops at one.
 */
export async function POST(request: Request) {
  const tenant = await requireTenant();
  let staff;
  try {
    staff = await requireStaff(TEST_PERMS.content, 'edit');
  } catch {
    return NextResponse.json({ error: 'You do not have permission to do that.' }, { status: 403 });
  }
  if (staff.organizationId !== tenant.organizationId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  /* Only from our own pages: a form on another site cannot post here with the admin's cookie. */
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let sameSite = false;
  try {
    sameSite = Boolean(origin && host && new URL(origin).host === host);
  } catch {
    sameSite = false;
  }
  if (!sameSite) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is larger than 20 MB.' }, { status: 400 });
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return NextResponse.json({ error: 'That is not a JSON file.' }, { status: 400 });
  }

  const { parsed, ...check } = checkFile(json);
  if (form?.get('dryRun') === '1' || !parsed.length) return NextResponse.json({ check });

  const report = await importContent(tenant.organizationId, staff.id, parsed);
  await recordAudit({
    organizationId: tenant.organizationId,
    actorId: staff.id,
    action: 'tests.imported',
    entity: 'ExamSet',
    after: { file: file.name, formats: report.formats.map((f) => `${f.formatCode}: ${f.created} new, ${f.updated} updated`) },
  });
  return NextResponse.json({ check, report });
}
