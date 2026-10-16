import { readFileSync } from 'node:fs';

// Jeu des mots V1 — the legacy word bank (docs/WORD_GAME_PARITY.md § 16). `words-fr.txt` is a byte copy
// of SAMMI's `data/liste_mots.txt` (SHA-256 of its LF content: WORD_BANK_SHA256). The only change at
// load: the one known duplicate line (`loser`) counts once. No word is cleaned, fixed or removed.

export const WORD_BANK_SHA256 =
  'b455ae2d730f466ae4fd975bea9d4dedcbbaeea38f462537ab83f865011f0e2f';

/** Same path from src/ (tests, tsx) and from dist/ (build), like the migrations directory. */
export const WORD_BANK_FILE = new URL(
  '../../src/word-game/words-fr.txt',
  import.meta.url,
);

/** Lines of the bank, in file order, first occurrence of each word kept. CRLF checkouts are tolerated. */
export function parseWordBank(text: string): string[] {
  const words = new Set<string>();
  for (const line of text.split('\n')) {
    const word = line.replace(/\r$/, '');
    if (word) words.add(word);
  }
  return [...words];
}

export function loadWordBank(file: URL = WORD_BANK_FILE): string[] {
  return parseWordBank(readFileSync(file, 'utf8'));
}
