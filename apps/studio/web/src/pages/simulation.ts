import {
  esc,
  hhmm,
  ic,
  page,
  patch,
  poller,
  run,
  stateChip,
} from '../ds/ds.js';
import { labOnMainCore, postJson } from '../http.js';
import {
  chatTimeline,
  chatView,
  type ChatIn,
  type StepOut,
} from '../sim-chat-view.js';
import {
  getJson,
  loadSimState,
  post,
  runSimAction,
  SIM_CHANGED,
} from '../simulation.js';
import { type SimState, simPanel, writesRealChat } from '../simulation-view.js';
import { PRESETS, testEvent } from './alerts-model.js';
import { labDoors } from './lab-doors.js';

// La Simulation : le live fictif, le chat tel qu'un viewer le verrait (une seule entrée pour tous les modules), des événements de
// stream, et le chemin vers les simulateurs de chaque module. Aucun réglage métier ici : chacun reste dans la page de son module.

const CLEARED_KEY = 'raptoru-sim-chat-cleared';
const EVENTS: [string, string][] = [
  ['follow', 'Follow'],
  ['sub', 'Sub'],
  ['resub', 'Resub'],
  ['gift_community', 'Subgift × 5'],
  ['bits', 'Bits'],
  ['raid', 'Raid'],
  ['donation', 'Don'],
];
const QUICK = [
  '!join',
  '!roulette 100',
  '!slots 100',
  '!mots',
  '!duel @lab_modo',
];

export function mountSimulationPage(root: HTMLElement) {
  const p = page(root, { title: 'Simulation' });
  let state: SimState | null = null;
  let inbox: ChatIn[] = [];
  let steps: StepOut[] = [];
  let busy = false;
  let error: string | null = null;
  let listSig = '';
  let main = false;
  let clearedAt = 0;
  try {
    clearedAt = Number(localStorage.getItem(CLEARED_KEY) ?? 0) || 0;
  } catch {
    /* storage unavailable: nothing hidden */
  }

  p.body.innerHTML = `<div class="sm-page">
    <section class="sm-chat">
      <div class="sc-head"><span class="d-note" data-id="lead"></span><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-chat="clear" title="Masque les messages affichés ; ne supprime rien">Vider l’affichage</button></div>
      <div class="sc-list" data-id="list" aria-live="polite"></div>
      <div class="sc-quick">${QUICK.map((q) => `<button type="button" class="d-tag add" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="sc-compose" data-id="compose">
        <label class="d-fld sc-field"><input type="text" data-id="text" placeholder="Écris comme dans le chat (!roulette 100, !mots, !join…)" maxlength="500" autocomplete="off" aria-label="Message"></label>
        <button type="submit" class="d-btn pri">${ic('arrow')}Envoyer</button>
      </form>
      <p class="d-note bad" data-id="out"></p>
    </section>
    <aside class="sm-side d-scroll">
      <section><h2 class="d-lb">Agir en tant que</h2><div class="sm-who">
        <label class="d-fld"><select data-id="who" aria-label="Viewer fictif"></select></label>
        <label class="d-fld"><select data-id="role" aria-label="Rôle"><option value="viewer">Viewer</option><option value="moderator">Modérateur</option></select></label>
      </div><p class="d-note">Pour les messages du chat comme pour les événements ci-dessous.</p></section>
      <section><h2 class="d-lb">Live fictif</h2><div data-id="controls"></div><p class="d-note" data-id="livenote"></p><pre class="sm-log" data-id="ingress" hidden title="Journal de l’ingestion Twitch"></pre></section>
      <section><h2 class="d-lb">Événements de stream</h2><div class="sm-evs">${EVENTS.map(([k, l]) => `<button type="button" class="d-btn sm" data-ev="${k}">${esc(l)}</button>`).join('')}</div><p class="d-note">Ils entrent dans la vraie file des Alertes du Lab.</p><ul class="sm-sent" data-id="sent"></ul></section>
      <section><h2 class="d-lb">Simulateurs des modules</h2><nav class="lb-doors">${labDoors()}</nav></section>
    </aside>
  </div>`;
  const sent: string[] = [];
  const $ = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;

  // The Lab on the main Core: the chat is the simulator's, nothing reaches Twitch either way.
  const lead = () =>
    patch(
      $('lead'),
      main
        ? 'Chat simulé : les réponses sont préparées pour le bot, jamais envoyées. Rien n’arrive à Twitch.'
        : 'Messages reçus et vraies réponses de LeCroupier_ (file d’envoi).',
    );
  void labOnMainCore().then((m) => {
    main = m;
    lead();
  });
  lead();

  void getJson('/api/lab-chat/identities').then((r) => {
    const ids = (r?.identities ?? []) as {
      id: string;
      label: string;
      login?: string;
    }[];
    $('who').innerHTML = ids
      .map(
        (i) =>
          `<option value="${esc(i.id)}" data-label="${esc(i.label)}" data-login="${esc(i.login ?? '')}">${esc(i.label)}${i.login ? ` · @${esc(i.login)}` : ''}</option>`,
      )
      .join('');
  });

  function paintControls() {
    patch($('controls'), simPanel(state, busy, error));
    // Les achats du Lab ne sont jamais bloqués hors live (Core, live-gate) : le live fictif sert aux modules qui suivent le stream.
    patch(
      $('livenote'),
      state?.stream === undefined
        ? ''
        : state.stream
          ? 'Les modules liés au stream le voient comme un vrai live. « Terminer » le clôt comme Twitch.'
          : 'Pas nécessaire pour acheter dans le Lab. Requis pour ce qui suit le stream : Tombola automatique, Spotify, Roue du Sub, Jeu des mots, Daily et présence.',
    );
    patch(
      p.state,
      state
        ? writesRealChat(state)
          ? stateChip('w', 'Écrit dans le vrai chat')
          : state.stream
            ? stateChip('live', 'Live simulé')
            : stateChip('off', 'Live fictif arrêté')
        : '',
    );
    const ing = state?.ingress as
      (SimState['ingress'] & { lines?: string[] }) | null | undefined;
    const log = $('ingress');
    log.hidden = !ing?.lines?.length;
    log.textContent = ing?.lines?.slice(-4).join('\n') ?? '';
  }

  function paintList() {
    const items = chatTimeline(inbox, steps, clearedAt);
    const outputOn = state?.output?.enabled === true;
    // Re-render only when something changed (statuses and « envoi dans N s » included).
    const now = Date.now();
    const sig = JSON.stringify([
      items.map((i) =>
        i.type === 'in'
          ? [i.key, i.msg.handled, i.msg.error]
          : [i.key, i.step.status],
      ),
      outputOn,
      Math.floor(now / 1000),
    ]);
    if (sig === listSig) return;
    listSig = sig;
    const list = $('list');
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = chatView(items, outputOn, now);
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  async function refresh() {
    const [s, recent, queued] = await Promise.all([
      loadSimState(),
      getJson('/api/lab-chat/recent'),
      getJson('/api/lab-chat/steps'),
    ]);
    state = s;
    inbox = (recent?.messages ?? []) as ChatIn[];
    steps = (queued?.steps ?? []) as StepOut[];
    paintControls();
    paintList();
  }
  const tick = poller(refresh, 1000);

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const q = t.closest<HTMLElement>('[data-quick]')?.dataset.quick;
    if (q) {
      const input = $<HTMLInputElement>('text');
      input.value = `${q} `;
      input.focus();
      return;
    }
    const fire = t.closest<HTMLElement>('[data-ev]');
    if (fire) {
      const pseudo =
        $<HTMLSelectElement>('who').selectedOptions[0]?.dataset.login ||
        'lab_viewer';
      const type = fire.dataset.ev!;
      const label = fire.textContent ?? type;
      return void run(
        fire,
        async () => {
          await postJson('/api/alerts/test', {
            ...testEvent(type, { ...PRESETS.normal!.data, pseudo }),
            ...(type === 'sub' || type === 'resub' ? { tier: '1000' } : {}),
          });
          sent.unshift(
            `<li><time>${hhmm(new Date().toISOString())}</time><b>${esc(label)}</b> de ${esc(pseudo)} : en file des Alertes · <a href="/?p=alerts">voir</a></li>`,
          );
          sent.length = Math.min(sent.length, 4);
          patch($('sent'), sent.join(''));
        },
        `${label} envoyé à la file des Alertes`,
      );
    }
    const b = t.closest<HTMLButtonElement>('[data-sim], [data-chat]');
    if (!b || b.disabled) return;
    if (b.dataset.chat === 'clear') {
      clearedAt = Date.now();
      try {
        localStorage.setItem(CLEARED_KEY, String(clearedAt));
      } catch {
        /* storage unavailable: hidden until reload */
      }
      listSig = '';
      paintList();
      return;
    }
    const action = b.dataset.sim;
    if (!action || !state) return;
    busy = true;
    error = null;
    paintControls();
    void runSimAction(action, state).then((e) => {
      error = e;
      busy = false;
      tick.now();
    });
  });

  $('compose').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = $<HTMLInputElement>('text');
    const text = input.value.trim();
    if (!text) return;
    const who = $<HTMLSelectElement>('who');
    const opt = who.selectedOptions[0];
    const label = opt?.dataset.label || who.value;
    $('out').textContent = '';
    void post('/api/lab-chat/simulate', {
      viewer_id: who.value,
      display_name: label,
      // The identity's Twitch login (e.g. lab_modo): the Duel resolves « !duel @lab_modo » with it.
      login: opt?.dataset.login || label,
      text,
      role: $<HTMLSelectElement>('role').value,
    })
      .then(() => {
        input.value = '';
        const list = $('list');
        list.scrollTop = list.scrollHeight;
        tick.now();
      })
      .catch((e: Error) => {
        $('out').textContent = `Refusé : ${e.message}`;
      });
  });

  window.addEventListener(SIM_CHANGED, () => tick.now());

  return {
    setVisible(v: boolean) {
      if (v) tick.start();
      else tick.stop();
    },
  };
}
