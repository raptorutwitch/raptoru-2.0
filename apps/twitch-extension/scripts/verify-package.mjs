// Reopens a package written by scripts/package.mjs and checks it before any upload to Twitch:
//   npm run verify:package -w @raptoru/twitch-extension -- release/<zip>
// Prints build-manifest.json and the embedded inventory, then fails (exit 1) on: unknown target,
// apiBase other than the target's, any legacy URL (raptoru.fr/api or the raptoru.fr site; the Core hosts
// core.raptoru.fr / core-staging.raptoru.fr are allowed), a missing page, a page whose first <script> is
// not the Twitch helper, an inline <script>, documentation, the Twitch mock, .env or .map files.
// package.mjs runs the same verification on every zip it builds.
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './targets.mjs';

export const PAGES = Object.freeze([
  'panel.html',
  'mobile.html',
  'video_component.html',
  'config.html',
]);
export const TWITCH_HELPER =
  'https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js';
export const VALIDATION_LINE = 'Validé par Antoni : oui';
// The legacy EBS and the legacy site; the Core hosts (core.raptoru.fr, core-staging.raptoru.fr) are allowed.
export const LEGACY = /raptoru\.fr\/api|(?<![\w.-])raptoru\.fr/i;
// Calibration: no Raptoru endpoint at all, not even in a comment. Local hosts only as URLs (`//127.0.0.1`):
// shared/emote-access.js compares a hostname with the bare loopback literal for the Lab's consent page
// (dead code without RUNTIME.labTwitchAuthorizePath, which no package defines).
export const CALIBRATION_FORBIDDEN =
  /raptoru\.fr|core-staging|\/v1\/ext|\/\/(localhost|127\.0\.0\.1)/i;
export const TEXTUAL = /\.(js|mjs|html|css|json|txt|svg|md)$/i;
// lab-modules/: Lab-only modules (extension/lab-modules), never in any package.
const FORBIDDEN_FILE =
  /(^|\/)(\.env[^/]*|twitch-ext-mock\.js|[^/]*\.map|[^/]*\.md)$|^lab-modules\//i;

/** Entries of a STORED zip (the only kind package.mjs writes). */
export function unzipStored(zip) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not a zip: end of central directory missing');
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(p) !== 0x02014b50)
      throw new Error('corrupt zip: central directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const comment = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLength);
    if (method !== 0) throw new Error(`${name}: compressed entry (not STORED)`);
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.push({ name, data: zip.subarray(start, start + size) });
    p += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** Every check of a package; `errors` empty = uploadable as far as this script can tell. */
export function verifyZip(zip) {
  const errors = [];
  let entries;
  try {
    entries = unzipStored(Buffer.from(zip));
  } catch (error) {
    return { manifest: null, inventory: null, errors: [error.message] };
  }
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const text = (name) => byName.get(name)?.toString('utf8') ?? null;

  let manifest = null;
  try {
    manifest = JSON.parse(text('build-manifest.json'));
  } catch {
    errors.push('build-manifest.json missing or unreadable');
  }
  const target = Object.hasOwn(TARGETS, manifest?.target ?? '')
    ? TARGETS[manifest.target]
    : null;
  if (manifest && !target) errors.push(`unknown target ${manifest.target}`);
  if (manifest && manifest.dirty !== false)
    errors.push('manifest: built from a modified tree');
  if (manifest && !/^[0-9a-f]{40}$/.test(manifest.commit ?? ''))
    errors.push('manifest: source commit missing');

  if (target) {
    if (manifest.apiBase !== target.apiBase)
      errors.push(
        `manifest apiBase ${JSON.stringify(manifest.apiBase)} is not the ${target.name} one`,
      );
    const runtime = text('shared/runtime-config.js') ?? '';
    if (
      !runtime.includes(`apiBase: ${JSON.stringify(target.apiBase)}`) ||
      !runtime.includes(`mode: '${target.mode}'`) ||
      runtime.includes('environment:') !== Boolean(target.environment) ||
      runtime.includes('labModules') ||
      (target.environment &&
        !runtime.includes(`environment: '${target.environment}'`))
    )
      errors.push(`shared/runtime-config.js is not the ${target.name} config`);
  }

  for (const { name, data } of entries) {
    if (!/^[A-Za-z0-9._/-]+$/.test(name)) errors.push(`unsafe name ${name}`);
    if (FORBIDDEN_FILE.test(name)) errors.push(`forbidden file ${name}`);
    if (!TEXTUAL.test(name)) continue;
    const content = data.toString('utf8');
    const legacy = LEGACY.exec(content);
    if (legacy) errors.push(`legacy URL ${legacy[0]} in ${name}`);
    const local =
      target?.name === 'calibration' && CALIBRATION_FORBIDDEN.exec(content);
    if (local) errors.push(`${local[0]} in ${name} (calibration package)`);
    if (/\.html$/i.test(name)) {
      for (const tag of content.match(/<script\b[^>]*>/gi) ?? [])
        if (!/\bsrc\s*=/i.test(tag))
          errors.push(`inline script in ${name}: ${tag}`);
    }
  }

  for (const page of PAGES) {
    const html = text(page);
    if (html === null) {
      errors.push(`missing page ${page}`);
      continue;
    }
    const first = /<script\b[^>]*>/i.exec(html)?.[0];
    // Calibration placeholders may carry no script at all.
    if (
      !first &&
      target?.name === 'calibration' &&
      page !== 'video_component.html'
    )
      continue;
    if (!first?.includes(`src="${TWITCH_HELPER}"`))
      errors.push(`${page}: the first <script> is not the Twitch helper`);
  }

  const inventory = text('build-inventory.txt');
  if (target?.name === 'production') {
    if (inventory === null)
      errors.push('production package without build-inventory.txt');
    else if (
      !inventory.split(/\r?\n/).some((l) => l.trim() === VALIDATION_LINE)
    )
      errors.push(`build-inventory.txt lacks « ${VALIDATION_LINE} »`);
  }
  return { manifest, inventory, errors, fileCount: entries.length };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run verify:package -- <zip>');
    process.exit(2);
  }
  const { manifest, inventory, errors, fileCount } = verifyZip(
    readFileSync(file),
  );
  console.log(`${resolve(file)}: ${fileCount ?? 0} files`);
  console.log(`build-manifest.json ${JSON.stringify(manifest, null, 2)}`);
  if (inventory !== null)
    console.log(`build-inventory.txt\n${inventory.trimEnd()}`);
  if (errors.length) {
    console.error(`REFUSED (${errors.length}):\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log('OK: package verified.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
