// Upgrade test of a Studio installer (docs/CICD.md « Publier Studio »), on a THROWAWAY Windows machine only (a GitHub
// Actions runner): the latest public release is installed, the user's data is planted, the new installer is installed
// over it, then:
// - the installed version is the new one;
// - every byte of the user's data is unchanged: %APPDATA%\Raptoru Studio (studio.json, obs-connection.json,
//   se-connection.json, preferences) and the data folder it names (.runtime with the Twitch / Spotify connections,
//   the Core and bot .env, the Twitch tokens) — an update replaces the program, never the data.
//   node apps/studio/desktop/scripts/test-upgrade.mjs <folder holding the new installer>
// Refuses to run outside GitHub Actions or when Studio is already installed (it would replace a real installation).
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const { fetch } = globalThis;
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};
if (process.platform !== 'win32') fail('Windows only');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true')
  fail('throwaway machine only (GitHub Actions runner): it installs Studio');
const installDir = join(process.env.LOCALAPPDATA, 'Programs', 'Raptoru Studio');
if (existsSync(installDir))
  fail(`${installDir} already exists: refusing to replace an installation`);
const newDir = process.argv[2];
const newExe = readdirSync(newDir).find((f) =>
  /^Raptoru-Studio-Setup-.+\.exe$/.test(f),
);
if (!newExe) fail(`no installer in ${newDir}`);
const newVersion = /Setup-(.+)\.exe$/.exec(newExe)[1];

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const installed = () =>
  JSON.parse(
    readFileSync(
      join(
        installDir,
        'resources',
        'app',
        'apps',
        'studio',
        'desktop',
        'package.json',
      ),
      'utf8',
    ),
  ).version;
const install = (exe) => {
  execFileSync(exe, ['/S'], { stdio: 'inherit' });
  // A silent install never starts Studio; if it did, stop it (no network call to any service from here).
  try {
    execFileSync('taskkill', ['/IM', 'Raptoru Studio.exe', '/F'], {
      stdio: 'ignore',
    });
  } catch {
    /* not running */
  }
};

// 1. The latest public release (what an installed Studio runs before updating).
const latest = await (
  await fetch(
    'https://api.github.com/repos/raptorutwitch/raptoru-studio-releases/releases/latest',
    { headers: { accept: 'application/vnd.github+json' } },
  )
).json();
const asset = latest.assets?.find((a) => /\.exe$/.test(a.name));
if (!asset) fail('no installer in the latest public release');
const oldExe = join(process.env.RUNNER_TEMP, asset.name);
writeFileSync(
  oldExe,
  Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer()),
);
install(oldExe);
const before = installed();
console.log(`installed ${latest.tag_name} (${before})`);

// 2. The user's data, as on the streamer's PC (fake values).
const userData = join(process.env.APPDATA, 'Raptoru Studio');
const dataRoot = join(process.env.RUNNER_TEMP, 'Raptoru 2.0');
const planted = {
  [join(userData, 'studio.json')]: JSON.stringify({ dataRoot }),
  [join(userData, 'obs-connection.json')]:
    '{"url":"ws://127.0.0.1:4455","password":"fake"}',
  [join(userData, 'se-connection.json')]: '{"token":"fake-streamelements"}',
  [join(userData, 'Preferences')]: '{"fake":"preferences"}',
  [join(
    dataRoot,
    'apps',
    'studio',
    'server',
    '.runtime',
    'twitch-connections.json',
  )]: '{"bot":"fake-twitch-token"}',
  [join(
    dataRoot,
    'apps',
    'studio',
    'server',
    '.runtime',
    'spotify',
    'oauth.json',
  )]: '{"refresh":"fake-spotify-dpapi"}',
  [join(dataRoot, 'apps', 'core-api', '.env')]:
    'BOT_SECRET=fake-0123456789abcdef\n',
  [join(dataRoot, 'apps', 'twitch-bot', '.twitch-tokens.json')]:
    '{"accessToken":"fake-access","refreshToken":"fake-refresh"}',
};
for (const [p, text] of Object.entries(planted)) {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
}
const hashes = Object.fromEntries(Object.keys(planted).map((p) => [p, sha(p)]));

// 3. The new installer over it.
install(join(newDir, newExe));
const after = installed();
console.log(`installed ${newExe} (${after})`);

// 4. Proofs.
const problems = [];
if (after !== newVersion)
  problems.push(`installed version ${after} ≠ ${newVersion}`);
if (after === before) problems.push('the version did not change');
for (const [p, h] of Object.entries(hashes))
  if (!existsSync(p)) problems.push(`removed by the update: ${p}`);
  else if (sha(p) !== h) problems.push(`changed by the update: ${p}`);
if (problems.length) fail(problems.join('\n  '));
console.log(
  `UPGRADE OK — ${before} → ${after}: ${Object.keys(planted).length} user files byte-identical (profile, Twitch, Spotify, OBS, StreamElements, .env, tokens)`,
);
