import { type CmdConfig, type CmdTrigger, keywordKey } from '@raptoru/schemas';
import { esc, ic, seg } from '../ds/ds.js';

// Comment une commande se lance (« !nom » ou un message qui contient une expression) et qui peut la modifier depuis
// l'extension (éditeurs délégués, par ID Twitch). Rendu HTML et modifications du brouillon seulement : le Core valide tout
// à l'enregistrement, et c'est lui qui vérifie chaque modification déléguée.

const NONE: CmdTrigger = { mode: 'command', keywords: [], match: 'word' };
export const triggerOf = (d: CmdConfig): CmdTrigger => d.trigger ?? NONE;
export const isKeywords = (d: CmdConfig) => d.trigger?.mode === 'keywords';
const quoted = (d: CmdConfig) =>
  triggerOf(d)
    .keywords.map((k) => `« ${k} »`)
    .join(', ');

/** La case « Déclenchement » des règles, et l'en-tête de la liste. */
export const triggerShort = (d: CmdConfig) =>
  isKeywords(d) ? `Message contenant ${quoted(d) || '…'}` : `!${d.name || '…'}`;

const MATCH: [CmdTrigger['match'], string, string][] = [
  [
    'word',
    'Mot entier',
    'L’expression doit être un mot à part : « ao » se déclenche dans « franchement ao ! », jamais dans « chaos » ni « aouh ».',
  ],
  [
    'anywhere',
    'N’importe où',
    'L’expression peut être au milieu d’un mot : « ao » se déclenche aussi dans « chaos ». Plus de déclenchements involontaires.',
  ],
];

export const keywordChips = (d: CmdConfig) =>
  `<div class="cdx-chips">${triggerOf(d)
    .keywords.map(
      (k) =>
        `<button type="button" class="d-tag" data-chipdel="kw|${esc(k)}" aria-label="Retirer ${esc(k)}">${esc(k)}${ic('x')}</button>`,
    )
    .join(
      '',
    )}<input type="text" data-chipin="kw" maxlength="40" placeholder="+ expression" aria-label="Ajouter une expression" autocomplete="off" spellcheck="false"></div>`;

export function triggerPop(d: CmdConfig, locked: boolean, err: string) {
  const t = triggerOf(d);
  if (locked)
    return `<h3>Déclenchement</h3><p class="cdx-ro">${ic('lock')}<span>${esc(triggerShort(d))}</span></p>`;
  const m = MATCH.find((x) => x[0] === t.match)!;
  const modes = [
    ['command', 'Commande exacte'],
    ['keywords', 'Message contenant une expression'],
  ] as const;
  return `<h3>Déclenchement</h3>
    <div class="d-tags" role="group" aria-label="Déclenchement">${modes
      .map(
        ([k, l]) =>
          `<button type="button" class="d-tag ${t.mode === k ? 'ok' : 'off'}" data-tmode="${k}" aria-pressed="${t.mode === k}">${t.mode === k ? ic('check') : ''}${l}</button>`,
      )
      .join('')}</div>
    ${
      t.mode === 'command'
        ? `<p class="cdx-sent">${esc(`Le viewer écrit !${d.name || 'nom'}${d.aliases.length ? ` (ou un alias)` : ''} au début de son message.`)}</p>`
        : `<div class="d-lb">Expressions (majuscules indifférentes, prises telles quelles)</div>
      ${keywordChips(d)}
      ${err ? `<p class="d-note bad">${esc(err)}</p>` : ''}
      ${seg(
        'data-tmatch',
        MATCH.map(([k, l]) => [k, l] as const),
        t.match,
        'block',
      )}
      <p class="cdx-sent">${esc(m[2])}</p>
      <p class="d-note">Sans « ! » : un message qui contient une de ces expressions la lance, une seule fois par message même s’il en contient plusieurs. Qui, délai, utilisations et sons restent ceux de la commande ; un refus n’est jamais annoncé dans le chat, et elle n’apparaît pas dans la liste publique de l’extension.</p>`
    }`;
}

/** Ce qu'un éditeur délégué peut faire, et ce qu'il ne peut pas (répété dans l'extension). */
export function editorsPop(d: CmdConfig, locked: boolean) {
  const list = d.editors ?? [];
  return `<h3>Modification déléguée</h3>
    <p class="d-note">Ces viewers retrouvent la commande dans l’extension (Commandes › Mes commandes) et peuvent seulement l’activer ou la désactiver${isKeywords(d) ? ' et changer ses expressions' : ''}. Jamais le son, le volume, qui peut l’utiliser, le délai, les utilisations ni les autres réglages. Indépendant de « Qui » : pouvoir la modifier ne donne pas le droit de l’utiliser, et l’inverse.</p>
    <div class="d-lb">Viewers (ID Twitch : gardent le droit même s’ils changent de pseudo)</div>
    ${
      locked
        ? `<p class="cdx-ro">${ic('lock')}<span>${esc(list.map((x) => x.name).join(', ') || 'Personne')}</span></p>`
        : `<div class="cdx-chips">${list
            .map(
              (x) =>
                `<button type="button" class="d-tag" data-chipdel="editor|${esc(x.id)}" aria-label="Retirer ${esc(x.name)}">${esc(x.name)} <small>${esc(x.id)}</small>${ic('x')}</button>`,
            )
            .join(
              '',
            )}<input type="text" data-chipin="editor" placeholder="+ pseudo ou ID Twitch" aria-label="Ajouter un éditeur par son pseudo ou son ID Twitch" autocomplete="off" spellcheck="false"></div>`
    }
    <p class="cdx-sent">${esc(list.length ? `${list.map((x) => x.name).join(', ')} peu${list.length > 1 ? 'vent' : 't'} la modifier depuis l’extension. Retire-${list.length > 1 ? 'les' : 'le'} pour reprendre la main.` : 'Personne ne peut la modifier depuis l’extension.')}</p>`;
}

export const editorsShort = (d: CmdConfig) =>
  (d.editors ?? []).map((x) => x.name).join(', ') || 'Personne';

// --- Modifications du brouillon -------------------------------------------------------------------------------------

export function setTrigger(d: CmdConfig, patch: Partial<CmdTrigger>) {
  d.trigger = { ...triggerOf(d), ...patch };
}

/** Ajoute une expression ; renvoie le problème à afficher, ou '' . */
export function addKeyword(d: CmdConfig, raw: string): string {
  const k = raw.trim().replace(/\s+/g, ' ');
  const list = triggerOf(d).keywords;
  if (!k) return 'Écris une expression.';
  if (k.length > 40) return '40 caractères au plus.';
  if (list.some((x) => keywordKey(x) === keywordKey(k)))
    return `« ${k} » est déjà dans la liste.`;
  if (list.length >= 20) return '20 expressions au plus.';
  setTrigger(d, { keywords: [...list, k] });
  return '';
}

export const removeKeyword = (d: CmdConfig, k: string) =>
  setTrigger(d, { keywords: triggerOf(d).keywords.filter((x) => x !== k) });
