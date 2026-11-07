import type { CmdAction, CmdConfig } from '@raptoru/schemas';
import {
  type Category,
  categoryOf,
  type CommandItem,
  cooldownText,
  COOLDOWN_PRESETS,
  dur,
  example,
  FIELD,
  GROUPS,
  MODES,
  quotaText,
  STEP,
  syntax,
  TO,
  variableMissing,
  VARIABLES,
  whoSentence,
  whoShort,
  WINDOWS,
} from '../commands-model.js';
import { ago, esc, fld, ic, type IcName, seg, sw } from '../ds/ds.js';
import { COLORS, ICONS, lookIc } from './commands-look.js';

// L'éditeur d'une commande, en HTML pur. Le nom se tape comme dans le chat, la réponse s'écrit avec ses variables, les étapes
// se lisent dans l'ordre d'envoi, et chaque règle (qui, délai, utilisations…) se règle sur place, depuis sa case. Rien n'est
// décidé ici : le Core valide tout à l'enregistrement.

export interface EditCtx {
  d: CmdConfig;
  /** La commande enregistrée ; null à la création. */
  base: CommandItem | null;
  cats: Category[];
  fav: boolean;
  aliasErr: string;
  cdCustom: boolean;
  conflict: null | { by: string; version: number; both: string[] };
}
const WHEN = {
  always: 'Tout le temps',
  live: 'Pendant le live',
  offline: 'Hors live',
} as const;
const REFUSE = {
  silent: 'Ne rien envoyer',
  explain: 'Expliquer pourquoi',
  custom: 'Message personnalisé',
} as const;
export const modName = (m: string) => (m === 'raffle' ? 'Tombola' : m);
export const whoDid = (by: string) =>
  by.startsWith('studio:')
    ? 'Studio'
    : by.startsWith('system:')
      ? `module ${by.slice(7)}`
      : by.replace(/^extension:/, 'Extension · ');

const isLocked = (c: EditCtx, f: string) => !!c.base?.locked_fields.includes(f);
const lockRo = (c: EditCtx, txt: string) =>
  `<p class="cdx-ro" title="Verrouillé par le module ${esc(c.base?.owner_module ?? '')}">${ic('lock')}<span>${esc(txt)}</span></p>`;

const chips = (list: string[], kind: string, placeholder: string) =>
  `<div class="cdx-chips">${list.map((v) => `<button type="button" class="d-tag" data-chipdel="${kind}|${esc(v)}" aria-label="Retirer ${esc(v)}">${esc(v)}${ic('x')}</button>`).join('')}<input type="text" data-chipin="${kind}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off" spellcheck="false"></div>`;

// --- Identité ---------------------------------------------------------------------------------------------------------

export function headHtml(c: EditCtx) {
  const { d, base } = c;
  const lockName = isLocked(c, 'name');
  const origin = !base
    ? 'Nouvelle commande'
    : base.kind === 'system'
      ? `Commande du module ${modName(base.owner_module ?? '')}`
      : 'Créée dans Raptoru';
  return `<button type="button" class="cdx-tile lg" style="--c:${esc(d.appearance.color)}" data-look aria-label="Icône et couleur" ${isLocked(c, 'appearance') ? 'disabled' : ''}>${lookIc(d.appearance.icon)}</button>
    <div class="cdx-id">
      <label class="cdx-name"><span aria-hidden="true">!</span><input type="text" data-name value="${esc(d.name)}" maxlength="25" placeholder="nom" aria-label="Nom de la commande" spellcheck="false" autocomplete="off" ${lockName ? 'readonly' : ''}></label>
      <input type="text" class="cdx-desc" data-desc value="${esc(d.description)}" maxlength="120" placeholder="Ce que les viewers lisent dans la liste" aria-label="Description" ${isLocked(c, 'description') ? 'readonly' : ''}>
    </div>
    <div class="cdx-acts">
      <small class="d-faint">${esc(origin)}</small>
      ${
        base
          ? `<button type="button" class="d-ib cdx-star ${c.fav ? 'on' : ''}" data-fav="${base.command_id}" aria-label="${c.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-pressed="${c.fav}">${ic('star')}</button>
      <span title="${base.config.enabled ? 'Activée' : 'Coupée'}">${sw(base.config.enabled, `data-toggle="${base.command_id}"`, `Activer !${d.name}`, { disabled: isLocked(c, 'enabled') })}</span>
      <button type="button" class="d-ib" data-more aria-label="Autres actions">${ic('more')}</button>`
          : ''
      }
    </div>
    <div class="cdx-alias">
      <span class="d-lb">Aussi</span>
      ${
        isLocked(c, 'aliases')
          ? lockRo(c, d.aliases.map((a) => `!${a}`).join(' ') || 'Aucun alias')
          : chips(
              d.aliases.map((a) => `!${a}`),
              'alias',
              '+ alias',
            )
      }
    </div>`;
}

export const lookHtml = (cur: { icon: string; color: string }, target = '') =>
  `<div class="cdx-icons" style="--c:${esc(cur.color)}">${ICONS.map((x) => `<button type="button" class="${cur.icon === x ? 'on' : ''}" data-icon="${target}${x}" aria-label="Icône ${x}" aria-pressed="${cur.icon === x}">${lookIc(x)}</button>`).join('')}</div>
   <div class="cdx-swatches">${COLORS.map((x) => `<button type="button" class="${cur.color === x ? 'on' : ''}" style="--c:${x}" data-color="${target}${x}" aria-label="Couleur ${x}" aria-pressed="${cur.color === x}"></button>`).join('')}</div>`;

// --- Alertes de la commande -------------------------------------------------------------------------------------------

export function bannersHtml(c: EditCtx) {
  const out: string[] = c.aliasErr
    ? [`<p class="d-note bad">${esc(c.aliasErr)}</p>`]
    : [];
  for (const i of c.base?.issues ?? []) {
    if (i.code === 'word_reserved')
      out.push(
        `<div class="cdx-ban bad">${ic('warn')}<div><b>!${esc(i.word)} appartient à ${esc(modName(i.module))} : ce mot ne lance pas cette commande.</b><span>Le module garde toujours ses mots. Retire ce mot (nom ou alias) ou change-le dans le module.</span></div></div>`,
      );
    if (i.code === 'last_send_failed')
      out.push(
        `<div class="cdx-ban warn">${ic('warn')}<div><b>Dernier envoi dans le chat : ${esc(STEP[i.status]?.[0] ?? i.status)}${i.error ? ` (${esc(i.error)})` : ''}, ${esc(ago(i.at))}.</b><button type="button" class="d-btn sm" data-history>Voir le journal</button></div></div>`,
      );
    if (i.code === 'me_unsupported')
      out.push(
        `<div class="cdx-ban warn">${ic('warn')}<div><b>Un message en /me n’est pas envoyé aujourd’hui.</b><span>Twitch ne propose pas /me par la voie d’envoi utilisée. Choisis Message, Annonce ou Réponse Twitch.</span></div></div>`,
      );
  }
  const k = c.conflict;
  if (k)
    out.push(
      `<div class="cdx-ban bad">${ic('users')}<div><b>Modifiée entre-temps (${esc(whoDid(k.by))}, version ${k.version}). Tes changements sont repris sur cette nouvelle version : vérifie, puis enregistre.</b>${k.both.length ? `<span>Modifié des deux côtés : ${k.both.map((f) => esc(FIELD[f] ?? f)).join(', ')}. Ta version reste dans l’éditeur.</span>` : ''}<span class="cdx-ban__a"><button type="button" class="d-btn sm" data-conflictok>Compris</button><button type="button" class="d-btn ghost sm" data-cancel>Abandonner mes changements</button></span></div></div>`,
    );
  return out.join('');
}

// --- Réponse ------------------------------------------------------------------------------------------------------------

/** Le texte, ses variables colorées : posé derrière la zone de saisie, il lui donne aussi sa hauteur. */
export function mirrorHtml(text: string, d: Pick<CmdConfig, 'args'>) {
  const known = new Map(VARIABLES.map((v) => [v[0], v[4]]));
  return `${esc(text).replace(/\{[a-z_]+\}/g, (t) => {
    const needs = known.get(t);
    return `<mark class="${needs === undefined || variableMissing(d, needs) ? 'bad' : ''}">${t}</mark>`;
  })}\n`;
}

export function replyHtml(c: EditCtx) {
  const { d } = c;
  const r = d.reply;
  const mode = MODES.find((m) => m[0] === r.mode)!;
  if (isLocked(c, 'reply'))
    return `<div class="cdx-sech"><span class="d-lb">Le bot répond</span></div>${lockRo(c, `${mode[1]} · « ${r.text} »`)}`;
  const to = TO.find((x) => x[0] === r.to)!;
  const modes = MODES.map(
    ([k, l, , desc]) =>
      [
        k,
        `<span title="${esc(`${l} : ${desc}`)}">${esc(k === 'reply' ? 'Réponse' : l)}</span>`,
      ] as const,
  );
  return `<div class="cdx-sech"><span class="d-lb">Le bot répond</span>${seg('data-rmode', modes, r.mode)}</div>
    ${r.mode === 'me' ? `<p class="d-note bad">/me n’est pas supporté aujourd’hui : ce message ne serait pas envoyé. Choisis Message ou Annonce.</p>` : ''}
    ${
      r.mode === 'silent'
        ? '<p class="cdx-silent">Le bot n’écrit rien quand on tape la commande.</p>'
        : `<div class="cdx-write"><div class="cdx-mirror" data-mirror aria-hidden="true">${mirrorHtml(r.text, d)}</div><textarea data-rtext maxlength="500" rows="2" placeholder="Ce que le bot écrit : Câlin de {display_name} !" aria-label="Texte de la réponse">${esc(r.text)}</textarea></div>
      <div class="cdx-vars">${VARIABLES.map(([v, name, desc, , needs]) => {
        const off = variableMissing(d, needs);
        return `<button type="button" class="cdx-var" data-insert="${v}" title="${esc(off ? `Demande ${needs === 'mention' ? 'un @pseudo' : 'un nombre'} après la commande (règle « Après la commande »)` : desc)}" ${off ? 'disabled' : ''}>${esc(name)}</button>`;
      }).join('')}<span class="d-sp"></span>
      ${
        r.mode === 'reply'
          ? '<small class="d-faint" title="Twitch affiche le message du viewer au-dessus de la réponse">Dans le fil du viewer</small>'
          : `<button type="button" class="d-btn ghost sm" data-tomenu>${ic('user')}${r.to === 'none' ? 'S’adresser à…' : r.to === 'user' ? `@${esc(r.to_login ?? '…')}` : esc(to[1])}${ic('down')}</button>`
      }</div>`
    }`;
}

// --- Étapes -------------------------------------------------------------------------------------------------------------

const asChat = (a: CmdAction): a is Extract<CmdAction, { type: 'chat' }> =>
  a.type === 'chat';

export function stepsHtml(c: EditCtx) {
  const { d } = c;
  const lk = isLocked(c, 'actions');
  const mod = d.actions.filter((a) => a.type === 'module');
  const chat = d.actions.filter(asChat);
  const modes = MODES.filter((m) => m[0] !== 'silent');
  const stepRow = (a: (typeof chat)[number], n: number) =>
    `<li class="cdx-step"><i>${n}</i>${
      lk
        ? `<span>${esc(a.text)}</span>`
        : `<div class="cdx-step__b"><label class="d-fld"><input type="text" data-atext="${a.id}" value="${esc(a.text)}" maxlength="500" placeholder="Texte du message" aria-label="Texte du message"></label>
        <span class="cdx-step__m"><label class="d-fld"><select data-amode="${a.id}" aria-label="Façon d’envoyer">${modes.map(([k, l, , , ok]) => `<option value="${k}" ${a.mode === k ? 'selected' : ''} ${ok || a.mode === k ? '' : 'disabled'}>${esc(l)}${ok ? '' : ' (non supporté)'}</option>`).join('')}</select></label>
        <label class="d-fld"><select data-aerr="${a.id}" aria-label="Si cet envoi échoue"><option value="continue" ${a.on_error === 'continue' ? 'selected' : ''}>Si échec : continuer</option><option value="stop" ${a.on_error === 'stop' ? 'selected' : ''}>Si échec : arrêter</option></select></label></span></div>
        <span class="cdx-step__x"><button type="button" class="d-ib" data-amove="${a.id}:-1" aria-label="Monter">${ic('down', 'cdx-up')}</button><button type="button" class="d-ib" data-amove="${a.id}:1" aria-label="Descendre">${ic('down')}</button><button type="button" class="d-ib" data-adel="${a.id}" aria-label="Retirer ce message">${ic('trash')}</button></span>`
    }</li>`;
  const replyRow = (n: number) =>
    `<li class="cdx-step is-reply"><i>${n}</i><span>La réponse ci-dessus</span></li>`;
  const list = chat.length
    ? d.reply_first
      ? [replyRow(1), ...chat.map((a, i) => stepRow(a, i + 2))]
      : [...chat.map((a, i) => stepRow(a, i + 1)), replyRow(chat.length + 1)]
    : [];
  return `<div class="cdx-sech"><span class="d-lb">Ensuite</span>
      ${chat.length ? `<label class="cdx-inl">Répondre d’abord ${sw(d.reply_first, 'data-replyfirst', 'Envoyer la réponse avant les autres messages', { disabled: isLocked(c, 'reply_first') })}</label>` : ''}
      <span class="d-sp"></span>${lk ? '' : `<button type="button" class="d-btn ghost sm" data-addchat>${ic('plus')}Ajouter un message</button>`}</div>
    ${mod.map((a) => `<p class="cdx-ro">${ic('lock')}<span>Action du module ${esc(a.type === 'module' ? `${modName(a.module)} · ${a.operation}` : '')} : fournie et protégée par le module, qui l’exécute lui-même.</span></p>`).join('')}
    ${list.length ? `<ol class="cdx-steps">${list.join('')}</ol>` : ''}
    ${chat.length || lk ? '' : '<p class="d-note">Aujourd’hui, des messages dans le chat. Sons, OBS et Jetons viendront plus tard.</p>'}`;
}

// --- Règles : une case par règle, le réglage s'ouvre sur place -------------------------------------------------------------

const rule = (k: string, icon: IcName, label: string, value: string) =>
  `<button type="button" class="cdx-rule" data-rule="${k}" aria-label="${esc(`${label} : ${value}`)}"><small>${ic(icon)}${esc(label)}</small><b title="${esc(value)}">${esc(value)}</b></button>`;

const argsText = (d: CmdConfig) =>
  d.args.length
    ? d.args
        .map(
          (a) =>
            (a.type === 'mention' ? `@${a.name}` : a.name) +
            (a.required ? '' : ' (facultatif)'),
        )
        .join(', ')
    : 'Rien';

export function rulesHtml(c: EditCtx) {
  const { d, base } = c;
  const cat = categoryOf({ config: d } as CommandItem, c.cats);
  const cd = d.cooldown;
  const q = d.quota;
  return `<div class="cdx-sech"><span class="d-lb">Règles</span></div><div class="cdx-rules">
    ${rule('who', 'users', 'Qui', whoShort(d.audience))}
    ${rule('cooldown', 'clock', 'Délai', cd.enabled ? `${dur(cd.seconds)} ${cd.scope === 'viewer' ? 'par personne' : 'pour tout le chat'}` : 'Aucun')}
    ${rule('quota', 'repeat', 'Utilisations', q.enabled ? quotaText(q).replace('Utilisations : ', '') : 'Illimitées')}
    ${rule('when', 'live', 'Quand', WHEN[d.when])}
    ${rule('listed', 'eye', 'Liste publique', d.listed ? 'Visible' : 'Cachée')}
    ${rule('category', 'layers', 'Catégorie', cat.name)}
    ${rule('args', 'note', 'Après la commande', argsText(d))}
    ${rule('refuse', 'ban', 'Si refusée', REFUSE[d.refuse.mode])}
    ${rule('team', 'lock', base?.kind === 'system' ? 'Équipe et module' : 'Équipe', d.team_lock ? 'Verrouillée' : 'Modifiable')}
  </div>`;
}

const sentence = (t: string) => `<p class="cdx-sent">${esc(t)}</p>`;

function whoPop(c: EditCtx) {
  const a = c.d.audience;
  return `<h3>Qui peut l’utiliser</h3>
    ${
      isLocked(c, 'audience.groups')
        ? lockRo(c, whoShort(a))
        : `<div class="d-tags" role="group" aria-label="Groupes autorisés">${GROUPS.map(([k, l]) => `<button type="button" class="d-tag ${a.groups.includes(k) ? 'ok' : 'off'}" data-grp="${k}" aria-pressed="${a.groups.includes(k)}">${a.groups.includes(k) ? ic('check') : ''}${esc(l)}</button>`).join('')}</div>`
    }
    <div class="d-lb">Autoriser aussi</div>
    ${isLocked(c, 'audience.allow') ? lockRo(c, a.allow.join(', ') || 'Personne') : chips(a.allow, 'allow', '+ pseudo')}
    <div class="d-lb">Exclure</div>
    ${isLocked(c, 'audience.deny') ? lockRo(c, a.deny.join(', ') || 'Personne') : chips(a.deny, 'deny', '+ pseudo')}
    ${sentence(whoSentence(a))}`;
}

const scope = (attr: string, v: string) =>
  seg(
    attr,
    [
      ['viewer', 'Par personne'],
      ['global', 'Pour tout le chat'],
    ],
    v,
    'block',
  );

function cooldownPop(c: EditCtx) {
  const cd = c.d.cooldown;
  if (isLocked(c, 'cooldown'))
    return `<h3>Délai</h3>${lockRo(c, cooldownText(cd))}`;
  const head = `<div class="d-row"><span>Limiter la fréquence</span>${sw(cd.enabled, 'data-cdon', 'Limiter la fréquence')}</div>`;
  if (!cd.enabled)
    return `<h3>Délai</h3>${head}${sentence('La commande peut être relancée tout de suite.')}`;
  const preset = COOLDOWN_PRESETS.some(([x]) => x === cd.seconds);
  const custom = c.cdCustom || !preset;
  const unit = { s: 1, min: 60, h: 3600 }[cd.unit];
  return `<h3>Délai</h3>${head}
    ${seg(
      'data-cdpreset',
      [
        ...COOLDOWN_PRESETS.map(([x, l]) => [String(x), l] as const),
        ['custom', 'Autre'],
      ],
      custom ? 'custom' : String(cd.seconds),
      'block',
    )}
    ${
      custom
        ? `<div class="cdx-inline"><span>Attendre</span>${fld('data-cdval aria-label="Durée" min="1"', cd.seconds / unit)}<label class="d-fld"><select data-cdunit aria-label="Unité">${[
            ['s', 'secondes'],
            ['min', 'minutes'],
            ['h', 'heures'],
          ]
            .map(
              ([v, t]) =>
                `<option value="${v}" ${cd.unit === v ? 'selected' : ''}>${t}</option>`,
            )
            .join('')}</select></label></div>`
        : ''
    }
    ${scope('data-cdscope', cd.scope)}
    ${sentence(cooldownText(cd))}`;
}

function quotaPop(c: EditCtx) {
  const q = c.d.quota;
  if (isLocked(c, 'quota'))
    return `<h3>Utilisations</h3>${lockRo(c, quotaText(q))}`;
  const head = `<div class="d-row"><span>Limiter le nombre d’utilisations</span>${sw(q.enabled, 'data-mxon', 'Limiter le nombre d’utilisations')}</div>`;
  if (!q.enabled)
    return `<h3>Utilisations</h3>${head}${sentence('Illimitées.')}`;
  return `<h3>Utilisations</h3>${head}
    <div class="cdx-inline"><span>Maximum</span>${fld('data-mxcount aria-label="Nombre maximum" min="1" max="10000"', q.max)}<label class="d-fld"><select data-mxper aria-label="Période">${WINDOWS.map(([v, t]) => `<option value="${v}" ${q.window === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    ${scope('data-mxscope', q.scope)}
    ${sentence(quotaText(q))}
    <p class="d-note">Indépendant du délai : les deux peuvent se combiner.</p>`;
}

const whenPop = (c: EditCtx) =>
  `<h3>Quand</h3>${
    isLocked(c, 'when')
      ? lockRo(c, WHEN[c.d.when])
      : seg('data-when', Object.entries(WHEN), c.d.when, 'block')
  }`;

function listedPop(c: EditCtx) {
  const d = c.d;
  return `<h3>Liste publique</h3>
    ${
      isLocked(c, 'listed')
        ? lockRo(
            c,
            d.listed
              ? 'Visible dans la liste publique'
              : 'Cachée de la liste publique',
          )
        : `<div class="d-row"><span>Visible dans l’extension</span>${sw(d.listed, 'data-listed', 'Visible dans la liste publique')}</div>`
    }
    ${
      d.listed
        ? `<div class="cdx-pub"><span class="d-tag ext">Extension · Commandes</span><div><span class="cdx-tile" style="--c:${esc(d.appearance.color)}">${lookIc(d.appearance.icon)}</span><p><b>!${esc(d.name || '…')}</b>${d.description ? `<small>${esc(d.description)}</small>` : ''}<small>${esc(whoShort(d.audience))}${d.aliases.length ? ` · aussi ${d.aliases.map((a) => `!${esc(a)}`).join(' ')}` : ''}</small></p></div></div><p class="d-note">Une commande désactivée n’apparaît pas.</p>`
        : '<p class="d-note">Elle fonctionne toujours, mais les viewers ne la voient pas dans l’extension.</p>'
    }`;
}

const categoryPop = (c: EditCtx) =>
  `<h3>Catégorie</h3>${
    isLocked(c, 'category')
      ? lockRo(c, categoryOf({ config: c.d } as CommandItem, c.cats).name)
      : `<label class="d-fld"><select data-category aria-label="Catégorie"><option value="">Sans catégorie</option>${c.cats.map((f) => `<option value="${esc(f.category_id)}" ${c.d.category === f.category_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>`
  }<button type="button" class="d-btn ghost sm" data-opencats>${ic('sliders')}Gérer les catégories</button>`;

function argsPop(c: EditCtx) {
  const { d } = c;
  const T = [
    ['mention', '@pseudo'],
    ['number', 'Nombre'],
    ['text', 'Texte'],
  ] as const;
  return `<h3>Ce que le viewer écrit après la commande</h3>
    <p class="cdx-syntax"><code>${esc(syntax(d))}</code>${d.args.length ? `<small>Exemple : ${esc(example(d))}</small>` : ''}</p>
    ${
      isLocked(c, 'args')
        ? lockRo(c, syntax(d))
        : `${d.args
            .map(
              (a, i) => `<div class="cdx-arg">
          <label class="d-fld"><input type="text" data-arg="${i}" value="${esc(a.name)}" maxlength="24" aria-label="Nom de l’élément"></label>
          <button type="button" class="d-ib" data-argdel="${i}" aria-label="Retirer ${esc(a.name)}">${ic('trash')}</button>
          ${seg(
            'data-argtype',
            T.map(([k, l]) => [`${i}:${k}`, l] as const),
            `${i}:${a.type}`,
            'block',
          )}
          <div class="d-row"><span>Obligatoire</span>${sw(a.required, `data-argreq="${i}"`, `${a.name} obligatoire`)}</div></div>`,
            )
            .join('')}
      ${d.args.length < 5 ? `<button type="button" class="d-btn ghost sm" data-argadd>${ic('plus')}Ajouter un @pseudo, un nombre, un texte</button>` : ''}
      <p class="d-note">Un texte prend tout le reste du message : mets-le en dernier.</p>`
    }`;
}

function refusePop(c: EditCtx) {
  const { d } = c;
  return `<h3>Si la commande ne peut pas être utilisée</h3>
    ${
      isLocked(c, 'refuse')
        ? lockRo(c, REFUSE[d.refuse.mode])
        : `${seg(
            'data-refuse',
            [
              ['silent', 'Rien'],
              ['explain', 'Expliquer'],
              ['custom', 'Message'],
            ],
            d.refuse.mode,
            'block',
          )}
      ${d.refuse.mode === 'custom' ? `<label class="d-fld cdx-wide"><input type="text" data-refusetext value="${esc(d.refuse.text)}" maxlength="300" placeholder="Réservée aux abonnés." aria-label="Message de refus"></label>` : ''}`
    }
    <p class="d-note">Pas le droit, trop tôt, pas pendant le live, élément manquant… Au plus une réponse de refus par minute et par personne.</p>`;
}

function teamPop(c: EditCtx) {
  const { d, base } = c;
  return `<h3>Équipe</h3>
    <div class="d-row"><span>Verrouiller pour l’équipe</span>${sw(d.team_lock, 'data-teamlock', 'Verrouiller pour l’équipe', { disabled: isLocked(c, 'team_lock') })}</div>
    <p class="d-note">L’équipe peut la voir, pas la modifier.</p>
    <button type="button" class="d-btn ghost sm" data-openrights>${ic('users')}Droits de l’équipe</button>
    ${
      base?.kind === 'system'
        ? `<div class="d-lb">Module ${esc(modName(base.owner_module ?? ''))}</div>
      <p class="d-note">Champs verrouillés : ${base.locked_fields.map((f) => esc(FIELD[f] ?? f)).join(', ') || 'aucun'}. Tes autres réglages sont gardés quand le module se met à jour.</p>
      <button type="button" class="d-btn sm" data-reset>${ic('repeat')}Remettre les réglages d’origine</button>`
        : ''
    }`;
}

export const RULE_POPS: Record<string, (c: EditCtx) => string> = {
  who: whoPop,
  cooldown: cooldownPop,
  quota: quotaPop,
  when: whenPop,
  listed: listedPop,
  category: categoryPop,
  args: argsPop,
  refuse: refusePop,
  team: teamPop,
};
