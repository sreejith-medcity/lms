/**
 * A sanity check on a pasted embed snippet.
 *
 * Snippets travel through chat apps, email and documents on their way from a
 * provider's dashboard into a settings box, and several of those helpfully
 * turn a URL into a markdown link on the way. What arrives looks close enough
 * to read past:
 *
 *   <script src='https://cdn.example.com/loader.js?abc['>](https://cdn...)</script>
 *
 * The src now ends in a bracket, the provider reports "widget not found, or a
 * typo in its ID", and the person who pasted it goes looking for the typo in
 * their widget rather than in the paste. This says so instead.
 *
 * It refuses rather than repairs. Quietly rewriting somebody's script tag is
 * how you end up loading a URL they never agreed to.
 */

export interface EmbedProblem {
  problem: string;
  detail: string;
}

/** Characters that are never part of a real script URL but are part of markdown. */
const MANGLED = /[[\]()<>{}\\^`|]/;

export function checkEmbed(html: string): EmbedProblem | null {
  const trimmed = html.trim();
  if (!trimmed) return null;

  for (const match of trimmed.matchAll(/\bsrc\s*=\s*(['"])(.*?)\1/gi)) {
    const url = match[2].trim();

    if (MANGLED.test(url)) {
      return {
        problem: 'That snippet looks like it was mangled on the way here.',
        detail: `The address it loads ends up as "${url.slice(0, 90)}", which has a stray character in it. Chat apps and documents often turn a URL into a link and leave brackets behind. Copy it again from the provider, or retype the part after the question mark.`,
      };
    }

    if (!/^https:\/\//i.test(url)) {
      return {
        problem: 'That snippet loads from something other than https.',
        detail: `It points at "${url.slice(0, 90)}". A widget on your storefront has to be served over https or browsers will block it.`,
      };
    }
  }

  // A markdown link left in the value, even outside an attribute, means the
  // paste came through something that rewrote it.
  if (/\]\(https?:\/\//.test(trimmed)) {
    return {
      problem: 'That snippet has a markdown link inside it.',
      detail:
        'Something between the provider and this box turned the address into a link. Paste the plain snippet, with nothing but the script tag in it.',
    };
  }

  return null;
}
