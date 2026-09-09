import { currentImpersonation } from '@/lib/impersonation';
import { StopImpersonating } from '@/components/impersonation-stop';

/**
 * Impossible to miss, on purpose.
 *
 * Somebody looking at a learner's account should never be in any doubt that
 * they are, and neither should anybody glancing at the screen over their
 * shoulder.
 */
export async function ImpersonationBanner({ learnerName }: { learnerName: string }) {
  const impersonation = await currentImpersonation();
  if (!impersonation) return null;

  return (
    <div className="sticky top-0 z-50 bg-[var(--warn)] text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-2">
        <p className="text-sm font-medium">
          You are looking at {learnerName}&apos;s account as {impersonation.staffName}. Nothing you
          do here is theirs.
        </p>
        <StopImpersonating />
      </div>
    </div>
  );
}
