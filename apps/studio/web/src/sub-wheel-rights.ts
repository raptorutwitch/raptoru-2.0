import {
  redrawConfirm,
  replayConfirm,
  type SwRightsUi,
  type SwViewerAdmin,
  type SwViewerHit,
} from './sub-wheel-rights-view.js';

// Roue du Sub V2 — Studio « Droits » (RV2-2): the actions of the rights screen. Every action asks a confirmation;
// a new right or a new draw also needs a reason (journal). One action at a time (a second click is ignored), and the
// key of a new right / new draw is drawn once per confirmation: a resent request is the same right in Core.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

/** Core refusals of these actions, in plain words. */
const REFUSAL: Record<
  string,
  (name: string, d: Record<string, unknown>) => string
> = {
  rights_available: (name, d) =>
    `${name} a déjà ${Number(d.usable) || 1} tour(s) à utiliser : lancez-les (aucun nouveau droit).`,
  redraw_pending: () => 'Une relance est déjà en attente pour ce tirage.',
  broadcaster_only: () => 'Réservé au diffuseur.',
  not_redrawable: () =>
    'Ce tirage ne peut pas être relancé (test ou simulation).',
  not_drawn_yet: () => 'Ce tour n’a pas encore été tiré.',
  forbidden: () => 'Permission refusée par le Core.',
  needs_review: () =>
    'Ce tour est à vérifier : décidez d’abord dans « À vérifier ».',
  not_owed: () => 'Ce tour n’est plus en attente.',
  spin_not_found: () => 'Tour introuvable.',
  grant_key_reused: () => 'Action déjà utilisée : recommencez.',
  redraw_key_reused: () => 'Action déjà utilisée : recommencez.',
  not_replayable: () =>
    'Ce tirage ne peut pas être rejoué (déjà affiché, en cours, ou un test).',
};

class Refused extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface RightsDeps {
  root: HTMLElement;
  /** Short feedback under the section (already shown by the next render). */
  notify: (text: string) => void;
  render: () => void;
}

export function mountSubWheelRights(d: RightsDeps) {
  const ui: SwRightsUi = {
    query: '',
    hits: null,
    viewer: null,
    grantOpen: false,
  };
  let busy = false;
  const field = (f: string) =>
    d.root.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
  const value = (f: string) => field(f)?.value.trim() ?? '';

  const call = async <T>(path: string, body?: object): Promise<T> => {
    const res = await fetch(`/api/sub-wheel${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = await res.json();
    if (!res.ok) throw new Refused(out.error ?? `HTTP ${res.status}`, out);
    return out as T;
  };
  const load = async (id: string) => {
    ui.viewer = await call<SwViewerAdmin>(`/admin/viewers/${id}`);
  };
  const name = () => ui.viewer?.viewer.name ?? 'ce viewer';

  /** One action at a time; its feedback; the viewer re-read after it. */
  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    busy = true;
    let text: string;
    try {
      text = await action();
    } catch (e) {
      const r = e as Refused;
      text = `Refusé : ${REFUSAL[r.code]?.(name(), r.details ?? {}) ?? r.message}`;
    }
    try {
      if (ui.viewer) await load(ui.viewer.viewer.id);
    } catch {
      /* the feedback says what happened; « Actualiser » re-reads */
    }
    busy = false;
    (document.activeElement as HTMLElement | null)?.blur();
    d.notify(text);
  };

  const request = (spinId: string) => call(`/spins/${spinId}/request`, {});

  return {
    ui,
    /** Handles the forms of the screen; false: not one of them. */
    submit(role: string | undefined) {
      if (role === 'swr-search') {
        const q = value('swr-q');
        if (q.replace(/^@+/, '').length < 2) {
          d.notify('Pseudo : au moins 2 caractères.');
          return true;
        }
        void run(async () => {
          ui.query = q;
          ui.hits = await call<SwViewerHit[]>('/admin/search', { q });
          if (ui.hits.length === 1) await load(ui.hits[0]!.id);
          else ui.viewer = null;
          return ui.hits.length
            ? `${ui.hits.length} viewer(s) trouvé(s).`
            : 'Aucun viewer trouvé.';
        });
        return true;
      }
      if (role === 'swr-grant' && ui.viewer) {
        const v = ui.viewer.viewer;
        const tier = Number(value('swr-tier') || 1);
        const months = Math.max(
          1,
          Math.min(200, Math.round(Number(value('swr-months')) || 1)),
        );
        const note = value('swr-note');
        const now = field('swr-now')?.checked ?? true;
        if (!note) {
          d.notify('Motif obligatoire (gardé dans l’historique).');
          return true;
        }
        if (
          !confirm(
            `Accorder une roue à ${v.name} ?\n\nUn NOUVEAU droit (T${tier}, roue ${months} mois) est créé${now ? ' et lancé à la prochaine roue' : ' et reste en attente'}.\nMotif : ${note}`,
          )
        )
          return true;
        const key = crypto.randomUUID();
        void run(async () => {
          const right = await call<{ spin_id: string }>('/grant', {
            key,
            viewer: {
              id: v.id,
              ...(v.login ? { login: v.login } : {}),
              name: v.name,
            },
            tier,
            months,
            note,
          });
          ui.grantOpen = false;
          if (!now) return `Roue accordée à ${v.name} (en attente).`;
          await request(right.spin_id);
          return `Roue accordée à ${v.name} : elle passe à la prochaine roue.`;
        });
        return true;
      }
      return false;
    },
    /** Handles the buttons of the screen; false: not one of them. */
    click(act: string, target: HTMLElement) {
      if (!act.startsWith('swr-')) return false;
      if (busy) return true;
      if (act === 'swr-pick' && target.dataset.id) {
        const id = target.dataset.id;
        void run(async () => {
          ui.grantOpen = false;
          await load(id);
          return '';
        });
      } else if (act === 'swr-refresh' && ui.viewer) void run(async () => '');
      else if (act === 'swr-grant-open' || act === 'swr-grant-close') {
        ui.grantOpen = act === 'swr-grant-open';
        d.render();
      } else if (act === 'swr-launch' && target.dataset.spin) {
        const spin = target.dataset.spin;
        if (!confirm(`Lancer ce tour de ${name()} à la prochaine roue ?`))
          return true;
        void run(async () => {
          await request(spin);
          return 'Tour lancé : il passe à la prochaine roue.';
        });
      } else if (act === 'swr-catchup' && ui.viewer) {
        const owed = ui.viewer.rights.filter(
          (r) => r.status === 'owed' && !r.blocked,
        );
        if (
          !owed.length ||
          !confirm(
            `Rattraper ${name()} : lancer ses ${owed.length} tour(s) disponible(s) ?\n\nCe sont ses propres tours (aucun nouveau droit). Ils passent avant la file automatique et sont tirés à la prochaine roue, live ou non, dès que le lecteur d’effets est prêt.`,
          )
        )
          return true;
        void run(async () => {
          let done = 0;
          for (const r of owed) {
            await request(r.spin_id);
            done++;
          }
          return `${done} tour(s) lancé(s) pour ${name()}.`;
        });
      } else if (act === 'swr-replay' && target.dataset.spin) {
        const spin = target.dataset.spin;
        if (
          !confirm(
            replayConfirm(
              name(),
              Number(target.dataset.amount),
              target.dataset.award ?? '',
            ),
          )
        )
          return true;
        void run(async () => {
          await call(`/spins/${spin}/replay`, {});
          return `Animation remise en file pour ${name()} (aucun crédit en plus).`;
        });
      } else if (act === 'swr-redraw' && target.dataset.spin) {
        const spin = target.dataset.spin;
        const amount =
          target.dataset.amount === '' ? null : Number(target.dataset.amount);
        if (
          !confirm(
            redrawConfirm(
              name(),
              target.dataset.at ?? '',
              amount,
              target.dataset.award ?? '',
            ),
          )
        )
          return true;
        const note = prompt(
          'Pourquoi ce nouveau tirage ? (obligatoire, gardé dans l’historique)',
        )?.trim();
        if (!note) return true;
        const key = crypto.randomUUID();
        void run(async () => {
          await call('/redraw', { key, spin_id: spin, note });
          return `Nouveau tirage demandé pour ${name()} : prochaine roue.`;
        });
      }
      return true;
    },
  };
}
