/** Normalise text for search: lowercase, strip Latin diacritics, unify Arabic letter variants and remove tashkeel. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every query token must appear in the haystack (name, aliases, Arabic name, equipment, muscles). */
export function matches(query: string, haystack: string[]): boolean {
  const q = normalize(query);
  if (!q) return true;
  const h = normalize(haystack.join(' '));
  return q.split(' ').every((tok) => h.includes(tok));
}
