// Commands V2 — « Commandes » for every viewer (phase F): the public list of the channel's commands,
// read-only, from Core's public projection (/commands/public: listed + enabled commands only, grouped
// by the streamer's categories, viewer fields only). Same V6.3 list as Studio / Modération, adapted to
// reading: Video 600×432 (Commande | Accès | Cooldown) and Mobile (command + state, then access ·
// cooldown, then description). No edit, no test, no admin data, no polling: read when opened.
import { registerSessionModule } from './module-registry.js';
import { ic } from './commands-v2-icons.js';
import { publicCooldown, publicGroups, publicQuota, publicWho, WHEN_LABEL } from './commands-v2-model.js';
import { boxWidth } from './box.js';
import { createCommandsMine } from './commands-mine.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Re-read Core at most this often when the host re-attaches the view on its own refreshes. */
const REFRESH_MS = 30_000;

export function createCommandsPublicView({ document, client, state = null }) {
  const win = document.defaultView;
  const node = document.createElement('div');
  node.className = 'cmdx cmdx--public';
  // The public list where the EBS offers it (commands_public); « Mes commandes modifiables » for a delegated editor.
  const showPublic = state?.commands_public !== false;
  const mine = createCommandsMine({ document, client, onChange: () => render() });
  const list = document.createElement('div');
  let mineLoaded = false;
  let pub = null;
  let failed = false;
  let q = '';
  let loadedAt = 0;
  const mode = () => (boxWidth(node, win) >= 520 ? 'video' : 'mobile');

  async function load() {
    loadedAt = Date.now();
    const editable = mine.load().then(() => {
      mineLoaded = true;
      render();
    });
    if (!showPublic) return editable;
    try {
      pub = await client.commandsPublic();
      failed = false;
    } catch {
      failed = !pub;
    }
    render();
  }

  /** Discreet state: only when the command is not usable right now, or only live / offline. */
  function pill(c) {
    if (!c.available_now) return `<span class="lpill lpill--off" title="${esc(WHEN_LABEL[c.when] ?? '')}">${c.when === 'live' ? 'Pendant le live' : c.when === 'offline' ? 'Hors live' : 'Indisponible'}</span>`;
    return c.when !== 'always' ? `<span class="lpill">${esc(WHEN_LABEL[c.when])}</span>` : '';
  }
  function row(c) {
    const mobile = mode() === 'mobile';
    const args = c.syntax.slice(c.name.length + 1).trim();
    const aliases = c.aliases.length ? `<span class="lalias">aussi ${c.aliases.map((a) => `!${esc(a)}`).join(' ')}</span>` : '';
    const access = esc(publicWho(c.audience));
    const cd = esc(publicCooldown(c.cooldown));
    const quota = publicQuota(c.quota);
    const name = `<span class="cn">${esc(c.name)}</span>${args ? `<span class="largs">${esc(args)}</span>` : ''}`;
    if (mobile)
      return `<div class="lr lr--pub ${c.available_now ? '' : 'off'}">
        <span class="lname"><span class="tile tile--md" style="--c:${esc(c.appearance.color)}">${ic(c.appearance.icon)}</span><span class="lname__t">
          <span class="lname__a">${name}${pill(c)}</span>
          <span class="lmeta">${access} · ${c.cooldown ? cd : 'Aucun cooldown'}${quota ? ` · ${esc(quota)}` : ''}</span>
          ${c.description ? `<span class="desc">${esc(c.description)}</span>` : ''}${aliases}</span></span></div>`;
    return `<div class="lr lr--pub ${c.available_now ? '' : 'off'}">
      <span class="lname"><span class="tile" style="--c:${esc(c.appearance.color)}">${ic(c.appearance.icon)}</span><span class="lname__t">
        <span class="lname__a">${name}${pill(c)}</span>
        ${c.description ? `<span class="desc" title="${esc(c.description)}">${esc(c.description)}</span>` : ''}${aliases}</span></span>
      <span class="lcol" title="${access}"><span>${access}</span></span>
      <span class="lcol"><span class="${c.cooldown ? '' : 'faint'}">${cd}</span>${quota ? `<small>${esc(quota)}</small>` : ''}</span></div>`;
  }
  function render() {
    node.dataset.mode = mode();
    if (mine.node.parentNode !== node) node.prepend(mine.node, list);
    if (!showPublic) {
      list.innerHTML = !mine.node.hidden
        ? ''
        : `<p class="empty">${mineLoaded ? 'Aucune commande à modifier pour l’instant.' : 'Chargement…'}</p>`;
      return;
    }
    const total = pub ? pub.categories.reduce((n, k) => n + k.commands.length, 0) + pub.uncategorized.length : 0;
    let body;
    if (!pub) body = `<p class="empty">${failed ? 'Les commandes sont indisponibles pour le moment.' : 'Chargement…'}</p>`;
    else if (!total) body = '<p class="empty">Aucune commande publique pour l’instant.</p>';
    else {
      const groups = publicGroups(pub, q);
      body = groups.length
        ? groups.map((k) => `<section class="lgroup"><div class="lgh" style="--c:${esc(k.color)}"><span class="lgh__i">${ic(k.icon)}</span><span class="lgh__t">${esc(k.name)}</span><em>${k.commands.length}</em></div>${k.commands.map(row).join('')}</section>`).join('')
        : `<p class="empty">Aucune commande pour « ${esc(q)} ».</p>`;
    }
    const search = total >= 6 ? `<div class="xs"><label class="msearch">${ic('search')}<input class="inp" data-pq placeholder="Chercher une commande" value="${esc(q)}" spellcheck="false" aria-label="Chercher une commande"></label></div>` : '';
    const head = pub && total && mode() === 'video' ? '<div class="lhead"><span>Commande</span><span>Accès</span><span>Cooldown</span></div>' : '';
    const focused = node.contains(document.activeElement) && document.activeElement.matches('[data-pq]');
    const caret = focused ? document.activeElement.selectionStart : null;
    list.innerHTML = `${search}${total ? `<p class="lpub-hint">À taper dans le chat${pub.live ? ' · <b>en live</b>' : ''}.</p>` : ''}<div class="lst">${head}<div class="lbody">${body}</div></div>`;
    if (focused) {
      const el = node.querySelector('[data-pq]');
      el?.focus({ preventScroll: true });
      if (caret !== null) el?.setSelectionRange(caret, caret);
    }
  }
  node.addEventListener('input', (e) => {
    if (e.target.matches('[data-pq]')) {
      q = e.target.value;
      render();
    }
  });

  return {
    node,
    start() {
      render();
      void load();
    },
    /** The host re-attaches the view on its refreshes: re-render (width), re-read Core at most every 30 s. */
    attached() {
      render();
      if (Date.now() - loadedAt > REFRESH_MS) void load();
    },
    /** « Mes commandes modifiables » (tests). */
    mine,
  };
}

/** Commands V2 « Commandes » (phase F): the channel's public command list, for every viewer. */
const COMMANDS_PUBLIC_MODULE = Object.freeze({
  id: 'commands',
  label: 'Commandes',
  icon: '!',
  description: 'Les commandes à taper dans le chat.',
});

/** Only a delegated editor's entry where the public list is not offered (Production today). */
const COMMANDS_MINE_CARD = Object.freeze({
  ...COMMANDS_PUBLIC_MODULE,
  description: 'Les commandes que le streamer te laisse modifier.',
});

registerSessionModule({
  id: COMMANDS_PUBLIC_MODULE.id,
  card: (state) => (state?.commands_public === true ? COMMANDS_PUBLIC_MODULE : COMMANDS_MINE_CARD),
  // Offered by the EBS (public list), or to a viewer the streamer named editor of a command; Video and Mobile only.
  available: ({ state, client, document }) =>
    ((state?.commands_public === true && typeof client?.commandsPublic === 'function') ||
      (state?.commands_editable === true && typeof client?.commandsMine === 'function')) &&
    !document.body.classList.contains('panel-view'),
  // Read-only, Core's public projection, under the host header (no intro: the list is the screen).
  intro: false,
  bodyData: { cmdPub: '1' },
  view: ({ document, client, state }) => createCommandsPublicView({ document, client, state }),
});
