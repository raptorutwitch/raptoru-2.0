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

export type MigrationScope = 'prod' | 'lab' | 'all' | 'staging';

/** Production schema (Daily, Presence, Wallet, Loyalty). */
export const PROD_MIGRATIONS: readonly string[] = Object.freeze([
  '20260924120000_daily.sql',
  '20260925120000_presence.sql',
  '20260926120000_wallet.sql',
  '20260927120000_loyalty_engine.sql',
  '20260928120000_daily_wallet.sql',
  // Studio installations: per-installation credential of the production transport (ASTRA-P1-019).
  '20261016120000_studio_installations.sql',
  // Twitch alerts V1, production schema: the final Lab alerts tables in one additive, idempotent file (the Lab keeps
  // its two files; same resulting schema, checked by test/alerts-prod-migration.test.ts).
  '20261024120000_alerts.sql',
  // Points de chaîne V1, production schema (same as the Lab file; Soundboard accepts sounds paid by channel points).
  '20261025130000_channel_points.sql',
  // Random Ban V2 (M1.1), production schema (same as the Lab file).
  '20261026130000_random_ban.sql',
  // Roue du Sub: spins and pending gains (same as the Lab file).
  '20261027130000_sub_wheel.sql',
  // Opening balances (economic cutover): one import per currency, one opening per wallet.
  '20261028130000_wallet_opening_import.sql',
  // Opening balances: every source account recorded once (imported into one wallet, or excluded).
  '20261029130000_wallet_opening_import_sources.sql',
  // Crédits TTS / Soundboard: secondary currencies of the canonical Wallet (D2).
  '20261030130000_wallet_credit_currencies.sql',
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
  // Twitch stream id of a Lab stream session (ASTRA-P1-007).
  '20261016130000_lab_stream_session_twitch_id.sql',
  '20261017120000_bonk_lab_viewer_oauth.sql',
  // Bonk VNext lot 5: salves (volley columns on bonk_lab_interactions).
  '20261018120000_bonk_lab_volleys.sql',
  // Jeu des mots V1 lot 2: cmd_steps also carries Jeu des mots messages (origin, no invocation).
  '20261019120000_cmd_steps_word_game.sql',
  // Jeu des mots V1 lot 3: words, winning messages, finds, channel state; ledger kind word_game.
  '20261019130000_word_game_lab.sql',
  // Roulette and Slot V1: plays, Studio switch; ledger kind and cmd_steps origin mini_game.
  '20261020120000_mini_games_lab.sql',
  // Duel V1: challenges between two Twitch IDs (stake through the Lab wallet, answers through cmd_steps).
  '20261021120000_mini_game_duels_lab.sql',
  // Twitch alerts V1 lot A1: source events (dedup), durable alert queue.
  '20261022120000_alerts_lab.sql',
  // Twitch alerts: one queue per family (follow, subscription, bits, raid, donation), several families at once.
  '20261023120000_alerts_lab_families.sql',
  // Points de chaîne V1: rewards, rules, redemptions, OBS jobs; Soundboard sounds paid by channel points.
  '20261025120000_channel_points_lab.sql',
  // Random Ban V2 (M1.1): requests, target, sanction, refund owed, animation.
  '20261026120000_random_ban_lab.sql',
  // Roue du Sub: spins (one per sub / resub / Prime), pending gains, switch OFF by default.
  '20261027120000_sub_wheel_lab.sql',
  // Points de chaîne « accorder des crédits »: its ledger kind on the Lab test wallet.
  '20261030120000_lab_ledger_channel_points.sql',
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

/**
 * The staging Core (Coolify, test data only) serves the Lab modules to real Twitch testers through the
 * viewer frontier and the Studio cockpit: on top of the production selection it needs exactly these
 * post-boundary Lab files (Extension moderation idempotency, Tombola stream sessions, Bonk Twitch emotes
 * linking of the viewer frontier). Explicit and closed: never Commands V2 or any other Lab file;
 * never part of the production scope.
 */
export const STAGING_EXTRA_LAB_MIGRATIONS: readonly string[] = Object.freeze([
  '20261015120000_lab_moderation_idempotency.sql',
  '20261016130000_lab_stream_session_twitch_id.sql',
  '20261017120000_bonk_lab_viewer_oauth.sql',
  // Bonk VNext lot 5: the staging Core serves Bonk salves to the Extension (/v1/ext).
  '20261018120000_bonk_lab_volleys.sql',
]);

export interface MigrationScopes {
  prod: readonly string[];
  lab: readonly string[];
  legacyLabInProd: readonly string[];
  /** Lab files added to the production selection for the staging Core only. */
  stagingExtra?: readonly string[];
}

export const MIGRATION_SCOPES: MigrationScopes = Object.freeze({
  prod: PROD_MIGRATIONS,
  lab: LAB_MIGRATIONS,
  legacyLabInProd: LEGACY_LAB_IN_PROD,
  stagingExtra: STAGING_EXTRA_LAB_MIGRATIONS,
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
  const stagingExtra = new Set(scopes.stagingExtra ?? []);
  for (const f of stagingExtra)
    if (!lab.has(f))
      throw new MigrationScopeError(
        `${f} is listed as a staging extra but not as a Lab migration`,
      );
  const keep =
    scope === 'prod'
      ? (f: string) => prod.has(f) || legacy.has(f)
      : scope === 'staging'
        ? (f: string) => prod.has(f) || legacy.has(f) || stagingExtra.has(f)
        : scope === 'lab'
          ? (f: string) => lab.has(f)
          : () => true;
  return sql.filter(keep).sort();
}
