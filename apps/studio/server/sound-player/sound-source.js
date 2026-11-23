// The local URL of a sound handed by Core, for the player: only the two shapes Core resolves — a bank file (a local
// extension asset) or a file published from Studio (named by its SHA-256; Studio serves its local copy, fetched from
// Core if needed). Anything else: null (the player reports invalid_sound, never plays it).
const LOCAL_SOUND = /^assets\/sounds\/[a-z0-9][a-z0-9._-]*\.mp3$/;
const PUBLISHED_SOUND = /^sound-files\/([0-9a-f]{64}\.wav)$/;

export function soundSource(url) {
  const s = String(url ?? '');
  if (LOCAL_SOUND.test(s)) return '/ext/' + s;
  const published = PUBLISHED_SOUND.exec(s);
  return published ? '/sound-lab/files/' + published[1] : null;
}
