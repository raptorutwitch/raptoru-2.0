// Commands V2 — « Modération › Commandes » of the extension (phase E), port of the validated prototype
// V6.3 (prototypes/commands-v6/, Extension surfaces Video 600×432 and Mobile). Everything comes from Core
// through the EBS façade /commands/v2/* with the caller's verified identity: the role (mod, supermod,
// streamer) and its rights are Core's (/me), every change is checked by Core (rights and bounds, team
// lock, module locks, expected_version). This view only shows them: a field the role may not change is
// displayed read-only with a lock. No local truth, no localStorage.
import { ic } from './commands-v2-icons.js';
import {
  blank,
  canCreate,
  canEdit,
  canRemove,
  canSetOnCreate,
  categoryOf,
  changes,
  cooldownMin,
  cooldownShort,
  cooldownText,
  COOLDOWN_PRESETS,
  counts,
  FIELD,
  groups,
  GROUPS,
  insertAt,
  historyCategoryName,
  MODES,
  NO_CATEGORY,
  previewText,
  quotaShort,
  quotaText,
  reapply,
  REASON,
  ISSUE,
  SAVE_ERROR,
  stateOf,
  STEP,
  TO,
  unitOf,
  VARIABLES,
  variableMissing,
  visible,
  whoSentence,
  whoShort,
  WINDOWS,
  word,
} from './commands-v2-model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (x) => structuredClone(x);
const clock = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayOf = (iso) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Aujourd’hui';
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};
const ROLE = { broadcaster: 'Streamer', supermod: 'Supermodo', moderator: 'Modérateur' };
const lock = (why) => `<span class="lk" title="${esc(why)}">${ic('lock')}</span>`;
const ro = (why, text) => `<div class="ro">${lock(why)}<span>${esc(text)}</span></div>`;

export function createCommandsV2View({ document, client, onBack }) {
  const win = document.defaultView;
  const node = document.createElement('div');
  node.className = 'cmdx';
  const ui = {
    view: 'list',
    side: 'all',
    cat: 'all',
    group: true,
    q: '',
    me: null,
    list: null,
    error: '',
    id: null,
    base: null,
    draft: null,
    nw: null,
    pop: null,
    cdCustom: false,
    sheet: null,
    activity: null,
    conflict: null,
    saving: false,
    saveError: '',
    aliasErr: '',
    confirm: null,
  };
  let started = false;
  let loadedAt = 0;
  const mode = () => ((node.clientWidth || win.innerWidth) >= 520 ? 'video' : 'mobile');
  const cats = () => ui.list?.categories ?? [];
  const cur = () => ui.list?.commands.find((c) => c.command_id === ui.id) ?? null;
  const D = () => (ui.view === 'new' ? ui.nw : ui.view === 'page' ? ui.draft : null);
  const dirty = () => !!ui.base && !!ui.draft && Object.keys(changes(ui.base.config, ui.draft)).length > 0;
  /** Field editable for this reader? On the creation page: the creation right. */
  const may = (field) => (ui.view === 'new' ? { ok: canSetOnCreate(ui.me, field), why: 'Non délégué à ton rôle' } : canEdit(ui.me, ui.base, field));
  const errText = (e) => {
    const d = e?.details ?? {};
    const code = String(d.error ?? e?.code ?? e?.message ?? 'erreur');
    const extra =
      code === 'cooldown_below_minimum' && d.min_seconds
        ? ` (minimum ${d.min_seconds} s)`
        : code === 'field_not_delegated' && d.field
          ? ` (${FIELD[d.field] ?? d.field})`
          : d.word
            ? ` (!${d.word}${d.command ? ` → !${d.command}` : d.module ? ` → ${d.module === 'raffle' ? 'Tombola' : d.module}` : ''})`
            : Array.isArray(d.issues) && d.issues.length
              ? ` : ${d.issues.map((i) => ISSUE[i] ?? i).join(' · ')}`
              : '';
    return `${SAVE_ERROR[code] ?? code}${extra}`;
  };

  // ------------------------------------------------------------------ data
  async function load() {
    try {
      const [me, list] = await Promise.all([client.cmdV2('me'), client.cmdV2('list')]);
      ui.me = me;
      ui.list = list;
      ui.error = '';
      if (ui.view === 'page' && ui.base) {
        const now = cur();
        if (!now) Object.assign(ui, { view: 'list', base: null, draft: null });
        else if (!dirty()) Object.assign(ui, { base: now, draft: clone(now.config) });
        else ui.base = { ...now, config: ui.base.config, version: ui.base.version };
      }
    } catch (e) {
      ui.error = e?.status === 403 ? 'Réservé à l’équipe de modération.' : `Commandes indisponibles (${errText(e)}).`;
    }
  }
  async function refresh() {
    loadedAt = Date.now();
    await load();
    rerender();
  }

  // ------------------------------------------------------------------ list (V6.3)
  function stateCell(c) {
    const st = stateOf(c);
    const icon = (name, tip, cls = '') => `<span class="lst-ic ${cls}" title="${esc(tip)}">${ic(name)}</span>`;
    const issue = st.key === 'ok' || st.key === 'off' ? '' : icon(st.key === 'reserved' ? 'warn' : 'warn', `${st.label} — ${st.why}`, `lst-ic--${st.tone}`);
    const sys = c.kind === 'system' ? icon('cube', `Commande système · module ${c.owner_module === 'raffle' ? 'Tombola' : (c.owner_module ?? '')}`) : '';
    const lk = c.config.team_lock ? icon('lock', 'Verrouillée par le streamer : l’équipe peut la consulter, pas la modifier') : '';
    const hid = c.config.listed ? '' : icon('eyeoff', 'Cachée de la liste publique');
    const t = canEdit(ui.me, c, 'enabled');
    const tip = t.ok ? (c.config.enabled ? 'Active — toucher pour désactiver' : 'Désactivée — toucher pour activer') : `${c.config.enabled ? 'Active' : 'Désactivée'} — ${t.why}`;
    return `<span class="lst-state">${issue}${sys}${lk}${hid}<button type="button" class="sw ${c.config.enabled ? 'on' : ''}" ${t.ok ? `data-toggle="${c.command_id}"` : 'disabled aria-disabled="true"'} role="switch" aria-checked="${c.config.enabled}" aria-label="Activer !${esc(c.config.name)}" title="${esc(tip)}"></button></span>`;
  }
  function row({ c, via }, showCat) {
    const cfg = c.config;
    const mobile = mode() === 'mobile';
    const k = categoryOf(c, cats());
    const cd = `${esc(cooldownShort(cfg.cooldown))}`;
    return `<div class="lr ${cfg.enabled ? '' : 'off'}" data-open="${c.command_id}" role="button" tabindex="0">
      <span class="lname"><span class="tile ${mobile ? 'tile--md' : ''}" style="--c:${cfg.appearance.color}">${ic(cfg.appearance.icon)}</span><span class="lname__t"><span class="lname__a"><span class="cn">${esc(cfg.name)}</span>${via ? `<span class="via">via !${esc(via)}</span>` : ''}${showCat ? `<span class="lcat" style="--c:${k.color}"><i></i>${esc(k.name)}</span>` : ''}</span>${mobile ? `<span class="lmeta">${esc(whoShort(cfg.audience))} · ${cfg.cooldown.enabled ? cd : 'Aucun cooldown'}${cfg.quota.enabled ? ` · max ${esc(quotaShort(cfg.quota))}` : ''}</span>` : ''}<span class="desc">${esc(cfg.description || 'Sans description')}</span></span></span>
      ${mobile ? '' : `<span class="lcol" title="${esc(whoShort(cfg.audience))}"><span>${esc(whoShort(cfg.audience))}</span></span><span class="lcol" title="${esc(`${cooldownText(cfg.cooldown)} · ${quotaText(cfg.quota)}`)}"><span class="${cfg.cooldown.enabled ? '' : 'faint'}">${cd}</span>${cfg.quota.enabled ? `<small>max ${esc(quotaShort(cfg.quota))}</small>` : ''}</span>`}
      ${stateCell(c)}</div>`;
  }
  function catFilter() {
    const all = ui.list?.commands ?? [];
    const n = (id) => all.filter((c) => (categoryOf(c, cats()) === NO_CATEGORY ? null : c.config.category) === id).length;
    const none = n(null);
    const k = ui.cat === 'all' ? null : ui.cat === 'none' ? NO_CATEGORY : (cats().find((x) => x.category_id === ui.cat) ?? NO_CATEGORY);
    return `<span class="lcatf"><label class="lsel ${k ? 'lsel--on' : ''}" style="--c:${k ? k.color : 'transparent'}"><i></i><select class="inp" data-cat aria-label="Catégorie">
        <option value="all" ${ui.cat === 'all' ? 'selected' : ''}>Toutes les catégories</option>
        ${cats().map((f) => `<option value="${f.category_id}" ${ui.cat === f.category_id ? 'selected' : ''}>${esc(f.name)} (${n(f.category_id)})</option>`).join('')}
        ${none ? `<option value="none" ${ui.cat === 'none' ? 'selected' : ''}>Sans catégorie (${none})</option>` : ''}</select></label>
      <button type="button" class="lgrp ${ui.group ? 'on' : ''}" data-group aria-pressed="${ui.group}" title="${ui.group ? 'Ne plus grouper' : 'Grouper par catégorie'}">${ic('folder')}<span>Grouper</span></button></span>`;
  }
  function header(title, extra = '') {
    return `<header class="xh"><button type="button" class="ib" data-back aria-label="Retour">${ic('back')}</button><span class="xh__t">${title}</span><span class="grow"></span>${extra}</header>`;
  }
  function listHtml() {
    const roleTag = ui.me ? `<span class="xme" title="Ton rôle pour les commandes (décidé par Core)">${esc(ROLE[ui.me.role] ?? ui.me.role)}</span>` : '';
    if (!ui.list) return `${header('<span class="faint">Modération ›</span> Commandes', roleTag)}<p class="empty">${esc(ui.error || 'Chargement…')}</p>`;
    const lu = { side: ui.side, cat: ui.cat, group: ui.group, q: ui.q };
    const list = visible(ui.list.commands, cats(), lu);
    const n = counts(ui.list.commands, cats(), lu);
    const gs = groups(list, cats(), lu);
    const showCat = ui.cat === 'all' && !ui.group;
    const mobile = mode() === 'mobile';
    const body = gs
      .map(([f, l]) => (f ? `<section class="lgroup"><div class="lgh" style="--c:${f.color}"><span class="lgh__i">${ic(f.icon)}</span><span class="lgh__t">${esc(f.name)}</span><em>${l.length}</em></div>${l.map((x) => row(x, showCat)).join('')}</section>` : l.map((x) => row(x, showCat)).join('')))
      .join('');
    const add = canCreate(ui.me) ? `<button type="button" class="btn btn--primary btn--sm" data-new title="Nouvelle commande">${ic('plus')}${mobile ? '' : 'Nouvelle'}</button>` : '';
    return `${header('<span class="faint">Modération ›</span> Commandes', `${roleTag}${add}`)}
      <div class="xs"><label class="msearch">${ic('search')}<input class="inp" data-q placeholder="Nom ou alias" value="${esc(ui.q)}" spellcheck="false"></label></div>
      <div class="lfilters"><div class="lseg" role="group" aria-label="État">${[['all', 'Toutes'], ['check', 'À vérifier'], ['off', 'Désactivées'], ['hidden', 'Cachées']].map(([k, l]) => `<button type="button" class="${ui.side === k ? 'on' : ''}" data-side="${k}">${l} <em>${n[k]}</em></button>`).join('')}</div>${catFilter()}</div>
      <div class="lst lst--ext">${mobile ? '' : '<div class="lhead"><span>Commande</span><span>Accès</span><span>Cooldown</span><span class="r">État</span></div>'}
        <div class="lbody scroll">${body || `<p class="empty">${ui.list.commands.length ? 'Aucune commande pour ce filtre.' : 'Aucune commande pour l’instant.'}</p>`}</div></div>`;
  }

  // ------------------------------------------------------------------ controls (validated prototype)
  const chips = (list, kind, placeholder) => `<div class="chips">${list.map((v) => `<span class="chip">${esc(v)}<button type="button" data-chipdel="${kind}|${esc(v)}" aria-label="Retirer ${esc(v)}">${ic('x')}</button></span>`).join('')}<input class="chip-in" data-chipin="${kind}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"></div>`;
  const preview = (m) => {
    if (m.mode === 'silent') return '';
    const t = esc(previewText(m)).replace(/^(@\S+)/, '<span class="cl-at">$1</span>');
    const line = m.mode === 'announce' ? `<div class="cl cl--ann"><span class="cl-tag">Annonce</span><b class="cl-bot">LeCroupier_</b> ${t}</div>` : m.mode === 'reply' ? `<div class="cl"><span class="cl-re">↳ En réponse à @PixelMamie</span><b class="cl-bot">LeCroupier_</b> ${t}</div>` : m.mode === 'me' ? `<div class="cl"><b class="cl-bot">LeCroupier_</b> <i class="cl-me">${t}</i></div><div class="cl cl--silent">/me n’est pas envoyé aujourd’hui.</div>` : `<div class="cl"><b class="cl-bot">LeCroupier_</b> ${t}</div>`;
    return `<div class="pvw"><span class="pvw__t">Aperçu dans le chat <span class="faint">(exemple)</span></span><div class="pv">${line}</div></div>`;
  };
  function replyHtml(d) {
    const r = d.reply;
    const m = may('reply');
    if (!m.ok) return ro(m.why, `${MODES.find((x) => x[0] === r.mode)[1]}${r.mode === 'silent' ? '' : ` · « ${r.text} »`}`) + preview(r);
    const to = TO.find((x) => x[0] === r.to);
    return `<div class="reply">
      <div class="seg seg--modes" role="radiogroup" aria-label="Comment le bot répond">${MODES.map(([k, l, i, desc, okm]) => `<button type="button" class="${r.mode === k ? 'on' : ''} ${okm ? '' : 'unsup'}" data-rmode="${k}" title="${esc(desc)}" role="radio" aria-checked="${r.mode === k}">${ic(i)}<span>${l}</span></button>`).join('')}</div>
      ${r.mode === 'me' ? `<p class="err">${ic('warn')}/me n’est pas supporté aujourd’hui : ce message ne serait pas envoyé.</p>` : ''}
      ${r.mode === 'silent' ? '<p class="hint">Le bot n’écrit rien.</p>' : `<textarea class="inp" rows="2" data-rtext maxlength="500" placeholder="Ce que le bot écrit">${esc(r.text)}</textarea>
      <div class="rbar">${r.mode === 'reply' ? `<span class="faint">${ic('at')}Répond dans le fil du viewer</span>` : `<div class="popw"><button type="button" class="pick ${r.to !== 'none' ? 'on' : ''}" data-pop="to" aria-expanded="${ui.pop === 'to'}">${ic('at')}S’adresser à : <b>${r.to === 'user' ? `@${esc(r.to_login ?? '…')}` : esc(to[1])}</b>${ic('down')}</button>${ui.pop === 'to' ? `<div class="pop pop--to">${TO.map(([k, l, desc]) => `<button type="button" class="popt ${r.to === k ? 'on' : ''}" data-to="${k}" ${k === 'target' && !d.args.some((a) => a.type === 'mention') ? 'disabled' : ''}><b>${l}</b><small>${desc}</small></button>`).join('')}${r.to === 'user' ? `<input class="inp" data-tologin value="${esc(r.to_login ?? '')}" placeholder="pseudo, sans @">` : ''}</div>` : ''}</div>`}
        <div class="popw"><button type="button" class="pick" data-pop="vars" aria-expanded="${ui.pop === 'vars'}">${ic('plus')}Insérer une variable${ic('down')}</button>${ui.pop === 'vars' ? `<div class="pop pop--vars" role="listbox">${VARIABLES.map(([v, name, desc, , needs]) => { const off = variableMissing(d, needs); return `<button type="button" class="vrow ${off ? 'vrow--off' : ''}" ${off ? 'disabled' : `data-insert="${v}"`} role="option"><b>${esc(name)}</b><code>${v}</code><small>${esc(desc)}${off ? ' — demande un argument (réglage Studio)' : ''}</small></button>`; }).join('')}</div>` : ''}</div></div>
      ${preview(r)}`}</div>`;
  }
  function whoHtml(d) {
    const a = d.audience;
    const g = may('audience.groups');
    const x = may('audience.deny');
    return `${g.ok ? `<div class="opts" role="group" aria-label="Groupes">${GROUPS.map(([k, l]) => `<button type="button" class="opt opt--tg ${a.groups.includes(k) ? 'on' : ''}" data-grp="${k}" aria-pressed="${a.groups.includes(k)}">${a.groups.includes(k) ? ic('check') : ''}${l}</button>`).join('')}</div>` : ro(g.why, a.groups.map((k) => GROUPS.find((x2) => x2[0] === k)?.[1] ?? k).join(' + ') || 'Aucun groupe')}
      <div class="people"><span>Autoriser aussi</span>${g.ok ? chips(a.allow, 'allow', '+ pseudo') : ro(g.why, a.allow.join(', ') || 'Personne')}</div>
      <div class="people"><span>Exclure</span>${x.ok ? chips(a.deny, 'deny', '+ pseudo') : ro(x.why, a.deny.join(', ') || 'Personne')}</div>
      <p class="sentence"><b>${esc(whoShort(a))}</b> <span class="faint">${esc(whoSentence(a))}</span></p>`;
  }
  const scopeSeg = (attr, v) => `<div class="seg seg--sm" role="radiogroup"><button type="button" class="${v === 'viewer' ? 'on' : ''}" data-${attr}="viewer">Par personne</button><button type="button" class="${v === 'global' ? 'on' : ''}" data-${attr}="global">Pour tout le chat</button></div>`;
  const toggleRow = (attr, on, label, dis = '') => `<label class="tgl"><button type="button" class="sw ${on ? 'on' : ''}" data-${attr} role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${dis ? `disabled title="${esc(dis)}"` : ''}></button><span>${label}</span></label>`;
  function cooldownHtml(d) {
    const c = d.cooldown;
    const m = may('cooldown');
    if (!m.ok) return ro(m.why, cooldownText(c));
    const min = cooldownMin(ui.me);
    if (!c.enabled) return `${toggleRow('cdon', false, 'Limiter la fréquence')}<p class="hint">${min ? `Ton rôle doit garder un cooldown d’au moins ${min} s.` : 'Aucun cooldown.'}</p>`;
    const preset = COOLDOWN_PRESETS.some(([s]) => s === c.seconds);
    const custom = ui.cdCustom || !preset;
    const unit = { s: 1, min: 60, h: 3600 }[c.unit];
    return `${toggleRow('cdon', true, 'Limiter la fréquence', min ? `Ton rôle doit garder un cooldown d’au moins ${min} s` : '')}
      <div class="lim"><div class="opts">${COOLDOWN_PRESETS.map(([s, l]) => `<button type="button" class="opt ${!custom && c.seconds === s ? 'on' : ''}" data-cdpreset="${s}" ${s < min ? `disabled title="Minimum autorisé pour ton rôle : ${min} s"` : ''}>${l}</button>`).join('')}<button type="button" class="opt ${custom ? 'on' : ''}" data-cdcustom>Personnalisé…</button></div>
        ${custom ? `<div class="lrow__f">Attendre <input class="inp inp--n" data-cdval value="${c.seconds / unit}" inputmode="numeric" aria-label="Durée"><select class="inp inp--u" data-cdunit aria-label="Unité">${[['s', 's'], ['min', 'min'], ['h', 'h']].map(([v, t]) => `<option value="${v}" ${c.unit === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>` : ''}
        ${scopeSeg('cdscope', c.scope)}
        <p class="sentence">${esc(cooldownText(c))}${min ? ` <span class="faint">· minimum ${min} s pour ton rôle</span>` : ''}</p></div>`;
  }
  function quotaHtml(d) {
    const q = d.quota;
    const m = may('quota');
    if (!m.ok) return ro(m.why, quotaText(q));
    if (!q.enabled) return `${toggleRow('mxon', false, 'Limiter le nombre d’utilisations')}<p class="hint">Illimité.</p>`;
    return `${toggleRow('mxon', true, 'Limiter le nombre d’utilisations')}
      <div class="lim"><div class="lrow__f">Maximum <input class="inp inp--n" data-mxcount value="${q.max}" inputmode="numeric" aria-label="Nombre maximum"> <select class="inp inp--w" data-mxper aria-label="Période">${WINDOWS.map(([v, t]) => `<option value="${v}" ${q.window === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${scopeSeg('mxscope', q.scope)}<p class="sentence">${esc(quotaText(q))}</p></div>`;
  }
  function listedHtml(d) {
    const m = may('listed');
    if (!m.ok) return ro(m.why, d.listed ? 'Visible dans la liste publique' : 'Cachée de la liste publique');
    return `<label class="tgl"><button type="button" class="sw ${d.listed ? 'on' : ''}" data-listed role="switch" aria-checked="${d.listed}"></button><span>${d.listed ? 'Visible dans la liste publique' : 'Cachée de la liste publique'}</span></label>`;
  }
  const catName = (id) => (cats().find((k) => k.category_id === id) ?? NO_CATEGORY).name;
  const WHEN = { always: 'Tout le temps', live: 'Pendant le live', offline: 'Hors live' };

  // ------------------------------------------------------------------ command page
  /** The name = the canonical trigger. Core checks the word (free, not reserved, not an alias) on save. */
  function nameHtml(d) {
    const m = may('name');
    if (!m.ok) return ro(m.why, `!${d.name}`);
    const renamed = ui.base && d.name !== ui.base.config.name;
    return `<div class="namebox"><input class="inp" data-name value="${esc(d.name)}" maxlength="25" autocomplete="off" spellcheck="false" aria-label="Nom de la commande"></div>
      <p class="hint">${renamed ? `!${esc(ui.base.config.name)} → !${esc(d.name || '…')} à l’enregistrement. Les alias ne changent pas.` : 'Le mot principal qui lance la commande. Les alias ne changent pas.'}</p>`;
  }
  function rightsLine(c) {
    if (ui.me.role === 'broadcaster') return 'Tu peux tout modifier ici. Catégorie, disponibilité, arguments et autres messages : dans Studio.';
    if (c.config.team_lock) return `${ic('lock')} Le streamer a verrouillé cette commande : tu peux la consulter.`;
    const fields = ['name', 'enabled', 'reply', 'aliases', 'audience.groups', 'audience.deny', 'cooldown', 'quota', 'listed'].filter((f) => canEdit(ui.me, c, f).ok).map((f) => ({ name: 'nom', enabled: 'activer', reply: 'réponse', aliases: 'alias', 'audience.groups': 'qui peut l’utiliser', 'audience.deny': 'exclusions', cooldown: `cooldown${cooldownMin(ui.me) ? ` (≥ ${cooldownMin(ui.me)} s)` : ''}`, quota: 'utilisations', listed: 'liste publique' })[f]);
    return fields.length ? `Ton rôle (${esc(ROLE[ui.me.role])}) peut modifier : ${fields.join(', ')}.` : `Ton rôle (${esc(ROLE[ui.me.role])}) peut consulter cette commande.`;
  }
  function banners(c) {
    const out = [];
    for (const i of c.issues ?? []) {
      if (i.code === 'word_reserved') out.push(`<div class="xstate xstate--bad"><span>!${esc(i.word)} appartient au module ${esc(i.module === 'raffle' ? 'Tombola' : i.module)} : ce mot ne lance pas cette commande.</span></div>`);
      if (i.code === 'last_send_failed') out.push(`<div class="xstate xstate--warn"><span>Dernier envoi : ${esc(STEP[i.status]?.[0] ?? i.status)}${i.error ? ` (${esc(i.error)})` : ''}.</span><button type="button" class="btn btn--sm btn--ghost" data-sheet="activity">Voir</button></div>`);
      if (i.code === 'me_unsupported') out.push('<div class="xstate xstate--warn"><span>Un message en /me n’est pas envoyé aujourd’hui.</span></div>');
    }
    if (c.kind === 'system') out.push(`<div class="xstate"><span>${ic('cube')} Commande système du module ${esc(c.owner_module === 'raffle' ? 'Tombola' : c.owner_module)} · verrouillé : ${c.locked_fields.map((f) => esc(FIELD[f] ?? f)).join(', ') || 'rien'}.</span></div>`);
    if (ui.conflict) out.push(`<div class="xstate xstate--bad"><span>Modifiée ailleurs pendant ton édition (version ${ui.conflict.version}). Tes changements ont été réappliqués sur la nouvelle version : vérifie, puis enregistre.${ui.conflict.both.length ? ` Changé des deux côtés : ${ui.conflict.both.map((f) => esc(FIELD[f] ?? f)).join(', ')}.` : ''}</span><button type="button" class="btn btn--sm btn--ghost" data-conflictok>Compris</button></div>`);
    return out.join('');
  }
  function pageHtml() {
    const c = ui.base;
    const d = ui.draft;
    const t = canEdit(ui.me, c, 'enabled');
    const al = may('aliases');
    const del = canRemove(ui.me, c);
    const F = (title, body) => `<section class="xsec"><h3>${title}</h3>${body}</section>`;
    return `<header class="xh"><button type="button" class="ib" data-back aria-label="Retour">${ic('back')}</button><span class="tile" style="--c:${d.appearance.color}">${ic(d.appearance.icon)}</span><span class="xh__t cn">${esc(d.name)}</span><span class="grow"></span>
        <button type="button" class="ib" data-sheet="activity" title="Utilisations et modifications">${ic('history')}</button>
        <button type="button" class="sw ${c.config.enabled ? 'on' : ''}" ${t.ok ? `data-toggle="${c.command_id}"` : 'disabled aria-disabled="true"'} role="switch" aria-checked="${c.config.enabled}" aria-label="Activer" title="${esc(t.ok ? (c.config.enabled ? 'Active' : 'Désactivée') : t.why)}"></button></header>
      <div class="xd scroll"><div class="xd__in">
        <p class="desc">${esc(d.description || 'Sans description')}</p>
        <p class="xright">${rightsLine(c)}</p>
        ${banners(c)}
        ${F('Commande', nameHtml(d))}
        ${F('Réponse', replyHtml(d))}
        ${F('Alias', al.ok ? `${chips(d.aliases.map((a) => `!${a}`), 'alias', '+ alias')}${ui.aliasErr ? `<p class="err">${ic('warn')}${esc(ui.aliasErr)}</p>` : ''}` : ro(al.why, d.aliases.map((a) => `!${a}`).join(', ') || 'Aucun'))}
        ${F('Qui peut l’utiliser', whoHtml(d))}
        ${F('Cooldown', cooldownHtml(d))}
        ${F('Utilisations', quotaHtml(d))}
        ${F('Liste publique', listedHtml(d))}
        ${F('Commande', `<dl class="xdl"><dt>Catégorie</dt><dd>${esc(catName(d.category))}</dd><dt>Disponible</dt><dd>${WHEN[d.when]}</dd>${d.args.length ? `<dt>Après la commande</dt><dd>${d.args.map((a) => esc(a.type === 'mention' ? `@${a.name}` : a.name)).join(' ')}</dd>` : ''}${d.actions.length ? `<dt>Autres actions</dt><dd>${d.actions.length} (réglées dans Studio)</dd>` : ''}</dl><p class="hint">${ic('lock')} Ces réglages se changent dans Studio.</p>`)}
        ${c.kind === 'custom' ? (del.ok ? `<button type="button" class="btn btn--sm btn--danger" data-remove>${ic('trash')}Supprimer la commande</button>` : '') : ''}
      </div></div>
      ${ui.confirm ? `<div class="xsave xsave--warn"><span>${esc(ui.confirm)}</span><button type="button" class="btn btn--ghost btn--sm" data-confirmno>Annuler</button><button type="button" class="btn btn--primary btn--sm btn--danger" data-confirmyes>Supprimer</button></div>` : ui.saveError ? `<div class="xsave xsave--warn"><span class="bad">${esc(ui.saveError)}</span><button type="button" class="btn btn--ghost btn--sm" data-cancel>Annuler mes changements</button>${dirty() ? '<button type="button" class="btn btn--primary btn--sm" data-save>Réessayer</button>' : ''}</div>` : dirty() ? `<div class="xsave"><span>${ui.saving ? 'Enregistrement…' : 'Non enregistré'}</span><button type="button" class="btn btn--ghost btn--sm" data-cancel>Annuler</button><button type="button" class="btn btn--primary btn--sm" data-save ${ui.saving ? 'disabled' : ''}>Enregistrer</button></div>` : ''}`;
  }

  // ------------------------------------------------------------------ creation (simple reply command)
  function newHtml() {
    const d = ui.nw;
    const block = !word(d.name) ? 'Donne un nom' : d.reply.mode !== 'silent' && !d.reply.text.trim() ? 'Écris la réponse' : '';
    const al = may('aliases');
    const F = (title, body) => `<section class="xsec"><h3>${title}</h3>${body}</section>`;
    return `<header class="xh"><button type="button" class="ib" data-back aria-label="Annuler">${ic('x')}</button><span class="xh__t">Nouvelle commande</span></header>
      <div class="xd scroll"><div class="xd__in">
        ${F('Nom', `<div class="namebox"><input class="inp" data-name value="${esc(d.name)}" placeholder="ex. calin" maxlength="25" autocomplete="off" spellcheck="false"></div>`)}
        ${al.ok ? F('Alias <small>facultatif</small>', `${chips(d.aliases.map((a) => `!${a}`), 'alias', '+ alias')}${ui.aliasErr ? `<p class="err">${ic('warn')}${esc(ui.aliasErr)}</p>` : ''}`) : ''}
        ${F('Description <small>facultatif</small>', `<input class="inp" data-desc value="${esc(d.description)}" maxlength="120" placeholder="Ce que les viewers lisent">`)}
        ${F('Catégorie', `<select class="inp inp--w" data-category><option value="">Sans catégorie</option>${cats().map((k) => `<option value="${k.category_id}" ${d.category === k.category_id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>`)}
        ${F('Réponse', replyHtml(d))}
        ${F('Qui peut l’utiliser', whoHtml(d))}
        ${F('Cooldown', cooldownHtml(d))}
        ${F('Utilisations', quotaHtml(d))}
        ${F('Liste publique', listedHtml(d))}
        <p class="note">${ic('lock')} Catégories, arguments, autres messages et réglages avancés : dans Studio.</p></div></div>
      <div class="xsave xsave--fix"><span class="${block || ui.saveError ? 'bad' : ''}">${ui.saving ? 'Création…' : ui.saveError ? esc(ui.saveError) : block || 'Prête'}</span>${may('enabled').ok ? `<button type="button" class="btn btn--ghost btn--sm" data-create="off" ${block || ui.saving ? 'disabled' : ''}>Créer désactivée</button>` : ''}<button type="button" class="btn btn--primary btn--sm" data-create="on" ${block || ui.saving ? 'disabled' : ''}>Créer</button></div>`;
  }

  // ------------------------------------------------------------------ activity sheet (context of the command)
  function activityHtml() {
    const a = ui.activity;
    if (!a) return '<p class="empty">Chargement…</p>';
    let day = '';
    const runs = a.invocations.length
      ? a.invocations
          .map((x) => {
            const d = dayOf(x.created_at);
            const h = d !== day ? `<div class="aday">${(day = d)}</div>` : '';
            const sent = x.steps.map((s) => `<span class="res res--${STEP[s.status]?.[1] ?? 'off'}">${esc(STEP[s.status]?.[0] ?? s.status)}${s.error ? ` · ${esc(s.error)}` : ''}</span>`).join(' ');
            return `${h}<div class="arow"><time>${clock(x.created_at)}</time><span class="res res--${x.decision === 'accepted' ? 'ok' : 'warn'}">${x.decision === 'accepted' ? 'Acceptée' : 'Refusée'}</span><div class="arow__t">${esc(x.viewer_display_name)}${x.reason ? `<small>${esc(REASON[x.reason] ?? x.reason)}${x.reason_detail?.message ? ` — ${esc(x.reason_detail.message)}` : ''}</small>` : ''}${sent ? `<small>Chat : ${sent}</small>` : ''}</div></div>`;
          })
          .join('')
      : '<p class="empty">Aucune utilisation.</p>';
    // Values of Core's history, in words (never raw JSON).
    const val = (field, v) => {
      if (v === null || v === undefined) return '—';
      if (field === 'reply') return `${MODES.find((m) => m[0] === v.mode)?.[1] ?? v.mode}${v.mode === 'silent' ? '' : ` « ${v.text} »`}`;
      if (field === 'cooldown') return cooldownText(v);
      if (field === 'quota') return quotaText(v);
      if (field === 'audience.groups') return v.map((g) => GROUPS.find((x) => x[0] === g)?.[1] ?? g).join(' + ') || 'aucun groupe';
      if (field === 'aliases') return v.length ? v.map((a2) => `!${a2}`).join(' ') : 'aucun';
      if (Array.isArray(v)) return v.length ? v.join(', ') : 'personne';
      if (field === 'enabled') return v ? 'activée' : 'désactivée';
      if (field === 'listed') return v ? 'visible' : 'cachée';
      if (field === 'category') return historyCategoryName(v, cats());
      if (field === 'when') return WHEN[v] ?? v;
      return typeof v === 'object' ? 'modifié' : String(v);
    };
    const changesHtml = a.changes.length
      ? a.changes.map((x) => `<div class="arow"><time>${clock(x.created_at)}</time><span class="who">${esc(x.actor_login ?? (x.via === 'studio' ? 'Studio' : x.actor_id))}</span><div class="arow__t">${x.changes.map((ch) => `<div class="diff"><span>${esc(FIELD[ch.field] ?? ch.field)}</span><ins>${esc(val(ch.field, ch.after))}</ins></div>`).join('') || esc(x.action)}</div></div>`).join('')
      : '<p class="empty">Aucune modification.</p>';
    return `<h6 class="sh6">Utilisations et refus</h6>${runs}<h6 class="sh6">Modifications</h6>${changesHtml}`;
  }
  function sheetHtml() {
    if (!ui.sheet || !ui.base) return '';
    return `<div class="veil" data-close></div><div class="sheet" role="dialog"><div class="grab"></div><div class="sheet__h"><b>Activité de !${esc(ui.base.config.name)}</b><button type="button" class="ib" data-close aria-label="Fermer">${ic('x')}</button></div><div class="sheet__b scroll">${activityHtml()}</div></div>`;
  }

  // ------------------------------------------------------------------ render
  function render() {
    node.dataset.mode = mode();
    node.classList.toggle('side-sheet', mode() === 'video');
    const keep = [...node.querySelectorAll('.scroll')].map((s) => s.scrollTop);
    node.innerHTML = (ui.view === 'page' && ui.base ? pageHtml() : ui.view === 'new' && ui.nw ? newHtml() : listHtml()) + sheetHtml();
    [...node.querySelectorAll('.scroll')].forEach((s, i) => (s.scrollTop = keep[i] ?? 0));
  }
  const keyOf = (el) => {
    if (!el || !node.contains(el)) return null;
    const a = [...el.attributes].find((x) => x.name.startsWith('data-'));
    return a ? `[${a.name}="${CSS.escape(a.value)}"]` : null;
  };
  function rerender() {
    const a = document.activeElement;
    const k = keyOf(a);
    const start = a && 'selectionStart' in a ? a.selectionStart : null;
    const end = a && 'selectionEnd' in a ? a.selectionEnd : null;
    render();
    const el = k ? node.querySelector(k) : null;
    if (el) {
      el.focus({ preventScroll: true });
      if (start !== null && el.setSelectionRange)
        try {
          el.setSelectionRange(start, end ?? start);
        } catch {
          /* not a text field */
        }
    }
  }
  function toast(text) {
    node.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${ic('check')}<span>${esc(text)}</span>`;
    node.append(t);
    win.setTimeout(() => t.remove(), 3800);
  }

  // ------------------------------------------------------------------ actions (Core decides)
  function open(id) {
    const c = ui.list?.commands.find((x) => x.command_id === id);
    if (!c) return;
    Object.assign(ui, { view: 'page', id, base: clone(c), draft: clone(c.config), pop: null, cdCustom: false, sheet: null, activity: null, conflict: null, saveError: '', aliasErr: '', confirm: null });
  }
  async function quickToggle(c) {
    try {
      await client.cmdV2Post(`commands/${c.command_id}/update`, { expected_version: c.version, changes: { enabled: !c.config.enabled } });
      const keep = ui.view === 'page' && dirty() ? ui.draft : null;
      await load();
      if (keep && ui.base) ui.draft = { ...keep, enabled: ui.base.config.enabled };
    } catch (e) {
      await load();
      toast(e?.status === 409 ? 'Modifiée ailleurs entre-temps : rechargée, recommence.' : errText(e));
    }
    rerender();
  }
  async function save() {
    const c = ui.base;
    const d = ui.draft;
    const ch = changes(c.config, d);
    if (!Object.keys(ch).length) return;
    ui.saving = true;
    ui.saveError = '';
    rerender();
    try {
      const out = await client.cmdV2Post(`commands/${c.command_id}/update`, { expected_version: c.version, changes: ch });
      await load();
      ui.base = cur() ?? out;
      ui.draft = clone(ui.base.config);
      ui.conflict = null;
      toast(`!${ui.base.config.name} enregistrée`);
    } catch (e) {
      if (e?.status === 409 && e.details?.error === 'version_conflict' && e.details.current) {
        const current = e.details.current;
        const r = reapply(c.config, d, current.config);
        await load();
        ui.base = cur() ?? current;
        ui.draft = r.draft;
        ui.conflict = { version: current.version, both: r.both };
      } else ui.saveError = errText(e);
    }
    ui.saving = false;
    rerender();
  }
  async function create(enabled) {
    ui.saving = true;
    ui.saveError = '';
    rerender();
    try {
      const out = await client.cmdV2Post('commands', { config: { ...ui.nw, name: word(ui.nw.name), enabled } });
      await load();
      ui.nw = null;
      open(out.command_id);
      toast(`!${out.config.name} créée`);
    } catch (e) {
      ui.saveError = errText(e);
    }
    ui.saving = false;
    rerender();
  }
  async function remove() {
    const c = ui.base;
    try {
      await client.cmdV2Post(`commands/${c.command_id}/delete`, { expected_version: c.version });
      Object.assign(ui, { view: 'list', base: null, draft: null, confirm: null });
      await load();
      toast(`!${c.config.name} supprimée`);
    } catch (e) {
      ui.confirm = null;
      ui.saveError = errText(e);
    }
    rerender();
  }
  async function loadActivity() {
    try {
      ui.activity = await client.cmdV2(`commands/${ui.base.command_id}/activity`);
    } catch (e) {
      ui.activity = { invocations: [], changes: [] };
      toast(errText(e));
    }
    rerender();
  }

  // ------------------------------------------------------------------ events
  node.addEventListener('click', (e) => {
    const t = e.target;
    const at = (s) => t.closest(s);
    let b;
    const d = D();
    if (ui.pop && !at('.popw')) ui.pop = null;
    if ((b = at('[data-toggle]'))) {
      e.stopPropagation();
      const c = ui.list?.commands.find((x) => x.command_id === b.dataset.toggle);
      if (c) void quickToggle(c);
      return;
    }
    if (at('[data-back]')) {
      if (ui.view === 'list') return onBack?.();
      if (dirty() && !win.confirm('Quitter sans enregistrer ?')) return;
      Object.assign(ui, { view: 'list', base: null, draft: null, nw: null, sheet: null, saveError: '' });
      return render();
    }
    if (at('[data-new]')) {
      Object.assign(ui, { view: 'new', nw: { ...blank(ui.cat !== 'all' && ui.cat !== 'none' ? ui.cat : null), cooldown: { enabled: true, seconds: Math.max(30, cooldownMin(ui.me)), unit: unitOf(Math.max(30, cooldownMin(ui.me))), scope: 'viewer' } }, saveError: '', aliasErr: '', pop: null, cdCustom: false });
      return render();
    }
    if ((b = at('[data-open]'))) return (open(b.dataset.open), render());
    if ((b = at('[data-side]'))) return ((ui.side = b.dataset.side), rerender());
    if (at('[data-group]')) return ((ui.group = !ui.group), rerender());
    if ((b = at('[data-sheet]'))) {
      ui.sheet = b.dataset.sheet;
      ui.activity = null;
      void loadActivity();
      return rerender();
    }
    if (at('[data-close]')) return ((ui.sheet = null), rerender());
    if (at('[data-save]')) return void save();
    if (at('[data-cancel]')) {
      if (ui.base) ui.draft = clone(ui.base.config);
      Object.assign(ui, { conflict: null, saveError: '' });
      return rerender();
    }
    if (at('[data-conflictok]')) return ((ui.conflict = null), rerender());
    if ((b = at('[data-create]'))) return void create(b.dataset.create === 'on');
    if (at('[data-remove]')) return ((ui.confirm = `Supprimer !${ui.base.config.name} ? Son historique est gardé.`), rerender());
    if (at('[data-confirmno]')) return ((ui.confirm = null), rerender());
    if (at('[data-confirmyes]')) return void remove();
    if (!d) return;
    if ((b = at('[data-pop]'))) return ((ui.pop = ui.pop === b.dataset.pop ? null : b.dataset.pop), rerender());
    if ((b = at('[data-rmode]'))) {
      d.reply = { ...d.reply, mode: b.dataset.rmode, ...(b.dataset.rmode === 'reply' ? { to: 'none' } : {}) };
      if (d.reply.to !== 'user') delete d.reply.to_login;
      return rerender();
    }
    if ((b = at('[data-to]'))) {
      d.reply = { ...d.reply, to: b.dataset.to };
      if (b.dataset.to !== 'user') {
        delete d.reply.to_login;
        ui.pop = null;
      }
      return rerender();
    }
    if ((b = at('[data-insert]'))) {
      const el = node.querySelector('[data-rtext]');
      const s = el?.selectionStart ?? d.reply.text.length;
      const r = insertAt(d.reply.text, s, el?.selectionEnd ?? s, b.dataset.insert);
      d.reply = { ...d.reply, text: r.text };
      ui.pop = null;
      render();
      const ta = node.querySelector('[data-rtext]');
      ta?.focus();
      ta?.setSelectionRange(r.caret, r.caret);
      return;
    }
    if ((b = at('[data-grp]'))) {
      const k = b.dataset.grp;
      const g = d.audience.groups;
      d.audience = { ...d.audience, groups: g.includes(k) ? g.filter((x) => x !== k) : k === 'everyone' ? ['everyone'] : [...g.filter((x) => x !== 'everyone'), k] };
      return rerender();
    }
    if (at('[data-cdon]')) return ((d.cooldown = { ...d.cooldown, enabled: !d.cooldown.enabled }), (ui.cdCustom = false), rerender());
    if ((b = at('[data-cdpreset]'))) {
      const s = Number(b.dataset.cdpreset);
      d.cooldown = { ...d.cooldown, seconds: s, unit: unitOf(s) };
      ui.cdCustom = false;
      return rerender();
    }
    if (at('[data-cdcustom]')) return ((ui.cdCustom = true), rerender());
    if ((b = at('[data-cdscope]'))) return ((d.cooldown = { ...d.cooldown, scope: b.dataset.cdscope }), rerender());
    if (at('[data-mxon]')) return ((d.quota = { ...d.quota, enabled: !d.quota.enabled }), rerender());
    if ((b = at('[data-mxscope]'))) return ((d.quota = { ...d.quota, scope: b.dataset.mxscope }), rerender());
    if (at('[data-listed]')) return ((d.listed = !d.listed), rerender());
    if ((b = at('[data-chipdel]'))) {
      const [k, v] = b.dataset.chipdel.split('|');
      if (k === 'alias') d.aliases = d.aliases.filter((a) => `!${a}` !== v);
      else d.audience = { ...d.audience, [k]: d.audience[k].filter((x) => x !== v) };
      return rerender();
    }
  });
  node.addEventListener('input', (e) => {
    const t = e.target;
    const d = D();
    if (t.matches('[data-q]')) return ((ui.q = t.value), rerender());
    if (!d) return;
    if (t.matches('[data-name]')) return ((d.name = word(t.value)), rerender());
    if (t.matches('[data-desc]')) return ((d.description = t.value), rerender());
    if (t.matches('[data-rtext]')) return ((d.reply = { ...d.reply, text: t.value }), rerender());
    if (t.matches('[data-tologin]')) return ((d.reply = { ...d.reply, to_login: word(t.value) || undefined }), rerender());
  });
  node.addEventListener('change', (e) => {
    const t = e.target;
    const d = D();
    if (t.matches('[data-cat]')) return ((ui.cat = t.value), rerender());
    if (!d) return;
    if (t.matches('[data-category]')) return ((d.category = t.value || null), rerender());
    if (t.matches('[data-cdval]') || t.matches('[data-cdunit]')) {
      const box = t.closest('.lrow__f');
      const unit = box.querySelector('[data-cdunit]').value;
      const n = Math.max(1, Math.round(Number(box.querySelector('[data-cdval]').value) || 1));
      const seconds = Math.min(86_400, n * { s: 1, min: 60, h: 3600 }[unit]);
      d.cooldown = { ...d.cooldown, seconds, unit: unitOf(seconds) };
      return rerender();
    }
    if (t.matches('[data-mxcount]')) return ((d.quota = { ...d.quota, max: Math.min(10_000, Math.max(1, Math.round(Number(t.value) || 1))) }), rerender());
    if (t.matches('[data-mxper]')) return ((d.quota = { ...d.quota, window: t.value }), rerender());
  });
  node.addEventListener('keydown', (e) => {
    const t = e.target;
    const d = D();
    if (e.key === 'Escape' && (ui.sheet || ui.pop)) return ((ui.sheet = null), (ui.pop = null), rerender());
    if (e.key === 'Enter' && t.matches('.lr')) return t.click();
    if (e.key === 'Enter' && d && t.matches('[data-chipin]')) {
      e.preventDefault();
      const k = t.dataset.chipin;
      const w = word(t.value);
      ui.aliasErr = '';
      if (k === 'alias') {
        const words = (ui.list?.commands ?? []).filter((c) => c.command_id !== ui.base?.command_id).flatMap((c) => [c.config.name, ...c.config.aliases]);
        const res = ui.list?.reserved_words.find((x) => x.word === w);
        if (!w) ui.aliasErr = 'Écris un alias';
        else if (w === d.name || d.aliases.includes(w)) ui.aliasErr = `!${w} est déjà utilisé par cette commande`;
        else if (res) ui.aliasErr = `!${w} appartient au module ${res.module === 'raffle' ? 'Tombola' : res.module}`;
        else if (words.includes(w)) ui.aliasErr = `!${w} lance déjà une autre commande`;
        else d.aliases = [...d.aliases, w];
      } else if (w) {
        const other = k === 'allow' ? 'deny' : 'allow';
        d.audience = { ...d.audience, [k]: d.audience[k].includes(w) ? d.audience[k] : [...d.audience[k], w], [other]: d.audience[other].filter((x) => x !== w) };
      }
      rerender();
      node.querySelector(`[data-chipin="${k}"]`)?.focus();
    }
  });

  return {
    node,
    start() {
      if (started) return;
      started = true;
      render();
      void refresh();
    },
    /** Called once the node is in the page (its width decides Video / Mobile). */
    attached() {
      rerender();
      // The host re-attaches on its own refreshes: Core is read again at most every 4 s from here.
      if (Date.now() - loadedAt > 4000) void refresh();
    },
  };
}
