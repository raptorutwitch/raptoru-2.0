import { confirmBox, esc, poller, stateChip, sw, toast } from '../ds/ds.js';
import { ApiError, getJson } from '../http.js';
import { saveSetting, type SettingView } from '../module-settings.js';

// Studio › Chaos, en-tête : « Autoriser les achats Chaos ». C'est le réglage de module `chaos.enabled` du Core, lu et
// écrit par les réglages de module existants (en Production : le cockpit de l'installation appairée). Qui peut acheter
// vient du Core (CHAOS_EXTENSION : off / testeurs / on, réglé dans Coolify seulement, jamais d'ici) : Studio l'affiche.
// Coupé par défaut ; l'activation demande une confirmation, la coupure est immédiate.

type Audience = 'lab' | 'off' | 'testers' | 'on' | 'unknown';
interface Access {
  setting: number;
  open: boolean;
  audience: Audience;
  testers: number;
}

const LABEL = 'Autoriser les achats Chaos';

/** Le refus ou la panne dits simplement ; « Core injoignable » quand Studio n'atteint pas le Core. */
function describe(e: unknown) {
  if (e instanceof ApiError) {
    if (
      e.code === 'core_unavailable' ||
      e.code === 'lab_core_unavailable' ||
      e.status >= 500
    )
      return 'Core injoignable';
    if (e.status === 404) return 'Pas de Core relié';
    if (e.code === 'forbidden' || e.status === 401 || e.status === 403)
      return 'Studio non autorisé par le Core';
    return e.code;
  }
  return 'Core injoignable';
}

function confirmText(a: Access) {
  switch (a.audience) {
    case 'testers':
      return `Seuls les comptes testeurs (${a.testers}) pourront acheter des effets dans l’extension, avec leurs vrais Jetons. Le public n’y a pas accès (CHAOS_EXTENSION = testeurs, réglé dans Coolify). Tu peux couper à tout moment.`;
    case 'on':
      return 'Tous les viewers pourront acheter des effets avec leurs vrais Jetons. Tu peux couper à tout moment.';
    case 'off':
      return 'Le Core garde Chaos fermé (CHAOS_EXTENSION = off) : rien ne s’ouvrira tant que cette variable n’est pas changée dans Coolify.';
    case 'lab':
      return 'Lab : les achats se font avec les Jetons fictifs du Lab.';
    default:
      return 'Le Core ne dit pas encore qui peut acheter (Core à mettre à jour) : seul ce réglage changera.';
  }
}

/** L'interrupteur de l'en-tête : son HTML (repeint avec l'en-tête) et son relevé, toutes les 15 s quand la page est visible. */
export function createChaosAccess(host: HTMLElement, repaint: () => void) {
  let st: Access | null = null;
  let error = '';
  let busy = false;

  async function load() {
    try {
      st = await getJson<Access>('/api/chaos-access');
      error = '';
    } catch (e) {
      // Un Core qui ne connaît pas encore cette lecture : le réglage seul, par les réglages de module.
      if (e instanceof ApiError && e.status === 404) {
        try {
          const { settings } = await getJson<{ settings: SettingView[] }>(
            '/api/module-settings',
          );
          const s = settings.find((x) => x.key === 'chaos.enabled');
          st = s
            ? { setting: s.value, open: false, audience: 'unknown', testers: 0 }
            : null;
          error = s ? '' : 'Réglage chaos.enabled absent du Core';
        } catch (e2) {
          st = null;
          error = describe(e2);
        }
      } else {
        st = null;
        error = describe(e);
      }
    }
    repaint();
  }
  const poll = poller(load, 15_000);

  function chip() {
    if (!st)
      return stateChip(
        error ? 'r' : 'w',
        error ? `${error} : état des achats inconnu` : 'Lecture…',
      );
    const on = st.setting === 1;
    if (st.audience === 'lab')
      return stateChip(
        on ? 'live' : 'off',
        on ? 'Lab · Jetons fictifs' : 'Coupés',
      );
    if (!on) return stateChip('off', 'Coupés');
    if (st.audience === 'testers')
      return stateChip('w', `Testeurs seulement (${st.testers})`);
    if (st.audience === 'on') return stateChip('r', 'Ouverts au public');
    if (st.audience === 'off')
      return stateChip('w', 'Fermés au Core (CHAOS_EXTENSION=off)');
    return stateChip('w', 'Qui peut acheter : inconnu');
  }

  async function toggle(input: HTMLInputElement) {
    const want = input.checked;
    input.checked = !want; // l'état affiché reste celui du Core jusqu'à sa réponse
    if (!st || busy) return;
    if (want) {
      const ok = await confirmBox({
        title: 'Autoriser les achats Chaos ?',
        body: confirmText(st),
        yes: 'Autoriser',
        no: 'Annuler',
        danger: st.audience === 'on',
      });
      if (!ok) return;
    }
    busy = true;
    repaint();
    try {
      await saveSetting('chaos.enabled', want ? 1 : 0);
      toast(
        want
          ? st.audience === 'testers'
            ? `Achats Chaos autorisés pour les testeurs (${st.testers}).`
            : 'Achats Chaos autorisés.'
          : 'Achats Chaos coupés : plus aucun achat possible.',
      );
    } catch (e) {
      toast(`Réglage non appliqué (${describe(e)}) : rien n’a changé.`, {
        bad: true,
      });
    } finally {
      busy = false;
      await load();
    }
  }

  host.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('[data-chaos-buy]')) void toggle(t as HTMLInputElement);
  });

  return {
    /** Dans l'en-tête de la page Chaos, avant STOP ALL. */
    html() {
      const on = st?.setting === 1;
      const title = st
        ? on
          ? 'Les achats d’effets depuis l’extension sont autorisés (réglage chaos.enabled du Core). Décocher coupe tout de suite.'
          : `Les viewers ne peuvent pas acheter d’effets. Cocher demande une confirmation.${st.audience === 'testers' ? ` Au Core : testeurs seulement (${st.testers}).` : st.audience === 'on' ? ' Au Core : ouvert au public.' : ''}`
        : error || 'Lecture de l’état des achats…';
      return `<label class="cx-buy" title="${esc(title)}">${sw(on, 'data-chaos-buy', LABEL, { disabled: !st || busy })}<span class="cx-buy__l">${LABEL}</span>${chip()}</label>`;
    },
    start: () => poll.start(),
    stop: () => poll.stop(),
    refresh: () => load(),
  };
}
