import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { toCsv } from '@/lib/csv';
import { EXPORT_HEADER, exportRow } from '@/lib/question-import';

export const dynamic = 'force-dynamic';

/**
 * A bank as a CSV, in the same columns the importer reads. Exporting one
 * bank and importing it into another is how a second academy on this build
 * gets a starting set, and the file itself documents the import format.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant();
  const { id } = await params;

  let staff;
  try {
    staff = await requireStaff('question_bank.manage_questions', 'view');
  } catch {
    return new NextResponse('Not allowed', { status: 403 });
  }
  if (staff.organizationId !== tenant.organizationId) {
    return new NextResponse('Not allowed', { status: 403 });
  }

  const bank = await db.questionBank.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      name: true,
      questions: {
        orderBy: { id: 'asc' },
        select: {
          promptHtml: true,
          type: true,
          explanation: true,
          difficulty: true,
          marks: true,
          negativeMarks: true,
          tags: true,
          options: { orderBy: { sortOrder: 'asc' }, select: { label: true, isCorrect: true } },
        },
      },
    },
  });
  if (!bank) return new NextResponse('Not found', { status: 404 });

  const csv = toCsv([EXPORT_HEADER, ...bank.questions.map(exportRow)]);
  const slug = bank.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bank';

  return new NextResponse(`﻿${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}-questions.csv"`,
    },
  });
}
