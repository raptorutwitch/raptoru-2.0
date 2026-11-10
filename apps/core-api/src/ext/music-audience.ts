// Music Hub in Production (docs/RELEASE_2026-11-10.md § 6): who the extension's music module is open to, from the
// Core's MUSIC_HUB_EXTENSION variable. The Lab is always open. Production:
//   off (default)          → closed, as before the release of 10/11;
//   testers:<id>,<id>…     → the broadcaster and these Twitch user ids (Hosted Test);
//   on                     → every viewer.
// The immediate switch stays Studio's « Demandes depuis l'extension » (no restart): off, the module is hidden and
// Core refuses requests, searches and paid skips. This variable is the hard switch (a Core restart).

export type MusicAudience =
  | { mode: 'off' }
  | { mode: 'on' }
  | { mode: 'testers'; testers: ReadonlySet<string> };

export function parseMusicAudience(raw: string | undefined): MusicAudience {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'off') return { mode: 'off' };
  if (v === 'on') return { mode: 'on' };
  const m = /^testers:([0-9]{1,20}(?:,[0-9]{1,20})*)?$/.exec(v);
  if (m) return { mode: 'testers', testers: new Set(m[1]?.split(',') ?? []) };
  throw new Error(
    `MUSIC_HUB_EXTENSION: off | on | testers:<id>,<id> (got « ${v} »)`,
  );
}

/** Whether this caller gets the music module (Lab: always). An unshared identity is never a tester. */
export function musicOpenTo(
  audience: MusicAudience,
  lab: boolean,
  caller: { role: string; userId: string | null },
): boolean {
  if (lab || audience.mode === 'on') return true;
  if (audience.mode === 'off') return false;
  return (
    caller.role === 'broadcaster' ||
    (caller.userId !== null && audience.testers.has(caller.userId))
  );
}
