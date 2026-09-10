'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { extractBlocks } from '@/lib/import-page';
import { parseBlockSource, toBlockSource } from '@/lib/block-source';
import { parseBlocks, type Block } from '@/lib/page-blocks';
import { fetchImageAsAsset } from '@/lib/remote-image';
import { storageConfigured } from '@/lib/storage';
import { normalisePath } from '@/lib/redirects';
import type { ActionState } from '@/server/courses';

/**
 * Course landing pages: the marketing pages from the old store, living here.
 *
 * The pages a campaign points at are the most valuable URLs the academy owns
 * and the ones with the most words on them. On the old site they also had no
 * way to buy anything, which is the part being fixed: the content lands on
 * the course page, at the address it was always sold from, above a purchase
 * card that works.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('blogs.manage_blogs', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[landing]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const shape = z.object({
  courseId: z.string().min(1, 'Pick the course this page belongs to'),
  slug: z
    .string()
    .trim()
    .min(2, 'The address needs at least two characters')
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  title: z.string().trim().min(2, 'Give the page a title').max(160),
  seoTitle: z.string().trim().max(70).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(180).optional().or(z.literal('')),
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

/** Addresses the app answers on already. A page here would never be reached. */
const RESERVED = new Set([
  'about', 'admin', 'api', 'blog', 'cart', 'checkout', 'contact', 'course', 'courses',
  'help', 'learn', 'login', 'logout', 'policies', 'sample', 'signup', 'sitemap.xml',
]);

export async function saveLandingPage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = shape.safeParse({
      courseId: formData.get('courseId'),
      slug: String(formData.get('slug') ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, ''),
      title: formData.get('title'),
      seoTitle: formData.get('seoTitle') || '',
      seoDescription: formData.get('seoDescription') || '',
      status: formData.get('status') || 'DRAFT',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    if (RESERVED.has(d.slug)) {
      return { error: `/${d.slug} is already a page in the app. Pick another address.` };
    }

    const course = await db.course.findFirst({
      where: { id: d.courseId, organizationId: tenant.organizationId },
      select: { id: true, landingPage: { select: { id: true } } },
    });
    if (!course) return { error: 'That course was not found.' };

    const blocks = parseBlockSource(String(formData.get('source') ?? ''));

    const clash = await db.storefrontPage.findFirst({
      where: {
        organizationId: tenant.organizationId,
        slug: d.slug,
        ...(course.landingPage ? { id: { not: course.landingPage.id } } : {}),
      },
      select: { id: true },
    });
    if (clash) return { error: `Another page already lives at /${d.slug}.` };

    const data = {
      slug: d.slug,
      title: d.title,
      kind: 'COURSE_LANDING' as const,
      blocks: blocks as unknown as Prisma.InputJsonValue,
      seoTitle: d.seoTitle || null,
      seoDescription: d.seoDescription || null,
      status: d.status,
      publishedAt: d.status === 'PUBLISHED' ? new Date() : null,
    };

    if (course.landingPage) {
      await db.storefrontPage.update({ where: { id: course.landingPage.id }, data });
    } else {
      await db.storefrontPage.create({
        data: { ...data, organizationId: tenant.organizationId, courseId: course.id },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: d.status === 'PUBLISHED' ? 'landing.published' : 'landing.saved',
      entity: 'StorefrontPage',
      entityId: course.landingPage?.id ?? null,
      after: { slug: d.slug, blocks: blocks.length },
    });

    revalidatePath('/admin/storefront/landing');
    revalidatePath(`/${d.slug}`);
    return {
      ok: true,
      message:
        d.status === 'PUBLISHED'
          ? `Live at /${d.slug}, with ${blocks.length} section${blocks.length === 1 ? '' : 's'}.`
          : `Saved as a draft with ${blocks.length} section${blocks.length === 1 ? '' : 's'}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteLandingPage(courseId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');
    await db.storefrontPage.deleteMany({
      where: { organizationId: tenant.organizationId, courseId, kind: 'COURSE_LANDING' },
    });
    revalidatePath('/admin/storefront/landing');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export interface ImportPreview {
  ok: boolean;
  error?: string;
  title?: string;
  /** The page in editable form, for the textarea, rather than as json. */
  source?: string;
  suggestedSlug?: string;
  blocks?: number;
  images?: number;
  notes?: string[];
}

/** Two megabytes of markup is a large page. Ten is a page that is not one. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

/**
 * Read an existing page and offer its content back as editable text.
 *
 * Nothing is saved by this. It fetches, extracts, pulls the pictures over
 * into our own storage and hands the result to the editor, where a person
 * decides what to keep. Importing straight into a published page would mean
 * whatever an old theme left in its markup goes live unread.
 */
export async function importLandingFromUrl(rawUrl: string): Promise<ImportPreview> {
  try {
    const { tenant, user } = await guard();

    let url: URL;
    try {
      url = new URL(String(rawUrl).trim());
    } catch {
      return { ok: false, error: 'That does not look like a web address.' };
    }
    // https only, and no addresses on this machine: a fetcher that will pull
    // any URL a form gives it is a way to read things behind the firewall.
    if (url.protocol !== 'https:') return { ok: false, error: 'The address has to start with https.' };
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(url.hostname)) {
      return { ok: false, error: 'That address is on this network, so it will not be fetched.' };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(25_000),
        headers: { accept: 'text/html' },
      });
    } catch {
      return { ok: false, error: 'That page could not be reached.' };
    }
    if (!response.ok) return { ok: false, error: `That page answered ${response.status}.` };

    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (type && !type.includes('html')) {
      return { ok: false, error: 'That address is not a web page.' };
    }

    const html = await response.text();
    if (html.length > MAX_PAGE_BYTES) {
      return { ok: false, error: 'That page is too large to import.' };
    }

    const extracted = extractBlocks(html);
    const notes = [...extracted.notes];

    // Bring the pictures across too, so the old host can be switched off.
    let images = 0;
    const blocks: Block[] = [];

    for (const block of extracted.blocks) {
      if (block.type === 'image' && block.url) {
        if (!storageConfigured()) {
          notes.push('File storage is not configured, so images were left pointing at the old site.');
          blocks.push(block);
          continue;
        }
        const pulled = await fetchImageAsAsset(block.url, tenant.organizationId, user.id);
        if ('assetId' in pulled) {
          images += 1;
          blocks.push({ type: 'image', assetId: pulled.assetId, alt: block.alt, caption: block.caption });
        } else {
          notes.push(pulled.problem);
          blocks.push(block);
        }
        continue;
      }
      blocks.push(block);
    }

    const clean = parseBlocks(blocks);

    return {
      ok: true,
      title: extracted.title,
      source: toBlockSource(clean),
      suggestedSlug: normalisePath(url.pathname).replace(/^\//, '').split('/').pop() || '',
      blocks: clean.length,
      images,
      notes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'UNAUTHORIZED' || message === 'FORBIDDEN') {
      return { ok: false, error: 'You do not have permission to do that.' };
    }
    console.error('[landing import]', message);
    return { ok: false, error: 'That page could not be imported.' };
  }
}
