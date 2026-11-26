// LAB ONLY — section « FX » (Chaos V2) de la console de modération (D4, shared/moderation-v2.js). Elle y entre par le
// point d'extension générique `registerModerationSection` (shared/module-registry.js, enregistrée par lab-moderation.js) :
// une ligne « FX » dans la navigation des modules, son contenu dans le panneau, ses actions d'en-tête (`headEnd`, boutons
// `data-xact`) rendues par la console. Mêmes classes et mêmes styles que les autres modules (`sec`, `rows`, `row` /
// `row--now`, `who`, `meta tnum`, `icon-btn`, lignes `h`, `statebtn`, `statenote`, modules/moderation/moderation.css).
// Données et actions : le faux Core (store.js → model.js), JAMAIS la Production. Au branchement : read models
// `/moderation/v2/chaos/*` et commandes `/moderation/v2/actions` (permissions vérifiées par le Core), comme TTS et
// Soundboard — contrat : docs/chaos/EXTENSION_INTERACTIONS.md § 9.
import { EFFECTS, durationRange, defaultChoice, effectById, normalizeChoice } from './catalog.js';
import { creditTerms, mmss } from './rules.js';
import { glyph } from './glyphs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const ST = { done: 'joué', expired: 'jamais démarré', removed: 'arrêté', cancelled: 'retiré', interrupted: 'interrompu', failed: 'pas démarré' };
const STATUS = { open: ['active', 'Ouverts'], paused: ['paused', 'Suspendus'], offline: ['disabled', 'Hors live'], disabled: ['disabled', 'Chaos coupé'], engine_down: ['disabled', 'Studio coupé'] };
export const FX_COLOR = '#b8405c';

/** `getMock()` : le faux Core partagé ; `capS()` : plafond Sécurité simulé ; `repaint()` : redessiner la console. */
export function createFxModeration({ document, getMock, capS, now = Date.now, repaint = () => {}, lab = false }) {
  const win = document.defaultView;
  const node = document.createElement('div');
  node.className = 'ix-fxmod';
  let ask = null; // { kind, id } : la question en cours (arrêter, retirer, rembourser, tout arrêter, crédit, offrir)
  let note = null; // { text, tone } : le retour de la dernière action
  let noteTimer = 0;
  let allHistory = false;
  let draft = { viewer: '', effect: 'flip', maxS: 20, level: '', reason: '' };
  let gift = null; // { effect, style, duration } : l'effet offert en cours de réglage

  const icon = (name) => glyph(document, name, '').outerHTML;
  const mini = (effect) => `<span class="mini" style="--c:${FX_COLOR}">${icon(effect)}</span>`;
  const name = (r) => (r.by === 'mod' ? 'Modération' : r.mine ? 'Toi' : r.buyer.name);
  const who = (r) => `<span class="who">${esc(name(r))}</span>`;
  const paid = (r) => (r.credit ? '<span class="meta">crédit</span>' : r.price ? `<span class="meta tnum">${fmt(r.price)} J</span>` : '<span class="meta">offert</span>');
  const sec = (t, end = '') => `<div class="sec"><span>${t}</span>${end}</div>`;
  const hact = (act, ic, tip, danger = false) =>
    `<button class="icon-btn icon-btn--sm hact${danger ? ' hact--danger' : ''}" data-xact="${act}" data-tip="${tip}" aria-label="${tip}">${icon(ic)}</button>`;

  function giftHtml() {
    const grid = `<div class="ixm-gifts">${EFFECTS.map((e) => `<button class="icon-btn${gift?.effect === e.id ? ' is-sel' : ''}" data-fx="gift-pick" data-e="${e.id}" title="${esc(e.label)}" aria-label="${esc(e.label)}" aria-pressed="${gift?.effect === e.id}">${icon(e.id)}</button>`).join('')}</div>`;
    if (!gift) return grid;
    const e = effectById(gift.effect);
    const c = normalizeChoice(e, { ...defaultChoice(e), style: gift.style, duration: gift.duration }, capS(), { reset: true });
    const r = durationRange(e, c, capS());
    const styles = (e.presets?.length ?? 0) > 1 ? `<select data-g="style" aria-label="Préréglage">${e.presets.map((p) => `<option value="${p.id}"${p.id === c.style ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>` : '';
    const durs = [];
    for (let s = r.min; s <= r.max; s += r.step) durs.push(s);
    const dur = r.fixed ? `<span class="meta">${r.def} s</span>` : `<select data-g="duration" aria-label="Durée">${durs.map((s) => `<option value="${s}"${s === c.duration ? ' selected' : ''}>${s} s</option>`).join('')}</select>`;
    return `${grid}<div class="ixm-form"><b class="ixm-gift-name">${esc(e.label)}</b>${styles}${dur}<button class="btn btn--sm btn--primary" data-fx="do-gift">Offrir au stream</button></div>`;
  }

  function askHtml(snap) {
    if (!ask) return '';
    const r = ask.id ? [...snap.active, ...snap.queue, ...snap.burst, ...snap.history].find((x) => x.id === ask.id) : null;
    const reason = `<input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire sans remboursement)" value="${esc(draft.reason)}">`;
    const keep = '<button class="btn btn--sm" data-fx="ask-close">Annuler</button>';
    const pay = r?.credit ? 'le crédit' : `${fmt(r?.price)} J`;
    if (ask.kind === 'stopall')
      return `<div class="ixm-ask ixm-ask--danger"><p>Tout arrêter ? Les effets à l’écran s’arrêtent (remboursés d’office s’ils ont joué moins de 25 % de leur durée) et les achats sont suspendus ; la file attend.</p><div class="ixm-acts"><button class="btn btn--sm btn--danger" data-fx="do-stopall">${icon('stop')}Tout arrêter</button>${keep}</div></div>`;
    if (ask.kind === 'gift') return `<div class="ixm-ask"><p>Offrir un effet au stream : gratuit, il passe devant la file.</p>${giftHtml()}<div class="ixm-acts">${keep}</div></div>`;
    if (ask.kind === 'credit') {
      const e = effectById(draft.effect);
      const viewers = snap.viewers.map((v) => `<option value="${esc(v.id)}"${v.id === draft.viewer ? ' selected' : ''}>${esc(v.id === '42' ? `${v.name} (toi, pour essayer)` : v.name)}</option>`).join('');
      const effects = EFFECTS.map((x) => `<option value="${x.id}"${x.id === draft.effect ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
      const durs = [10, 15, 20, 30].map((s) => `<option value="${s}"${s === draft.maxS ? ' selected' : ''}>${s} s au plus</option>`).join('');
      const levels = e.levels?.length
        ? `<select data-f="level" aria-label="Force au plus"><option value="">Toutes les forces</option>${e.levels.map((l, i) => `<option value="${l.id}"${l.id === draft.level ? ' selected' : ''}>${esc(e.levels.slice(0, i + 1).map((x) => x.label).join(' ou '))}</option>`).join('')}</select>`
        : '';
      return `<div class="ixm-ask"><p>Offrir un crédit : le viewer lancera cet effet plus tard, gratuitement, une fois.</p>
        <div class="ixm-form">${snap.viewers.length ? `<select data-f="viewer" aria-label="Viewer"><option value="">Viewer…</option>${viewers}</select>` : `<input class="ixm-reason" data-viewer maxlength="40" placeholder="Pseudo du viewer" aria-label="Pseudo du viewer" value="${esc(draft.viewerName ?? '')}">`}<select data-f="effect" aria-label="Effet">${effects}</select><select data-f="maxS" aria-label="Durée au plus">${durs}</select>${levels}</div>
        <input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire)" value="${esc(draft.reason)}">
        <div class="ixm-acts"><button class="btn btn--sm btn--primary" data-fx="do-credit">Offrir le crédit</button>${keep}</div></div>`;
    }
    if (!r) return '';
    if (ask.kind === 'stop') {
      const early = r.progress < 0.25;
      return `<div class="ixm-ask"><p>Arrêter ${esc(r.label)} de ${esc(name(r))} ? Joué à ${Math.round((r.progress ?? 0) * 100)} %${early ? ' : remboursement conseillé.' : '.'}</p>${reason}
        <div class="ixm-acts">${r.price || r.credit ? `<button class="btn btn--sm btn--primary" data-fx="do-stop" data-refund="1">Arrêter et rendre ${pay}</button>` : ''}<button class="btn btn--sm" data-fx="do-stop" data-refund="0">${r.price || r.credit ? 'Sans rembourser' : 'Arrêter'}</button>${keep}</div></div>`;
    }
    if (ask.kind === 'cancel')
      return `<div class="ixm-ask"><p>Retirer la demande de ${esc(name(r))} (${esc(r.label)}) ? Jamais démarrée : rendre ${pay} est conseillé.</p>${reason}
        <div class="ixm-acts">${r.price || r.credit ? `<button class="btn btn--sm btn--primary" data-fx="do-cancel" data-refund="1">Retirer et rendre ${pay}</button>` : ''}<button class="btn btn--sm" data-fx="do-cancel" data-refund="0">${r.price || r.credit ? 'Sans rembourser' : 'Retirer'}</button>${keep}</div></div>`;
    if (ask.kind === 'refund')
      return `<div class="ixm-ask"><p>Rendre ${pay} à ${esc(name(r))} pour ${esc(r.label)} (${ST[r.state] ?? r.state}) ?</p><input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire)" value="${esc(draft.reason)}">
        <div class="ixm-acts"><button class="btn btn--sm btn--primary" data-fx="do-refund">Rembourser</button>${keep}</div></div>`;
    if (ask.kind === 'revoke')
      return `<div class="ixm-ask"><p>Retirer ce crédit pas encore utilisé ?</p><input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire)" value="${esc(draft.reason)}">
        <div class="ixm-acts"><button class="btn btn--sm btn--danger" data-fx="do-revoke">Retirer le crédit</button>${keep}</div></div>`;
    return '';
  }

  const waitingRow = (r, pos) => `<div class="row ixm-row"><span class="ixm-pos tnum">${pos}</span>${mini(r.effect)}${who(r)}<span class="txt"><b>${esc(r.label)}</b> ${esc(r.summary)}</span>${paid(r)}
    <span class="meta tnum hide-narrow" title="Départ estimé">~${mmss(r.eta)}</span><button class="icon-btn icon-btn--xs trash" data-fx="ask-cancel" data-id="${r.id}" title="Retirer la demande" aria-label="Retirer la demande de ${esc(name(r))}">${icon('close')}</button></div>`;

  function paint() {
    const snap = getMock().snapshot(now());
    const focusReason = document.activeElement?.matches?.('[data-reason]') && node.contains(document.activeElement);
    const caret = focusReason ? document.activeElement.selectionStart : null;
    let b = '';
    if (note) b += `<div class="statenote ixm-note ixm-note--${note.tone}" role="status">${esc(note.text)}</div>`;
    if (snap.status === 'paused') b += `<div class="statenote statenote--paused">${icon('pause')}Achats suspendus · file conservée</div>`;
    if (lab) b += '<p class="ixm-lab">Lab · faux Core : aucune action ne touche le live.</p>';
    b += askHtml(snap);
    b += sec(`À l’écran · ${snap.active.length}/${snap.maxActive}`);
    b += snap.active.length
      ? `<div class="rows">${snap.active
          .map(
            (r) => `<div class="row row--now ixm-row" style="--c:${FX_COLOR}">${mini(r.effect)}${who(r)}<span class="txt"><b>${esc(r.label)}</b> ${esc(r.summary)}</span>${paid(r)}
              <span class="meta tnum">${mmss(r.remaining)}</span><button class="icon-btn icon-btn--xs stopic" data-fx="ask-stop" data-id="${r.id}" title="Arrêter" aria-label="Arrêter ${esc(r.label)}">${icon('stop')}</button>
              <span class="thin"><i style="width:${Math.round(r.progress * 100)}%"></i></span></div>`,
          )
          .join('')}</div>`
      : '<div class="empty">Rien à l’écran</div>';
    b += sec(`En attente · ${snap.queue.length}/${snap.queueMax}`);
    b += snap.queue.length ? `<div class="rows">${snap.queue.map((r) => waitingRow(r, r.position)).join('')}</div>` : '<div class="empty">File vide</div>';
    if (snap.burst.length) b += sec(`Clignements en attente · ${snap.burst.length}/${snap.burstMax}`) + `<div class="rows">${snap.burst.map((r, i) => waitingRow(r, i + 1)).join('')}</div>`;
    const recent = snap.history.slice(0, allHistory ? 30 : 5);
    const more = snap.history.length > 5 ? `<button class="linkish" data-fx="toggle-history">${allHistory ? 'Moins' : `Tout · ${snap.history.length}`}</button>` : '';
    b += sec('Récents', more);
    b += recent.length
      ? `<div class="rows hist">${recent
          .map((r) => {
            const can = (r.price || r.credit) && !r.refunded;
            return `<div class="h ixm-h"><span class="h__t tnum">${hhmm(r.finished ?? r.created)}</span>${mini(r.effect)}<span class="h__what"><b>${esc(name(r))}</b> · ${esc(r.label)}${r.reason ? ` · « ${esc(r.reason)} »` : ''}</span>
              <span class="h__st">${ST[r.state] ?? r.state}${r.refunded ? ' · rendu' : ''}</span>${can ? `<button class="btn btn--sm" data-fx="ask-refund" data-id="${r.id}">Rembourser</button>` : ''}</div>`;
          })
          .join('')}</div>`
      : '<div class="empty">Aucun effet récemment</div>';
    const pending = snap.allCredits.filter((c) => c.state === 'available');
    b += sec(`Crédits offerts en attente · ${pending.length}`);
    b += pending.length
      ? `<div class="rows">${pending
          .slice(0, 6)
          .map(
            (c) => `<div class="row ixm-row">${mini(c.effect)}<span class="who">${esc(c.viewer.id === '42' ? 'Toi' : c.viewer.name)}</span><span class="txt"><b>${esc(effectById(c.effect).label)}</b> ${esc(creditTerms(c))} · ${esc(c.reason)}</span>
              <span class="meta hide-narrow">${esc(c.source.by)}</span><button class="icon-btn icon-btn--xs trash" data-fx="ask-revoke" data-id="${c.id}" title="Retirer le crédit" aria-label="Retirer le crédit">${icon('close')}</button></div>`,
          )
          .join('')}</div>`
      : '<div class="empty">Aucun crédit en attente</div>';
    node.innerHTML = b;
    if (focusReason) {
      const input = node.querySelector('[data-reason]');
      input?.focus({ preventScroll: true });
      if (caret != null) input?.setSelectionRange(caret, caret);
    }
  }

  /** Actions de l'en-tête (rendu par la console) : offrir, crédit, tout arrêter, état des achats. */
  function headEnd() {
    const status = getMock().snapshot(now()).status;
    const [st, label] = STATUS[status] ?? STATUS.open;
    const toggle = status === 'open' || status === 'paused';
    return `${hact('ask-gift', 'gift', 'Offrir un effet')}${hact('ask-credit', 'ticket', 'Offrir un crédit d’effet')}${hact('ask-stopall', 'stop', 'Tout arrêter', true)}
      <button class="statebtn statebtn--${st}" data-xact="${toggle ? 'toggle-pause' : 'noop'}" data-tip="${status === 'paused' ? 'Reprendre les achats' : toggle ? 'Suspendre les achats' : 'État du live (ne se change pas d’ici)'}" aria-label="Achats : ${label}"${toggle ? '' : ' disabled'}><span class="sdot sdot--${st}"></span>${label}</button>`;
  }

  const say = (text, tone = 'ok') => {
    note = { text, tone };
    win.clearTimeout(noteTimer);
    noteTimer = win.setTimeout(() => {
      note = null;
      paint();
    }, 3500);
  };
  // Une commande répond tout de suite (faux Core du Lab) ou plus tard (Core : vérifiée et tracée côté serveur).
  const done = (result, ok) =>
    Promise.resolve(result).then(
      (out) => {
        if (!out?.ok) {
          say(out?.message ?? 'Refusé.', 'error');
          return paint();
        }
        ask = null;
        gift = null;
        draft = { ...draft, reason: '' };
        say(ok);
        paint();
        repaint();
      },
      () => {
        say('Le Core ne répond pas : rien n’a changé.', 'error');
        paint();
      },
    );

  function act(name, id) {
    const mock = getMock();
    const t = now();
    if (name === 'ask-close') {
      ask = null;
      gift = null;
    } else if (name.startsWith('ask-')) {
      ask = { kind: name.slice(4), id };
      draft.reason = '';
    } else if (name === 'toggle-pause') {
      const paused = mock.snapshot(t).status === 'paused';
      return done(mock.moderation.setPaused(!paused), paused ? 'Achats repris.' : 'Achats suspendus : la file attend.');
    } else if (name === 'toggle-history') allHistory = !allHistory;
    else if (name === 'do-stopall') return done(mock.moderation.stopAll(t), 'Tout est arrêté, achats suspendus.');
    else if (name === 'do-stop' || name === 'do-cancel') return null; // traité avec le bouton (remboursement)
    else if (name === 'do-refund') return done(mock.moderation.refund(ask.id, draft.reason.trim(), t), 'Rendu au viewer.');
    else if (name === 'do-revoke') return done(mock.moderation.revokeCredit(ask.id, draft.reason.trim(), t), 'Crédit retiré.');
    else if (name === 'do-credit') {
      // Faux Core : la liste des viewers ; Core : le pseudo, retrouvé par le Core (recherche de la console).
      const viewer = mock.snapshot(t).viewers.find((v) => v.id === draft.viewer) ?? (draft.viewerName?.trim() ? { id: null, name: draft.viewerName.trim() } : null);
      const constraints = { maxS: draft.maxS };
      if (draft.level) {
        const e = effectById(draft.effect);
        constraints.levels = e.levels.slice(0, e.levels.findIndex((l) => l.id === draft.level) + 1).map((l) => l.id);
      }
      return done(mock.moderation.grantCredit({ viewer, effect: draft.effect, constraints, reason: draft.reason }, t), `Crédit ${effectById(draft.effect).label} offert à ${viewer?.name ?? '…'}.`);
    } else if (name === 'do-gift' && gift) {
      const e = effectById(gift.effect);
      const c = normalizeChoice(e, { ...defaultChoice(e), style: gift.style, duration: gift.duration }, capS(), { reset: true });
      return done(mock.moderation.trigger(e.id, c, t), `${e.label} offert au stream.`);
    }
    return paint();
  }

  node.addEventListener('input', (event) => {
    if (event.target.matches('[data-reason]')) draft.reason = event.target.value;
    if (event.target.matches('[data-viewer]')) draft.viewerName = event.target.value;
  });
  node.addEventListener('change', (event) => {
    const { f, g } = event.target.dataset;
    if (g && gift) gift[g] = g === 'duration' ? Number(event.target.value) : event.target.value;
    if (f) {
      draft[f] = f === 'maxS' ? Number(event.target.value) : event.target.value;
      if (f === 'effect') draft.level = '';
    }
    if (f || g) paint();
  });
  node.addEventListener('click', (event) => {
    const b = event.target.closest('[data-fx]');
    if (!b || !node.contains(b)) return;
    event.stopPropagation();
    const name = b.dataset.fx;
    if (name === 'gift-pick') {
      const e = effectById(b.dataset.e);
      gift = { effect: e.id, style: defaultChoice(e).style, duration: defaultChoice(e).duration };
      return paint();
    }
    if (name === 'do-stop' || name === 'do-cancel') {
      const mock = getMock();
      const op = name === 'do-stop' ? mock.moderation.remove : mock.moderation.cancel;
      const refund = b.dataset.refund === '1';
      return done(op(ask.id, { refund, reason: draft.reason.trim() || null }, now()), refund ? 'Retiré et rendu.' : 'Retiré sans remboursement (motif noté).');
    }
    act(name, b.dataset.id);
  });

  return {
    node,
    paint,
    headEnd,
    /** Un bouton de l'en-tête (`data-xact`) : la console le transmet ici. */
    action: (name) => (name === 'noop' ? null : act(name)),
    destroy: () => win.clearTimeout(noteTimer),
  };
}
