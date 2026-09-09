/** All money is paise. Never store rupees as floats. */
export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => paise / 100;

export function formatMoney(paise: number, currency = 'INR', locale = 'en-IN') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

export interface TaxInput {
  amountPaise: number;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  interState: boolean;
  pricesAreExclusive: boolean;
}

export interface TaxBreakup {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/** Mirrors the GST-exclusive setup found in the Edmingle account. */
export function computeTax(input: TaxInput): TaxBreakup {
  const rate = input.interState
    ? input.igstPercent
    : input.cgstPercent + input.sgstPercent;

  const taxablePaise = input.pricesAreExclusive
    ? input.amountPaise
    : Math.round((input.amountPaise * 100) / (100 + rate));

  const taxPaise = Math.round((taxablePaise * rate) / 100);

  return {
    taxablePaise,
    cgstPaise: input.interState ? 0 : Math.round((taxablePaise * input.cgstPercent) / 100),
    sgstPaise: input.interState ? 0 : Math.round((taxablePaise * input.sgstPercent) / 100),
    igstPaise: input.interState ? taxPaise : 0,
    totalPaise: taxablePaise + taxPaise,
  };
}
