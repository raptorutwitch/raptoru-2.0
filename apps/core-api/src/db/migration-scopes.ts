// Explicit boundary between the production schema and the Lab schema (both live in
// supabase/migrations). Every *.sql file MUST be listed here, in exactly one scope; an unlisted file
// stops every migration run (fail closed), so a new Lab migration can never reach the production
// path by omission.
//
// - `prod`: what the production migrator (scripts/migrate.ts) applies.
// - `lab`: what the Lab launchers apply to the dedicated Lab database (Studio local runtime,
//   scripts/bonk-lab.mjs). Their lists are checked against LAB_MIGRATIONS by the tests.
// - `all`: tests only (one throw-away database holding both schemas).
//
// History: before this boundary the production migrator applied every file of the folder, Lab ones
// included, and the production Core still wires the Bonk / Soundboard / TTS Lab routes. Those
// historical Lab files therefore stay in the production selection (LEGACY_LAB_IN_PROD, frozen, never
// extended): the production path behaves exactly as before for them. Any Lab migration added after
// this boundary goes to LAB_MIGRATIONS only.

export type MigrationScope = 'prod' | 'lab' | 'all';

/** Production schema (Daily, Presence, Wallet, Loyalty). */
export const PROD_MIGRATIONS: readonly string[] = Object.freeze([
  '20260924120000_daily.sql',
  '20260925120000_presence.sql',
  '20260926120000_wallet.sql',
  '20260927120000_loyalty_engine.sql',
  '20260928120000_daily_wallet.sql',
]);

/** Lab schema, in order (dedicated Lab database only). */
export const LAB_MIGRATIONS: readonly string[] = Object.freeze([
  '20260929120000_bonk_lab.sql',
  '20260930120000_bonk_lab_twitch.sql',
  '20261001120000_bonk_lab_third_party.sql',
  '20261002120000_sound_lab.sql',
  '20261003120000_sound_lab_custom_label.sql',
  '20261004120000_tts_lab.sql',
  '20261005120000_lab_moderation.sql',
  '20261006120000_tts_lab_cooldown_clear.sql',
  '20261007120000_moderation_d4.sql',
  '20261008120000_raffle_v2.sql',
  '20261009120000_raffle_scheduler.sql',
  '20261010120000_raffle_round_labels.sql',
  // Commands V2 (after the boundary: Lab only, never in the production selection).
  '20261011120000_commands_v2.sql',
  '20261012120000_commands_v2_invocations.sql',
  '20261013120000_commands_v2_steps.sql',
  '20261014120000_commands_v2_categories.sql',
  // Moderation V2 idempotent actions (ASTRA-P1-009).
  '20261015120000_lab_moderation_idempotency.sql',
]);

/**
 * Lab files the production migrator already applied before the boundary existed. FROZEN: never add
 * a file here — a new Lab migration belongs to LAB_MIGRATIONS only.
 */
export const LEGACY_LAB_IN_PROD: readonly string[] = Object.freeze([
  '20260929120000_bonk_lab.sql',
  '20260930120000_bonk_lab_twitch.sql',
  '20261001120000_bonk_lab_third_party.sql',
  '20261002120000_sound_lab.sql',
  '20261003120000_sound_lab_custom_label.sql',
  '20261004120000_tts_lab.sql',
  '20261005120000_lab_moderation.sql',
  '20261006120000_tts_lab_cooldown_clear.sql',
  '20261007120000_moderation_d4.sql',
  '20261008120000_raffle_v2.sql',
  '20261009120000_raffle_scheduler.sql',
  '20261010120000_raffle_round_labels.sql',
]);

export interface MigrationScopes {
  prod: readonly string[];
  lab: readonly string[];
  legacyLabInProd: readonly string[];
}

export const MIGRATION_SCOPES: MigrationScopes = Object.freeze({
  prod: PROD_MIGRATIONS,
  lab: LAB_MIGRATIONS,
  legacyLabInProd: LEGACY_LAB_IN_PROD,
});

export class MigrationScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationScopeError';
  }
}

/**
 * Files of `scope`, in name order. Throws when a *.sql file is not classified (or classified twice),
 * whatever the scope: nothing is applied from a folder that holds an unclassified migration.
 */
export function selectMigrations(
  files: readonly string[],
  scope: MigrationScope,
  scopes: MigrationScopes = MIGRATION_SCOPES,
): string[] {
  const prod = new Set(scopes.prod);
  const lab = new Set(scopes.lab);
  for (const f of scopes.legacyLabInProd)
    if (!lab.has(f))
      throw new MigrationScopeError(
        `${f} is listed as a legacy Lab migration but not as a Lab migration`,
      );
  const sql = files.filter((f) => f.endsWith('.sql'));
  for (const f of sql) {
    if (prod.has(f) && lab.has(f))
      throw new MigrationScopeError(`${f} is classified both prod and lab`);
    if (!prod.has(f) && !lab.has(f))
      throw new MigrationScopeError(
        `unclassified migration ${f}: add it to PROD_MIGRATIONS or LAB_MIGRATIONS (src/db/migration-scopes.ts)`,
      );
  }
  const legacy = new Set(scopes.legacyLabInProd);
  const keep =
    scope === 'prod'
      ? (f: string) => prod.has(f) || legacy.has(f)
      : scope === 'lab'
        ? (f: string) => lab.has(f)
        : () => true;
  return sql.filter(keep).sort();
}
