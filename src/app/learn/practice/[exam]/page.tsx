import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { anthropicReady } from '@/lib/anthropic';
import { practiceAllowance } from '@/lib/ai-practice';
import { settingBool } from '@/lib/settings/store';
import { presetFor } from '@/lib/ai-evaluation';
import { Workspace } from './workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ exam: string }> }) {
  const { exam } = await params;
  return { title: presetFor(exam)?.label ?? 'Practice' };
}

export default async function PracticeExamPage({ params }: { params: Promise<{ exam: string }> }) {
  const { exam } = await params;
  const preset = presetFor(exam);
  if (!preset) notFound();

  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const [enabled, ready, allowance] = await Promise.all([
    settingBool(tenant.organizationId, 'ai.practiceEnabled'),
    anthropicReady(tenant.organizationId),
    practiceAllowance(tenant.organizationId, user.id),
  ]);
  if (!enabled) notFound();

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <Link href="/learn/practice" className="t-small faint hover:underline">
        Practice
      </Link>
      <h1 className="mt-1 text-xl font-semibold">{preset.label}</h1>
      <p className="t-small faint mt-1">{preset.blurb}</p>

      <div className="mt-6">
        <Workspace
          preset={{
            key: preset.key,
            kind: preset.kind,
            label: preset.label,
            length: preset.length,
            language: preset.language,
            criteria: preset.criteria.map((c) => c.name),
          }}
          ready={ready}
          left={Math.max(0, allowance.limit - allowance.used)}
        />
      </div>
    </div>
  );
}
