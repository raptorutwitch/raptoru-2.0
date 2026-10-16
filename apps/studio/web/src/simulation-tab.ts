import {
  chatTimeline,
  chatView,
  type ChatIn,
  type StepOut,
} from './sim-chat-view.js';
import {
  getJson,
  loadSimState,
  post,
  runSimAction,
  SIM_CHANGED,
} from './simulation.js';
import { type SimState, simPanel } from './simulation-view.js';

// Studio Lab — « Simulation » tab: the Lab chat ingress (moved from the Tombola tab: Twitch ingestion and
// the chat simulator with its identities and roles), the same four switches as the top bar panel (shared
// code and confirmations), and the chat as a viewer would see it (sim-chat-view). Polls while visible.

const POLL_MS = 1000;
const CLEARED_KEY = 'raptoru-sim-chat-cleared';

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function mountSimulationTab(root: HTMLElement) {
  let state: SimState | null = null;
  let inbox: ChatIn[] = [];
  let steps: StepOut[] = [];
  let busy = false;
  let error: string | null = null;
  let timer = 0;
  let listSig = '';
  let clearedAt = 0;
  try {
    clearedAt = Number(localStorage.getItem(CLEARED_KEY) ?? 0) || 0;
  } catch {
    /* storage unavailable: nothing hidden */
  }

  root.innerHTML = `<section class="st">
    <div class="st-head"><h1>Simulation</h1><span class="sim-muted">Lab · une seule entrée chat pour tous les modules (simulateur et vrai chat Twitch)</span></div>
    <div class="st-grid">
      <div class="st-side"><div data-id="controls"></div><div data-id="ingress"></div></div>
      <div class="st-chat">
        <div class="sc-head"><b>Chat</b><span class="sim-muted">messages reçus par Core · réponses réelles de LeCroupier_ (file d’envoi)</span><button type="button" class="sim-btn" data-chat="clear" title="Masque les messages affichés ; ne supprime rien dans Core">Vider l’affichage</button></div>
        <div class="sc-list" data-id="list" aria-live="polite"></div>
        <form class="sc-compose" data-id="compose">
          <select class="sc-input" data-id="who" aria-label="Identité"></select>
          <select class="sc-input" data-id="role" aria-label="Rôle"><option value="viewer">Viewer</option><option value="moderator">Modérateur</option></select>
          <input class="sc-input sc-field" data-id="text" placeholder="Message (ex. !roulette 100, !mots, !join…)" maxlength="500" autocomplete="off">
          <button type="submit" class="sim-btn sc-send">Envoyer</button>
        </form>
        <p class="sim-muted sc-out" data-id="out"></p>
      </div>
    </div>
  </section>`;
  const $ = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;

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

  function renderControls() {
    $('controls').innerHTML = simPanel(state, busy, error);
    const ing = state?.ingress as
      (SimState['ingress'] & { lines?: string[] }) | null | undefined;
    $('ingress').innerHTML = ing?.lines?.length
      ? `<pre class="st-log" title="Journal de l’ingestion Twitch">${esc(ing.lines.slice(-4).join('\n'))}</pre>`
      : '';
  }

  function renderList() {
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
    renderControls();
    renderList();
  }

  root.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-sim], [data-chat]',
    );
    if (!b || b.disabled) return;
    if (b.dataset.chat === 'clear') {
      clearedAt = Date.now();
      try {
        localStorage.setItem(CLEARED_KEY, String(clearedAt));
      } catch {
        /* storage unavailable: hidden until reload */
      }
      listSig = '';
      renderList();
      return;
    }
    const action = b.dataset.sim;
    if (!action || !state) return;
    busy = true;
    error = null;
    renderControls();
    void runSimAction(action, state).then((e) => {
      error = e;
      busy = false;
      void refresh();
    });
  });

  $('compose').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = $<HTMLInputElement>('text').value.trim();
    if (!text) return;
    const who = $<HTMLSelectElement>('who');
    const opt = who.selectedOptions[0];
    const label = opt?.dataset.label || who.value;
    $('out').textContent = 'Envoi…';
    void post('/api/lab-chat/simulate', {
      viewer_id: who.value,
      display_name: label,
      // The identity's Twitch login (e.g. lab_modo): the Duel resolves « !duel @lab_modo » with it.
      login: opt?.dataset.login || label,
      text,
      role: $<HTMLSelectElement>('role').value,
    })
      .then(() => {
        $('out').textContent = '';
        $<HTMLInputElement>('text').value = '';
        const list = $('list');
        list.scrollTop = list.scrollHeight;
        return refresh();
      })
      .catch((e: Error) => {
        $('out').textContent = `Refusé : ${e.message}`;
      });
  });

  window.addEventListener(SIM_CHANGED, () => {
    if (timer) void refresh();
  });

  return {
    setVisible(v: boolean) {
      window.clearInterval(timer);
      timer = 0;
      if (!v) return;
      void refresh();
      timer = window.setInterval(() => void refresh(), POLL_MS);
    },
  };
}
