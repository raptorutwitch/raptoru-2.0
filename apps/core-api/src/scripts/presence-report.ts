// Read-only presence report. Usage:
//   npm run presence:report -w @raptoru/core-api -- --latest
//   npm run presence:report -w @raptoru/core-api -- --stream <twitchStreamId> [--csv out.csv] [--json]
import { writeFile } from 'node:fs/promises';
import { createPgDb } from '../db/db.js';
import {
  buildPresenceReport,
  formatPresenceReport,
  latestPresenceStreamId,
  presenceReportCsv,
} from '../presence/presence-report.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const db = createPgDb(url);
try {
  const report = await db.tx(async (q) => {
    await q.query('set transaction read only');
    const latest = args.includes('--latest');
    const streamId = latest
      ? await latestPresenceStreamId(q)
      : option('--stream');
    if (!streamId)
      return latest
        ? 'no presence data yet (no stream observed)'
        : 'pass --latest or --stream <id>';
    return (
      (await buildPresenceReport(q, streamId, new Date())) ??
      `unknown stream ${streamId}`
    );
  });
  if (typeof report === 'string') {
    console.log(`SHADOW MODE — ${report}`);
    process.exitCode = 1;
  } else {
    console.log(
      args.includes('--json')
        ? JSON.stringify(report, null, 2)
        : formatPresenceReport(report),
    );
    const csv = option('--csv');
    if (csv) {
      await writeFile(csv, presenceReportCsv(report), 'utf8');
      console.log(`CSV written to ${csv}`);
    }
  }
} finally {
  await db.close();
}
