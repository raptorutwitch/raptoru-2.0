import type { Queryable } from '../db/db.js';

// Watched / blocked TTS words (D4 « Surveillance »). Matching rule of the prototype: a whole word or
// expression (not inside another word), case-insensitive; accents are ignored as well (« arrete » =
// « arrête ») and spaces inside an expression are flexible. Positions refer to the original message,
// so the console can highlight exactly what Core matched.

export type WordKind = 'watch' | 'block';
export interface WordRule {
  id: number;
  word: string;
  normalized: string;
  kind: WordKind;
}
export interface WordHit {
  word: string;
  kind: WordKind;
  start: number;
  end: number;
}

/** Lower case without diacritics, one UTF-16 unit for one unit (positions are kept). */
export function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const lower = ch.toLowerCase();
    out += base.length === 1 ? base : lower.length === 1 ? lower : ch;
  }
  return out;
}

/** Stored form of a word: trimmed, single spaces, folded. */
export function normalizeWord(word: string) {
  return fold(word.trim().replace(/\s+/g, ' '));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every occurrence of every rule in the message (whole words only). */
export function findWordHits(text: string, rules: WordRule[]): WordHit[] {
  const folded = fold(text);
  const hits: WordHit[] = [];
  for (const r of rules) {
    if (!r.normalized) continue;
    const pattern = r.normalized.split(' ').map(escape).join('\\s+');
    const re = new RegExp(`(^|[^\\p{L}])(${pattern})(?=[^\\p{L}]|$)`, 'gu');
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      const start = m.index + m[1]!.length;
      hits.push({
        word: r.word,
        kind: r.kind,
        start,
        end: start + m[2]!.length,
      });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export async function wordRules(
  q: Queryable,
  channelId: string,
): Promise<WordRule[]> {
  return (
    await q.query<{
      id: string | number;
      word: string;
      normalized: string;
      kind: WordKind;
    }>(
      'select id, word, normalized, kind from lab_tts_words where channel_id = $1 order by id',
      [channelId],
    )
  ).map((r) => ({ ...r, id: Number(r.id) }));
}
