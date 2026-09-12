/**
 * How much of a profile is filled in, as a number the learner can see and
 * the office can sort by. Each item counts once; the custom fields the
 * academy marked as required count too, so "complete" means what the
 * academy meant by it, not what the schema happens to have columns for.
 */
export function profileCompletion(input: {
  name: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  profile: { occupation?: string | null; area?: string | null; residentialAddress?: string | null; parentPhone?: string | null } | null;
  requiredCustom: { value: unknown }[];
}): number {
  const filled = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined);
  const items: boolean[] = [
    filled(input.name),
    filled(input.email),
    filled(input.phone),
    filled(input.avatarUrl),
    filled(input.dateOfBirth),
    filled(input.gender),
    filled(input.profile?.occupation),
    filled(input.profile?.area),
    filled(input.profile?.residentialAddress),
    ...input.requiredCustom.map((f) => filled(f.value)),
  ];
  return Math.round((items.filter(Boolean).length / items.length) * 100);
}
