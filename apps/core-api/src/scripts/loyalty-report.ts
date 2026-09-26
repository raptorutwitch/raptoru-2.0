// Read-only Loyalty report (preview or credit). Usage:
//   npm run loyalty:report -w @raptoru/core-api -- --latest [--csv out.csv] [--json]
//   npm run loyalty:report -w @raptoru/core-api -- --stream <twitchStreamId>
import { writeFile } from 'node:fs/promises';
import { createPgDb } from '../db/db.js';
import {
  buildLoyaltyReport,
  formatLoyaltyReport,
  latestLoyaltyStreamId,
  loyaltyReportCsv,
} from '../loyalty/report.js';

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
    const streamId = args.includes('--latest')
      ? await latestLoyaltyStreamId(q)
      : option('--stream');
    if (!streamId)
      return 'no loyalty data yet (is LOYALTY_PREVIEW enabled in core-api?)';
    return (
      (await buildLoyaltyReport(q, streamId, new Date())) ??
      `unknown stream ${streamId}`
    );
  });
  if (typeof report === 'string') {
    console.log(report);
    process.exitCode = 1;
  } else {
    console.log(
      args.includes('--json')
        ? JSON.stringify(report, null, 2)
        : formatLoyaltyReport(report),
    );
    const csv = option('--csv');
    if (csv) {
      await writeFile(csv, loyaltyReportCsv(report), 'utf8');
      console.log(`CSV written to ${csv}`);
    }
  }
} finally {
  await db.close();
}
