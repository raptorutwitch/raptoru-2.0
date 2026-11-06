import { esc, ic, seg } from '../ds/ds.js';
import {
  searchViewers,
  nameOf,
  type ModItem,
  type ModJump,
  type ModModule,
} from '../mod/mod.js';
import type { CatalogModule } from '../module-host.js';

// Ce que les vues de la page Modération partagent : la lecture du Core, le contrat d'une vue, le filtre viewer.

export interface Round {
  raffle_id: string;
  status: string;
  kind: string;
  amount: number;
  currency?: { id: string; label: string; short_label?: string } | null;
  prize?: string | null;
  opened_at: string;
  duration_ms: number;
  remaining_ms: number;
  origin: string;
  outcome: string | null;
  titles?: Record<string, string[] | string>;
  participants: number;
  entries?: {
    viewer_id: string;
    display_name: string;
    source: string;
    created_at: string;
  }[];
  winners: {
    viewer_id: string;
    display_name: string;
    amount: number;
    payout_status: string;
    ledger_id: number | null;
    paid_at: string | null;
  }[];
}
export interface Overview {
  tts: {
    module_state: ModState;
    player_offline?: boolean;
    queue_full?: boolean;
    wait_ms?: number;
    current: ModItem | null;
    waiting: ModItem[];
    recent: ModItem[];
  };
  soundboard: {
    module_state: ModState;
    playing: ModItem[];
    waiting: ModItem[];
    recent: ModItem[];
  };
  bonk: { module_state: ModState; recent: ModItem[] };
  raffle: { module_state: ModState };
  raffle_v2: {
    module_state: ModState;
    round: Round | null;
    last: Round | null;
  } | null;
  global: { paused: boolean; refused?: number };
  me?: { role: string; grants: string[] };
}
export type ModState = 'active' | 'paused' | 'disabled';

export interface Ctx {
  o: Overview | null;
  err: string;
  lab: boolean;
  hosts: CatalogModule[] | null;
  go(j: ModJump): void;
}
export interface View {
  el: HTMLElement;
  /** Redessine à partir de ce qui est déjà lu. */
  paint(): void;
  /** Relit ce qui lui est propre (à chaque relevé tant qu'elle est visible). */
  read?(): Promise<unknown> | void;
  /** Posée par « Voir tout », un bouton de file, ou le clic d'un onglet (`j` vide). */
  enter?(j?: ModJump): void;
  /** Rend vrai si la touche a servi. */
  key?(e: KeyboardEvent): boolean;
  /** Une seconde a passé : minuteurs, barres. */
  tick?(): void;
  /** Le détail s'est refermé : la vue retire sa sélection. */
  closed?(): void;
}

export const MOD_OPTS = [
  ['tts', 'TTS'],
  ['soundboard', 'Sons'],
  ['bonk', 'Bonk'],
  ['raffle', 'Tombola'],
] as const;
export const MOD_KEYS = MOD_OPTS.map(([k]) => k) as ModModule[];

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600)
    return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Le filtre viewer d'une barre : un pseudo tapé filtre tout de suite (`typed`) et propose les viewers connus du Core
 * (liste native) ; un viewer reconnu devient une pastille (`picked`), retirée d'un clic.
 */
export function viewerField(
  bar: HTMLElement,
  o: {
    id: string;
    picked: () => string | null;
    typed: () => string;
    onType: (text: string) => void;
    onPick: (id: string | null) => void;
  },
) {
  let timer: ReturnType<typeof setTimeout>;
  let hits: { id: string; name: string }[] = [];
  bar.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-vq]')) return;
    o.onType(t.value);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const hit = hits.find(
        (h) => h.name.toLowerCase() === t.value.trim().toLowerCase(),
      );
      if (hit) return o.onPick(hit.id);
      void searchViewers(t.value).then(
        (l) => {
          hits = l.map((v) => ({ id: v.viewer_id, name: v.display_name }));
          const list = bar.querySelector(`#${o.id}`);
          if (list)
            list.innerHTML = hits
              .map((h) => `<option value="${esc(h.name)}"></option>`)
              .join('');
        },
        () => undefined,
      );
    }, 180);
  });
  bar.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-vx]')) o.onPick(null);
  });
  return {
    html: () => {
      const v = o.picked();
      return v
        ? `<button type="button" class="d-tag ok" data-vx title="Retirer ce filtre">${ic('user')}${esc(nameOf(v))} ${ic('x')}</button>`
        : `<label class="d-fld md-vf">${ic('user')}<input type="text" data-vq list="${o.id}" placeholder="Viewer" aria-label="Filtrer par viewer" autocomplete="off"></label><datalist id="${o.id}"></datalist>`;
    },
    /** À appeler après un dessin : le champ retrouve ce qui était tapé. */
    restore: () => {
      const i = bar.querySelector<HTMLInputElement>('[data-vq]');
      if (i && i !== document.activeElement) i.value = o.typed();
    },
  };
}

/** Les modules en segment, avec « Tout » ou d'autres premiers choix. */
export const moduleSeg = (
  attr: string,
  first: readonly (readonly [string, string])[],
  cur: string,
) => seg(attr, [...first, ...MOD_OPTS], cur);
