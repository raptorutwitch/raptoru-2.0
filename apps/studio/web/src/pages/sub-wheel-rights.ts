import { ApiError, getJson, postJson } from '../http.js';
import {
  choiceBox,
  confirmBox,
  drawer,
  errText,
  toast,
  type Drawer,
  streamTestConfirm,
} from '../ds/ds.js';
import {
  redrawConfirm,
  replayConfirm,
  rightsSearch,
  viewerCard,
  type SwRightsUi,
  type SwViewerAdmin,
  type SwViewerHit,
} from './sub-wheel-rights-view.js';

// Roue du Sub, les actions sur les droits d'un viewer. Chaque action demande une confirmation ; un nouveau droit ou un nouveau tirage
// demande aussi un motif (journal). Une action à la fois, et la clé d'un nouveau droit ou d'un nouveau tirage est tirée une fois par
// confirmation : une requête renvoyée est le même droit pour le Core.

/** Les refus du Core sur ces actions. */
const REFUSAL = (
  name: string,
  d: Record<string, unknown>,
): Record<string, string> => ({
  rights_available: `${name} a déjà ${Number(d.usable) || 1} tour(s) à utiliser : lance-les, aucun nouveau droit.`,
  redraw_pending: 'Une relance est déjà en attente pour ce tirage.',
  broadcaster_only: 'Réservé au diffuseur.',
  not_redrawable: 'Ce tirage ne peut pas être relancé (test ou simulation).',
  not_drawn_yet: 'Ce tour n’a pas encore été tiré.',
  forbidden: 'Permission refusée.',
  needs_review: 'Ce tour est à vérifier : décide d’abord dans « À vérifier ».',
  not_owed: 'Ce tour n’est plus en attente.',
  spin_not_found: 'Tour introuvable.',
  grant_key_reused: 'Action déjà utilisée : recommence.',
  redraw_key_reused: 'Action déjà utilisée : recommence.',
  not_replayable:
    'Ce tirage ne peut pas être rejoué (déjà affiché, en cours, ou un test).',
});

export function mountRights(onChange: () => void) {
  const ui: SwRightsUi = {
    query: '',
    hits: null,
    viewer: null,
    grantOpen: false,
  };
  let busy = false;
  let box: Drawer | null = null;

  const paintBox = () => {
    if (box && ui.viewer) box.set({ body: viewerCard(ui.viewer, ui) });
  };
  const load = async (id: string) => {
    ui.viewer = await getJson<SwViewerAdmin>(
      `/api/sub-wheel/admin/viewers/${id}`,
    );
  };
  const name = () => ui.viewer?.viewer.name ?? 'ce viewer';
  const value = (el: HTMLElement, f: string) =>
    el.querySelector<HTMLInputElement>(`[data-f="${f}"]`)?.value.trim() ?? '';
  const call = <T>(path: string, body: object) =>
    postJson<T>(`/api/sub-wheel${path}`, body);
  const request = (spin: string) => call(`/spins/${spin}/request`, {});

  /** Une action à la fois ; son résultat ; le viewer relu ensuite. */
  const go = async (action: () => Promise<string>) => {
    if (busy) return;
    busy = true;
    try {
      const text = await action();
      if (text) toast(text);
    } catch (e) {
      const r = e as ApiError;
      const said = REFUSAL(name(), r.details ?? {})[r.code];
      toast(said || errText(e), { bad: true });
    }
    try {
      if (ui.viewer) await load(ui.viewer.viewer.id);
    } catch {
      /* le résultat est dit ; le tiroir garde sa dernière lecture */
    }
    busy = false;
    paintBox();
    onChange();
  };

  async function show(id: string) {
    ui.grantOpen = false;
    await load(id);
    const v = ui.viewer!;
    box = drawer({
      kicker: `Droits d’un viewer${v.viewer.login ? ` · ${v.viewer.login}` : ''} · ${v.viewer.id}`,
      title: v.viewer.name,
      body: viewerCard(v, ui),
      onClose: () => {
        box = null;
        ui.viewer = null;
        onChange();
      },
    });
    box.el.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (t) void click(t);
    });
    box.el.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void grant(ev.target as HTMLElement);
    });
  }
  const openViewer = (id: string) =>
    void go(async () => {
      await show(id);
      return '';
    });

  async function grant(form: HTMLElement) {
    if (!ui.viewer) return;
    const v = ui.viewer.viewer;
    const tier = Number(value(form, 'swr-tier') || 1);
    const months = Math.max(
      1,
      Math.min(200, Math.round(Number(value(form, 'swr-months')) || 1)),
    );
    const note = value(form, 'swr-note');
    const now =
      form.querySelector<HTMLInputElement>('[data-f="swr-now"]')?.checked ??
      true;
    if (!note)
      return toast('Motif obligatoire (gardé dans l’historique).', {
        bad: true,
      });
    if (
      !(await confirmBox({
        title: `Accorder une roue à ${v.name} ?`,
        body: `Un NOUVEAU droit (T${tier}, roue ${months} mois) est créé${now ? ' et lancé à la prochaine roue' : ' et reste en attente'}.\nMotif : ${note}`,
        yes: 'Accorder la roue',
        no: 'Annuler',
        danger: false,
      }))
    )
      return;
    const key = crypto.randomUUID();
    void go(async () => {
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
  }

  async function click(t: HTMLElement) {
    const act = t.dataset.act;
    if (busy || !act?.startsWith('swr-')) return;
    const spin = t.dataset.spin;
    if (act === 'swr-pick' && t.dataset.id) openViewer(t.dataset.id);
    else if (act === 'swr-refresh') void go(async () => '');
    else if (act === 'swr-grant-open' || act === 'swr-grant-close') {
      ui.grantOpen = act === 'swr-grant-open';
      paintBox();
    } else if (act === 'swr-launch' && spin) {
      if (
        await confirmBox({
          title: `Lancer ce tour de ${name()} ?`,
          body: 'Il passe à la prochaine roue.',
          yes: 'Lancer',
          no: 'Annuler',
          danger: false,
        })
      )
        void go(async () => {
          await request(spin);
          return 'Tour lancé : il passe à la prochaine roue.';
        });
    } else if (act === 'swr-catchup' && ui.viewer) {
      const owed = ui.viewer.rights.filter(
        (r) => r.status === 'owed' && !r.blocked,
      );
      if (
        owed.length &&
        (await confirmBox({
          title: `Rattraper ${name()} : lancer ses ${owed.length} tour(s) ?`,
          body: 'Ce sont ses propres tours (aucun nouveau droit). Ils passent avant la file automatique et sont tirés à la prochaine roue, live ou non, dès que le lecteur d’effets est prêt.',
          yes: 'Rattraper',
          no: 'Annuler',
          danger: false,
        }))
      )
        void go(async () => {
          let done = 0;
          for (const r of owed) {
            await request(r.spin_id);
            done++;
          }
          return `${done} tour(s) lancé(s) pour ${name()}.`;
        });
    } else if (act === 'swr-replay' && spin) {
      if (
        await streamTestConfirm({
          title: 'Rejouer l’animation ?',
          body: replayConfirm(
            name(),
            Number(t.dataset.amount),
            t.dataset.award ?? '',
          ),
          yes: 'Rejouer l’animation',
          no: 'Annuler',
        })
      )
        void go(async () => {
          await call(`/spins/${spin}/replay`, {});
          return `Animation remise en file pour ${name()} (aucun crédit en plus).`;
        });
    } else if (act === 'swr-redraw' && spin) {
      const amount = t.dataset.amount === '' ? null : Number(t.dataset.amount);
      const yes = await choiceBox({
        title: 'Relancer un tirage ?',
        body: redrawConfirm(
          name(),
          t.dataset.at ?? '',
          amount,
          t.dataset.award ?? '',
        ),
        choices: [],
        yes: 'Relancer, payé en plus',
        danger: true,
        field: {
          label: 'Pourquoi ce nouveau tirage ? (gardé dans l’historique)',
          required: true,
        },
      });
      if (!yes) return;
      const key = crypto.randomUUID();
      void go(async () => {
        await call('/redraw', { key, spin_id: spin, note: yes.text });
        return `Nouveau tirage demandé pour ${name()} : prochaine roue.`;
      });
    }
  }

  return {
    ui,
    openViewer,
    click,
    tab: (v2: boolean) => rightsSearch(ui, v2),
    /** Le formulaire de recherche. */
    search(q: string) {
      if (q.replace(/^@+/, '').length < 2)
        return toast('Pseudo : au moins 2 caractères.', { bad: true });
      void go(async () => {
        ui.query = q;
        ui.hits = await call<SwViewerHit[]>('/admin/search', { q });
        if (ui.hits.length === 1) await show(ui.hits[0]!.id);
        return ui.hits.length > 1 ? `${ui.hits.length} viewers trouvés.` : '';
      });
    },
  };
}
