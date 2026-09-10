'use server';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';

/**
 * Setting a password on an account that was created by a purchase.
 *
 * A guest checkout makes the account and signs them in once the money is
 * confirmed. That session is real but it is the only way in, so this is the
 * screen that turns it into an account they can come back to.
 *
 * It refuses an account that already has a password. Changing one is the
 * reset flow, which proves who is asking; this one proves nothing beyond
 * holding the session, which is exactly enough to set the first password and
 * not enough to replace an existing one.
 */
export async function setFirstPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await getSessionUser();
    if (!session) return { error: 'Please sign in again.' };

    const password = String(formData.get('password') ?? '');
    const again = String(formData.get('confirm') ?? '');

    if (password.length < 8) return { error: 'Use at least 8 characters.' };
    if (password.length > 200) return { error: 'That password is too long.' };
    if (password !== again) return { error: 'The two passwords do not match.' };

    const user = await db.user.findUnique({
      where: { id: session.id },
      select: { id: true, passwordHash: true, organizationId: true },
    });
    if (!user) return { error: 'Please sign in again.' };
    if (user.passwordHash) {
      return { error: 'This account already has a password. Use "forgot password" to change it.' };
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), mustResetPassword: false },
    });

    await recordAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'user.password_set',
      entity: 'User',
      entityId: user.id,
    });

    return { ok: true, message: 'Your password is set. You can sign in with it any time.' };
  } catch (err) {
    console.error('[account-claim]', err instanceof Error ? err.message : err);
    return { error: 'We could not set that just now. Please try again.' };
  }
}
