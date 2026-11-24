/** BR-YT-02: fallback search URL – never an invented video ID. */
export const youtubeSearchUrl = (exerciseName: string): string =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exerciseName} form`)}`;

/** BR-YT-04: accept only youtube.com / youtu.be video URLs pasted by the user. */
export function parseYoutubeUrl(input: string): { ok: true; url: string; videoId: string } | { ok: false } {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return { ok: false }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false };
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null;
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/); if (m) id = m[2]; }
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return { ok: false };
  return { ok: true, url: `https://www.youtube.com/watch?v=${id}`, videoId: id };
}
