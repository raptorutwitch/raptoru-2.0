// Reads the legacy raptoru.fr Daily tables and imports them into Core.
// Dry-run unless --apply is passed. Never writes to the legacy database.
import {
  applyLegacyImport,
  buildLegacyImport,
  type LegacyDailyEventRow,
  type LegacyPlayerRow,
} from '../daily/legacy-import.js';
import { createPgDb } from '../db/db.js';

const legacyUrl = process.env.LEGACY_DATABASE_URL;
const coreUrl = process.env.DATABASE_URL;
if (!legacyUrl || !coreUrl)
  throw new Error('LEGACY_DATABASE_URL and DATABASE_URL are required');
const apply = process.argv.includes('--apply');

const legacy = createPgDb(legacyUrl);
const core = createPgDb(coreUrl);
try {
  const players = await legacy.query<LegacyPlayerRow>(
    `select twitch_user_id, login, display_name, total_daily, current_streak, best_streak, last_daily_stream
     from players`,
  );
  const events = await legacy.query<LegacyDailyEventRow>(
    `select id, twitch_user_id, pseudo, stream_id, streak_at_time, total_at_time, reward_at_time, created_at
     from daily_events`,
  );
  const plan = buildLegacyImport(players, events);
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        streamDays: plan.streamDays.length,
        viewers: plan.viewers.length,
        claims: plan.claims.length,
        warnings: plan.warnings,
        sample: plan.stats.slice(0, 5),
      },
      null,
      2,
    ),
  );
  if (apply) {
    await core.tx((q) => applyLegacyImport(q, plan));
    console.log('import applied');
  }
} finally {
  await legacy.close();
  await core.close();
}
