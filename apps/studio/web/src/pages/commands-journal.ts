import type { CmdConfig } from '@raptoru/schemas';
import {
  type CommandItem,
  cooldownText,
  FIELD,
  MODES,
  quotaText,
  REASON,
  STEP,
} from '../commands-model.js';
import { drawer, errText, esc, hhmm, ic, seg, type Drawer } from '../ds/ds.js';
import { getJson } from '../http.js';

// Le journal des commandes, dans un tiroir : chaque message qui a nommé une commande (acceptée ou refusée, avec la raison du
// Core), qui a modifié quoi, et le sort de chaque envoi dans le chat. Par commande depuis l'éditeur, global depuis l'en-tête.

interface Step {
  seq: number;
  kind: string;
  status: string;
  error: string | null;
  twitch_message_id: string | null;
}
interface Invocation {
  invocation_id: string;
  command_id: string;
  trigger: string;
  viewer_display_name: string;
  source: string;
  decision: 'accepted' | 'rejected';
  reason: string | null;
  reason_detail: Record<string, unknown> | null;
  created_at: string;
  steps: Step[];
}
interface Change {
  id: number;
  command_id: string | null;
  action: string;
  actor_id: string;
  actor_login: string | null;
  via: string;
  changes: { field: string; before: unknown; after: unknown }[];
  created_at: string;
}
interface StepRow {
  step_id: string;
  /** Null pour un message du Jeu des mots (aucune invocation Commandes). */
  invocation_id: string | null;
  origin?: 'commands' | 'word_game';
  kind: string;
  params: { mode?: string; text?: string };
  status: string;
  attempt_count: number;
  error: { code?: string; message?: string } | null;
  twitch_message_id: string | null;
  created_at: string;
}
type Tab = 'runs' | 'changes' | 'steps';

const HELP: Record<Tab, string> = {
  runs: 'Chaque message qui a nommé une commande : acceptée ou refusée, et ce qui est parti dans le chat.',
  changes: 'Qui a modifié quoi, avant et après.',
  steps:
    'Les messages de LeCroupier_ : envoyé, échec, incertain (jamais renvoyé), expiré.',
};
const day = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Aujourd’hui';
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString())
    return 'Hier';
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
};
const byDay = <T extends { created_at: string }>(
  list: T[],
  f: (x: T) => string,
  empty: string,
) => {
  if (!list.length) return `<div class="d-empty">${empty}</div>`;
  let d = '';
  return list
    .map((x) => {
      const k = day(x.created_at);
      const head = k !== d ? `<h4 class="d-lb cdx-day">${esc(k)}</h4>` : '';
      d = k;
      return head + f(x);
    })
    .join('');
};
const tone = { ok: 'ok', warn: 'warn', bad: 'bad', off: 'off' } as const;
const stepTag = (status: string, extra = '') => {
  const [label, t] = STEP[status] ?? [status, 'off' as const];
  return `<span class="d-tag ${tone[t]}" title="${esc(status)}">${esc(label)}${esc(extra)}</span>`;
};
/** Une valeur du journal dans les mots de l'éditeur. */
function val(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'rien';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (Array.isArray(v) && field === 'args')
    return v.map((a: { name: string }) => a.name).join(', ') || 'Rien';
  if (Array.isArray(v) && field === 'actions')
    return `${v.length} message${v.length > 1 ? 's' : ''}`;
  if (Array.isArray(v)) return v.join(', ') || 'Aucun';
  if (field === 'cooldown') return cooldownText(v as CmdConfig['cooldown']);
  if (field === 'quota') return quotaText(v as CmdConfig['quota']);
  if (field === 'reply') {
    const r = v as CmdConfig['reply'];
    return `${MODES.find((m) => m[0] === r.mode)?.[1] ?? r.mode}${r.text ? ` · ${r.text}` : ''}`;
  }
  if (field === 'refuse') return (v as CmdConfig['refuse']).text || 'Réglé';
  if (field === 'appearance') return (v as CmdConfig['appearance']).icon;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
const ACT: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  reset: 'Remise d’origine',
  system_sync: 'Mise à jour du module',
  rights: 'Droits de l’équipe',
};

export function openJournal(
  commands: CommandItem[],
  only: CommandItem | null = null,
) {
  let tab: Tab = 'runs';
  const name = (id: string | null) =>
    only || !id
      ? ''
      : (commands.find((c) => c.command_id === id)?.config.name ?? '');
  const invRow = (x: Invocation) => {
    const n = name(x.command_id);
    return `<div class="cdx-j"><time>${hhmm(x.created_at)}</time><div><span class="d-tag ${x.decision === 'accepted' ? 'ok' : 'warn'}">${x.decision === 'accepted' ? 'Acceptée' : 'Refusée'}</span> ${n ? `<b>!${esc(n)}</b> · ` : ''}${esc(x.viewer_display_name)} <span class="d-faint">!${esc(x.trigger)} · ${x.source === 'twitch' ? 'Twitch' : 'simulateur'}</span>
      ${x.reason ? `<small>${esc(REASON[x.reason] ?? x.reason)}${x.reason_detail?.message ? ` : ${esc(x.reason_detail.message)}` : ''}</small>` : ''}
      ${x.steps.length ? `<small class="cdx-jsteps">${x.steps.map((s) => stepTag(s.status, s.error ? ` · ${s.error}` : '')).join('')}</small>` : x.decision === 'accepted' ? '<small>Aucun message à envoyer</small>' : ''}</div></div>`;
  };
  const changeRow = (x: Change) => {
    const n = name(x.command_id);
    return `<div class="cdx-j"><time>${hhmm(x.created_at)}</time><div><b>${esc(ACT[x.action] ?? x.action)}</b>${n ? ` · !${esc(n)}` : ''} <span class="d-faint">${x.via === 'studio' ? 'Studio' : `${esc(x.actor_login ?? x.actor_id)} · ${x.via === 'extension' ? 'Extension' : 'système'}`}</span>
      ${x.changes.map((ch) => `<small class="cdx-diff"><span>${esc(FIELD[ch.field] ?? ch.field)}</span>${ch.before !== null && ch.before !== undefined ? `<del>${esc(val(ch.field, ch.before))}</del>${ic('arrow')}` : ''}<ins>${esc(val(ch.field, ch.after))}</ins></small>`).join('')}</div></div>`;
  };
  const stepRow = (s: StepRow) =>
    `<div class="cdx-j"><time>${hhmm(s.created_at)}</time><div>${stepTag(s.status)} ${esc(s.params.text ?? '')}
      <small>${esc({ normal: 'Message', announce: 'Annonce', reply: 'Réponse Twitch', me: '/me' }[s.params.mode ?? ''] ?? s.params.mode ?? '')} · ${esc(s.origin === 'word_game' ? 'Jeu des mots' : s.kind === 'refusal' ? 'réponse de refus' : s.kind === 'reply' ? 'réponse' : 'autre message')}${s.attempt_count > 1 ? ` · ${s.attempt_count} tentatives` : ''}${s.error?.code ? ` · ${esc(s.error.code)}` : ''}${s.twitch_message_id ? ' · reçu par Twitch' : ''}</small></div></div>`;

  const q = only ? `command_id=${only.command_id}&` : '';
  const body = async () => {
    if (tab === 'runs')
      return byDay(
        (
          await getJson<{ invocations: Invocation[] }>(
            `/api/commands/invocations?${q}limit=${only ? 50 : 100}`,
          )
        ).invocations,
        invRow,
        'Aucune utilisation.',
      );
    if (tab === 'changes')
      return byDay(
        (
          await getJson<{ entries: Change[] }>(
            only
              ? `/api/commands/${only.command_id}/history?limit=50`
              : '/api/commands/history?limit=100',
          )
        ).entries,
        changeRow,
        'Aucune modification.',
      );
    return byDay(
      (await getJson<{ steps: StepRow[] }>('/api/commands/steps?limit=100'))
        .steps,
      stepRow,
      'Aucun envoi.',
    );
  };
  const tabs: [Tab, string][] = [
    ['runs', 'Utilisations'],
    ['changes', 'Modifications'],
    ...(only ? [] : ([['steps', 'Envois chat']] as [Tab, string][])),
  ];
  const head = () =>
    `${seg('data-jtab', tabs, tab, 'block')}<p class="d-note">${HELP[tab]}</p>`;
  let d: Drawer | null = null;
  let gen = 0;
  const load = async () => {
    const mine = ++gen;
    d!.set({
      body: `${head()}<div class="d-skel" style="height:160px"></div>`,
    });
    let html: string;
    try {
      html = await body();
    } catch (e) {
      html = `<p class="d-note bad">${esc(errText(e))}</p>`;
    }
    if (mine === gen) d!.set({ body: `${head()}${html}` });
  };
  d = drawer({
    kicker: only ? 'Journal' : 'Commandes',
    title: only ? `!${only.config.name}` : 'Journal',
    body: '',
  });
  d.el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-jtab]');
    if (!t) return;
    tab = t.dataset.jtab as Tab;
    void load();
  });
  void load();
}
