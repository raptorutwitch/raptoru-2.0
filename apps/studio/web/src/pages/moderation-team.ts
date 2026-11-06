import { ago, confirmBox, esc, ic, patch, pp, seg, sw } from '../ds/ds.js';
import { act, granted, modGet, PERMS, ROLE } from '../mod/mod.js';
import type { View } from './moderation-ui.js';

// L'équipe : un tableau croisé, une ligne par membre, une colonne par permission. Les mots surveillés : deux listes. Le Core
// garde les règles (personne ne modifie ses propres droits, un mod n'accorde que ce qu'il a).

interface Member {
  viewer_id: string;
  display_name: string;
  role: string;
  grants: string[];
  last_seen: string | null;
}

export function mountTeam(): View {
  const el = document.createElement('div');
  el.className = 'mv-team';
  let members: Member[] | null = null;
  let failed = false;
  const keys = Object.keys(PERMS);
  const read = async () => {
    try {
      members = (await modGet<{ members: Member[] }>('team')).members;
      failed = false;
    } catch {
      failed = true;
    }
    paint();
  };
  const line = (m: Member) => {
    const mod = m.role === 'moderator';
    return `<div class="mt-r" role="row"><span class="mt-who" role="cell">${pp(m.display_name, 26)}<span><b>${esc(m.display_name)}</b><small>${esc(ROLE[m.role] ?? m.role)}${m.last_seen ? ` · vu ${esc(ago(m.last_seen))}` : ''}</small></span></span>
      ${keys
        .map((p) => {
          const on = m.grants.includes(p);
          const can = mod && granted('perms') && granted(p);
          return `<span class="mt-c" role="cell">${sw(on, `data-p="${p}" data-v="${esc(m.viewer_id)}" data-name="${esc(m.display_name)}"`, `${PERMS[p]![0]} · ${m.display_name}`, { disabled: !can })}</span>`;
        })
        .join('')}
      <span class="mt-c" role="cell">${m.role === 'broadcaster' ? '' : `<button type="button" class="d-btn ghost sm" data-staff="${esc(m.viewer_id)}" data-name="${esc(m.display_name)}" data-role="${m.role === 'supermod' ? '' : 'supermod'}">${m.role === 'supermod' ? 'Retirer supermod' : 'Nommer supermod'}</button>`}</span></div>`;
  };
  function paint() {
    if (!members) {
      patch(
        el,
        `<div class="d-empty">${failed ? 'Équipe illisible pour le moment.' : 'Lecture…'}</div>`,
      );
      return;
    }
    patch(
      el,
      `<div class="mt" role="table" aria-label="Permissions de l’équipe" style="--cols:${keys.length}"><div class="mt-r mt-head" role="row"><span role="columnheader" class="d-lb">Membre</span>${keys.map((p) => `<span role="columnheader" class="mt-p" title="${esc(PERMS[p]![1])}">${esc(PERMS[p]![0])}</span>`).join('')}<span role="columnheader"></span></div>${members.map(line).join('')}</div>
      <p class="d-note">Streamer et supermods ont toutes les permissions. Un mod apparaît ici dès qu’il ouvre la modération dans l’extension (rôle Twitch).</p>`,
    );
  }
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.p) return;
    void act(
      null,
      {
        action: 'set_permission',
        viewer_id: t.dataset.v,
        permission: t.dataset.p,
        granted: t.checked,
      },
      `${PERMS[t.dataset.p]![0]} ${t.checked ? 'accordée à' : 'retirée à'} ${t.dataset.name}`,
    ).then(read);
  });
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-staff]');
    if (!b) return;
    const add = !!b.dataset.role;
    if (add) {
      const yes = await confirmBox({
        title: `Nommer ${b.dataset.name} supermod ?`,
        body: 'Un supermod a toutes les permissions : remboursements, Wallet, sanctions sensibles, pause globale.',
        yes: 'Nommer supermod',
        no: 'Annuler',
      });
      if (!yes) return;
    }
    await act(
      b,
      {
        action: 'set_staff',
        viewer_id: b.dataset.staff,
        role: b.dataset.role || null,
      },
      add ? `${b.dataset.name} nommé supermod` : 'Supermod retiré',
    );
    await read();
  });
  return { el, paint, read };
}

interface Word {
  id: number;
  word: string;
  kind: 'watch' | 'block';
  created_by?: string;
}
export function mountWords(): View {
  const el = document.createElement('div');
  el.className = 'mv-words';
  el.innerHTML = `<form class="mw-add" data-form><label class="d-fld"><input type="text" data-word maxlength="40" placeholder="Mot ou expression" aria-label="Nouveau mot"></label><span data-kind></span><button class="d-btn pri">${ic('plus')}Ajouter</button></form><div class="mw-cols" data-cols></div>`;
  const cols = el.querySelector<HTMLElement>('[data-cols]')!;
  const form = el.querySelector<HTMLFormElement>('[data-form]')!;
  let words: Word[] | null = null;
  let failed = false;
  let kind = 'watch';
  const read = async () => {
    try {
      words = (await modGet<{ words: Word[] }>('words')).words;
      failed = false;
    } catch {
      failed = true;
    }
    paint();
  };
  const col = (k: Word['kind'], title: string, hint: string) => {
    const l = (words ?? []).filter((w) => w.kind === k);
    return `<section class="mw-col"><h2 class="d-lb">${title} · ${l.length}</h2><p class="d-note">${hint}</p><div class="d-tags">${l.map((w) => `<button type="button" class="d-tag ${k === 'block' ? 'bad' : 'warn'}" data-w="${w.id}" data-t="${esc(w.word)}" title="Retirer « ${esc(w.word)} »">${esc(w.word)} ${ic('x')}</button>`).join('') || '<span class="d-faint">Aucun mot.</span>'}</div></section>`;
  };
  function paint() {
    patch(
      el.querySelector<HTMLElement>('[data-kind]'),
      seg(
        'data-k',
        [
          ['watch', 'À vérifier'],
          ['block', 'Bloqué'],
        ],
        kind,
      ),
    );
    patch(
      cols,
      words
        ? col(
            'watch',
            'À vérifier',
            'La demande est retenue jusqu’à ta décision.',
          ) +
            col(
              'block',
              'Bloqués',
              'La demande est refusée avant la file : rien n’est débité.',
            )
        : `<div class="d-empty">${failed ? 'Liste illisible pour le moment.' : 'Lecture…'}</div>`,
    );
  }
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b?.dataset.k) {
      kind = b.dataset.k;
      return paint();
    }
    if (b?.dataset.w)
      void act(
        b,
        { action: 'remove_word', word_id: Number(b.dataset.w) },
        `« ${b.dataset.t} » retiré`,
      ).then(read);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const i = form.querySelector<HTMLInputElement>('[data-word]')!;
    const word = i.value.trim();
    if (!word) return i.focus();
    i.value = '';
    void act(
      null,
      { action: 'add_word', word, kind },
      `« ${word} » ajouté`,
    ).then(read);
  });
  return { el, paint, read };
}
