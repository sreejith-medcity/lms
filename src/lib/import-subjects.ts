import { parseCsv } from '@/lib/csv';
import { slugify } from '@/lib/slug';

/**
 * Reading a subjects file, without touching a database.
 *
 * Split out from the action that writes so the parsing, the column matching
 * and the row validation can be tested against real exports rather than
 * against a mock of Prisma. Every judgement about what a row means lives
 * here; the action only writes what this hands it.
 */

export interface SubjectRow {
  /** 1-based, and it is the row in the file rather than the index in the array. */
  line: number;
  name: string;
  slug: string;
  tagline: string;
  ctaLabel: string;
  imageUrl: string;
  comingSoon: boolean;
  showOnHome: boolean;
  sortOrder: number;
}

export interface SubjectParse {
  rows: SubjectRow[];
  problems: string[];
}

/**
 * Header names, forgivingly.
 *
 * A file is typed by a person or exported by one of several plugins, so
 * "Coming soon", "coming_soon" and "comingSoon" all have to mean the same
 * thing. Matching on letters only removes the whole argument.
 */
const HEADERS: Record<string, string[]> = {
  name: ['name', 'subject', 'category', 'title'],
  tagline: ['tagline', 'description', 'blurb', 'summary', 'subtitle'],
  ctaLabel: ['ctalabel', 'button', 'buttonlabel', 'buttontext', 'cta'],
  imageUrl: ['imageurl', 'image', 'images', 'picture', 'artwork', 'thumbnail'],
  comingSoon: ['comingsoon', 'soon'],
  showOnHome: ['showonhome', 'onhome', 'home', 'featured'],
  sortOrder: ['sortorder', 'order', 'position', 'sort'],
};

const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function columnIndexes(header: string[]): Record<string, number> {
  const found: Record<string, number> = {};
  header.forEach((raw, index) => {
    const key = flatten(raw);
    for (const [field, aliases] of Object.entries(HEADERS)) {
      if (found[field] === undefined && aliases.includes(key)) found[field] = index;
    }
  });
  return found;
}

/** "yes", "true", "1" and "y" all mean yes. Blank means no. */
function truthy(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1' || v === 'y';
}

export function parseSubjects(csv: string): SubjectParse {
  const table = parseCsv(csv);
  const problems: string[] = [];

  if (table.length === 0) return { rows: [], problems: ['That file has nothing in it.'] };

  const columns = columnIndexes(table[0]);
  if (columns.name === undefined) {
    return {
      rows: [],
      problems: [
        `No column of names. The first row is: ${table[0].join(', ')}. One column has to be called Name.`,
      ],
    };
  }

  const at = (row: string[], field: string) => {
    const index = columns[field];
    return index === undefined ? '' : (row[index] ?? '').trim();
  };

  const rows: SubjectRow[] = [];
  const seen = new Map<string, number>();

  table.slice(1).forEach((raw, i) => {
    const line = i + 2;
    const name = at(raw, 'name');
    if (!name) return;

    const slug = slugify(name);
    if (!slug) {
      problems.push(`Row ${line}: "${name}" has no letters or numbers in it to make an address from.`);
      return;
    }

    // Two rows for one subject would create it and then overwrite it, which
    // reads as the first row having been ignored.
    const earlier = seen.get(slug);
    if (earlier) {
      problems.push(`Row ${line}: "${name}" is the same subject as row ${earlier}. Only the first is used.`);
      return;
    }
    seen.set(slug, line);

    const imageUrl = at(raw, 'imageUrl');
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      problems.push(`Row ${line}: the picture for "${name}" is not an https address, so it is skipped.`);
    }

    // An empty cell is not a zero. Number('') is 0, which is finite and
    // non-negative, so reading it as a position silently stacked every
    // subject at the front and lost the order the file was written in.
    const orderCell = at(raw, 'sortOrder');
    const order = orderCell === '' ? Number.NaN : Number(orderCell);

    rows.push({
      line,
      name,
      slug,
      tagline: at(raw, 'tagline'),
      ctaLabel: at(raw, 'ctaLabel'),
      imageUrl: /^https:\/\//i.test(imageUrl) ? imageUrl : '',
      comingSoon: truthy(at(raw, 'comingSoon')),
      // Absent means yes: a file of subjects is a list of what to show.
      showOnHome: columns.showOnHome === undefined ? true : truthy(at(raw, 'showOnHome')),
      sortOrder: Number.isFinite(order) && order >= 0 ? Math.trunc(order) : i,
    });
  });

  if (rows.length === 0) problems.push('No rows with a name in them.');

  return { rows, problems };
}
