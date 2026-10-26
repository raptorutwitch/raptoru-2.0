import { mountSubWheelRights } from './sub-wheel-rights.js';
import { replayConfirm, rightsTab } from './sub-wheel-rights-view.js';
import {
  type SwMode,
  type SwState,
  type SwTab,
  type SwUi,
  subWheelView,
} from './sub-wheel-view.js';

// Roue du Sub — the Studio section of the « Points de chaîne » tab (docs/SUB_WHEEL.md, V2: SUB_WHEEL_V2_PLAN.md). Studio
// shows what Core decided and sends the actions; Core checks every permission (Studio = the broadcaster), journals
// them and stays the only authority on draws and gains. Sensitive actions ask for a confirmation; decisions ask for a
// note (journal). The tests never give a real gain.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

/** Core refusals, in plain words (anything else is shown as is). */
const REFUSAL: Record<string, string> = {
  forbidden: 'Permission refusée par le Core.',
  needs_review: 'Ce tour est à vérifier : décide d’abord dans « À vérifier ».',
  not_owed: 'Ce tour n’est plus en attente (déjà tiré, fusionné ou retiré).',
  review_closed: 'Cette vérification a déjà été décidée.',
  not_mergeable: 'Fusion impossible : ce tour a déjà été tiré ou crédité.',
  grant_key_reused: 'Ce tour a déjà été accordé à quelqu’un d’autre.',
  not_replayable:
    'Ce tirage ne peut pas être rejoué (déjà affiché, en cours, ou un test).',
  not_to_check: 'Cette roue n’est pas « à vérifier » (déjà réglée).',
  spin_not_found: 'Tour introuvable.',
  review_not_found: 'Vérification introuvable.',
};
const MODE_CONFIRM: Record<SwMode, string> = {
  v1: 'Revenir en V1 ?\n\nChaque avis de sub tire tout de suite, comme aujourd’hui. Les tours gardés restent gardés (aucun n’est perdu) mais la V2 ne les tire plus.',
  v2_acquire:
    'Passer en V2 — acquisition ?\n\nLes tours sont gardés ; la V1 continue de tirer les avis de sub. La V2 ne tire rien.',
  v2: 'Passer en V2 ?\n\nLa roue tirera les tours gardés : les demandes, puis la file automatique (en live, viewer présent). Les gains sont décidés et crédités par le Core.',
};

export function mountSubWheel(root: HTMLElement) {
  let state: SwState | null = null;
  let error: string | null = null;
  let message = '';
  let busy = false;
  const ui: SwUi = { tab: 'waiting' };
  /** Lab only: a simulated viewer is named by its pseudo; the same pseudo keeps the same (fake) Twitch ID. */
  const labViewerId = (name: string) => {
    const known = state?.lab_sim?.viewers.find(
      (v) => v.display_name.toLowerCase() === name.toLowerCase(),
    );
    if (known) return known.viewer_id;
    let h = 0x811c9dc5;
    for (const c of name.toLowerCase())
      h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
    return `9${String(h).padStart(10, '0')}`;
  };

  const render = () => {
    const keep = [...root.querySelectorAll<HTMLInputElement>('[data-f]')].map(
      (el) => [el.dataset.f!, el.value] as const,
    );
    ui.rights =
      ui.tab === 'rights'
        ? rightsTab(rightsCtl.ui, !!state && !state.v2_unavailable)
        : undefined;
    root.innerHTML =
      subWheelView(state, error, ui) +
      (message
        ? `<p class="cp-muted sw-message" role="status">${message}</p>`
        : '');
    for (const [f, v] of keep) {
      const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
      if (el) el.value = v;
    }
  };

  const load = async (force = false) => {
    // Paused only while typing in this section (a clicked tab or button keeps the live refresh going).
    const typing = document.activeElement?.matches('input, select, textarea');
    if (!force && (busy || (typing && root.contains(document.activeElement))))
      return;
    try {
      const res = await fetch('/api/sub-wheel/state', { headers: HEADERS });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      state = body;
      error = null;
    } catch (e) {
      error = `Roue du Sub indisponible : ${(e as Error).message}`;
    }
    render();
  };

  const say = (text: string) =>
    text.replace(
      /[&<>]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!,
    );
  // RV2-2 « Droits »: its own screen (sub-wheel-rights*.ts); this section only routes its forms and buttons.
  const rightsCtl = mountSubWheelRights({
    root,
    notify: (text) => {
      message = say(text);
      render();
    },
    render: () => render(),
  });

  const post = async (path: string, body: object, done: string) => {
    if (busy) return false;
    busy = true;
    let ok = false;
    try {
      const res = await fetch(`/api/sub-wheel${path}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      message = say(done);
      ok = true;
    } catch (e) {
      const code = (e as Error).message;
      message = say(`Refusé : ${REFUSAL[code] ?? code}`);
    } finally {
      busy = false;
    }
    (document.activeElement as HTMLElement | null)?.blur();
    await load(true);
    return ok;
  };

  const field = (f: string) =>
    root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)?.value.trim() ?? '';

  const testBody = () => ({
    name: field('sw-name') || undefined,
    tier: Number(field('sw-tier') || 1),
    months: Math.max(
      1,
      Math.min(200, Math.round(Number(field('sw-months') || 1) || 1)),
    ),
  });

  root.addEventListener('submit', (ev) => {
    const role = (ev.target as HTMLElement).dataset.role;
    if (rightsCtl.submit(role)) {
      ev.preventDefault();
      return;
    }
    if (role === 'sw-sim-viewer' || role === 'sw-sim-event') {
      ev.preventDefault();
      const name = field(role === 'sw-sim-viewer' ? 'sv-name' : 'se-name')
        .replace(/^@+/, '')
        .trim();
      if (!name) {
        message = 'Pseudo obligatoire.';
        render();
        return;
      }
      const id = labViewerId(name);
      if (role === 'sw-sim-viewer')
        void post(
          '/lab/presence',
          { viewers: [{ id, name, present: true }] },
          `${name} ajouté, présent.`,
        );
      else
        void post(
          '/lab/simulate',
          {
            kind: field('se-kind') || 'sub',
            viewer: { id, name },
            tier: Number(field('se-tier') || 1),
            months: Math.max(
              1,
              Math.min(200, Math.round(Number(field('se-months')) || 2)),
            ),
          },
          'Événement simulé envoyé au Core (Lab).',
        );
      return;
    }
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.act !== 'sw-mode' || !state) return;
    const mode = el.value as SwMode;
    if (
      mode === (state.settings.mode ?? 'v1') ||
      !confirm(MODE_CONFIRM[mode])
    ) {
      render();
      return;
    }
    void post('/mode', { mode }, `Mode changé.`);
  });

  root.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>(
      '[data-act]',
    );
    const act = target?.dataset.act;
    if (!act || busy) return;
    if (rightsCtl.click(act, target!)) return;
    if (act === 'sw-tab') {
      ui.tab = (target!.dataset.tab as SwTab) ?? 'waiting';
      message = '';
      render();
      return;
    }
    if (act === 'sw-switch' && state) {
      const on = !state.settings.enabled;
      if (
        on &&
        !confirm(
          'Activer la Roue du Sub ?\n\nLes vrais subs, resubs et Prime lanceront la roue selon le mode choisi. Le Core décide chaque gain une seule fois.',
        )
      )
        return;
      void post(
        '/settings',
        { enabled: on },
        on
          ? 'Roue activée.'
          : 'Roue désactivée (tirages en pause, aucun tour perdu).',
      );
    }
    if (act === 'sw-draw' && target?.dataset.spin) {
      if (
        !confirm(
          `Tirer le tour de ${target.dataset.name ?? 'ce viewer'} à la prochaine roue ?`,
        )
      )
        return;
      void post(
        `/spins/${target.dataset.spin}/request`,
        {},
        'Tirage demandé : il passe à la prochaine roue.',
      );
    }
    if (act === 'sw-confirm-shown' && target?.dataset.spin) {
      if (
        !confirm(
          `La roue de ${target.dataset.name ?? 'ce viewer'} a bien été vue ?\n\nElle passe « Affichée » telle quelle (rien n’est tiré ni crédité) et le gain est annoncé une fois dans le chat.`,
        )
      )
        return;
      void post(
        `/spins/${target.dataset.spin}/confirm-shown`,
        {},
        'Roue marquée « Affichée ».',
      );
    }
    if (act === 'sw-replay' && target?.dataset.spin) {
      if (
        !confirm(
          replayConfirm(
            target.dataset.name ?? 'ce viewer',
            Number(target.dataset.amount),
            target.dataset.award ?? '',
          ),
        )
      )
        return;
      void post(
        `/spins/${target.dataset.spin}/replay`,
        {},
        'Animation remise en file (aucun crédit en plus).',
      );
    }
    if (act === 'sw-review' && target?.dataset.review) {
      const decision = target.dataset.decision as
        'distinct' | 'merge' | 'unresolved';
      const ask = {
        distinct:
          'Deux mois distincts : les deux tours seront tirables. Motif ?',
        merge:
          'Fusionner : ce tour bloqué est le même mois que l’autre. Il ne sera jamais tiré ni crédité (rien n’est effacé). Motif ?',
        unresolved: 'Laisser en attente : le tour reste bloqué. Motif ?',
      }[decision];
      const note = prompt(ask)?.trim();
      if (!note) return;
      if (
        decision === 'merge' &&
        !confirm('Confirmer la fusion ? Elle est définitive.')
      )
        return;
      void post(
        `/reviews/${target.dataset.review}/resolve`,
        { decision, note },
        decision === 'distinct'
          ? 'Deux mois distincts : le tour est de nouveau tirable.'
          : decision === 'merge'
            ? 'Doublon fusionné (aucun crédit).'
            : 'Laissé en attente.',
      );
    }
    if (act === 'sw-invitations' && state) {
      const on = !state.settings.invitations_enabled;
      if (
        on &&
        !confirm(
          'Activer les invitations naturelles ?\n\nEn V2 et pendant le live, LeCroupier_ proposera une fois par live, dans le chat, de lancer les tours en attente. Accepter demande le tirage ; rien n’est crédité à la réponse.',
        )
      )
        return;
      void post(
        '/invitations',
        { enabled: on },
        on ? 'Invitations activées.' : 'Invitations désactivées.',
      );
    }
    if (act === 'sw-announce-delay') {
      const raw = field('sw-announce-delay');
      const seconds = Number(raw);
      if (!/^\d{1,2}$/.test(raw) || seconds > 60) {
        message = say('Délai d’annonce : un nombre entier de 0 à 60 secondes.');
        render();
        return;
      }
      void post(
        '/announce-delay',
        { seconds },
        `Délai d’annonce du gain : ${seconds} s.`,
      );
    }
    if (act === 'sw-sim-fail-start' && target)
      void post(
        '/lab/fail-next-start',
        { on: target.dataset.on === '1' },
        target.dataset.on === '1'
          ? 'La prochaine roue échouera avant de démarrer (simulé).'
          : 'Échec simulé annulé.',
      );
    if (act === 'sw-sim-live' && target)
      void post(
        '/lab/live',
        { on: target.dataset.on === '1' },
        target.dataset.on === '1'
          ? 'Live simulé démarré.'
          : 'Live simulé terminé.',
      );
    if (act === 'sw-sim-readings' && target)
      void post(
        '/lab/presence',
        { readings: target.dataset.on === '1' },
        target.dataset.on === '1'
          ? 'Relevés simulés démarrés.'
          : 'Relevés arrêtés : présence inconnue.',
      );
    if (act === 'sw-sim-present' && target?.dataset.id)
      void post(
        '/lab/presence',
        {
          viewers: [
            {
              id: target.dataset.id,
              name: target.dataset.name ?? target.dataset.id,
              present: target.dataset.present === '1',
            },
          ],
        },
        'Présence mise à jour.',
      );
    if (act === 'sw-test')
      void post(
        '/test',
        testBody(),
        'Roue envoyée au lecteur d’effets (aucun gain).',
      );
    if (act === 'sw-full')
      void post(
        '/test',
        { ...testBody(), full: true },
        'Alerte de sub simulée puis roue (aucun gain).',
      );
    if ((act === 'sw-manual' || act === 'sw-cancel') && target?.dataset.spin) {
      const note = prompt(
        act === 'sw-manual'
          ? 'Gain crédité à la main : où et comment ? (note obligatoire)'
          : 'Annuler ce gain : pourquoi ? (note obligatoire)',
      )?.trim();
      if (!note) return;
      void post(
        `/spins/${target.dataset.spin}/award`,
        { status: act === 'sw-manual' ? 'manual' : 'cancelled', note },
        'Gain mis à jour.',
      );
    }
  });

  return { load: () => load() };
}
