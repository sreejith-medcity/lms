/**
 * The DNS an academy has to publish to send as itself, and how each
 * record is judged. Pure, so the judgement can be tested without a
 * resolver.
 */

export interface DnsRecord {
  kind: 'DKIM' | 'SPF' | 'DMARC';
  type: 'TXT';
  host: string;
  value: string;
  why: string;
}

export function domainProblem(raw: string): string | null {
  const d = raw.trim().toLowerCase();
  if (!d) return 'Enter the domain.';
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d)) return 'That is not a domain name. Something like academy.in, without http or a path.';
  return null;
}

export function localPartProblem(raw: string): string | null {
  const l = raw.trim().toLowerCase();
  if (!l) return 'What goes before the @: noreply, hello, office.';
  if (!/^[a-z0-9._-]{1,64}$/.test(l)) return 'Letters, digits, dots, hyphens and underscores only.';
  return null;
}

/** Strip a PEM public key down to the base64 body DKIM wants. */
export function dkimPublicValue(pem: string): string {
  return pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
}

export function dnsRecordsFor(domain: string, selector: string, publicKeyPem: string, spfInclude: string | null): DnsRecord[] {
  const records: DnsRecord[] = [
    {
      kind: 'DKIM',
      type: 'TXT',
      host: `${selector}._domainkey.${domain}`,
      value: `v=DKIM1; k=rsa; p=${dkimPublicValue(publicKeyPem)}`,
      why: 'Lets a receiving mail server check the signature on mail sent from here.',
    },
    {
      kind: 'SPF',
      type: 'TXT',
      host: domain,
      value: spfInclude ? `v=spf1 include:${spfInclude} ~all` : 'v=spf1 ~all',
      why: spfInclude ? 'Names the platform as allowed to send for the domain. Merge into an existing SPF record if there is one; a domain may only have one.' : 'The platform has no SPF include set (PLATFORM_SPF_INCLUDE). Ask the platform team which to add.',
    },
    {
      kind: 'DMARC',
      type: 'TXT',
      host: `_dmarc.${domain}`,
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
      why: 'Tells receivers what to do with mail that fails the other two; p=none only reports, which is the right start.',
    },
  ];
  return records;
}

export interface DnsCheck {
  dkimOk: boolean;
  spfOk: boolean;
  dmarcOk: boolean;
  note: string;
}

/** Judge what the resolver returned. TXT records arrive split into chunks; they are joined first. */
export function judgeDns(input: { dkim: string[][] | null; spf: string[][] | null; dmarc: string[][] | null }, publicKeyPem: string, spfInclude: string | null): DnsCheck {
  const join = (rows: string[][] | null) => (rows ?? []).map((chunks) => chunks.join(''));
  const wanted = dkimPublicValue(publicKeyPem);
  const dkimRows = join(input.dkim);
  const dkimOk = dkimRows.some((r) => /v=DKIM1/i.test(r) && r.replace(/\s+/g, '').includes(`p=${wanted}`));
  const spfRows = join(input.spf).filter((r) => /^v=spf1/i.test(r));
  const spfOk = spfRows.length > 0 && (spfInclude ? spfRows.some((r) => r.toLowerCase().includes(`include:${spfInclude.toLowerCase()}`)) : true);
  const dmarcOk = join(input.dmarc).some((r) => /^v=DMARC1/i.test(r));
  const notes: string[] = [];
  if (!dkimOk) notes.push(dkimRows.length ? 'The DKIM record is there but the key does not match.' : 'No DKIM record found yet.');
  if (!spfOk) notes.push(spfRows.length ? 'The SPF record does not include the platform.' : spfRows.length === 0 && (input.spf ?? []).length ? 'The SPF record does not start with v=spf1.' : 'No SPF record found yet.');
  if (!dmarcOk) notes.push('No DMARC record found yet (optional, but recommended).');
  return { dkimOk, spfOk, dmarcOk, note: notes.length ? notes.join(' ') : 'All three records resolve.' };
}

/** Verified once DKIM and SPF pass; DMARC is advice, not a gate. */
export function verified(check: Pick<DnsCheck, 'dkimOk' | 'spfOk'>): boolean {
  return check.dkimOk && check.spfOk;
}
