// A viewer's text → a Spotify track reference (historical spotify-v2/reference.js, unchanged rules): a track URI
// (`spotify:track:<22>`), an open.spotify.com track link (with or without `intl-xx`, any query string) or free text to
// search. Any other Spotify kind (album, playlist, episode…) or another site → INVALID_REFERENCE; empty → INVALID_INPUT.

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export type ParsedReference =
  | { kind: 'exact'; trackId: string; source: 'uri' | 'url' }
  | { kind: 'search'; query: string }
  | { kind: 'invalid'; reason: 'INVALID_REFERENCE' | 'INVALID_INPUT' };

export function parseTrackReference(
  input: string | null | undefined,
): ParsedReference {
  const raw = String(input ?? '').trim();
  if (!raw) return { kind: 'invalid', reason: 'INVALID_INPUT' };

  const uri = raw.match(/^spotify:([^:]+):([^:?/#]+)$/i);
  if (uri) {
    const [, type, id] = uri;
    if (type!.toLowerCase() !== 'track' || !SPOTIFY_ID.test(id!))
      return { kind: 'invalid', reason: 'INVALID_REFERENCE' };
    return { kind: 'exact', trackId: id!, source: 'uri' };
  }
  if (/^spotify:/i.test(raw))
    return { kind: 'invalid', reason: 'INVALID_REFERENCE' };

  if (/^(?:https?:\/\/|www\.|open\.spotify\.com\/)/i.test(raw)) {
    const candidate =
      raw.startsWith('www.') || raw.startsWith('open.spotify.com/')
        ? `https://${raw}`
        : raw;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return { kind: 'invalid', reason: 'INVALID_REFERENCE' };
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname.toLowerCase() !== 'open.spotify.com'
    )
      return { kind: 'invalid', reason: 'INVALID_REFERENCE' };
    let segments: string[];
    try {
      segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map((s) => decodeURIComponent(s));
    } catch {
      return { kind: 'invalid', reason: 'INVALID_REFERENCE' };
    }
    const at = segments.findIndex((s) => s.toLowerCase() === 'track');
    if (at < 0 || !SPOTIFY_ID.test(segments[at + 1] ?? ''))
      return { kind: 'invalid', reason: 'INVALID_REFERENCE' };
    return { kind: 'exact', trackId: segments[at + 1]!, source: 'url' };
  }

  // The historical service searched the raw text (its normalized form was only used to reject an empty one).
  const normalized = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim();
  if (!normalized) return { kind: 'invalid', reason: 'INVALID_INPUT' };
  return { kind: 'search', query: raw.slice(0, 500) };
}
