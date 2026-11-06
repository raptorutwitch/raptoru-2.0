import {
  choiceBox,
  confirmBox,
  esc,
  fld,
  fmt,
  hhmm,
  ic,
  keyed,
  patch,
  pp,
  toast,
} from '../ds/ds.js';
import { getJson, postJson } from '../http.js';
import {
  act,
  modChanged,
  modErr,
  modGet,
  openViewer,
  searchViewers,
  when,
  type Card,
  type ModJump,
} from '../mod/mod.js';
import type { Activity } from '../module-host.js';
import type { Ctx, View } from './moderation-ui.js';

// « Autres modules » : le journal et le remboursement des modules du socle, tels que le Core les expose à tout module qui a une
// politique de modération visible. Le remboursement est le débit d'origine, une fois, avec un motif.
const STATUS: Record<string, string> = {
  queued: 'En attente',
  done: 'Terminé',
  refunded: 'Remboursé',
  failed: 'Échec',
  canceled: 'Annulé',
};

export function mountOthers(ctx: Ctx): View {
  const el = document.createElement('div');
  el.className = 'mv-others';
  el.innerHTML = `<nav class="mo-list" data-list aria-label="Modules"></nav><section class="mo-j"><header class="mo-h" data-head></header><div class="mj-rows" data-rows></div></section>`;
  const list = el.querySelector<HTMLElement>('[data-list]')!;
  const head = el.querySelector<HTMLElement>('[data-head]')!;
  const rows = el.querySelector<HTMLElement>('[data-rows]')!;
  let cur: string | null = null;
  let items: Activity[] | null = null;
  let failed = false;
  const mods = () => (ctx.hosts ?? []).filter((m) => m.moderation?.visible);
  const shown = () => mods().find((m) => m.id === cur) ?? mods()[0] ?? null;

  async function read() {
    const m = shown();
    if (!m) return paint();
    try {
      items = (
        await getJson<{ items: Activity[] }>(
          `/api/modules/activity?module=${encodeURIComponent(m.id)}&limit=100`,
        )
      ).items;
      failed = false;
    } catch {
      failed = true;
    }
    paint();
  }
  function paint() {
    const m = shown();
    patch(
      list,
      mods()
        .map(
          (x) =>
            `<button type="button" class="mo-m ${x === m ? 'on' : ''}" data-m="${esc(x.id)}"><b>${esc(x.label)}</b><small>${esc(x.enabled ? x.status.summary : 'Coupé')}</small></button>`,
        )
        .join(''),
    );
    if (!m) {
      patch(head, '');
      patch(
        rows,
        `<div class="d-empty">${ctx.hosts ? 'Aucun module du socle à modérer.' : 'Modules du socle illisibles pour le moment.'}</div>`,
      );
      return;
    }
    patch(
      head,
      `<h2>${esc(m.label)}${m.enabled ? '' : ' <span class="d-tag off">Coupé</span>'}</h2><p class="d-note">${esc(m.moderation?.note ?? '')}</p>`,
    );
    const canRefund = m.moderation?.refund === 'moderator';
    keyed(
      rows,
      (items ?? []).map((r) => ({
        key: r.activity_id,
        html: `<div class="mj-r mo-r"><time class="d-num">${when(r.created_at)}</time>${r.viewer ? `<button type="button" class="mo-who" data-viewer="${esc(r.viewer.id)}">${pp(r.viewer.display_name, 20)}<b>${esc(r.viewer.display_name)}</b></button>` : '<b>—</b>'}<span class="mj-what">${esc(r.action)}${r.reason ? ` · « ${esc(r.reason)} »` : ''}</span><span class="mj-st is-${esc(r.status)}">${esc(STATUS[r.status] ?? r.status)}</span><span class="d-num mj-amt">${r.amount ? `${fmt(r.amount)} J` : 'gratuit'}</span>${canRefund && r.amount > 0 && r.status !== 'refunded' ? `<button type="button" class="d-btn ghost sm" data-refund="${esc(r.activity_id)}">Rembourser…</button>` : '<span></span>'}</div>`,
      })),
      `<div class="d-empty">${failed ? 'Journal illisible pour le moment.' : items ? 'Rien dans le journal pour l’instant.' : 'Lecture…'}</div>`,
    );
  }
  async function refund(b: HTMLElement, r: Activity) {
    const pick = await choiceBox({
      title: `Rembourser ${r.viewer?.display_name ?? 'ce viewer'} ?`,
      body: `${fmt(r.amount)} Jetons rendus : le débit d’origine, une seule fois.`,
      choices: [],
      yes: 'Rembourser',
      field: { label: 'Motif du remboursement', required: true },
    });
    if (!pick) return;
    b.classList.add('is-busy');
    try {
      const out = await postJson<{ refunded: number }>('/api/modules/refund', {
        activity_id: r.activity_id,
        reason: pick.text.slice(0, 200),
      });
      toast(`Remboursé : ${fmt(out.refunded)} Jetons`);
    } catch (e) {
      toast(modErr(e), { bad: true });
    }
    b.classList.remove('is-busy');
    modChanged();
    await read();
  }
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    const d = b?.dataset;
    if (d?.m) {
      cur = d.m;
      items = null;
      paint();
      return void read();
    }
    if (d?.viewer) return openViewer(d.viewer);
    const r = items?.find((x) => x.activity_id === d?.refund);
    if (r) void refund(b!, r);
  });
  return {
    el,
    paint,
    read,
    enter(j?: ModJump) {
      if (j?.module && j.module !== cur) {
        cur = j.module;
        items = null;
      }
    },
  };
}

// --- Wallet de test du Lab ------------------------------------------------------------------------------------------------

interface Wallet {
  tokens: number;
  credits_tts: number;
  credits_soundboard: number;
}
/** Les outils du Lab sur son Wallet fictif : valeurs exactes, ajustements rapides, remise à zéro. Absent du profil Production. */
export function mountLabWallet(): View {
  const el = document.createElement('div');
  el.className = 'mv-wallet';
  el.innerHTML = `<p class="d-note">Jetons et crédits fictifs du Lab, jamais l’économie réelle.</p>
    <div class="ml-pick"><label class="d-fld"><select data-who aria-label="Viewer"></select></label><button type="button" class="d-btn ghost sm" data-open>${ic('user')}Fiche</button></div>
    <div data-body></div>`;
  const who = el.querySelector<HTMLSelectElement>('[data-who]')!;
  const body = el.querySelector<HTMLElement>('[data-body]')!;
  let people: { id: string; label: string }[] = [];
  let w: Wallet | null = null;
  let until: string | null = null;
  let failed = '';

  async function readPeople() {
    const { identities } = await modGet<{
      identities: { id: string; label: string }[];
    }>('identities');
    const seen = await searchViewers('').catch(() => []);
    people = [
      ...identities,
      ...seen
        .filter((v) => !identities.some((i) => i.id === v.viewer_id))
        .map((v) => ({ id: v.viewer_id, label: v.display_name })),
    ];
    const cur = who.value;
    who.innerHTML = people
      .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`)
      .join('');
    who.value = people.some((p) => p.id === cur) ? cur : (people[0]?.id ?? '');
  }
  async function read() {
    try {
      if (!people.length) await readPeople();
      if (!who.value) return;
      const [wallet, card] = await Promise.all([
        modGet<Wallet>(`wallet/${who.value}`),
        modGet<Card>(`viewers/${who.value}`),
      ]);
      w = wallet;
      until = card.tts_cooldown_until ?? null;
      failed = '';
    } catch (e) {
      failed = modErr(e);
    }
    paint();
  }
  function paint() {
    if (!w) {
      patch(body, `<div class="d-empty">${esc(failed || 'Lecture…')}</div>`);
      return;
    }
    // Les champs restent à ce qu'on tape : le dessin n'a lieu que si les soldes lus changent.
    const editing = body.contains(document.activeElement);
    if (editing) return;
    patch(
      body,
      `<div class="ml-grid">
        <label><span class="d-lb">Jetons</span>${fld('data-w="tokens" min="0"', w.tokens)}</label>
        <label><span class="d-lb">Crédits TTS</span>${fld('data-w="credits_tts" min="0"', w.credits_tts)}</label>
        <label><span class="d-lb">Crédits Sons</span>${fld('data-w="credits_soundboard" min="0"', w.credits_soundboard)}</label>
      </div>
      <div class="ml-act"><button type="button" class="d-btn pri" data-op="set">Définir</button>
        <button type="button" class="d-btn" data-op="adjust" data-k="tokens" data-n="10000">+ 10 000 Jetons</button>
        <button type="button" class="d-btn" data-op="adjust" data-k="credits_tts" data-n="1">+ 1 crédit TTS</button>
        <button type="button" class="d-btn" data-op="adjust" data-k="credits_soundboard" data-n="1">+ 1 crédit Sons</button>
        <span class="d-sp"></span><button type="button" class="d-btn bad" data-op="reset">Remettre à zéro…</button></div>
      <h2 class="d-lb" style="margin-top:20px">Cooldown TTS</h2>
      <div class="ml-cd"><span>${until && Date.parse(until) > Date.now() ? `Actif jusqu’à ${hhmm(until)}` : 'Aucun cooldown TTS.'}</span><button type="button" class="d-btn ghost sm" data-clear ${until && Date.parse(until) > Date.now() ? '' : 'disabled'}>Effacer</button></div>`,
    );
  }
  async function wallet(b: HTMLElement) {
    const op = b.dataset.op!;
    const out: Record<string, unknown> = { viewer_id: who.value, op };
    if (op === 'set')
      for (const i of body.querySelectorAll<HTMLInputElement>('[data-w]'))
        out[i.dataset.w!] = Number(i.value);
    if (op === 'adjust') out[b.dataset.k!] = Number(b.dataset.n);
    if (op === 'reset') {
      const yes = await confirmBox({
        title: 'Remettre ce Wallet de test à zéro ?',
        body: 'Il revient aux valeurs par défaut du Lab.',
        yes: 'Remettre à zéro',
        no: 'Annuler',
      });
      if (!yes) return;
    }
    b.classList.add('is-busy');
    try {
      await postJson('/api/lab/wallet', out);
      toast('Wallet de test mis à jour');
    } catch (e) {
      toast(modErr(e), { bad: true });
    }
    b.classList.remove('is-busy');
    (document.activeElement as HTMLElement | null)?.blur?.();
    modChanged();
    await read();
  }
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b?.dataset.op) return void wallet(b);
    if (b?.matches('[data-open]') && who.value) return openViewer(who.value);
    if (b?.matches('[data-clear]'))
      void act(
        b,
        { action: 'clear_cooldown', viewer_id: who.value, module: 'tts' },
        'Cooldown TTS effacé',
      ).then(read);
  });
  who.addEventListener('change', () => {
    w = null;
    paint();
    void read();
  });
  return { el, paint, read };
}
