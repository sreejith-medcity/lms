import { formatBySlug } from '@/lib/exams/registry';
import { rememberNextPath } from '@/lib/next-path';
import { redirectResponse } from '@/lib/http-headers';

/**
 * From a test page to the door and back: the page is remembered, and after
 * signing up or in, the visitor lands on it again, ready to start.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const format = formatBySlug(slug);
  if (!format) return redirectResponse('/tests');
  await rememberNextPath(`/tests/${format.slug}`);
  return redirectResponse(new URL(request.url).searchParams.get('login') ? '/login' : '/signup');
}
