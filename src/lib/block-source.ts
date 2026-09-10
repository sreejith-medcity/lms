import type { Block } from '@/lib/page-blocks';
import { parseBlocks } from '@/lib/page-blocks';

/**
 * A page as text somebody can read, edit and paste.
 *
 * The alternative was a block builder: add block, choose type, drag to
 * reorder, twelve components and a state machine. What an academy actually
 * does with an imported page is read it once, delete the two paragraphs about
 * the old fee structure, fix a heading and publish. That is a text editor's
 * job, so a page is stored as blocks and edited as this:
 *
 *   ## What you will learn          a heading, attached to what follows it
 *   Ordinary paragraphs.            prose, blank line between paragraphs
 *   - a bullet                      a list
 *   ? How long is it                a question
 *   : Six months.                   and its answer
 *   = 18 | branches                 a number worth showing
 *   ![alt](https://...)             a picture, or asset:<id> once imported
 *   > Ready to start | Enrol now    the call to action
 *
 * It round-trips: what comes out of `toBlockSource` parses back to the same
 * blocks, which is what makes it safe to edit an imported page rather than
 * only look at it. Both directions are pure and tested.
 */

const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)$/;

export function parseBlockSource(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  const blocks: Block[] = [];
  let heading: string | undefined;
  let paragraphs: string[] = [];
  let current: string[] = [];
  let bullets: string[] = [];
  let faq: { q: string; a: string }[] = [];
  let stats: { value: string; label: string }[] = [];

  const endParagraph = () => {
    const text = current.join(' ').trim();
    if (text) paragraphs.push(text);
    current = [];
  };

  const flush = () => {
    endParagraph();
    if (paragraphs.length > 0) {
      blocks.push({ type: 'text', heading, body: paragraphs.join('\n\n') });
      heading = undefined;
    }
    if (bullets.length > 0) {
      blocks.push({ type: 'bullets', heading, items: bullets });
      heading = undefined;
    }
    if (faq.length > 0) {
      blocks.push({ type: 'faq', heading, items: faq });
      heading = undefined;
    }
    if (stats.length > 0) {
      blocks.push({ type: 'stats', heading, items: stats });
      heading = undefined;
    }
    paragraphs = [];
    bullets = [];
    faq = [];
    stats = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      endParagraph();
      continue;
    }

    if (line.startsWith('## ')) {
      flush();
      heading = line.slice(3).trim();
      continue;
    }

    if (line.startsWith('- ')) {
      endParagraph();
      bullets.push(line.slice(2).trim());
      continue;
    }

    if (line.startsWith('? ')) {
      endParagraph();
      faq.push({ q: line.slice(2).trim(), a: '' });
      continue;
    }

    if (line.startsWith(': ')) {
      const answer = line.slice(2).trim();
      const last = faq[faq.length - 1];
      // An answer with no question above it is a stray line, not a paragraph
      // to be lost: it joins the previous answer rather than disappearing.
      if (last) last.a = last.a ? `${last.a}\n\n${answer}` : answer;
      continue;
    }

    if (line.startsWith('= ')) {
      endParagraph();
      const [value, ...rest] = line.slice(2).split('|');
      const label = rest.join('|').trim();
      if (value.trim() && label) stats.push({ value: value.trim(), label });
      continue;
    }

    const image = IMAGE.exec(line);
    if (image) {
      flush();
      const target = image[2].trim();
      blocks.push(
        target.startsWith('asset:')
          ? { type: 'image', assetId: target.slice(6), alt: image[1] || undefined }
          : { type: 'image', url: target, alt: image[1] || undefined },
      );
      continue;
    }

    if (line.startsWith('> ')) {
      flush();
      const [body, ...rest] = line.slice(2).split('|');
      blocks.push({
        type: 'cta',
        body: body.trim() || undefined,
        label: rest.join('|').trim() || undefined,
      });
      continue;
    }

    current.push(line);
  }

  flush();

  // Through the same door everything else comes through, so the editor cannot
  // save a block the renderer would refuse.
  return parseBlocks(blocks);
}

export function toBlockSource(blocks: Block[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    const lines: string[] = [];
    if ('heading' in block && block.heading) lines.push(`## ${block.heading}`);

    switch (block.type) {
      case 'text':
        lines.push(block.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).join('\n\n'));
        break;
      case 'bullets':
        lines.push(block.items.map((i) => `- ${i}`).join('\n'));
        break;
      case 'faq':
        lines.push(
          block.items
            .map((i) => `? ${i.q}\n${i.a.split(/\n{2,}/).map((a) => `: ${a.trim()}`).join('\n')}`)
            .join('\n'),
        );
        break;
      case 'stats':
        lines.push(block.items.map((i) => `= ${i.value} | ${i.label}`).join('\n'));
        break;
      case 'image':
        lines.push(`![${block.alt ?? ''}](${block.assetId ? `asset:${block.assetId}` : block.url})`);
        break;
      case 'cta':
        lines.push(`> ${block.body ?? 'Ready to start?'}${block.label ? ` | ${block.label}` : ''}`);
        break;
    }

    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}
