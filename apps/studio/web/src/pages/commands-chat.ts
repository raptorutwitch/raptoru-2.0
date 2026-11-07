import type { CmdConfig } from '@raptoru/schemas';
import {
  CHECK,
  dur,
  example,
  PREVIEW_EXAMPLE,
  previewLines,
  previewVars,
  REASON,
} from '../commands-model.js';
import { esc, ic, pp, seg, sw } from '../ds/ds.js';

// Le faux chat : ce qu'on écrit dans l'éditeur s'y lit aussitôt, avec le viewer choisi et ce qu'il a tapé. C'est un exemple pour
// l'écran. La vérité reste la décision du Core (« Tester ») : même décision qu'un vrai message, rien n'est écrit ni envoyé.

export interface Decision {
  decision: 'accepted' | 'rejected';
  reason: string | null;
  message: string;
  detail: Record<string, unknown>;
  checks: { check: string; ok: boolean }[];
  raw_args: string;
  args: Record<string, string | number>;
  rendered: {
    reply: { mode: string; text: string; reply_to: string | null } | null;
    actions: { type: string; mode?: string; text?: string }[];
    reply_first: boolean;
  } | null;
  viewer: { groups: string[]; role: string; follower: boolean | null };
  live: boolean;
  follower_source: string | null;
}

/** Viewers fictifs du test : pseudo, identifiant, rôle et badges restent modifiables. */
export const TEST_VIEWERS = [
  {
    label: 'Viewer',
    id: '900101',
    login: 'pixelmamie',
    display_name: 'PixelMamie',
    role: 'viewer',
    badges: [] as string[],
  },
  {
    label: 'Abonné',
    id: '900102',
    login: 'kevdu59',
    display_name: 'Kevdu59',
    role: 'viewer',
    badges: ['subscriber'],
  },
  {
    label: 'VIP',
    id: '900103',
    login: 'luna_bzh',
    display_name: 'luna_bzh',
    role: 'viewer',
    badges: ['vip'],
  },
  {
    label: 'Modérateur',
    id: '900104',
    login: 'aouh',
    display_name: 'Aouh',
    role: 'moderator',
    badges: ['moderator'],
  },
  {
    label: 'Streamer',
    id: '900100',
    login: 'raptoru_',
    display_name: 'Raptoru_',
    role: 'broadcaster',
    badges: ['broadcaster'],
  },
];
const BADGES: [string, string][] = [
  ['subscriber', 'Abonné'],
  ['founder', 'Fondateur'],
  ['vip', 'VIP'],
  ['moderator', 'Modérateur'],
  ['broadcaster', 'Streamer'],
];
export const newTester = () => ({
  preset: 0,
  ...structuredClone(TEST_VIEWERS[0]!),
  follower: 'unknown' as 'unknown' | 'true' | 'false',
  message: '',
  res: null as Decision | null,
  /** Ce que le viewer a tapé pour cette décision, et sous quel nom. */
  ran: '',
  ranBy: '',
  busy: false,
  error: '',
});
export type Tester = ReturnType<typeof newTester>;

const BOT = 'LeCroupier_';

/** Les valeurs résolues ressortent dans le message : marques posées avant l'échappement. */
const marked = (t: string) =>
  esc(t).replace(/\uE000(.*?)\uE001/g, '<mark>$1</mark>');

const line = (mode: string, html: string, viewer: string) => {
  const text = `<b class="cdx-bot">${BOT}</b> `;
  if (mode === 'announce')
    return `<div class="cdx-l ann d-in"><small>Annonce</small><div>${text}${html}</div></div>`;
  if (mode === 'reply')
    return `<div class="cdx-l d-in"><small class="cdx-re">En réponse à @${esc(viewer)}</small><div>${text}${html}</div></div>`;
  if (mode === 'me')
    return `<div class="cdx-l d-in"><div>${text}<i>${html}</i></div><small class="cdx-bad">Ne serait pas envoyé : /me</small></div>`;
  return `<div class="cdx-l d-in"><div>${text}${html}</div></div>`;
};

/** Le fil de l'aperçu : le message tapé, puis ce que le bot écrirait, variables résolues. */
export function previewItems(d: CmdConfig, t: Tester) {
  const typed = t.message.trim() || example(d);
  const first = typed.split(/\s+/)[0]!.replace(/^!/, '').toLowerCase();
  const fires = first === d.name || d.aliases.includes(first) || !d.name;
  const vars = { ...PREVIEW_EXAMPLE, ...previewVars(d, t, typed) };
  const shown = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, `\uE000${v}\uE001`]),
  );
  const items = [
    {
      key: 'typed',
      html: `<div class="cdx-l d-in"><div><b>${esc(t.display_name)}</b> ${esc(typed)}</div></div>`,
    },
  ];
  if (!fires)
    return [
      ...items,
      {
        key: 'nofire',
        html: `<p class="cdx-lnote d-in">Ce message ne lance pas !${esc(d.name)} : le bot ne réagit pas.</p>`,
      },
    ];
  const lines = previewLines(d, shown).map((l) => ({
    key: l.key,
    html: line(
      l.mode,
      l.text.replace(/\uE000|\uE001/g, '').trim()
        ? marked(l.text)
        : '<em class="d-faint">Écris la réponse…</em>',
      t.display_name,
    ),
  }));
  if (!lines.length)
    lines.push({
      key: 'silent',
      html: '<p class="cdx-lnote d-in">Le bot n’écrit rien.</p>',
    });
  if (!d.enabled)
    lines.push({
      key: 'off',
      html: '<p class="cdx-lnote d-in">Coupée : elle ne répond pas.</p>',
    });
  return [...items, ...lines];
}

const tf = (k: string, label: string, v: string) =>
  `<label><span class="d-lb">${label}</span><span class="d-fld"><input type="text" data-tfield="${k}" value="${esc(v)}" spellcheck="false"></span></label>`;

/** Le viewer fictif, modifiable en entier : c'est lui que le Core jugera. */
export function viewerForm(t: Tester) {
  return `<h3>Qui tape la commande</h3>
    <label class="d-fld"><select data-tpreset aria-label="Viewer">${TEST_VIEWERS.map((v, i) => `<option value="${i}" ${t.preset === i ? 'selected' : ''}>${esc(v.label)} · ${esc(v.display_name)}</option>`).join('')}</select></label>
    <div class="cdx-tgrid">
      ${tf('display_name', 'Pseudo', t.display_name)}${tf('login', 'Identifiant', t.login)}${tf('id', 'Id Twitch', t.id)}
      <label><span class="d-lb">Rôle dans le chat</span><span class="d-fld"><select data-tfield="role">${[
        ['viewer', 'Viewer'],
        ['moderator', 'Modérateur'],
        ['broadcaster', 'Streamer'],
      ]
        .map(
          ([k, l]) =>
            `<option value="${k}" ${t.role === k ? 'selected' : ''}>${l}</option>`,
        )
        .join('')}</select></span></label>
    </div>
    <div class="d-lb">Badges</div>
    ${BADGES.map(([b, l]) => `<div class="d-row"><span>${l}</span>${sw(t.badges.includes(b), `data-tbadge="${b}"`, l)}</div>`).join('')}
    <div class="d-lb">Suit la chaîne</div>
    ${seg(
      'data-tfollow',
      [
        ['unknown', 'Inconnu'],
        ['true', 'Oui'],
        ['false', 'Non'],
      ],
      t.follower,
      'block',
    )}`;
}

export const viewerBtn = (t: Tester) =>
  `<button type="button" class="d-btn ghost sm cdx-who" data-tviewer aria-label="Changer de viewer">${pp(t.display_name, 18)}${esc(t.display_name)}${ic('down')}</button>`;

/** La décision du Core sur la version enregistrée. */
export function verdictHtml(t: Tester) {
  const d = t.res;
  if (t.error) return `<p class="d-note bad">${esc(t.error)}</p>`;
  if (!d) return '';
  const det = d.detail;
  const extra = [
    det.remaining_s !== undefined
      ? `Cooldown : encore ${dur(Number(det.remaining_s))} (${det.scope === 'viewer' ? 'par personne' : 'pour tout le chat'})`
      : '',
    det.used !== undefined
      ? `Utilisations : ${String(det.used)} sur ${String(det.max)}`
      : '',
    det.syntax ? `Syntaxe : ${String(det.syntax)}` : '',
    det.follower_source
      ? `Follow : ${det.follower_source === 'test' ? 'valeur du test' : 'inconnu (pas de lecture Twitch)'}`
      : '',
  ].filter(Boolean);
  const r = d.rendered;
  const lines = r
    ? [
        ...(r.reply_first && r.reply ? [r.reply] : []),
        ...r.actions.filter((a) => a.type === 'chat'),
        ...(!r.reply_first && r.reply ? [r.reply] : []),
      ]
    : [];
  const ok = d.decision === 'accepted';
  return `<section class="cdx-verdict ${ok ? 'ok' : 'no'} d-in">
    <header>${ic(ok ? 'check' : 'warn')}<b>${ok ? `Acceptée pour ${esc(t.ranBy)}` : `Refusée : ${esc(REASON[d.reason ?? ''] ?? d.reason)}`}</b></header>
    <p>${esc(d.message)}</p>
    ${lines.length ? `<div class="cdx-real"><span class="d-lb">Serait envoyé</span>${lines.map((l) => line(l.mode ?? 'normal', esc(l.text), t.ranBy)).join('')}</div>` : ok ? '<p class="d-faint">Aucun message (le bot n’écrit rien).</p>' : ''}
    <details class="d-acc"><summary>Contrôles du serveur</summary>
      <ol class="cdx-checks">${d.checks.map((x) => `<li class="${x.ok ? '' : 'no'}">${ic(x.ok ? 'check' : 'x')}<span>${esc(CHECK[x.check] ?? x.check)}${!x.ok && extra.length ? `<small>${extra.map(esc).join(' · ')}</small>` : ''}</span></li>`).join('')}</ol>
      <dl class="d-kv"><dt>Message testé</dt><dd>${esc(t.ran)}</dd><dt>Groupes vus</dt><dd>${esc(d.viewer.groups.join(', ') || 'aucun')}</dd><dt>Stream</dt><dd>${d.live ? 'en live' : 'hors live'}</dd>${Object.entries(
        d.args,
      )
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join('')}</dl>
    </details></section>`;
}
