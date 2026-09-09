import { notFound, redirect } from 'next/navigation';
import { ensureCourseCommunity } from '@/server/community';

export const dynamic = 'force-dynamic';

/**
 * The door to a course's discussion.
 *
 * The room is made on the way through rather than created with every course,
 * because a wall of empty rooms is worse than none. Entitlement is checked
 * inside `ensureCourseCommunity`, so this page cannot be used to conjure a room
 * for a course somebody is not on.
 */
export default async function CourseDiscussion({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const result = await ensureCourseCommunity(productId);

  if (!result.ok || !result.id) notFound();
  redirect(`/learn/community/${result.id}`);
}
