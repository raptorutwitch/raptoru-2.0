#!/usr/bin/env node
// Halloween media import (docs/HALLOWEEN.md) — converts COPIES of the streamer's screamer / apparition videos into what
// Studio's overlay plays (WebM VP9 with alpha + Opus, loudness evened out), writes their manifest and a small thumbnail
// per media for the Twitch extension shop. The originals are only read (never moved, rewritten or deleted).
//
//   node apps/studio/server/scripts/halloween-import.mjs [--source <dir>] [--ffmpeg <ffmpeg.exe>] [--out <dir>]
//        [--thumbs <dir>] [--only <id,id>] [--force]
//
// Defaults: source = the streamer's Halloween folder; out = apps/studio/server/.runtime/halloween/media (Studio's
// storage, outside Git); thumbs = apps/twitch-extension/extension/assets/halloween (shipped with the extension).
// A media already converted from the same original (same size and date) is kept unless --force.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const SOURCE = arg('source', 'C:/Users/Antoni/Documents/Stream PROJET/Halloween');
const FFMPEG = arg('ffmpeg', process.env.FFMPEG ?? 'ffmpeg');
const OUT = resolve(arg('out', join(ROOT, 'apps/studio/server/.runtime/halloween/media')));
const THUMBS = resolve(arg('thumbs', join(ROOT, 'apps/twitch-extension/extension/assets/halloween')));
const ONLY = arg('only', '')
  .split(',')
  .filter(Boolean);
const FORCE = process.argv.includes('--force');

const SCREAMERS = 'Anim de stream/Screameur Audio';
/**
 * The media (stable id → original). `clip`: [start, duration] seconds kept from a long original. `kind`: screamer
 * (sudden, with its sound) or apparition (something crosses / shows up). The catalogue (prices, cooldowns, on / off)
 * lives in the Core; this list only says which files exist.
 */
export const MEDIA = [
  { id: 'baby', label: 'Bébé', file: `${SCREAMERS}/Baby Screamer Audio.mov`, kind: 'screamer' },
  { id: 'balloon-boy', label: 'Balloon Boy', file: `${SCREAMERS}/Ballon boy screamer Audio.mov`, kind: 'screamer' },
  { id: 'bonnie', label: 'Bonnie', file: `${SCREAMERS}/Bonnie Screameur Son.mov`, kind: 'screamer' },
  { id: 'bonnie-walking', label: 'Bonnie rôde', file: `${SCREAMERS}/Bonnie Walking Son.mov`, kind: 'apparition' },
  { id: 'brique', label: 'Brique bizarre', file: `${SCREAMERS}/Brique bizarre_V2.mov`, kind: 'screamer' },
  { id: 'castor-mutant', label: 'Castor mutant', file: `${SCREAMERS}/Castor Mutant_V2.mov`, kind: 'screamer' },
  { id: 'castor', label: 'Castor', file: `${SCREAMERS}/Castor_V2.mov`, kind: 'screamer' },
  { id: 'chat', label: 'Chat', file: `${SCREAMERS}/Cat screamer Audio.mov`, kind: 'screamer' },
  { id: 'clown-side', label: 'Clown de côté', file: `${SCREAMERS}/Clown Side_V2.mov`, kind: 'screamer' },
  { id: 'clown', label: 'Clown', file: `${SCREAMERS}/Clown_V2.mov`, kind: 'screamer' },
  { id: 'crane', label: 'Crâne', file: `${SCREAMERS}/Crâne V_2.mov`, kind: 'screamer' },
  { id: 'cuphead', label: 'Cuphead', file: `${SCREAMERS}/Cuphead Screamer Audio.mov`, kind: 'screamer' },
  { id: 'foxy', label: 'Foxy', file: `${SCREAMERS}/Foxy screamer son.mov`, kind: 'screamer' },
  { id: 'ghost-girl', label: 'Fille fantôme', file: `${SCREAMERS}/Ghost Girl Son.mov`, kind: 'apparition' },
  { id: 'hibou', label: 'Hibou', file: `${SCREAMERS}/Hiboux_V2.mov`, kind: 'screamer' },
  { id: 'huggy-wuggy', label: 'Huggy Wuggy', file: `${SCREAMERS}/Huggy Wuggy_V2.mov`, kind: 'screamer' },
  { id: 'enfant', label: 'Enfant', file: `${SCREAMERS}/Kid Jump Screamer Audio.mov`, kind: 'screamer' },
  { id: 'enfant-2', label: 'Enfant 2', file: `${SCREAMERS}/Kid jumping 2 Screamer Audio.mov`, kind: 'screamer' },
  { id: 'mickey-2', label: 'Mickey 2', file: `${SCREAMERS}/Mickey Screamer 2 Audio.mov`, kind: 'screamer' },
  { id: 'oeuf', label: 'Œuf', file: `${SCREAMERS}/Oeuf_V2.mov`, kind: 'screamer' },
  { id: 'puppet', label: 'Puppet', file: `${SCREAMERS}/Puppet Screamer Son.mov`, kind: 'screamer' },
  { id: 'puppet-2', label: 'Puppet 2', file: `${SCREAMERS}/Puppet Screameur Son.mov`, kind: 'screamer' },
  { id: 'glitch', label: 'Glitch', file: `${SCREAMERS}/Screamer Glitch Audio.mov`, kind: 'screamer' },
  { id: 'golden-freddy', label: 'Golden Freddy', file: `${SCREAMERS}/Screamer Golden Freddy Audio.mov`, kind: 'screamer' },
  { id: 'mickey', label: 'Mickey', file: `${SCREAMERS}/Screamer Mickey Audio.mov`, kind: 'screamer' },
  { id: 'mickey-stare', label: 'Mickey te fixe', file: `${SCREAMERS}/Screamer Mickey Stare Audio.mov`, kind: 'screamer' },
  { id: 'stare-glitch', label: 'Regard glitché', file: `${SCREAMERS}/Stare Screamer Glitch Audio.mov`, kind: 'screamer' },
  { id: 'tete-de-trou', label: 'Tête de trou', file: `${SCREAMERS}/Tête de trou_V2².mov`, kind: 'screamer' },
  { id: 'chauves-souris', label: 'Chauves-souris', file: 'Anim de stream/Chauve-Souris Son.mov', kind: 'apparition' },
  {
    id: 'araignee',
    label: 'Araignée',
    file: 'Araignée/Araignée 1 minute loop balade.mov',
    kind: 'apparition',
    clip: [0, 12],
  },
];

function ff(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`ffmpeg introuvable (${FFMPEG}) : ${r.error.message}`);
  return r;
}

/** Duration, size and streams of a media (read from ffmpeg's banner: no ffprobe needed). */
function probe(path) {
  const info = ff(['-i', path]).stderr;
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  const v = /Video: ([^,\n]+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(info);
  return {
    duration_ms: m ? Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000) : null,
    codec: v?.[1]?.trim() ?? null,
    width: v ? +v[2] : null,
    height: v ? +v[3] : null,
    alpha: /yuva|argb|rgba|bgra/.test(info),
    audio: /Audio: /.test(info),
  };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(THUMBS, { recursive: true });
  const manifestPath = join(OUT, 'manifest.json');
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { media: [] };
  const known = new Map(previous.media.map((m) => [m.id, m]));
  const media = [];
  const problems = [];
  for (const m of MEDIA) {
    const src = join(SOURCE, m.file);
    if (ONLY.length && !ONLY.includes(m.id)) {
      if (known.has(m.id)) media.push(known.get(m.id));
      continue;
    }
    if (!existsSync(src)) {
      problems.push(`${m.id} : original absent (${m.file})`);
      continue;
    }
    const st = statSync(src);
    const source = { file: m.file, size: st.size, mtime: st.mtime.toISOString() };
    const out = join(OUT, `${m.id}.webm`);
    const thumb = join(THUMBS, `${m.id}.jpg`);
    const prev = known.get(m.id);
    if (
      !FORCE &&
      prev &&
      existsSync(out) &&
      existsSync(thumb) &&
      prev.source?.size === source.size &&
      prev.source?.mtime === source.mtime
    ) {
      media.push(prev);
      console.log(`= ${m.id} (déjà converti)`);
      continue;
    }
    const before = probe(src);
    const clip = m.clip ? ['-ss', String(m.clip[0]), '-t', String(m.clip[1])] : [];
    const tmp = `${out}.part.webm`;
    const audio = before.audio
      ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000']
      : ['-an'];
    const enc = ff([
      '-y',
      ...clip,
      '-i',
      src,
      // 1080p at most (the 640×360 originals stay as they are; the page scales them to the screen).
      '-vf',
      "scale='min(1920,iw)':-2:flags=lanczos",
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      before.alpha ? 'yuva420p' : 'yuv420p',
      '-b:v',
      '0',
      '-crf',
      '31',
      '-row-mt',
      '1',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-auto-alt-ref',
      '0',
      ...audio,
      tmp,
    ]);
    if (enc.status !== 0 || !existsSync(tmp)) {
      problems.push(`${m.id} : conversion échouée (${enc.stderr.split('\n').slice(-3).join(' ')})`);
      continue;
    }
    renameSync(tmp, out);
    // Thumbnail: a frame at 60 % of the media, over the shop's dark background (no transparency in a JPEG).
    const at = ((before.duration_ms ?? 2000) * (m.clip ? 0.3 : 0.6)) / 1000;
    const th = ff([
      '-y',
      ...clip,
      '-ss',
      String(at.toFixed(2)),
      '-i',
      src,
      '-filter_complex',
      'color=c=0x140f1c:s=320x180[bg];[0:v]scale=320:180:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1',
      '-frames:v',
      '1',
      '-q:v',
      '5',
      thumb,
    ]);
    if (th.status !== 0) problems.push(`${m.id} : miniature échouée`);
    const after = probe(out);
    const entry = {
      id: m.id,
      label: m.label,
      kind: m.kind,
      file: `${m.id}.webm`,
      thumb: `assets/halloween/${m.id}.jpg`,
      duration_ms: after.duration_ms,
      width: after.width,
      height: after.height,
      alpha: before.alpha,
      audio: before.audio,
      bytes: statSync(out).size,
      source,
      original: { codec: before.codec, width: before.width, height: before.height, duration_ms: before.duration_ms },
    };
    media.push(entry);
    console.log(
      `+ ${m.id} ${entry.width}x${entry.height} ${entry.duration_ms} ms ${(entry.bytes / 1024).toFixed(0)} Kio${entry.alpha ? ' alpha' : ''}${entry.audio ? ' son' : ' muet'}`,
    );
  }
  writeFileSync(
    manifestPath,
    JSON.stringify({ version: 1, generated_at: new Date().toISOString(), media }, null, 2),
  );
  console.log(`\n${media.length} médias dans ${manifestPath}`);
  if (problems.length) {
    console.log(`\nProblèmes :\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
  }
}

main();
