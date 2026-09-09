/**
 * The stages an enquiry moves through.
 *
 * Out of the actions module because everything exported from a `'use server'`
 * file is published as a callable endpoint, and a list of strings should not be
 * one.
 */
export const STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_BOOKED',
  'NEGOTIATION',
  'WON',
  'LOST',
  'SUPPORT',
] as const;

export type LeadStage = (typeof STAGES)[number];
