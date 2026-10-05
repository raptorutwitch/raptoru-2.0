import { systemClock } from '../clock.js';
import { createPgDb } from '../db/db.js';
import { StudioInstallations } from '../studio/installations.js';

// Operator tool of the future production transport (ASTRA-P1-019): pair, revoke or list the Studio
// installations of the Core database given by DATABASE_URL. Never prints a secret (Core has none).
//   npm run studio:installation -w @raptoru/core-api -- pair <pairing code> "<label>"
//   npm run studio:installation -w @raptoru/core-api -- revoke <installation id>
//   npm run studio:installation -w @raptoru/core-api -- list

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const [command, arg, label] = process.argv.slice(2);

const db = createPgDb(url);
const installations = new StudioInstallations(db, systemClock);
try {
  if (command === 'pair' && arg && label) {
    const row = await installations.register(arg, label);
    console.log(`paired ${row.installation_id} (${row.label})`);
  } else if (command === 'revoke' && arg) {
    console.log(
      (await installations.revoke(arg))
        ? `revoked ${arg}`
        : `unknown installation ${arg}`,
    );
  } else if (command === 'list') {
    for (const r of await installations.list())
      console.log(
        `${r.installation_id}  ${r.label}  ${r.revoked_at ? 'REVOKED ' + r.revoked_at.toISOString() : 'active'}  last seen ${r.last_seen_at?.toISOString() ?? 'never'}`,
      );
  } else {
    console.error(
      'usage: pair <pairing code> <label> | revoke <installation id> | list',
    );
    process.exitCode = 2;
  }
} finally {
  await db.close();
}
