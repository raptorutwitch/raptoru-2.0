// LAB ONLY — section « FX » de la console de modération (D4) pour Chaos V2. Même composition et mêmes classes que les
// modules de la console (shared/moderation-v2.js : `.modv2`, pane, `sec`, `row` / `row--now`, `who`, `meta tnum`,
// `icon-btn`, lignes `h` de l'historique, `statebtn`, `statenote`) et mêmes styles (modules/moderation/moderation.css) :
// rien de nouveau à apprendre pour un modérateur. Données et actions : le faux Core (model.js) ; au branchement, les
// read models et commandes du Core (`/moderation/v2/*`, permissions vérifiées par le Core), comme TTS et Soundboard.
// Intégration prévue dans la console : une ligne « FX » de plus dans la navigation des modules
// (docs/chaos/EXTENSION_INTERACTIONS.md § 9). En Lab, la console D4 n'a pas de faux Core : la section s'ouvre depuis
// Interactions (bouton « Modération FX », réservé à l'équipe).
import { EFFECTS, effectById } from './catalog.js';
import { creditTerms, mmss } from './model.js';
import { glyph } from './glyphs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const ST = { done: 'joué', expired: 'jamais démarré', removed: 'arrêté', cancelled: 'retiré' };
const FX_C = '#b8405c';

export function createFxModeration({ document, getMock, now = Date.now, onGift, onClose }) {
  const win = document.defaultView;
  const node = document.createElement('div');
  node.className = 'modv2 ix-fxmod';
  node.innerHTML = '<div class="layout"><main class="stage"><div class="stage__body" data-body></div></main></div>';
  const body = node.querySelector('[data-body]');
  let ask = null; // { kind, id } : la question en cours (arrêter, retirer, rembourser, tout arrêter, crédit, offrir)
  let note = null; // { text, tone } : le retour de la dernière action
  let noteTimer = 0;
  let draft = { viewer: '', effect: 'flip', maxS: 20, level: '', reason: '' };

  const icon = (name) => glyph(document, name, '').outerHTML;
  const mini = (effect) => `<span class="mini" style="--c:${FX_C}">${icon(effect)}</span>`;
  const who = (r) => (r.by === 'mod' ? '<span class="who">Modération</span>' : `<span class="who">${esc(r.mine ? 'Toi' : r.buyer.name)}</span>`);
  const paid = (r) => (r.credit ? '<span class="meta">crédit</span>' : r.price ? `<span class="meta tnum">${fmt(r.price)} J</span>` : '<span class="meta">offert</span>');
  const sec = (t, end = '') => `<div class="sec"><span>${t}</span>${end}</div>`;
  const hact = (act, name, tip, danger = false) =>
    `<button class="icon-btn icon-btn--sm hact${danger ? ' hact--danger' : ''}" data-act="${act}" data-tip="${tip}" aria-label="${tip}" title="${tip}">${icon(name)}</button>`;

  function askHtml(snap) {
    if (!ask) return '';
    const r = ask.id ? [...snap.active, ...snap.queue, ...snap.history].find((x) => x.id === ask.id) : null;
    const reason = `<input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire sans remboursement)" value="${esc(draft.reason)}">`;
    const keep = '<button class="btn btn--sm" data-act="ask-close">Annuler</button>';
    const pay = r?.credit ? 'le crédit' : `${fmt(r?.price)} J`;
    if (ask.kind === 'stopall')
      return `<div class="ixm-ask ixm-ask--danger"><p>Tout arrêter ? Les effets à l’écran s’arrêtent (remboursés d’office s’ils ont joué moins de 25 % de leur durée) et les achats sont suspendus ; la file attend.</p><div class="ixm-acts"><button class="btn btn--sm btn--danger" data-act="do-stopall">${icon('stop')}Tout arrêter</button>${keep}</div></div>`;
    if (ask.kind === 'gift')
      return `<div class="ixm-ask"><p>Offrir un effet au stream : gratuit, il passe devant la file.</p><div class="ixm-gifts">${EFFECTS.map((e) => `<button class="icon-btn" data-act="gift" data-e="${e.id}" title="${esc(e.label)}" aria-label="Offrir ${esc(e.label)}">${icon(e.id)}</button>`).join('')}</div><div class="ixm-acts">${keep}</div></div>`;
    if (ask.kind === 'credit') {
      const e = effectById(draft.effect);
      const viewers = snap.viewers.map((v) => `<option value="${esc(v.id)}"${v.id === draft.viewer ? ' selected' : ''}>${esc(v.id === '42' ? `${v.name} (toi, pour essayer)` : v.name)}</option>`).join('');
      const effects = EFFECTS.map((x) => `<option value="${x.id}"${x.id === draft.effect ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
      const durs = [10, 15, 20, 30].map((s) => `<option value="${s}"${s === draft.maxS ? ' selected' : ''}>${s} s au plus</option>`).join('');
      const levels = e.levels?.length
        ? `<select data-f="level" aria-label="Force au plus"><option value="">Toutes les forces</option>${e.levels.map((l, i) => `<option value="${l.id}"${l.id === draft.level ? ' selected' : ''}>${esc(e.levels.slice(0, i + 1).map((x) => x.label).join(' ou '))}</option>`).join('')}</select>`
        : '';
      return `<div class="ixm-ask"><p>Offrir un crédit : le viewer pourra lancer cet effet plus tard, gratuitement, une seule fois.</p>
        <div class="ixm-form"><select data-f="viewer" aria-label="Viewer"><option value="">Viewer…</option>${viewers}</select><select data-f="effect" aria-label="Effet">${effects}</select><select data-f="maxS" aria-label="Durée au plus">${durs}</select>${levels}</div>
        <input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire)" value="${esc(draft.reason)}">
        <div class="ixm-acts"><button class="btn btn--sm btn--primary" data-act="do-credit">Offrir le crédit</button>${keep}</div></div>`;
    }
    if (!r) return '';
    if (ask.kind === 'stop') {
      const early = r.progress < 0.25;
      return `<div class="ixm-ask"><p>Arrêter ${esc(r.label)} de ${esc(r.buyer.name)} ? Joué à ${Math.round((r.progress ?? 0) * 100)} %${early ? ' : remboursement conseillé.' : '.'}</p>${reason}
        <div class="ixm-acts">${r.price || r.credit ? `<button class="btn btn--sm btn--primary" data-act="do-stop" data-refund="1">Arrêter et rendre ${pay}</button>` : ''}<button class="btn btn--sm" data-act="do-stop" data-refund="0">${r.price || r.credit ? 'Sans rembourser' : 'Arrêter'}</button>${keep}</div></div>`;
    }
    if (ask.kind === 'cancel')
      return `<div class="ixm-ask"><p>Retirer la demande de ${esc(r.buyer.name)} (${esc(r.label)}) ? Jamais démarrée : rendre ${pay} est conseillé.</p>${reason}
        <div class="ixm-acts">${r.price || r.credit ? `<button class="btn btn--sm btn--primary" data-act="do-cancel" data-refund="1">Retirer et rendre ${pay}</button>` : ''}<button class="btn btn--sm" data-act="do-cancel" data-refund="0">${r.price || r.credit ? 'Sans rembourser' : 'Retirer'}</button>${keep}</div></div>`;
    if (ask.kind === 'refund')
      return `<div class="ixm-ask"><p>Rendre ${pay} à ${esc(r.buyer.name)} pour ${esc(r.label)} (${ST[r.state] ?? r.state}) ?</p><input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire)" value="${esc(draft.reason)}">
        <div class="ixm-acts"><button class="btn btn--sm btn--primary" data-act="do-refund">Rembourser</button>${keep}</div></div>`;
    if (ask.kind === 'revoke')
      return `<div class="ixm-ask"><p>Retirer ce crédit pas encore utilisé ?</p><input class="ixm-reason" data-reason maxlength="80" placeholder="Motif (obligatoire)" value="${esc(draft.reason)}">
        <div class="ixm-acts"><button class="btn btn--sm btn--danger" data-act="do-revoke">Retirer le crédit</button>${keep}</div></div>`;
    return '';
  }

  function paint() {
    const mock = getMock();
    const t = now();
    const snap = mock.snapshot(t);
    const keep = body.querySelector('[data-scroll]')?.scrollTop ?? 0;
    const focusReason = document.activeElement?.matches?.('[data-reason]') && node.contains(document.activeElement);
    const caret = focusReason ? document.activeElement.selectionStart : null;
    node.dataset.mode = node.getBoundingClientRect().width >= 560 ? 'video' : 'compact';
    const paused = snap.status === 'paused';
    const st = snap.status === 'offline' ? 'disabled' : paused ? 'paused' : 'active';
    const headEnd = `${hact('ask-gift', 'gift', 'Offrir un effet')}${hact('ask-credit', 'ticket', 'Offrir un crédit d’effet')}${hact('ask-stopall', 'stop', 'Tout arrêter', true)}
      <button class="statebtn statebtn--${st}" data-act="toggle-pause" title="${paused ? 'Reprendre les achats' : 'Suspendre les achats'}" aria-label="${paused ? 'Achats suspendus : reprendre' : 'Achats ouverts : suspendre'}"><span class="sdot sdot--${st}"></span>${st === 'disabled' ? 'Hors live' : paused ? 'Suspendus' : 'Ouverts'}</button>`;
    let b = '';
    if (note) b += `<div class="statenote ixm-note ixm-note--${note.tone}" role="status">${esc(note.text)}</div>`;
    if (paused) b += `<div class="statenote statenote--paused">${icon('pause')}Achats suspendus · file conservée</div>`;
    b += askHtml(snap);
    b += sec(`À l’écran · ${snap.active.length}/${snap.maxActive}`);
    b += snap.active.length
      ? `<div class="rows">${snap.active
          .map(
            (r) => `<div class="row row--now ixm-row" style="--c:${FX_C}">${mini(r.effect)}${who(r)}<span class="txt"><b>${esc(r.label)}</b> ${esc(r.summary)}</span>${paid(r)}
              <span class="meta tnum">${mmss(r.remaining)}</span><button class="icon-btn icon-btn--xs stopic" data-act="ask-stop" data-id="${r.id}" title="Arrêter" aria-label="Arrêter ${esc(r.label)}">${icon('stop')}</button>
              <span class="thin"><i style="width:${Math.round(r.progress * 100)}%"></i></span></div>`,
          )
          .join('')}</div>`
      : '<div class="empty">Rien à l’écran</div>';
    b += sec(`En attente · ${snap.queue.length}/${snap.queueMax}`);
    b += snap.queue.length
      ? `<div class="rows">${snap.queue
          .map(
            (r) => `<div class="row ixm-row"><span class="ixm-pos tnum">${r.position}</span>${mini(r.effect)}${who(r)}<span class="txt"><b>${esc(r.label)}</b> ${esc(r.summary)}</span>${paid(r)}
              <span class="meta tnum hide-narrow" title="Départ estimé">~${mmss(r.eta)}</span><button class="icon-btn icon-btn--xs trash" data-act="ask-cancel" data-id="${r.id}" title="Retirer la demande" aria-label="Retirer la demande">${icon('close')}</button></div>`,
          )
          .join('')}</div>`
      : '<div class="empty">File vide</div>';
    const recent = snap.history.slice(0, 6);
    b += sec('Récents', '<span class="meta hide-narrow">Historique complet : Modération › Historique</span>');
    b += recent.length
      ? `<div class="rows hist">${recent
          .map((r) => {
            const can = (r.price || r.credit) && !r.refunded;
            return `<div class="h ixm-h"><span class="h__t tnum">${hhmm(r.finished ?? r.created)}</span>${mini(r.effect)}<span class="h__what"><b>${esc(r.mine ? 'Toi' : r.buyer.name)}</b> · ${esc(r.label)}${r.reason ? ` · « ${esc(r.reason)} »` : ''}</span>
              <span class="h__st">${ST[r.state] ?? r.state}${r.refunded ? ' · remboursé' : ''}</span>${can ? `<button class="btn btn--sm" data-act="ask-refund" data-id="${r.id}">Rembourser</button>` : ''}</div>`;
          })
          .join('')}</div>`
      : '<div class="empty">Aucun effet récemment</div>';
    const credits = snap.allCredits.filter((c) => c.state === 'available').slice(0, 6);
    b += sec(`Crédits offerts en attente · ${snap.allCredits.filter((c) => c.state === 'available').length}`);
    b += credits.length
      ? `<div class="rows">${credits
          .map(
            (c) => `<div class="row ixm-row">${mini(c.effect)}<span class="who">${esc(c.viewer.id === '42' ? 'Toi' : c.viewer.name)}</span><span class="txt"><b>${esc(effectById(c.effect).label)}</b> ${esc(creditTerms(c))} · ${esc(c.reason)}</span>
              <span class="meta">${esc(c.source.by)}</span><button class="icon-btn icon-btn--xs trash" data-act="ask-revoke" data-id="${c.id}" title="Retirer le crédit" aria-label="Retirer le crédit">${icon('close')}</button></div>`,
          )
          .join('')}</div>`
      : '<div class="empty">Aucun crédit en attente</div>';
    body.innerHTML = `<section class="pane pane--main"><header class="pane__head"><button class="icon-btn icon-btn--sm" data-act="close" title="Retour à Chaos" aria-label="Retour à Chaos">${icon('chevL')}</button>
      <div class="pane__title"><small>Modération</small><strong><span class="ttl-ic" style="--c:${FX_C}">${icon('chaos')}</span>FX</strong></div>${headEnd}</header>
      <div class="scroll" data-scroll><div class="pane__body">${b}</div></div></section>`;
    body.querySelector('[data-scroll]').scrollTop = keep;
    if (focusReason) {
      const input = body.querySelector('[data-reason]');
      input?.focus({ preventScroll: true });
      if (caret != null) input?.setSelectionRange(caret, caret);
    }
  }

  const say = (text, tone = 'ok') => {
    note = { text, tone };
    win.clearTimeout(noteTimer);
    noteTimer = win.setTimeout(() => {
      note = null;
      paint();
    }, 3500);
  };
  const done = (out, ok) => {
    if (!out.ok) {
      say(out.message, 'error');
      return paint();
    }
    ask = null;
    draft = { ...draft, reason: '' };
    say(ok);
    paint();
  };

  node.addEventListener('input', (event) => {
    if (event.target.matches('[data-reason]')) draft.reason = event.target.value;
  });
  node.addEventListener('change', (event) => {
    const f = event.target.dataset.f;
    if (!f) return;
    draft[f] = f === 'maxS' ? Number(event.target.value) : event.target.value;
    if (f === 'effect') draft.level = '';
    paint();
  });
  node.addEventListener('click', (event) => {
    const b = event.target.closest('[data-act]');
    if (!b || !node.contains(b)) return;
    const mock = getMock();
    const t = now();
    const act = b.dataset.act;
    const id = b.dataset.id;
    if (act === 'close') return onClose?.();
    if (act === 'ask-close') ask = null;
    else if (act.startsWith('ask-')) {
      ask = { kind: act.slice(4), id };
      draft.reason = '';
    } else if (act === 'toggle-pause') {
      const paused = mock.snapshot(t).status === 'paused';
      mock.moderation.setPaused(!paused);
      say(paused ? 'Achats repris.' : 'Achats suspendus : la file attend.');
    } else if (act === 'do-stopall') return done(mock.moderation.stopAll(t), 'Tout est arrêté, achats suspendus.');
    else if (act === 'do-stop' || act === 'do-cancel') {
      const op = act === 'do-stop' ? mock.moderation.remove : mock.moderation.cancel;
      const refund = b.dataset.refund === '1';
      return done(op(ask.id, { refund, reason: draft.reason.trim() || null }, t), refund ? 'Retiré et rendu.' : 'Retiré sans remboursement (motif noté).');
    } else if (act === 'do-refund') return done(mock.moderation.refund(ask.id, draft.reason.trim(), t), 'Rendu au viewer.');
    else if (act === 'do-revoke') return done(mock.moderation.revokeCredit(ask.id, draft.reason.trim(), t), 'Crédit retiré.');
    else if (act === 'do-credit') {
      const viewer = mock.snapshot(t).viewers.find((v) => v.id === draft.viewer);
      const constraints = { maxS: draft.maxS };
      if (draft.level) {
        const e = effectById(draft.effect);
        constraints.levels = e.levels.slice(0, e.levels.findIndex((l) => l.id === draft.level) + 1).map((l) => l.id);
      }
      return done(mock.moderation.grantCredit({ viewer, effect: draft.effect, constraints, reason: draft.reason }, t), `Crédit ${effectById(draft.effect).label} offert à ${viewer?.name ?? '…'}.`);
    } else if (act === 'gift') {
      ask = null;
      return onGift?.(b.dataset.e, b);
    }
    paint();
  });

  return {
    node,
    paint,
    focus: () => node.querySelector('[data-act="close"]')?.focus({ preventScroll: true }),
    say: (text) => {
      say(text);
      paint();
    },
    destroy: () => win.clearTimeout(noteTimer),
  };
}
