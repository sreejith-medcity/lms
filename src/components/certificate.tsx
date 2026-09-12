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
  const accent = design.accent || 'var(--brand)';
  return (
    <div
      className={`relative mx-auto w-full max-w-3xl overflow-hidden bg-white text-[#111] ${design.font === 'sans' ? 'font-sans' : 'font-serif'}`}
      style={{ aspectRatio: '297 / 210' }}
    >
      {design.backgroundAssetId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/assets/${design.backgroundAssetId}`} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      )}
      {design.showFrame && (
        <>
          <div aria-hidden className="absolute inset-3 border" style={{ borderColor: accent, opacity: 0.35 }} />
          <div aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: accent }} />
        </>
      )}

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
          style={{ color: accent }}
        >
          {design.headline}
        </h1>

        <p className="mt-6 max-w-xl text-sm leading-relaxed sm:text-base">
          {merge(design.body, values)}
        </p>

        <div className="mt-auto flex w-full items-end justify-between pb-[6%] pt-8 text-left">
          <div>
            {design.showSerial && (
              <>
                <p className="text-[0.65rem] uppercase tracking-widest text-[#666]">Certificate no.</p>
                <p className="font-mono text-sm">{values.serial}</p>
              </>
            )}
          </div>

          {(design.signatoryName || design.signatoryRole) && (
            <div className="text-right">
              {design.signatureAssetId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/assets/${design.signatureAssetId}`} alt="" className="ml-auto mb-1 h-10 w-auto max-w-40 object-contain" />
              )}
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
