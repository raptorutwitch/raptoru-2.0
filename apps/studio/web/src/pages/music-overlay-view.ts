import { esc, ic, sw } from '../ds/ds.js';

// Overlay musique — partie pure de l'éditeur (docs/music/MUSIC_OVERLAYS.md) : la bibliothèque de modèles, les réglages
// (l'essentiel d'abord, le reste replié), l'assistant OBS. Le rendu de l'overlay lui-même n'est PAS ici : l'aperçu est la
// vraie page OBS dans un cadre (le même code, le même résultat), nourrie par l'éditeur. La démo ne quitte jamais ce cadre.

export type Archetype =
  'minimal' | 'clean' | 'glass' | 'neon' | 'editorial' | 'focus';

export interface MoSettings {
  archetype: Archetype;
  size: 'compact' | 'standard' | 'large';
  width: number;
  position: string;
  margin: number;
  align: 'start' | 'center' | 'end';
  orientation: 'horizontal' | 'vertical';
  radius: number;
  spacing: 'tight' | 'normal' | 'airy';
  cover: {
    show: boolean;
    size: 'small' | 'medium' | 'large';
    shape: 'square' | 'rounded' | 'circle';
  };
  palette: string;
  colors: {
    accent: string;
    text: string;
    muted: string;
    background: string;
    opacity: number;
    border: boolean;
    shadow: number;
    gradient: boolean;
    auto_accent: boolean;
  };
  font: 'moderne' | 'condensee' | 'editoriale' | 'mono';
  title_scale: number;
  artist_scale: number;
  weight: 'regular' | 'bold' | 'black';
  long_text: 'scroll' | 'wrap' | 'ellipsis';
  show: Record<
    | 'label'
    | 'title'
    | 'artist'
    | 'album'
    | 'progress'
    | 'time'
    | 'requester'
    | 'request_badge'
    | 'pause_state',
    boolean
  >;
  animation: {
    enter: 'none' | 'fade' | 'slide' | 'rise' | 'scale';
    change: 'none' | 'crossfade' | 'slide' | 'flip' | 'pop';
    intensity: 'subtle' | 'normal' | 'strong';
    duration_ms: number;
    ambient: boolean;
  };
  display: {
    mode: 'always' | 'announce' | 'hybrid';
    announce_s: number;
    on_pause: 'show' | 'dim' | 'compact' | 'hide';
    on_idle: 'hide' | 'placeholder';
    request_spotlight: boolean;
  };
}

export interface MoBuiltin {
  id: string;
  name: string;
  description: string;
  settings: MoSettings;
}
export interface MoVariant {
  id: string;
  name: string;
  base: string;
  settings: MoSettings;
  updated_at: string;
}
export interface MoLive {
  state: 'playing' | 'paused' | 'stale' | 'lost' | 'off' | 'none';
  gen: number;
  track: {
    title: string;
    artists: string[];
    album: string | null;
    duration_ms: number | null;
  } | null;
  position_ms: number | null;
  cover: string | null;
  request: { by: string | null } | null;
}
export interface MoState {
  version: number;
  visible: boolean;
  preset: { id: string; name: string; settings: MoSettings };
  live: MoLive;
  pulse: number;
  url: string;
  builtins: MoBuiltin[];
  variants: MoVariant[];
  palettes: Record<
    string,
    {
      label: string;
      accent: string;
      text: string;
      muted: string;
      background: string;
    }
  >;
  repaired: string[];
}
export interface MoObs {
  connected: boolean;
  installed: boolean;
  url_ok: boolean;
  scenes: string[];
  program_scene: string | null;
  on_program: boolean;
  scene_names: string[];
  canvas: { width: number; height: number } | null;
  error: string | null;
}

export const ARCH_LABEL: Record<Archetype, string> = {
  minimal: 'Flottant',
  clean: 'Cartouche',
  glass: 'Verre',
  neon: 'Néon',
  editorial: 'Éditorial',
  focus: 'Projecteur',
};

// --- Démo (le cadre de l'éditeur seulement) ------------------------------------------------------------------------------

const cover = (h1: number, h2: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 70% 55%)"/><stop offset="1" stop-color="hsl(${h2} 60% 25%)"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><circle cx="6.5" cy="4" r="2.6" fill="hsl(${h2} 80% 72%)" opacity=".85"/></svg>`)}`;

export const DEMOS = {
  normal: {
    label: 'Normal',
    live: {
      state: 'playing',
      gen: 101,
      track: {
        title: 'Nuit Blanche',
        artists: ['Lune Rouge'],
        album: 'Néons',
        duration_ms: 222_000,
      },
      position_ms: 71_000,
      cover: cover(330, 260),
      request: null,
    },
  },
  long: {
    label: 'Titre très long',
    live: {
      state: 'playing',
      gen: 102,
      track: {
        title:
          'Un titre au nom vraiment très long pour vérifier que rien ne déborde (Version Longue Remasterisée)',
        artists: ['Orchestre Halcyon', 'Ava Solène', 'DJ Orbite'],
        album: 'Odyssée — Édition Deluxe Intégrale',
        duration_ms: 750_000,
      },
      position_ms: 200_000,
      cover: cover(200, 140),
      request: null,
    },
  },
  request: {
    label: 'Demande viewer',
    live: {
      state: 'playing',
      gen: 103,
      track: {
        title: 'Raptor Run',
        artists: ['The Velociraptors'],
        album: 'Jurassic Garage',
        duration_ms: 168_000,
      },
      position_ms: 9_000,
      cover: cover(20, 350),
      request: { by: 'Viewer_Lab' },
    },
  },
  paused: {
    label: 'En pause',
    live: {
      state: 'paused',
      gen: 104,
      track: {
        title: 'Velours',
        artists: ['Mira'],
        album: 'Satin',
        duration_ms: 252_000,
      },
      position_ms: 140_000,
      cover: null,
      request: null,
    },
  },
  idle: {
    label: 'Spotify fermé',
    live: {
      state: 'lost',
      gen: 105,
      track: null,
      position_ms: null,
      cover: null,
      request: null,
    },
  },
} satisfies Record<string, { label: string; live: MoLive }>;
export type DemoId = keyof typeof DEMOS;

export const BACKDROPS = [
  ['dark', 'Jeu sombre'],
  ['light', 'Jeu clair'],
  ['busy', 'Jeu chargé'],
  ['check', 'Transparent'],
] as const;

// --- Bibliothèque ------------------------------------------------------------------------------------------------------

/** Les modèles prêts (un cadre de prévisualisation chacun) et les variantes du streamer. */
export function libraryView(s: MoState, sel: string) {
  const onAir = s.preset.id;
  const card = (id: string, name: string, sub: string, arch: Archetype) =>
    `<button type="button" class="mox-card ${id === sel ? 'is-sel' : ''}" data-pick="${esc(id)}" aria-pressed="${id === sel}">
      <span class="mox-card__frame"><iframe data-card="${esc(id)}" src="/music-overlay/overlay.html?card=1" title="${esc(name)}" tabindex="-1" loading="lazy"></iframe></span>
      <span class="mox-card__t"><b>${esc(name)}</b>${id === onAir ? '<span class="d-tag ok">À l’antenne</span>' : ''}</span>
      <small>${esc(sub || ARCH_LABEL[arch])}</small>
    </button>`;
  const mine = s.variants
    .map(
      (v) =>
        `<li><button type="button" class="mox-var ${v.id === sel ? 'is-sel' : ''}" data-pick="${esc(v.id)}" aria-pressed="${v.id === sel}">
        <span class="mox-dot" style="--c:${esc(v.settings.colors.accent)}"></span>
        <span class="mox-var__t"><b>${esc(v.name)}</b><small>${esc(ARCH_LABEL[v.settings.archetype])}</small></span>
        ${v.id === onAir ? '<span class="d-tag ok">À l’antenne</span>' : ''}
      </button></li>`,
    )
    .join('');
  return `<h2 class="d-lb">Mes variantes</h2>
    ${mine ? `<ul class="mox-vars">${mine}</ul>` : '<p class="mox-note">Modifie un modèle : ta variante est créée et enregistrée toute seule.</p>'}
    <h2 class="d-lb">Modèles</h2>
    <div class="mox-cards">${s.builtins.map((b) => card(b.id, b.name, b.description, b.settings.archetype)).join('')}</div>`;
}

// --- Barre de l'aperçu ---------------------------------------------------------------------------------------------------

export function stageBar(o: {
  source: 'real' | 'demo';
  demo: DemoId;
  backdrop: string;
  zoom: boolean;
  live: MoLive | null;
}) {
  const seg = (
    attr: string,
    opts: readonly (readonly [string, string])[],
    cur: string,
  ) =>
    `<span class="d-seg mox-seg" style="--n:${opts.length};--i:${Math.max(
      0,
      opts.findIndex(([k]) => k === cur),
    )}" role="group">${opts
      .map(
        ([k, l]) =>
          `<button type="button" ${attr}="${esc(k)}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${esc(l)}</button>`,
      )
      .join('')}</span>`;
  const real = o.live?.track
    ? `${o.live.state === 'paused' ? 'En pause' : 'En cours'} : « ${esc(o.live.track.title)} »`
    : 'Aucune musique relevée pour l’instant';
  return `<div class="mox-bar">
      ${seg(
        'data-src',
        [
          ['real', 'Morceau réel'],
          ['demo', 'Démo'],
        ],
        o.source,
      )}
      ${
        o.source === 'demo'
          ? `<span class="mox-chips">${(Object.keys(DEMOS) as DemoId[])
              .map(
                (k) =>
                  `<button type="button" class="d-tag ${k === o.demo ? 'add on' : ''}" data-demo="${k}" aria-pressed="${k === o.demo}">${esc(DEMOS[k].label)}</button>`,
              )
              .join('')}</span>`
          : `<span class="mox-real">${ic('music')}${real}</span>`
      }
      <span class="d-sp"></span>
      <button type="button" class="d-btn ghost sm" data-act="mox-replay" title="Rejoue l’apparition et le changement de titre dans l’aperçu seulement">${ic('play')}Rejouer l’animation</button>
      ${seg('data-bg', BACKDROPS, o.backdrop)}
      ${seg(
        'data-zoom',
        [
          ['0', 'Écran entier'],
          ['1', 'Zoom'],
        ],
        o.zoom ? '1' : '0',
      )}
    </div>`;
}

// --- Réglages ----------------------------------------------------------------------------------------------------------

const segOf = (
  path: string,
  opts: readonly (readonly [string, string])[],
  cur: string,
) =>
  `<span class="d-seg mox-seg" style="--n:${opts.length};--i:${Math.max(
    0,
    opts.findIndex(([k]) => k === cur),
  )}" role="group">${opts
    .map(
      ([k, l]) =>
        `<button type="button" data-seg="${path}" data-v="${esc(k)}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${esc(l)}</button>`,
    )
    .join('')}</span>`;
const line = (label: string, ctl: string, hint = '') =>
  `<div class="mox-row"><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span>${ctl}</div>`;
const range = (
  path: string,
  v: number,
  min: number,
  max: number,
  step: number,
  unit: string,
  label: string,
) =>
  `<label class="mox-range"><input type="range" data-num="${path}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(label)}"><b>${v}${esc(unit)}</b></label>`;
const toggle = (path: string, on: boolean, label: string) =>
  sw(on, `data-bool="${path}"`, label);
const select = (
  path: string,
  opts: readonly (readonly [string, string])[],
  cur: string,
  label: string,
) =>
  `<label class="d-fld mox-sel"><select data-pick-set="${path}" aria-label="${esc(label)}">${opts
    .map(
      ([k, l]) =>
        `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`,
    )
    .join('')}</select></label>`;
const color = (path: string, v: string, label: string) =>
  `<label class="mox-color"><input type="color" data-color="${path}" value="${esc(v)}" aria-label="${esc(label)}"><code>${esc(v)}</code></label>`;

const POSITIONS = [
  ['top-left', 'En haut à gauche'],
  ['top-center', 'En haut au centre'],
  ['top-right', 'En haut à droite'],
  ['middle-left', 'Au milieu à gauche'],
  ['', ''],
  ['middle-right', 'Au milieu à droite'],
  ['bottom-left', 'En bas à gauche'],
  ['bottom-center', 'En bas au centre'],
  ['bottom-right', 'En bas à droite'],
] as const;

const SHOWS: [keyof MoSettings['show'], string][] = [
  ['title', 'Titre'],
  ['artist', 'Artiste'],
  ['album', 'Album'],
  ['progress', 'Progression'],
  ['time', 'Temps'],
  ['label', '« En cours »'],
  ['request_badge', 'Badge demande'],
  ['requester', 'Pseudo du viewer'],
  ['pause_state', 'État pause'],
];

/** Les réglages d'un preset : l'essentiel, puis les détails repliés (la recherche du navigateur les retrouve). */
export function settingsView(
  st: MoState,
  sel: { id: string; name: string; builtin: boolean; settings: MoSettings },
  save: { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string },
) {
  const s = sel.settings;
  const pal = Object.entries(st.palettes)
    .map(
      ([k, p]) =>
        `<button type="button" class="mox-swatch ${s.palette === k ? 'on' : ''}" data-palette="${esc(k)}" aria-pressed="${s.palette === k}" title="${esc(p.label)}" style="--a:${esc(p.accent)};--b:${esc(p.background)};--t:${esc(p.text)}"><i></i><span>${esc(p.label)}</span></button>`,
    )
    .join('');
  const pos = POSITIONS.map(([k, l]) =>
    k
      ? `<button type="button" class="${s.position === k ? 'on' : ''}" data-seg="position" data-v="${k}" aria-pressed="${s.position === k}" aria-label="${esc(l)}" title="${esc(l)}"><i></i></button>`
      : '<span></span>',
  ).join('');
  const shows = SHOWS.map(
    ([k, l]) =>
      `<label class="mox-chk"><input type="checkbox" data-bool="show.${k}" ${s.show[k] ? 'checked' : ''}><span>${esc(l)}</span></label>`,
  ).join('');
  const orientable =
    s.archetype === 'clean' ||
    s.archetype === 'glass' ||
    s.archetype === 'focus';
  const saved =
    save.state === 'saving'
      ? '<span class="mox-saved">Enregistrement…</span>'
      : save.state === 'saved'
        ? `<span class="mox-saved ok">${ic('check')}Enregistré</span>`
        : save.state === 'error'
          ? `<span class="mox-saved bad">${ic('warn')}Non enregistré : ${esc(save.error ?? 'erreur')}</span>`
          : '';
  const head = `<div class="mox-sethead">
      <div><span class="d-lb">${sel.builtin ? 'Modèle' : 'Ma variante'} · ${esc(ARCH_LABEL[s.archetype])}</span><h2>${esc(sel.name)}</h2></div>
      ${saved}
    </div>
    ${sel.builtin ? '<p class="mox-note">Modèle prêt à l’emploi. Change un réglage : une variante à ton nom est créée, le modèle reste intact.</p>' : ''}
    <div class="mox-actions">
      ${st.preset.id === sel.id ? '<span class="d-tag ok">À l’antenne</span>' : `<button type="button" class="d-btn pri sm" data-act="mox-onair">${ic('play')}Mettre à l’antenne</button>`}
      <button type="button" class="d-btn ghost sm" data-act="mox-dup">Dupliquer</button>
      ${sel.builtin ? '' : '<button type="button" class="d-btn ghost sm" data-act="mox-rename">Renommer</button><button type="button" class="d-btn ghost sm" data-act="mox-reset">Valeurs par défaut</button><button type="button" class="d-btn ghost sm danger" data-act="mox-delete">Supprimer</button>'}
    </div>`;
  const essentials = `<section class="mox-grp"><h3>Essentiel</h3>
      ${line(
        'Taille',
        segOf(
          'size',
          [
            ['compact', 'Compacte'],
            ['standard', 'Standard'],
            ['large', 'Grande'],
          ],
          s.size,
        ),
      )}
      ${line('Position', `<span class="mox-pos" role="group" aria-label="Position">${pos}</span>`)}
      ${line(
        'Affichage',
        segOf(
          'display.mode',
          [
            ['always', 'Toujours'],
            ['announce', 'Annonce'],
            ['hybrid', 'Hybride'],
          ],
          s.display.mode,
        ),
        s.display.mode === 'always'
          ? 'Visible tant que la musique joue.'
          : s.display.mode === 'announce'
            ? 'Apparaît à chaque nouveau titre, puis s’efface.'
            : 'Compact en permanence, agrandi à chaque nouveau titre.',
      )}
      ${s.display.mode === 'always' ? '' : line('Durée de l’annonce', range('display.announce_s', s.display.announce_s, 3, 60, 1, ' s', 'Durée de l’annonce'))}
      ${line(
        'En pause',
        select(
          'display.on_pause',
          [
            ['show', 'Montrer « En pause »'],
            ['dim', 'Estomper'],
            ['compact', 'Réduire'],
            ['hide', 'Cacher'],
          ],
          s.display.on_pause,
          'En pause',
        ),
      )}
      ${line(
        'Rien ne joue',
        segOf(
          'display.on_idle',
          [
            ['hide', 'Cacher'],
            ['placeholder', '« Aucune musique »'],
          ],
          s.display.on_idle,
        ),
      )}
      ${line('Mettre en avant une demande', toggle('display.request_spotlight', s.display.request_spotlight, 'Mettre en avant une demande'), 'Une demande qui commence est toujours annoncée.')}
      ${line('Pochette', toggle('cover.show', s.cover.show, 'Pochette'))}
    </section>
    <section class="mox-grp"><h3>Couleurs</h3>
      <div class="mox-swatches">${pal}${s.palette === 'custom' ? '<span class="mox-swatch on is-custom"><i></i><span>Perso</span></span>' : ''}</div>
      ${line('Accent tiré de la pochette', toggle('colors.auto_accent', s.colors.auto_accent, 'Accent tiré de la pochette'), 'Change à chaque titre ; sinon l’accent de la palette.')}
    </section>
    <section class="mox-grp"><h3>Contenu</h3><div class="mox-chks">${shows}</div></section>`;
  const adv = (title: string, bodyHtml: string) =>
    `<details class="mox-adv"><summary>${esc(title)}</summary><div>${bodyHtml}</div></details>`;
  const advanced = `<h3 class="mox-advh">Réglages avancés</h3>
    ${adv(
      'Couleurs en détail',
      `${line('Accent', color('colors.accent', s.colors.accent, 'Accent'))}
       ${line('Texte', color('colors.text', s.colors.text, 'Texte'))}
       ${line('Texte secondaire', color('colors.muted', s.colors.muted, 'Texte secondaire'))}
       ${line('Fond', color('colors.background', s.colors.background, 'Fond'))}
       ${line('Opacité du fond', range('colors.opacity', s.colors.opacity, 0, 100, 1, ' %', 'Opacité du fond'))}
       ${line('Dégradé', toggle('colors.gradient', s.colors.gradient, 'Dégradé'))}
       ${line('Bordure', toggle('colors.border', s.colors.border, 'Bordure'))}
       ${line('Ombre', range('colors.shadow', s.colors.shadow, 0, 3, 1, '', 'Ombre'))}`,
    )}
    ${adv(
      'Typographie',
      `${line(
        'Police',
        select(
          'font',
          [
            ['moderne', 'Moderne'],
            ['condensee', 'Condensée'],
            ['editoriale', 'Éditoriale'],
            ['mono', 'Machine'],
          ],
          s.font,
          'Police',
        ),
      )}
       ${line('Taille du titre', range('title_scale', s.title_scale, 70, 160, 5, ' %', 'Taille du titre'))}
       ${line('Taille de l’artiste', range('artist_scale', s.artist_scale, 70, 160, 5, ' %', 'Taille de l’artiste'))}
       ${line(
         'Graisse',
         segOf(
           'weight',
           [
             ['regular', 'Normale'],
             ['bold', 'Grasse'],
             ['black', 'Très grasse'],
           ],
           s.weight,
         ),
       )}
       ${line(
         'Textes trop longs',
         segOf(
           'long_text',
           [
             ['scroll', 'Défiler'],
             ['wrap', '2 lignes'],
             ['ellipsis', '« … »'],
           ],
           s.long_text,
         ),
       )}`,
    )}
    ${adv(
      'Disposition',
      `${line('Largeur', range('width', s.width, 220, 1100, 10, ' px', 'Largeur'))}
       ${line('Marge au bord', range('margin', s.margin, 0, 240, 2, ' px', 'Marge au bord'))}
       ${line(
         'Alignement',
         segOf(
           'align',
           [
             ['start', 'Début'],
             ['center', 'Centre'],
             ['end', 'Fin'],
           ],
           s.align,
         ),
       )}
       ${
         orientable
           ? line(
               'Orientation',
               segOf(
                 'orientation',
                 [
                   ['horizontal', 'Horizontale'],
                   ['vertical', 'Verticale'],
                 ],
                 s.orientation,
               ),
             )
           : ''
       }
       ${line('Arrondis', range('radius', s.radius, 0, 48, 1, ' px', 'Arrondis'))}
       ${line(
         'Espacement',
         segOf(
           'spacing',
           [
             ['tight', 'Serré'],
             ['normal', 'Normal'],
             ['airy', 'Aéré'],
           ],
           s.spacing,
         ),
       )}
       ${line(
         'Taille de la pochette',
         segOf(
           'cover.size',
           [
             ['small', 'Petite'],
             ['medium', 'Moyenne'],
             ['large', 'Grande'],
           ],
           s.cover.size,
         ),
       )}
       ${line(
         'Forme de la pochette',
         segOf(
           'cover.shape',
           [
             ['square', 'Carrée'],
             ['rounded', 'Arrondie'],
             ['circle', 'Ronde'],
           ],
           s.cover.shape,
         ),
       )}`,
    )}
    ${adv(
      'Animation',
      `${line(
        'Apparition',
        select(
          'animation.enter',
          [
            ['none', 'Aucune'],
            ['fade', 'Fondu'],
            ['slide', 'Glissement'],
            ['rise', 'Montée'],
            ['scale', 'Zoom léger'],
          ],
          s.animation.enter,
          'Apparition',
        ),
      )}
       ${line(
         'Nouveau titre',
         select(
           'animation.change',
           [
             ['none', 'Aucune'],
             ['crossfade', 'Fondu enchaîné'],
             ['slide', 'Défilement'],
             ['flip', 'Pochette retournée'],
             ['pop', 'Rebond'],
           ],
           s.animation.change,
           'Nouveau titre',
         ),
       )}
       ${line(
         'Intensité',
         segOf(
           'animation.intensity',
           [
             ['subtle', 'Subtile'],
             ['normal', 'Normale'],
             ['strong', 'Marquée'],
           ],
           s.animation.intensity,
         ),
       )}
       ${line('Durée', range('animation.duration_ms', s.animation.duration_ms, 150, 1500, 10, ' ms', 'Durée'))}
       ${line('Lueur décorative', toggle('animation.ambient', s.animation.ambient, 'Lueur décorative'), 'Une respiration lente, décorative : elle ne suit pas l’audio.')}`,
    )}
    <p class="mox-note">Les animations s’arrêtent si le système demande moins de mouvement.</p>`;
  return `${head}${essentials}${advanced}`;
}

// --- OBS (panneau) -----------------------------------------------------------------------------------------------------

export const OBS_ERRORS: Record<string, string> = {
  obs_offline: 'OBS n’est pas connecté à Studio (Studio › Système › OBS).',
  obs_timeout: 'OBS ne répond pas.',
  obs_name_taken:
    'Une autre source porte déjà le nom « Raptoru · Musique » : renomme-la dans OBS.',
  obs_not_found: 'OBS ne trouve plus cet élément.',
  obs_refused: 'OBS a refusé l’action.',
  obs_not_confirmed:
    'OBS n’a pas confirmé : rien n’est considéré comme installé.',
  not_installed: 'La source n’est pas encore installée.',
  unknown_scene: 'Cette scène n’existe plus dans OBS.',
  overlays_unavailable: 'Overlay indisponible dans ce Studio.',
  invalid_overlay: 'Réglage refusé (valeur hors limites).',
  unknown_preset: 'Ce preset n’existe plus.',
  name_required: 'Donne un nom à la variante.',
  too_many_variants: 'Trop de variantes (40 au plus).',
};

export function obsView(o: MoObs | null, url: string, visible: boolean) {
  const step = (done: boolean, title: string, body: string) =>
    `<li class="mox-step ${done ? 'is-done' : ''}"><span class="mox-step__n">${done ? ic('check') : ''}</span><div><b>${esc(title)}</b>${body}</div></li>`;
  if (!o) return '<p class="mox-note">Lecture de l’état d’OBS…</p>';
  const scenes = o.scene_names
    .map(
      (n) =>
        `<option value="${esc(n)}" ${n === o.program_scene ? 'selected' : ''}>${esc(n)}${n === o.program_scene ? ' (à l’antenne)' : ''}</option>`,
    )
    .join('');
  const where = o.scenes.length
    ? `Présente dans : ${o.scenes.map((s) => `« ${esc(s)} »`).join(', ')}.`
    : 'Dans aucune scène pour l’instant.';
  return `<div class="mox-obs">
    <p class="mox-note">Une seule source navigateur pour tous les modèles : changer de preset ou afficher / masquer se fait ici, sans toucher OBS.</p>
    <ol class="mox-steps">
      ${step(o.connected, 'OBS connecté à Studio', o.connected ? '<small>Connexion OBS de Studio active.</small>' : `<small>${esc(o.error ? (OBS_ERRORS[o.error] ?? o.error) : 'Non connecté : la connexion OBS se règle dans Studio (Système). Tu peux aussi ajouter la source à la main (URL ci-dessous).')}</small>`)}
      ${step(o.installed && o.url_ok, 'Source « Raptoru · Musique »', o.installed ? (o.url_ok ? `<small>Installée. ${where}</small>` : '<small>Installée, mais son adresse n’est pas celle de ce Studio.</small><button type="button" class="d-btn sm" data-act="mox-obs-repair">Réparer l’adresse</button>') : `<small>Créée dans une scène à part « Raptoru · Musique (overlay) » : aucune de tes scènes n’est modifiée.</small><button type="button" class="d-btn pri sm" data-act="mox-obs-install" ${o.connected ? '' : 'disabled'}>Installer dans OBS</button>`)}
      ${step(o.on_program, 'Visible sur le stream', o.installed ? `<small>${o.on_program ? 'Dans la scène à l’antenne.' : 'Ajoute-la à la scène où tu veux la voir (rien n’est retiré ni remplacé).'}</small><span class="mox-addrow"><label class="d-fld mox-sel"><select data-obs-scene aria-label="Scène">${scenes}</select></label><button type="button" class="d-btn sm" data-act="mox-obs-add">Ajouter à cette scène</button></span>` : '<small>Après l’installation.</small>')}
      ${step(visible, 'Affichée', `<small>${visible ? 'L’overlay est affiché (bouton en haut de page).' : 'Masquée : clique « Afficher » en haut de page.'}</small>`)}
    </ol>
    <h3 class="mox-advh">Ajout à la main</h3>
    <p class="mox-note">Source « Navigateur », largeur 1920, hauteur 1080, cette adresse (elle contient une clé : ne la partage pas) :</p>
    <div class="mox-url"><code>${esc(url.replace(/#.*/, '#••••'))}</code><button type="button" class="d-btn sm" data-act="mox-copy-url">Copier l’adresse</button></div>
    <button type="button" class="d-btn ghost sm" data-act="mox-obs-refresh">Relire l’état d’OBS</button>
  </div>`;
}
