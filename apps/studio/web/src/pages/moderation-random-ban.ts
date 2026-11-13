import {
  drawer,
  esc,
  hhmm,
  ic,
  keyed,
  patch,
  pop,
  run,
  seg,
} from '../ds/ds.js';
import { getJson, postJson } from '../http.js';
import {
  act,
  blockMenu,
  cooldownForm,
  openViewer,
  searchViewers,
} from '../mod/mod.js';
import { rbDetail, type RbView } from './sanctions-model.js';
import type { View } from './moderation-ui.js';

// Modération › Random Ban (refonte Mini-jeux 13/11) : chaque demande — qui l'a lancée, qui a été tiré, si la sanction a
// vraiment eu lieu, le pronostic Sniper — et ce que l'équipe peut faire. Le Core vérifie les droits, journalise
// (auteur, motif) et ne bouge l'argent qu'une fois ; Studio ne touche jamais Twitch lui-même. Blocages et délais sont
// ceux de la modération (module « random_ban ») : ils valent pour l'extension, !rb et les points de chaîne.

type Filter = 'all' | 'todo' | 'open' | 'sniper';
const FILTERS = [
  ['all', 'Tout'],
  ['todo', 'À traiter'],
  ['open', 'En cours'],
  ['sniper', 'Sniper'],
] as const;
const OPEN = ['queued', 'searching', 'timeout_requested'];
const SOURCE: Record<string, string> = {
  extension: 'Jetons · extension',
  chat: 'Jetons · !rb',
  channel_points: 'Points de chaîne',
  test: 'Test Studio',
};
const RESULT: Record<string, readonly [string, string]> = {
  queued: ['En file', 'warn'],
  searching: ['Tirage', 'warn'],
  timeout_requested: ['Sanction envoyée', 'warn'],
  confirmed: ['Sanction appliquée', 'ok'],
  flop: ['Personne d’éligible', ''],
  failed: ['Sans effet', 'bad'],
  uncertain: ['À vérifier sur Twitch', 'bad'],
  simulated: ['À blanc', ''],
  canceled: ['Annulé', ''],
};
const WHY: Record<string, string> = {
  timeout_incertain: 'Timeout incertain : vérifier sur Twitch',
  remboursement_en_attente: 'Remboursement en attente',
  prime_non_decidee: 'Prime Sniper pas encore décidée',
  sniper_a_resoudre: 'Pronostic Sniper à résoudre',
  demande_bloquee: 'Demande ouverte depuis plus de 2 min',
};

/** What a moderator should look at for this request (null: nothing). */
const todo = (r: RbView, recon: Map<string, string>) =>
  recon.get(r.request_id) ??
  (r.sniper === 'unresolved' && !OPEN.includes(r.status)
    ? 'sniper_a_resoudre'
    : null);

export function mountRandomBan(): View {
  const el = document.createElement('div');
  el.className = 'mrb';
  el.innerHTML = `<div class="mrb-bar"><span data-z="filters"></span><span class="d-sp"></span><span data-z="queue"></span></div>
    <div class="mrb-list" data-z="list"></div>`;
  const z = (k: string) => el.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  let filter: Filter = 'all';
  let rows: RbView[] = [];
  let recon = new Map<string, string>();
  let paused = false;
  let err = '';

  async function read() {
    try {
      const h = await getJson<{ paused: boolean; requests: RbView[] }>(
        '/api/random-ban/moderation/history',
      );
      rows = h.requests;
      paused = h.paused;
      const r = await getJson<{ items: { why: string; request: RbView }[] }>(
        '/api/random-ban/moderation/reconciliation',
      );
      recon = new Map(r.items.map((x) => [x.request.request_id, x.why]));
      err = '';
    } catch (e) {
      err = (e as Error).message;
    }
    paint();
  }

  const visible = () =>
    rows.filter((r) =>
      filter === 'todo'
        ? !!todo(r, recon)
        : filter === 'open'
          ? OPEN.includes(r.status)
          : filter === 'sniper'
            ? !!r.wish
            : true,
    );

  function line(r: RbView) {
    const [label, tone] = RESULT[r.status] ?? [r.status, ''];
    const why = todo(r, recon);
    const sn = r.wish
      ? `<small class="mrb-sn ${r.sniper === 'hit' ? 'ok' : r.sniper === 'unresolved' ? 'warn' : ''}">🎯 ${esc(r.wish.name ?? `« ${r.wish.text ?? '?'} »`)}${r.sniper === 'hit' ? ' · touché' : r.sniper === 'unresolved' ? ' · à résoudre' : ''}</small>`
      : '';
    return `<button type="button" class="mrb-l d-in" data-rq="${esc(r.request_id)}">
      <time>${esc(hhmm(r.created_at))}</time>
      <span class="mrb-who"><b>${esc(r.buyer.name)}</b> → ${r.target ? `<b>${esc(r.target.name ?? r.target.id)}</b>` : '<i>—</i>'}</span>
      <span class="mrb-src">${esc(SOURCE[r.source] ?? r.source)}${Number.isInteger(r.price_paid) ? ` · ${r.price_paid!.toLocaleString('fr-FR')}` : ''}</span>
      <span class="mrb-end">${sn}<span class="d-tag ${tone}">${label}</span>${why ? `<span class="d-tag bad">${esc(WHY[why] ?? why)}</span>` : ''}</span>
    </button>`;
  }

  function paint() {
    const n = rows.filter((r) => todo(r, recon)).length;
    patch(
      z('filters'),
      seg(
        'data-f',
        FILTERS.map(
          ([k, l]) =>
            [
              k,
              k === 'todo' && n ? `${l} <em class="warn">${n}</em>` : l,
            ] as const,
        ),
        filter,
      ),
    );
    patch(
      z('queue'),
      paused
        ? `<span class="d-tag warn">File en pause</span> <button type="button" class="d-btn sm" data-queue="resume">Reprendre…</button>`
        : `<button type="button" class="d-btn ghost sm" data-queue="pause">${ic('pause')}Pause de la file…</button>`,
    );
    keyed(
      z('list'),
      visible().map((r) => ({ key: r.request_id, html: line(r) })),
      `<div class="d-empty">${err ? esc(err) : filter === 'todo' ? 'Rien à traiter.' : 'Aucun Random Ban.'}</div>`,
    );
  }

  /** The actions this request allows (the Core checks again, and refuses what is no longer possible). */
  function actions(r: RbView) {
    const b = (a: string, label: string, cls = 'warn') =>
      `<button type="button" class="d-btn ${cls} sm" data-a="${a}">${label}</button>`;
    const impossible: string[] = [];
    if (r.status === 'uncertain' && r.refund === 'to_verify')
      impossible.push(
        'Vérifie sur Twitch que le timeout n’a PAS eu lieu avant de rembourser.',
      );
    if (r.source === 'channel_points' && !r.redemption_id)
      impossible.push(
        'Rachat sans référence Twitch : à rembourser dans la file des récompenses de Twitch.',
      );
    return {
      foot: [
        r.status === 'queued' && r.source !== 'test'
          ? b('cancel', 'Annuler et rembourser…')
          : '',
        r.status === 'uncertain' && r.refund === 'to_verify'
          ? b('refund_uncertain', 'Rembourser les Jetons (vérifié)…')
          : '',
        r.redemption_id &&
        ['failed', 'uncertain', 'canceled', 'flop'].includes(r.status)
          ? b('refund_points', 'Rembourser les points (Twitch)…')
          : '',
        r.sniper === 'unresolved'
          ? b('resolve', 'Résoudre le Sniper…', 'pri')
          : '',
        r.sniper === 'hit' ? b('revoke_bonus', 'Retirer la prime…') : '',
        b('block', `${ic('ban')}Bloquer ${esc(r.buyer.name)}…`, 'ghost'),
        b('cooldown', `${ic('clock')}Délai Random Ban…`, 'ghost'),
        b('lift', 'Lever blocage et délai…', 'ghost'),
        `<button type="button" class="d-btn ghost sm" data-see="${esc(r.buyer.id)}">${ic('user')}Fiche</button>`,
      ].join(''),
      note: impossible.length
        ? `<p class="d-note bad">${impossible.map(esc).join('<br>')}</p>`
        : '',
    };
  }

  const reasonOf = (title: string) => {
    const reason = window.prompt(
      `${title}\n\nMotif (obligatoire, gardé dans l’historique de modération) :`,
      '',
    );
    return reason?.trim() || null;
  };
  const rbAct = (
    btn: HTMLElement,
    command: Record<string, unknown>,
    done: string,
  ) =>
    run(
      btn,
      () => postJson('/api/random-ban/moderation/act', { command }),
      done,
    );

  function resolveForm(anchor: HTMLElement, r: RbView) {
    const typed = r.wish?.text ?? '';
    const box = pop(
      anchor,
      `<h3>Résoudre le Sniper</h3>
      <p class="d-note">Tapé par ${esc(r.buyer.name)} : <b>« ${esc(typed)} »</b>. Choisis le compte qu’il visait, ou « Aucun ». Le tirage ne change pas ; une prime n’est versée qu’une fois.</p>
      <label class="d-fld">${ic('search')}<input type="search" data-q value="${esc(typed)}" aria-label="Chercher un viewer" autocomplete="off"></label>
      <div class="mrb-hits" data-hits></div>
      <button type="button" class="d-btn ghost sm" data-none>Aucun compte : pronostic sans effet</button>`,
      undefined,
      { cls: 'd-form m-form' },
    );
    const hits = box.querySelector<HTMLElement>('[data-hits]')!;
    const search = async (q: string) => {
      const l = q.trim() ? await searchViewers(q).catch(() => []) : [];
      hits.innerHTML = l.length
        ? l
            .slice(0, 8)
            .map(
              (v) =>
                `<button type="button" class="d-btn ghost sm" data-v="${esc(v.viewer_id)}" data-n="${esc(v.display_name)}">${esc(v.display_name)}</button>`,
            )
            .join('')
        : '<small>Aucun viewer connu pour ce texte.</small>';
    };
    void search(typed);
    box.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.matches('[data-q]')) void search(t.value);
    });
    box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const v = t.closest<HTMLElement>('[data-v]');
      if (!v && !t.closest('[data-none]')) return;
      const reason = reasonOf(
        v
          ? `Attribuer le pronostic à ${v.dataset.n} ?`
          : 'Déclarer ce pronostic sans compte (sans effet) ?',
      );
      if (!reason) return;
      box.hidePopover();
      void rbAct(
        anchor,
        {
          action: 'resolve_sniper',
          request_id: r.request_id,
          viewer_id: v?.dataset.v ?? null,
          reason,
        },
        v
          ? `Pronostic attribué à ${v.dataset.n}`
          : 'Pronostic déclaré sans effet',
      ).then(() => read());
    });
  }

  function open(r: RbView) {
    const a = actions(r);
    const d = drawer({
      kicker: `Random Ban · ${hhmm(r.created_at)}`,
      title: `${r.buyer.name} → ${r.target?.name ?? '—'}`,
      body: `${a.note}${rbDetail(r)}`,
      foot: a.foot,
    });
    d.el.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const see = t.closest<HTMLElement>('[data-see]')?.dataset.see;
      if (see) return openViewer(see);
      const btn = t.closest<HTMLElement>('[data-a]');
      if (!btn) return;
      const id = r.buyer.id;
      const name = r.buyer.name;
      switch (btn.dataset.a) {
        case 'block':
          return blockMenu(btn, id, name, 'random_ban');
        case 'cooldown':
          return cooldownForm(btn, id, name, 'random_ban');
        case 'lift': {
          const reason = reasonOf(
            `Lever le blocage et le délai Random Ban de ${name} ?`,
          );
          if (!reason) return;
          await act(
            btn,
            {
              action: 'unblock_viewer',
              viewer_id: id,
              module: 'random_ban',
              reason,
            },
            `${name} · blocage Random Ban levé`,
          ).catch(() => {});
          await act(
            btn,
            {
              action: 'clear_cooldown',
              viewer_id: id,
              module: 'random_ban',
              reason,
            },
            `${name} · délai Random Ban levé`,
          ).catch(() => {});
          return;
        }
        case 'resolve':
          return resolveForm(btn, r);
        case 'refund_points': {
          const reason = reasonOf(
            'Rembourser ses points de chaîne via Twitch ? Seulement sur une récompense créée par Raptoru ; sinon, à faire dans la file de Twitch.',
          );
          if (!reason) return;
          const ok = await run(
            btn,
            () =>
              postJson(
                `/api/channel-points/redemptions/twitch/${encodeURIComponent(r.redemption_id!)}/refund`,
                { reason },
              ),
            'Remboursement des points demandé à Twitch',
          );
          if (ok) void read();
          return;
        }
        default: {
          const label = {
            cancel:
              'Annuler cette demande en attente ? L’acheteur est remboursé une fois.',
            refund_uncertain:
              'Rembourser ce résultat incertain ? Seulement si tu as vérifié sur Twitch que le timeout n’a PAS eu lieu.',
            revoke_bonus: 'Retirer la prime Sniper de ce viewer ?',
          }[btn.dataset.a!];
          if (!label) return;
          const reason = reasonOf(label);
          if (!reason) return;
          const ok = await rbAct(
            btn,
            { action: btn.dataset.a, request_id: r.request_id, reason },
            'Fait',
          );
          if (ok) {
            d.el.close();
            void read();
          }
        }
      }
    });
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-f]')?.dataset.f as
      Filter | undefined;
    if (f) {
      filter = f;
      return paint();
    }
    const q = t.closest<HTMLElement>('[data-queue]')?.dataset.queue;
    if (q) {
      const reason = reasonOf(
        q === 'pause'
          ? 'Mettre la file Random Ban en pause ? Plus aucun achat ; le bot ne prend rien.'
          : 'Reprendre la file Random Ban ?',
      );
      if (reason)
        void rbAct(
          t.closest('button')!,
          { action: q, reason },
          q === 'pause' ? 'File en pause' : 'File reprise',
        ).then(() => read());
      return;
    }
    const id = t.closest<HTMLElement>('[data-rq]')?.dataset.rq;
    const r = id && rows.find((x) => x.request_id === id);
    if (r) open(r);
  });

  return { el, paint, read };
}
