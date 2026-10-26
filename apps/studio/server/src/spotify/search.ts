// Spotify V2 — the historical search and selection (spotify-v2/normalize.js + search.js, in production 25/08 → 18/10/2026),
// ported unchanged: deterministic scoring (0.55 title + 0.30 artist + 0.15 combined, phrase bonus, variant adjustment),
// « title - artist » separators, equivalent recordings grouped (shared id, ISRC, or same title / credited artists /
// variant within 2.5 s), then NOT_FOUND below 0.68, AMBIGUOUS within 0.08 or for the same base title without artist
// context. Tests: test/spotify-search.test.ts (the historical cases).

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'to',
  'in',
  'on',
  'la',
  'le',
  'les',
  'de',
  'du',
  'des',
  'et',
  'un',
  'une',
]);
const VARIANT_TERMS = [
  'radio edit',
  'extended mix',
  'official audio',
  'official video',
  'remastered',
  'instrumental',
  'acoustic',
  'karaoke',
  'sped up',
  'slowed',
  'remix',
  'live',
  'edit',
  'version',
  'mix',
] as const;

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value: unknown, { meaningful = false } = {}) {
  const tokens = normalizeText(value).split(' ').filter(Boolean);
  return meaningful ? tokens.filter((t) => !STOPWORDS.has(t)) : tokens;
}

const unique = (tokens: string[]) => [...new Set(tokens)];

function extractVariantTerms(value: unknown) {
  const normalized = normalizeText(value);
  return VARIANT_TERMS.filter((term) => normalized.includes(term));
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

export function tokenSimilarity(a: string, b: string) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (Math.min(left.length, right.length) < 3) return 0;
  if (left.startsWith(right) || right.startsWith(left)) return 0.92;
  return Math.max(
    0,
    1 - levenshtein(left, right) / Math.max(left.length, right.length),
  );
}

function coverage(sourceTokens: string[], targetTokens: string[]) {
  const source = unique(sourceTokens.filter(Boolean));
  const target = unique(targetTokens.filter(Boolean));
  if (source.length === 0 || target.length === 0) return 0;
  return (
    source.reduce(
      (sum, t) => sum + Math.max(...target.map((c) => tokenSimilarity(t, c))),
      0,
    ) / source.length
  );
}

function sequenceIncluded(needle: string, haystack: string) {
  const left = unique(tokenize(needle, { meaningful: true }));
  const right = tokenize(haystack, { meaningful: true });
  if (left.length === 0 || left.length > right.length) return false;
  return right.some((_, i) =>
    left.every(
      (t, offset) => tokenSimilarity(t, right[i + offset] ?? '') >= 0.88,
    ),
  );
}

/** A Spotify track as the Web API returns it (only what the scoring reads). */
export interface Candidate {
  id: string;
  uri?: string;
  name: string;
  artists: { name: string }[];
  duration_ms?: number;
  external_ids?: { isrc?: string };
  linked_from?: { id?: string; uri?: string };
  /** The release it comes from (always returned by the search, 26/10 diagnostic): tells editions apart. */
  album?: { name?: string; album_type?: string; release_date?: string };
}

const artistNames = (c: Candidate) =>
  (c.artists ?? []).map((a) => a?.name).filter(Boolean) as string[];
const candidateTitle = (c: Candidate) => c.name ?? '';

const EXPLICIT_QUERY_SEPARATOR = /^(.*?)\s+[-–—|]\s+(.*?)$/u;
const TITLE_RECALL_WEIGHT = 0.25;
const TITLE_PRECISION_WEIGHT = 0.75;
const STRONG_ROLE_FIT = 0.86;
const TITLE_TOKEN_MATCH_THRESHOLD = 0.78;

function tokenFit(expected: string[], actual: string[]) {
  if (expected.length === 0 || actual.length === 0) return 0;
  return 0.65 * coverage(expected, actual) + 0.35 * coverage(actual, expected);
}

function explicitQueryParts(query: string) {
  const match = String(query ?? '')
    .trim()
    .match(EXPLICIT_QUERY_SEPARATOR);
  if (!match) return null;
  const left = match[1]!.trim();
  const right = match[2]!.trim();
  return left && right ? { left, right } : null;
}

function bestArtistFit(expected: string[], artists: string[]) {
  if (expected.length === 0 || artists.length === 0) return 0;
  const all = artists.flatMap((a) => tokenize(a, { meaningful: true }));
  return Math.max(
    tokenFit(expected, all),
    ...artists.map((a) =>
      tokenFit(expected, tokenize(a, { meaningful: true })),
    ),
  );
}

function unmatchedQueryTokens(queryTokens: string[], titleTokens: string[]) {
  const used = new Set<number>();
  const unmatched: string[] = [];
  for (const q of queryTokens) {
    let bestIndex = -1;
    let best = 0;
    for (let i = 0; i < titleTokens.length; i += 1) {
      if (used.has(i)) continue;
      const s = tokenSimilarity(q, titleTokens[i]!);
      if (s > best) {
        best = s;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && best >= TITLE_TOKEN_MATCH_THRESHOLD)
      used.add(bestIndex);
    else unmatched.push(q);
  }
  return unmatched;
}

function bestArtistContextFit(
  queryTokens: string[],
  titleTokens: string[],
  artists: string[],
) {
  if (queryTokens.length === 0 || artists.length === 0) return 0;
  const residual = unmatchedQueryTokens(queryTokens, titleTokens);
  if (residual.length === 0) return 0;
  const all = artists.flatMap((a) => tokenize(a, { meaningful: true }));
  return Math.max(
    coverage(residual, all),
    ...artists.map((a) =>
      coverage(residual, tokenize(a, { meaningful: true })),
    ),
  );
}

function structuredMatch(
  parts: { left: string; right: string },
  titleTokens: string[],
  artists: string[],
  title: string,
) {
  const orientations = [
    {
      titleQuery: parts.left,
      artistQuery: parts.right,
      direction: 'left_title',
    },
    {
      titleQuery: parts.right,
      artistQuery: parts.left,
      direction: 'right_title',
    },
  ];
  return orientations
    .map((o) => {
      const titleQueryTokens = tokenize(o.titleQuery, { meaningful: true });
      const artistQueryTokens = tokenize(o.artistQuery, { meaningful: true });
      const titleFit = tokenFit(titleQueryTokens, titleTokens);
      const artistFit = bestArtistFit(artistQueryTokens, artists);
      const exactTitle = normalizeText(o.titleQuery) === normalizeText(title);
      const exactArtist = artists.some(
        (a) => normalizeText(o.artistQuery) === normalizeText(a),
      );
      return {
        ...o,
        titleQueryTokens,
        titleFit,
        artistFit,
        fit: 0.65 * titleFit + 0.35 * artistFit,
        exact: exactTitle && exactArtist,
      };
    })
    .sort(
      (l, r) =>
        Number(r.exact) - Number(l.exact) ||
        r.fit - l.fit ||
        r.titleFit - l.titleFit ||
        r.artistFit - l.artistFit,
    )[0]!;
}

function variantAdjustment(query: string, title: string, artists: string[]) {
  const queryVariants = new Set(extractVariantTerms(query));
  const candidateVariants = new Set(
    extractVariantTerms(`${title} ${artists.join(' ')}`),
  );
  const shared = [...queryVariants].filter((t) => candidateVariants.has(t));
  const unexpected = [...candidateVariants].filter(
    (t) => !queryVariants.has(t),
  );
  const missing = [...queryVariants].filter((t) => !candidateVariants.has(t));
  return {
    bonus: Math.min(0.08, shared.length * 0.04),
    penalty: Math.min(0.22, unexpected.length * 0.12 + missing.length * 0.04),
  };
}

const VARIANT_BASE_TOKENS = new Set([
  'acoustic',
  'audio',
  'edit',
  'extended',
  'instrumental',
  'karaoke',
  'live',
  'mix',
  'official',
  'radio',
  'remaster',
  'remastered',
  'reissue',
  'reissued',
  'remix',
  'slowed',
  'sped',
  'up',
  'version',
  'video',
]);

const variantlessTitle = (c: Candidate) =>
  tokenize(candidateTitle(c), { meaningful: true })
    .filter((t) => !VARIANT_BASE_TOKENS.has(t))
    .join(' ');

const DURATION_EQUIVALENCE_TOLERANCE_MS = 2_500;
const FEATURE_MARKER = /\b(?:feat|featuring|ft|feta)\b/;
const FEATURE_SUFFIX = /\b(?:feat|featuring|ft|feta)\b.*$/;
const EQUIVALENT_TITLE_MARKERS =
  /\b(?:remaster(?:ed)?|reissue(?:d)?)\b(?:\s+\d{4})?|\b\d{4}\s+\b(?:remaster(?:ed)?|reissue(?:d)?)\b/gi;

function featureArtistTokens(title: string) {
  const normalized = normalizeText(title);
  const marker = normalized.match(FEATURE_MARKER);
  if (!marker || marker.index === undefined) return [];
  const tail = normalized
    .slice(marker.index + marker[0].length)
    .replace(
      /\b(?:live|remix|acoustic|instrumental|karaoke|edit|mix|version|remaster(?:ed)?|reissue(?:d)?)\b.*$/g,
      '',
    );
  return tokenize(tail, { meaningful: true });
}

const creditedArtistKey = (c: Candidate) =>
  [
    ...new Set([
      ...artistNames(c).flatMap((a) => tokenize(a)),
      ...featureArtistTokens(candidateTitle(c)),
    ]),
  ]
    .sort()
    .join(' ');

function recordingTitleKey(c: Candidate) {
  const title = normalizeText(candidateTitle(c))
    .replace(FEATURE_SUFFIX, ' ')
    .replace(EQUIVALENT_TITLE_MARKERS, ' ');
  const tokens = tokenize(title, { meaningful: true });
  return (tokens.length > 0 ? tokens : tokenize(title)).join(' ');
}

function recordingVariantKey(c: Candidate) {
  const title = normalizeText(candidateTitle(c));
  const v: string[] = [];
  if (/\blive\b/.test(title)) v.push('live');
  if (/\b(?:remix|remixed)\b/.test(title)) v.push('remix');
  if (/\bacoustic\b/.test(title)) v.push('acoustic');
  if (/\binstrumental\b/.test(title)) v.push('instrumental');
  if (/\bkaraoke\b/.test(title)) v.push('karaoke');
  if (/\b(?:radio\s+edit|edit)\b/.test(title)) v.push('edit');
  if (/\b(?:extended\s+mix|mix)\b/.test(title)) v.push('mix');
  if (/\b(?:slowed|sped\s+up)\b/.test(title)) v.push('tempo');
  if (/\bversion\b/.test(title)) v.push('version');
  return [...new Set(v)].sort().join('|');
}

const identifierSet = (c: Candidate) =>
  new Set(
    [c.id, c.uri, c.linked_from?.id, c.linked_from?.uri]
      .filter(Boolean)
      .map(String),
  );
const isrc = (c: Candidate) =>
  String(c.external_ids?.isrc ?? '')
    .trim()
    .toUpperCase();

function equivalentRecording(l: Candidate, r: Candidate) {
  if (l === r) return true;
  const ids = identifierSet(l);
  if ([...identifierSet(r)].some((i) => ids.has(i))) return true;
  if (isrc(l) && isrc(l) === isrc(r)) return true;
  if (recordingTitleKey(l) !== recordingTitleKey(r)) return false;
  if (creditedArtistKey(l) !== creditedArtistKey(r)) return false;
  if (recordingVariantKey(l) !== recordingVariantKey(r)) return false;
  return (
    l.duration_ms !== undefined &&
    r.duration_ms !== undefined &&
    Math.abs(l.duration_ms - r.duration_ms) <= DURATION_EQUIVALENCE_TOLERANCE_MS
  );
}

export function scoreCandidate(query: string, c: Candidate) {
  const title = candidateTitle(c);
  const artists = artistNames(c);
  const queryTokens = tokenize(query, { meaningful: true });
  const titleTokens = tokenize(title, { meaningful: true });
  const artistTokens = tokenize(artists.join(' '), { meaningful: true });
  const allTokens = [...titleTokens, ...artistTokens];
  const combined =
    (coverage(queryTokens, allTokens) + coverage(allTokens, queryTokens)) / 2;
  const genericTitleFit =
    coverage(queryTokens, titleTokens) * 0.65 +
    coverage(titleTokens, queryTokens) * 0.35;
  const genericArtistFit =
    coverage(queryTokens, artistTokens) * 0.65 +
    coverage(artistTokens, queryTokens) * 0.35;
  const parts = explicitQueryParts(query);
  const structured = parts
    ? structuredMatch(parts, titleTokens, artists, title)
    : null;
  const titleFit = structured?.titleFit ?? genericTitleFit;
  const artistFit = structured?.artistFit ?? genericArtistFit;
  const titlePrecision = coverage(
    titleTokens,
    structured?.titleQueryTokens ?? queryTokens,
  );
  const titleQuality =
    titleFit * TITLE_RECALL_WEIGHT + titlePrecision * TITLE_PRECISION_WEIGHT;
  const combinedRecall = coverage(queryTokens, allTokens);
  const artistContextFit = bestArtistContextFit(
    queryTokens,
    titleTokens,
    artists,
  );
  const strongRoleMatch = structured
    ? structured.exact ||
      (structured.titleFit >= STRONG_ROLE_FIT &&
        structured.artistFit >= STRONG_ROLE_FIT)
    : queryTokens.length > 1 &&
      titlePrecision >= STRONG_ROLE_FIT &&
      combinedRecall >= STRONG_ROLE_FIT &&
      artistContextFit >= STRONG_ROLE_FIT;
  const phraseBonus = sequenceIncluded(title, structured?.titleQuery ?? query)
    ? 0.06
    : 0;
  const variant = variantAdjustment(query, title, artists);
  const raw =
    0.55 * titleQuality +
    0.3 * artistFit +
    0.15 * combined +
    phraseBonus +
    variant.bonus -
    variant.penalty;
  return {
    score: Math.max(0, Math.min(1, Number(raw.toFixed(6)))),
    title_fit: Number(titleFit.toFixed(6)),
    title_precision: Number(titlePrecision.toFixed(6)),
    artist_context_fit: Number(artistContextFit.toFixed(6)),
    strong_role_match: strongRoleMatch,
    explicit_separator: Boolean(structured),
    structured_exact: structured?.exact ?? false,
  };
}

export type Ranked = ReturnType<typeof scoreCandidate> & {
  candidate: Candidate;
  original_index: number;
};

export function confidenceForScore(
  score: number,
  margin = 1,
): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 0.86 && margin >= 0.12) return 'HIGH';
  if (score >= 0.74 && margin >= 0.08) return 'MEDIUM';
  return 'LOW';
}

/** A request naming a particular version: never decided by the editions' tie-break below. */
const ASKED_VERSION =
  /\b(?:live|remix|remixed|acoustic|acoustique|instrumental|karaoke|edit|mix|slowed|sped|version|remaster(?:ed)?|remasteris[eé]e?|unplugged|concert|reprise|cover|demo)\b/;
/** A live release whose track title says nothing (« Black City Tour »): never preferred unless asked. */
const LIVE_RELEASE = /\b(?:live|tour|concert|unplugged|en public|olympia)\b/;
const RELEASE_RANK: Record<string, number> = { album: 0, single: 1 };
const releaseRank = (c: Candidate) =>
  RELEASE_RANK[String(c.album?.album_type ?? '')] ?? 2; // compilation / unknown last
const releaseDate = (c: Candidate) => String(c.album?.release_date ?? '9999');
const isLiveRelease = (c: Candidate) =>
  LIVE_RELEASE.test(normalizeText(c.album?.name ?? ''));

/** The edition shown for a group of one recording: album or single before a compilation, then the oldest, then id. */
function preferredEdition(members: Ranked[]) {
  const best = Math.max(...members.map((m) => m.score));
  return members
    .filter((m) => m.score === best)
    .sort(
      (l, r) =>
        releaseRank(l.candidate) - releaseRank(r.candidate) ||
        releaseDate(l.candidate).localeCompare(releaseDate(r.candidate)) ||
        String(l.candidate.id).localeCompare(String(r.candidate.id)),
    )[0]!;
}

/**
 * Editions of ONE song (26/10): several distinct recordings with the same title and artist, the request naming no
 * version. Decided only when every close contender has that same title, and then deterministically: the exact
 * requested artists (never a featuring the viewer did not ask for; the one naming the most of them), then not a live release, then album or single
 * before a compilation, then the oldest release. Different songs (or several left equal) stay ambiguous.
 */
function resolveEditions(
  query: string,
  distinct: Ranked[],
  minMargin: number,
): Ranked | null {
  const q = normalizeText(query);
  if (ASKED_VERSION.test(q)) return null;
  const top = distinct[0]!;
  if (!(top.artist_context_fit >= STRONG_ROLE_FIT)) return null;
  const close = distinct.filter((d) => top.score - d.score < minMargin);
  if (close.length < 2) return null;
  const title = recordingTitleKey(top.candidate);
  if (close.some((d) => recordingTitleKey(d.candidate) !== title)) return null;
  const words = new Set(tokenize(q));
  let left = close;
  const keep = (f: (d: Ranked) => boolean) => {
    const kept = left.filter(f);
    if (kept.length) left = kept;
  };
  keep((d) =>
    creditedArtistKey(d.candidate)
      .split(' ')
      .every((w) => !w || words.has(w)),
  );
  // Of those, the one crediting the most of the named artists (a featuring wins only when it is named).
  const credited = (d: Ranked) =>
    creditedArtistKey(d.candidate).split(' ').filter(Boolean).length;
  const most = Math.max(...left.map(credited));
  keep((d) => credited(d) === most);
  keep((d) => !isLiveRelease(d.candidate));
  if (left.length === 1) return left[0]!;
  const ranked = [...left].sort(
    (l, r) =>
      releaseRank(l.candidate) - releaseRank(r.candidate) ||
      releaseDate(l.candidate).localeCompare(releaseDate(r.candidate)),
  );
  const [a, b] = ranked;
  // Still equal on every rule: no reason to prefer one, the viewer is asked to be precise.
  if (
    b &&
    releaseRank(a!.candidate) === releaseRank(b.candidate) &&
    releaseDate(a!.candidate) === releaseDate(b.candidate)
  )
    return null;
  return a!;
}

export function selectCandidate(
  query: string,
  candidates: Candidate[],
  options: { minScore?: number; minMargin?: number } = {},
) {
  const ranked: Ranked[] = candidates
    .map((candidate, original_index) => ({
      candidate,
      original_index,
      ...scoreCandidate(query, candidate),
    }))
    .sort(
      (l, r) =>
        r.score - l.score ||
        String(l.candidate.id ?? l.candidate.uri ?? '').localeCompare(
          String(r.candidate.id ?? r.candidate.uri ?? ''),
        ) ||
        l.original_index - r.original_index,
    );
  if (ranked.length === 0)
    return { status: 'NOT_FOUND' as const, ranked, margin: 0 };
  const groups: { representative: Ranked; members: Ranked[] }[] = [];
  for (const item of ranked) {
    const group = groups.find((g) =>
      g.members.some((m) => equivalentRecording(m.candidate, item.candidate)),
    );
    if (group) group.members.push(item);
    else groups.push({ representative: item, members: [item] });
  }
  for (const g of groups) g.representative = preferredEdition(g.members);
  const distinct = groups.map((g) => g.representative);
  const top = distinct[0]!;
  const second = distinct[1];
  const margin = second ? top.score - second.score : 1;
  const base = {
    ranked,
    distinct_ranked: distinct,
    equivalence_groups: groups,
    top,
    second,
    margin,
  };
  if (top.score < (options.minScore ?? 0.68))
    return { status: 'NOT_FOUND' as const, ...base };
  const sameBaseTitle = distinct.filter(
    (i) =>
      variantlessTitle(i.candidate) === variantlessTitle(top.candidate) &&
      i.title_fit >= 0.7,
  );
  if (sameBaseTitle.length > 1 && !(top.artist_context_fit >= STRONG_ROLE_FIT))
    return { status: 'AMBIGUOUS' as const, ...base };
  if (second && margin < (options.minMargin ?? 0.08)) {
    const edition = resolveEditions(query, distinct, options.minMargin ?? 0.08);
    if (!edition) return { status: 'AMBIGUOUS' as const, ...base };
    return {
      status: 'MATCHED' as const,
      ...base,
      top: edition,
      resolved: 'edition' as const,
      confidence: confidenceForScore(edition.score, margin),
    };
  }
  return {
    status: 'MATCHED' as const,
    ...base,
    confidence: confidenceForScore(top.score, margin),
  };
}
