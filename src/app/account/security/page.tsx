import { redirect } from 'next/navigation';

/** The old address. The page now lives with the rest of the account. */
export default function SecurityRedirect() {
  redirect('/learn/account/security');
}
