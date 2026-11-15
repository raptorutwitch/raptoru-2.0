// Commandes Chat — « Mes commandes modifiables » (édition déléguée, docs/COMMANDS_V2_STATUS.md). Les commandes dont le
// streamer a fait de ce viewer un éditeur (Studio › une commande › Modification déléguée, par ID Twitch) : l'activer ou
// la couper et, pour une commande « message contenant une expression », changer ses expressions, puis Enregistrer.
// Rien d'autre n'est montré ni envoyé : le Core vérifie à chaque enregistrement l'identité Twitch du jeton, que ce viewer
// est bien éditeur de cette commande, la version lue (aucune perte de mise à jour) et refuse tout autre champ.
// Aucune commande modifiable : rien n'est affiché (jamais une zone vide).
import { ic } from './commands-v2-icons.js';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const key = (k) => k.trim().replace(/\s+/g, ' ').toLowerCase();
const hhmm = (t) =>
  new Date(t).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const MAX_KEYWORDS = 20;
const MATCH = {
  word: 'en mot entier',
  anywhere: 'n’importe où dans le message',
};
const SAVE_ERROR = {
  version_conflict:
    'Elle a été modifiée entre-temps : voici ses réglages actuels. Refais ta modification.',
  not_found: 'Tu ne peux plus modifier cette commande.',
  field_not_delegated: 'Ce réglage n’est pas modifiable depuis l’extension.',
  invalid_config:
    'Il faut au moins une expression (40 caractères au plus, sans doublon).',
  identity_required:
    'Partage ton identité Twitch avec l’extension pour modifier tes commandes.',
};

/** `client.commandsMine()` → { commands }, `client.commandsMineSave(id, body)` → { command }. */
export function createCommandsMine({ document, client, onChange = () => {} }) {
  const node = document.createElement('section');
  node.className = 'cmine';
  node.setAttribute('aria-label', 'Mes commandes modifiables');
  node.hidden = true;
  /** command_id → { base (Core's view), enabled, keywords, input, busy, msg: { ok, text } | null } */
  const items = new Map();
  let order = [];

  const dirty = (it) =>
    it.enabled !== it.base.enabled ||
    JSON.stringify(it.keywords) !== JSON.stringify(it.base.trigger.keywords);
  const fresh = (base, msg = null) => ({
    base,
    enabled: base.enabled,
    keywords: [...base.trigger.keywords],
    input: '',
    busy: false,
    msg,
  });

  async function load() {
    if (typeof client?.commandsMine !== 'function') return;
    try {
      const out = await client.commandsMine();
      const list = Array.isArray(out?.commands) ? out.commands : [];
      order = list.map((c) => c.command_id);
      for (const c of list) {
        const it = items.get(c.command_id);
        // A draft being edited stays (a re-read never erases it); otherwise Core's values.
        if (!it || (!dirty(it) && !it.busy))
          items.set(c.command_id, fresh(c, it?.msg ?? null));
      }
      for (const id of [...items.keys()])
        if (!order.includes(id)) items.delete(id);
    } catch {
      // Unavailable: keep what was shown (nothing on a first failure).
    }
    render();
  }

  function card(it) {
    const c = it.base;
    const id = esc(c.command_id);
    const kw = c.editable.includes('keywords');
    const chips = kw
      ? `<div class="chips" role="group" aria-label="Expressions de ${esc(c.name)}">${it.keywords
          .map(
            (k) =>
              `<span class="chip">${esc(k)}<button type="button" data-mine-del="${id}|${esc(k)}" aria-label="Retirer ${esc(k)}" ${it.busy ? 'disabled' : ''}>${ic('x')}</button></span>`,
          )
          .join(
            '',
          )}${it.keywords.length < MAX_KEYWORDS ? `<input class="chip-in" data-mine-in="${id}" value="${esc(it.input)}" maxlength="40" placeholder="+ expression" aria-label="Ajouter une expression" autocomplete="off" spellcheck="false" ${it.busy ? 'disabled' : ''}>` : ''}</div>`
      : '';
    const how = kw
      ? `Se lance quand un message contient une de ces expressions, ${MATCH[c.trigger.match] ?? ''}.`
      : `Se lance avec !${esc(c.name)} dans le chat.`;
    const status = it.msg
      ? `<span class="cmine__st ${it.msg.ok ? 'is-ok' : 'is-bad'}" role="status">${it.msg.ok ? ic('check') : ic('warn')}${esc(it.msg.text)}</span>`
      : `<span class="cmine__st" role="status">${dirty(it) ? 'Modifications non enregistrées' : `À jour · modifiée à ${hhmm(c.updated_at)}`}</span>`;
    return `<article class="cmine__c${it.enabled ? '' : ' is-off'}" data-mine="${id}">
      <header class="cmine__h">
        <span class="cmine__n"><b>${kw ? esc(c.name) : `!${esc(c.name)}`}</b><small>${how}</small></span>
        <label class="tgl"><button type="button" class="sw ${it.enabled ? 'on' : ''}" data-mine-toggle="${id}" role="switch" aria-checked="${it.enabled}" aria-label="Activer ${esc(c.name)}" ${it.busy ? 'disabled' : ''}></button><span>${it.enabled ? 'Active' : 'Coupée'}</span></label>
      </header>
      ${chips}
      <footer class="cmine__f">${status}<button type="button" class="btn btn--primary btn--sm" data-mine-save="${id}" ${dirty(it) && !it.busy ? '' : 'disabled'}>${it.busy ? 'Enregistrement…' : 'Enregistrer'}</button></footer>
    </article>`;
  }

  function render() {
    const list = order.map((id) => items.get(id)).filter(Boolean);
    const was = !node.hidden;
    node.hidden = !list.length;
    if (was !== !node.hidden) onChange();
    if (!list.length) {
      node.innerHTML = '';
      return;
    }
    const focused = node.contains(document.activeElement)
      ? document.activeElement.dataset?.mineIn
      : null;
    node.innerHTML = `<div class="lgh" style="--c:var(--accent)"><span>${ic('pencil')}</span><span>Mes commandes modifiables</span><em>${list.length}</em></div>
      ${list.map(card).join('')}
      <p class="cmine__hint">Le streamer t’a confié ${list.length > 1 ? 'ces commandes' : 'cette commande'} : tu peux l’activer, la couper et changer ses expressions. Le son, qui peut l’utiliser, le délai et le reste restent réglés par le streamer.</p>`;
    if (focused)
      node
        .querySelector(`[data-mine-in="${CSS.escape(focused)}"]`)
        ?.focus({ preventScroll: true });
  }

  /** Adds the expression typed in the card (literal, case-insensitive duplicates refused — Core checks again). */
  function addKeyword(it) {
    const k = it.input.trim().replace(/\s+/g, ' ');
    if (!k) return;
    if (k.length > 40) it.msg = { ok: false, text: '40 caractères au plus.' };
    else if (it.keywords.some((x) => key(x) === key(k)))
      it.msg = { ok: false, text: `« ${k} » est déjà dans la liste.` };
    else {
      it.keywords = [...it.keywords, k];
      it.input = '';
      it.msg = null;
    }
  }

  async function save(it) {
    if (it.input.trim()) addKeyword(it);
    if (!dirty(it) || it.busy) return render();
    if (it.base.editable.includes('keywords') && !it.keywords.length) {
      it.msg = { ok: false, text: 'Il faut au moins une expression.' };
      return render();
    }
    const body = { expected_version: it.base.version };
    if (it.enabled !== it.base.enabled) body.enabled = it.enabled;
    if (
      JSON.stringify(it.keywords) !== JSON.stringify(it.base.trigger.keywords)
    )
      body.keywords = it.keywords;
    it.busy = true;
    it.msg = null;
    render();
    try {
      const out = await client.commandsMineSave(it.base.command_id, body);
      items.set(
        it.base.command_id,
        fresh(out.command, {
          ok: true,
          text: `Enregistré à ${hhmm(Date.now())}`,
        }),
      );
    } catch (e) {
      const code = e?.code ?? e?.message;
      const current = e?.details?.current;
      if (code === 'not_found') {
        items.delete(it.base.command_id);
        order = order.filter((x) => x !== it.base.command_id);
      } else if (code === 'version_conflict' && current?.command_id) {
        items.set(
          it.base.command_id,
          fresh(current, { ok: false, text: SAVE_ERROR.version_conflict }),
        );
      } else {
        it.busy = false;
        it.msg = {
          ok: false,
          text:
            SAVE_ERROR[code] ??
            'Enregistrement impossible pour le moment. Réessaie.',
        };
      }
    }
    render();
  }

  const itemOf = (id) => items.get(id) ?? null;
  node.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !node.contains(b) || b.disabled) return;
    if (b.dataset.mineToggle) {
      const it = itemOf(b.dataset.mineToggle);
      if (!it) return;
      it.enabled = !it.enabled;
      it.msg = null;
      return render();
    }
    if (b.dataset.mineDel) {
      const [id, k] = b.dataset.mineDel.split('|');
      const it = itemOf(id);
      if (!it) return;
      it.keywords = it.keywords.filter((x) => x !== k);
      it.msg = null;
      return render();
    }
    if (b.dataset.mineSave) {
      const it = itemOf(b.dataset.mineSave);
      if (it) void save(it);
    }
  });
  node.addEventListener('input', (e) => {
    const id = e.target.dataset?.mineIn;
    const it = id ? itemOf(id) : null;
    if (it) it.input = e.target.value;
  });
  node.addEventListener('keydown', (e) => {
    const id = e.target.dataset?.mineIn;
    const it = id ? itemOf(id) : null;
    if (!it || e.key !== 'Enter') return;
    e.preventDefault();
    addKeyword(it);
    render();
  });

  return { node, load, render };
}
