import { merge, type CertificateDesign, type MergeValues } from '@/lib/certificate';

/**
 * The certificate itself, typeset once and used by the admin preview, the
 * learner's copy and the public verification page, so all three are the same
 * document rather than three drifting approximations of it.
 *
 * Print styles are on the page that renders it: A4 landscape, no chrome.
 */
export function Certificate({
  design,
  values,
  revoked = false,
}: {
  design: CertificateDesign;
  values: MergeValues;
  revoked?: boolean;
}) {
  return (
    <div
      className="relative mx-auto w-full max-w-3xl overflow-hidden bg-white text-[#111]"
      style={{ aspectRatio: '297 / 210' }}
    >
      <div
        aria-hidden
        className="absolute inset-3 border"
        style={{ borderColor: 'var(--brand)', opacity: 0.35 }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ background: 'var(--brand)' }}
      />

      {revoked && (
        <div
          aria-hidden
          className="absolute inset-0 grid place-items-center"
          style={{ transform: 'rotate(-18deg)' }}
        >
          <span className="text-[5rem] font-bold uppercase tracking-widest text-red-600/15">
            Withdrawn
          </span>
        </div>
      )}

      <div className="relative flex h-full flex-col items-center justify-center px-[8%] text-center">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-[#555]">
          {values.academy}
        </p>

        <h1
          className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ color: 'var(--brand)' }}
        >
          {design.headline}
        </h1>

        <p className="mt-6 max-w-xl text-sm leading-relaxed sm:text-base">
          {merge(design.body, values)}
        </p>

        <div className="mt-auto flex w-full items-end justify-between pb-[6%] pt-8 text-left">
          <div>
            <p className="text-[0.65rem] uppercase tracking-widest text-[#666]">Certificate no.</p>
            <p className="font-mono text-sm">{values.serial}</p>
          </div>

          {(design.signatoryName || design.signatoryRole) && (
            <div className="text-right">
              <div className="mb-1 ml-auto h-px w-40 bg-[#999]" />
              {design.signatoryName && (
                <p className="text-sm font-medium">{design.signatoryName}</p>
              )}
              {design.signatoryRole && (
                <p className="text-[0.7rem] uppercase tracking-widest text-[#666]">
                  {design.signatoryRole}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
