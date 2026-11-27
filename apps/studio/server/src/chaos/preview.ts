import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Aperçu animé d'une fiche (Studio › Chaos) : le moteur rend l'effet, avec les réglages de la fiche, sur une scène de
// jeu de synthèse, dans un processus court et séparé (`ChaosEngine.exe --preview-anim`) : aucune fenêtre, aucune
// capture, rien à l'écran, aucun effet sur le moteur en marche. Même code que l'effet réel : l'aperçu ne peut pas
// promettre autre chose que ce que l'effet fera. Résultats gardés en mémoire (mêmes réglages → même image).

export interface PreviewResult {
  image: string; // data:image/jpeg;base64,…
  frames: number;
  cols: number;
  w: number;
  h: number;
  fps: number;
  head_ms: number;
  tail_from_ms: number;
  total_ms: number;
}

const CACHE = new Map<string, PreviewResult>();
const MAX_CACHED = 24;
let running: Promise<unknown> = Promise.resolve();

export class PreviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Un seul rendu à la fois (le GPU reste au jeu), 20 s au plus. */
export function renderPreview(
  exe: string,
  stateDir: string,
  effect: string,
  variant: string | null,
  preset: unknown,
): Promise<PreviewResult> {
  if (!/^[a-z][a-z0-9_.]{0,40}$/.test(effect))
    return Promise.reject(
      new PreviewError('invalid_request', 'effet invalide'),
    );
  if (variant !== null && !/^[a-z][a-z0-9_]{0,40}$/.test(variant))
    return Promise.reject(
      new PreviewError('invalid_request', 'variante invalide'),
    );
  const presetJson = JSON.stringify(preset ?? {});
  if (presetJson.length > 8000)
    return Promise.reject(
      new PreviewError('invalid_request', 'réglages trop longs'),
    );
  const key = createHash('sha1')
    .update(`${effect}|${variant ?? '-'}|${presetJson}`)
    .digest('hex')
    .slice(0, 16);
  const hit = CACHE.get(key);
  if (hit) return Promise.resolve(hit);
  if (!existsSync(exe))
    return Promise.reject(
      new PreviewError('engine_absent', 'Moteur introuvable.'),
    );
  const dir = join(stateDir, 'preview');
  mkdirSync(dir, { recursive: true });
  const job = running.then(
    () =>
      new Promise<PreviewResult>((resolve, reject) => {
        const jpg = join(dir, `${key}.jpg`);
        const json = join(dir, `${key}.json`);
        writeFileSync(json, presetJson);
        execFile(
          exe,
          [
            '--preview-anim',
            jpg,
            effect,
            variant ?? '-',
            json,
            '--cache',
            join(stateDir, 'shader-cache'),
          ],
          { timeout: 20000, windowsHide: true },
          (err, stdout) => {
            const out = String(stdout).trim().split(/\r?\n/).pop() ?? '';
            let info: Record<string, unknown> = {};
            try {
              info = JSON.parse(out) as Record<string, unknown>;
            } catch {
              /* sortie illisible : traitée ci-dessous */
            }
            try {
              if (typeof info.error === 'string')
                return reject(
                  new PreviewError(
                    info.error,
                    String(info.message ?? info.error),
                  ),
                );
              if (err || !existsSync(jpg))
                return reject(
                  new PreviewError(
                    'preview_failed',
                    err?.message ?? 'aperçu non rendu',
                  ),
                );
              const r: PreviewResult = {
                ...(info as unknown as Omit<PreviewResult, 'image'>),
                image: `data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}`,
              };
              CACHE.set(key, r);
              if (CACHE.size > MAX_CACHED)
                CACHE.delete(CACHE.keys().next().value!);
              resolve(r);
            } finally {
              rmSync(jpg, { force: true });
              rmSync(json, { force: true });
            }
          },
        );
      }),
  );
  running = job.catch(() => undefined);
  return job;
}
