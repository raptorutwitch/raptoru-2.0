// StreamElements accounts → Twitch identity (docs/ECONOMY_MIGRATION.md § 8). StreamElements only gives a username; the
// Twitch user ID is the canonical identity. A balance is attributed only when the evidence is unambiguous; anything
// else goes to quarantine with its amount (Antoni, 19/10/2026: quarantine rather than a wrong holder). Pure function:
// the inputs are read elsewhere (SE export, Twitch Get Users now, dated historical pairs from the legacy data).

export interface SeIdentityInput {
  /** StreamElements leaderboard at the cutoff (username lowercased). */
  accounts: { username: string; points: number }[];
  /** Twitch Get Users by login, now: login → id. */
  current: Map<string, { id: string; created_at: string }>;
  /** Twitch Get Users by id, now (for the ids of the history): id → current login. Absent = account gone. */
  currentById: Map<string, string>;
  /** Dated (id, login) pairs seen in historical data (legacy tables, logs), login lowercased. */
  history: { id: string; login: string; source: string; last_seen: string }[];
}

export type SeIdentityStatus =
  /** Today's holder of the login is the one the history saw with it, and only him. */
  | 'confirmed'
  /** Login gone or reassigned since; the history names one single holder → that holder (renamed). */
  | 'renamed'
  /** The login resolves today but no historical data ever saw it: plausible, not proven. */
  | 'current_only'
  /** The history saw several holders, or a holder other than today's: never decided automatically. */
  | 'ambiguous'
  /** Nobody: no current account, no history. */
  | 'unresolved'
  /** Not a Twitch login (spaces…): a display name or a typo, to be examined by hand. */
  | 'invalid';

export interface SeIdentityRow {
  username: string;
  points: number;
  status: SeIdentityStatus;
  /** Only set for confirmed / renamed / current_only. */
  twitch_user_id: string | null;
  /** Ids involved (history and today) — the evidence for a human decision. */
  candidates: string[];
  reason: string;
  /** Another SE account resolves to the same Twitch ID (two balances, one person). */
  shares_id_with: string[];
}

export function reconcileSeIdentities(i: SeIdentityInput): SeIdentityRow[] {
  const seen = new Map<string, Set<string>>();
  for (const h of i.history) {
    if (!/^\d{1,32}$/.test(h.id)) continue;
    const login = h.login.trim().toLowerCase();
    (seen.get(login) ?? seen.set(login, new Set()).get(login)!).add(h.id);
  }
  const rows: SeIdentityRow[] = i.accounts.map(({ username, points }) => {
    const base = { username, points, shares_id_with: [] as string[] };
    if (!/^[a-z0-9_]{1,25}$/.test(username))
      return {
        ...base,
        status: 'invalid',
        twitch_user_id: null,
        candidates: [],
        reason: 'pas un login Twitch',
      };
    const now = i.current.get(username)?.id ?? null;
    const past = [...(seen.get(username) ?? [])].sort();
    const candidates = [...new Set([...past, ...(now ? [now] : [])])].sort();
    if (past.length > 1)
      return {
        ...base,
        status: 'ambiguous',
        twitch_user_id: null,
        candidates,
        reason: 'plusieurs titulaires dans l’historique',
      };
    const [old] = past;
    if (old && now && old === now)
      return {
        ...base,
        status: 'confirmed',
        twitch_user_id: now,
        candidates,
        reason: 'historique = titulaire actuel',
      };
    if (old && now && old !== now)
      return {
        ...base,
        status: 'ambiguous',
        twitch_user_id: null,
        candidates,
        reason: 'pseudo réattribué : titulaire historique ≠ actuel',
      };
    if (old && !now)
      return i.currentById.has(old)
        ? {
            ...base,
            status: 'renamed',
            twitch_user_id: old,
            candidates,
            reason:
              'pseudo abandonné, titulaire historique unique toujours existant',
          }
        : {
            ...base,
            status: 'ambiguous',
            twitch_user_id: null,
            candidates,
            reason:
              'titulaire historique introuvable aujourd’hui (supprimé / suspendu)',
          };
    if (now)
      return {
        ...base,
        status: 'current_only',
        twitch_user_id: now,
        candidates,
        reason: 'aucune trace historique',
      };
    return {
      ...base,
      status: 'unresolved',
      twitch_user_id: null,
      candidates,
      reason: 'ni compte actuel ni historique',
    };
  });
  // One Twitch ID behind two SE accounts: both are kept, flagged (two balances of one person, or a wrong match).
  const byId = new Map<string, SeIdentityRow[]>();
  for (const r of rows)
    if (r.twitch_user_id)
      (
        byId.get(r.twitch_user_id) ??
        byId.set(r.twitch_user_id, []).get(r.twitch_user_id)!
      ).push(r);
  for (const group of byId.values())
    if (group.length > 1)
      for (const r of group)
        r.shares_id_with = group.filter((g) => g !== r).map((g) => g.username);
  return rows;
}

/** Counts and sums per status (no username): what a report may show. */
export function summarizeSeIdentities(rows: SeIdentityRow[]) {
  const out: Record<string, { accounts: number; points: number }> = {};
  for (const r of rows) {
    const s = (out[r.status] ??= { accounts: 0, points: 0 });
    s.accounts++;
    s.points += r.points;
  }
  return {
    by_status: out,
    shared_ids: rows.filter((r) => r.shares_id_with.length).length,
    total: {
      accounts: rows.length,
      points: rows.reduce((a, r) => a + r.points, 0),
    },
  };
}
