import {
  chaosEffectRequestSchema,
  type ChaosEffectView,
} from '@raptoru/schemas';
import { ChaosError, type ChaosEngineClient } from './engine-client.js';

// Chaos V2 lot 2 (docs/chaos/CONTRAT_LOT2.md § 3) : UNE fonction pour toute demande d'un viewer — achat livré par le
// Core (core-loop.ts) ou « Jouer sur mon PC » du Lab Interactions (POST /api/chaos/lab/play). Source jamais de
// confiance (le moteur refuse tout paramètre non exposé), cible = l'écran de la fiche de l'effet (mode E), politique
// `reject` : un effet qui ne peut pas démarrer tout de suite est refusé (le Core rembourse), jamais mis en file.

/** Ce qu'une demande de viewer peut fixer (forme de `engineRequest` de la fiche, catalog.js). */
const VIEWER_FIELDS = [
  'effect',
  'variant',
  'level',
  'params',
  'duration_ms',
  'transition',
];

export type ViewerEffectResult =
  | {
      ok: true;
      request_id: string;
      state: string;
      view: ChaosEffectView;
      /** « Tous les écrans » : une demande de viewer joue sur le premier seulement. */
      note?: string;
    }
  | { ok: false; code: string; message: string };

interface Monitor {
  device: string;
  primary?: boolean;
  order?: number;
}

/**
 * Écran(s) d'un choix de fiche (left, right, s:<rang>, primary, all, ou un nom \\.\DISPLAYn), de gauche à droite :
 * la règle du moteur (apps/chaos-engine/src/Model/ScreenLayout.cs), sur la liste `targets.list` (déjà rangée).
 */
export function resolveScreens(choice: string, monitors: Monitor[]): string[] {
  const m = [...monitors]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((x) => x.device);
  if (!m.length) throw new ChaosError('screen_missing', 'aucun écran détecté');
  if (choice === 'all') return m;
  if (choice === 'left') return [m[0]!];
  if (choice === 'right') return [m[m.length - 1]!];
  if (choice === 'primary')
    return [(monitors.find((x) => x.primary) ?? { device: m[0]! }).device];
  const rank = /^s:(\d{1,2})$/.exec(choice);
  if (rank && +rank[1]! > 0 && +rank[1]! < m.length - 1) return [m[+rank[1]!]!];
  if (m.includes(choice)) return [choice];
  throw new ChaosError(
    'screen_missing',
    `l'écran de la fiche (${choice}) n'existe plus : ${m.length} écran(s) détecté(s)`,
  );
}

export async function submitViewerEffect(
  runtime: { client: ChaosEngineClient },
  engineRequest: Record<string, unknown>,
  o: { source: 'core' | 'extension'; ref: string; requestId: string },
): Promise<ViewerEffectResult> {
  const extra = Object.keys(engineRequest).filter(
    (k) => !VIEWER_FIELDS.includes(k),
  );
  if (extra.length)
    return {
      ok: false,
      code: 'invalid_request',
      message: `champ non permis : ${extra.join(', ')}`,
    };
  try {
    const c = runtime.client;
    const effect = String(engineRequest.effect ?? '');
    const [cfg, targets] = await Promise.all([
      c.call<{ effects?: Record<string, { screen?: string }> }>('config.get'),
      c.call<{ monitors?: Monitor[] }>('targets.list', { windows: false }),
    ]);
    const screens = resolveScreens(
      cfg.effects?.[effect]?.screen ?? 'primary',
      targets.monitors ?? [],
    );
    const parsed = chaosEffectRequestSchema.safeParse({
      ...engineRequest,
      request_id: o.requestId,
      source: { kind: o.source, ref: o.ref },
      target: { kind: 'screen', device: screens[0] },
      policy: 'reject',
    });
    if (!parsed.success)
      return {
        ok: false,
        code: 'invalid_request',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')} : ${i.message}`)
          .join(' ; '),
      };
    const view = await c.call<ChaosEffectView>('effect.request', parsed.data);
    // Refus immédiat du moteur (politique reject : emplacement pris, même effet actif, plafond, délai, file pleine).
    if (view.state === 'finished')
      return {
        ok: false,
        code: view.reason ?? view.outcome ?? 'rejected',
        message: `refusé par le moteur (${view.outcome ?? '?'} : ${view.reason ?? '?'})`,
      };
    return {
      ok: true,
      request_id: view.request_id,
      state: view.state,
      view,
      ...(screens.length > 1
        ? {
            note: `« Tous les écrans » : la demande joue sur le premier écran seulement (${screens[0]})`,
          }
        : {}),
    };
  } catch (e) {
    return {
      ok: false,
      code: e instanceof ChaosError ? e.code : 'internal',
      message: (e as Error).message,
    };
  }
}
