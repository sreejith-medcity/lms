import { generateKeyPairSync } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { db } from '@/lib/db';
import { open, seal } from '@/lib/secrets';
import { judgeDns, verified, type DnsCheck } from './email-domain-rules';

/**
 * The academy's own sending domain: the keypair minted here, the DNS
 * checked here, and the From (plus a DKIM signature for SMTP) applied to
 * every email once it verifies.
 */

export function spfInclude(): string | null {
  return process.env.PLATFORM_SPF_INCLUDE?.trim() || null;
}

export function mintDkimKeys(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { publicKeyPem: publicKey as string, privateKeyPem: privateKey as string };
}

async function txt(host: string): Promise<string[][] | null> {
  try {
    return await resolveTxt(host);
  } catch {
    return null;
  }
}

export async function checkDomainDns(organizationId: string): Promise<DnsCheck | null> {
  const row = await db.emailDomain.findUnique({ where: { organizationId }, select: { id: true, domain: true, dkimSelector: true, dkimPublicKey: true } });
  if (!row) return null;
  const [dkim, spf, dmarc] = await Promise.all([txt(`${row.dkimSelector}._domainkey.${row.domain}`), txt(row.domain), txt(`_dmarc.${row.domain}`)]);
  const check = judgeDns({ dkim, spf, dmarc }, row.dkimPublicKey, spfInclude());
  const ok = verified(check);
  await db.emailDomain.update({
    where: { id: row.id },
    data: { spfOk: check.spfOk, dkimOk: check.dkimOk, dmarcOk: check.dmarcOk, lastCheckedAt: new Date(), lastCheckNote: check.note, status: ok ? 'VERIFIED' : 'PENDING', verifiedAt: ok ? new Date() : null },
  });
  return check;
}

export interface SendingIdentity {
  fromEmail: string;
  fromName: string | null;
  dkim: { domainName: string; keySelector: string; privateKey: string } | null;
}

/** What outgoing email should say it is from, once the domain has verified; null means the provider's own. */
export async function sendingIdentity(organizationId: string): Promise<SendingIdentity | null> {
  const row = await db.emailDomain.findUnique({ where: { organizationId, status: 'VERIFIED' }, select: { domain: true, fromLocal: true, fromName: true, dkimSelector: true, dkimPrivateKey: true } });
  if (!row) return null;
  const privateKey = open(row.dkimPrivateKey);
  return {
    fromEmail: `${row.fromLocal}@${row.domain}`,
    fromName: row.fromName,
    dkim: privateKey ? { domainName: row.domain, keySelector: row.dkimSelector, privateKey } : null,
  };
}

export function sealPrivateKey(pem: string): string {
  return seal(pem);
}
