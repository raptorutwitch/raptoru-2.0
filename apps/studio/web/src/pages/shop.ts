import {
  choiceBox,
  confirmBox,
  errText,
  esc,
  fld,
  fmt,
  ic,
  keyed,
  menu,
  page,
  patch,
  poller,
  pop,
  pp,
  run,
  seg,
  stateChip,
  sw,
  toast,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import {
  badgesHtml,
  cardHtml,
  coreStyle,
  gem,
  imageOf,
  imageUrl,
  lookAttr,
  paintLooks,
  podiumHtml,
  RARITIES,
  RARITY_FR,
  rowHtml,
  titleHtml,
  type Look,
  type Wearer,
} from './player-card.js';
import { slug } from './progression-model.js';
import {
  awardKey,
  frameProblemsOf,
  isoToParis,
  itemPayload,
  offerState,
  parisToIso,
} from './shop-model.js';

// La Boutique : l'atelier montre l'objet porté, en direct, sur la vraie carte du site. Le Core fixe prix, soldes et possession ;
// une seule action à la fois, un double clic n'envoie jamais deux fois, un don garde sa clé jusqu'à ce qu'il aboutisse.

type Kind = 'title' | 'badge' | 'frame' | 'banner';
type Status = 'draft' | 'published' | 'hidden' | 'archived';
type Style = Look;
interface Offer {
  offer_id: string;
  reward_id: string;
  currency: 'main' | 'bonbons';
  price: number;
  enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  event_key: string | null;
  sort: number;
}
interface Item {
  reward_id: string;
  kind: Kind;
  label: string;
  description: string;
  rarity: string;
  category: string;
  unlock_level: number | null;
  sort: number;
  status: Status;
  style: Style;
  image_id: string | null;
  event_key: string | null;
  owners: number;
  offers: Offer[];
}
type Edit = Omit<Item, 'owners' | 'offers'>;
interface Purchase {
  purchase_id: string;
  viewer_id: string;
  viewer_name: string;
  reward_id: string;
  currency: 'main' | 'bonbons';
  price: number;
  status: 'completed' | 'refunded';
  created_at: string;
  refund_reason: string | null;
}
interface ViewerHit {
  twitch_user_id: string;
  login: string;
  display_name: string | null;
}
interface ViewerDetail {
  equipped: {
    title: string | null;
    badges: string[];
    frame: string | null;
    banner: string | null;
  };
  inventory: {
    id: string;
    label: string;
    rarity: string;
    style: Style;
    image: string | null;
  }[];
}

const KINDS: [Kind, string][] = [
  ['title', 'Titre'],
  ['badge', 'Badge'],
  ['frame', 'Cadre'],
  ['banner', 'Bannière'],
];
const KIND_FR: Record<Kind, string> = {
  title: 'Titre',
  badge: 'Badge',
  frame: 'Cadre d’avatar',
  banner: 'Bannière',
};
const STATUSES: [Status, string][] = [
  ['draft', 'Brouillon'],
  ['published', 'Publié'],
  ['hidden', 'Masqué'],
  ['archived', 'Archivé'],
];
const STATUS_FR = Object.fromEntries(STATUSES) as Record<Status, string>;
const STATUS_HINT: Record<Status, string> = {
  draft: 'Invisible des viewers. L’identifiant peut encore changer.',
  published: 'Visible, et en vente avec une offre active.',
  hidden: 'Hors boutique, gardé par ceux qui l’ont.',
  archived: 'Comme masqué, et retiré de la gestion courante.',
};
const EFFECTS: [string, string][] = [
  ['none', 'Aucun'],
  ['glow', 'Lueur'],
  ['shine', 'Brillance'],
  ['pulse', 'Pulsation'],
  ['rainbow', 'Arc-en-ciel'],
  ['sparkle', 'Étincelles'],
];
const CURRENCY: Record<string, string> = { main: 'Jetons', bonbons: 'Bonbons' };
/** Chaque règle d'image, telle que le Core la vérifie sur les octets (core-api/src/cosmetics/images.ts). */
const IMAGE_RULE: Record<Exclude<Kind, 'title'>, string> = {
  badge: 'PNG ou WebP fixe, 128 × 128 et 40 Ko au plus.',
  frame:
    'PNG ou WebP fixe, carré de 128 à 512 px (512 conseillé), 96 Ko au plus. Centre transparent (l’avatar occupe le cercle central de 62,5 %), 8 px vides sur les bords.',
  banner:
    'PNG ou WebP fixe, format 4:1 de 1024 × 256 à 2048 × 512, 256 Ko au plus. Rien d’important dans les 40 % de gauche, voilés sous le pseudo.',
};
const REFUS = {
  already_owned: 'Ce viewer a déjà cet objet.',
  already_refunded: 'Cet achat est déjà remboursé.',
  insufficient_funds: 'Solde insuffisant.',
  insufficient_tokens: 'Solde insuffisant.',
  invalid_request: 'Vérifie les champs : un nom, un identifiant valable.',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const paris = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const blank = (): Edit => ({
  reward_id: '',
  kind: 'title',
  label: '',
  description: '',
  rarity: 'common',
  category: 'general',
  unlock_level: null,
  sort: 0,
  status: 'draft',
  style: { color: '#2ee6c1', gradient: null, effect: 'none', weight: 'bold' },
  image_id: null,
  event_key: null,
});

async function frameProblems(file: Blob): Promise<string[]> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  return frameProblemsOf(
    g.getImageData(0, 0, bmp.width, bmp.height).data,
    bmp.width,
    bmp.height,
  );
}
const toBase64 = (file: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('image illisible'));
    r.readAsDataURL(file);
  });

export function mountShopPage(root: HTMLElement) {
  coreStyle();
  const p = page(root, { title: 'Boutique', mod: 'shop' });
  p.body.innerHTML = `<div class="sh">
    <div class="sh-a" data-scene-z="atelier">
      <aside class="sh-shelf" aria-label="Catalogue">
        <label class="d-fld sh-q">${ic('search')}<input type="search" data-q placeholder="Nom, identifiant, événement" aria-label="Chercher dans le catalogue"></label>
        <div class="sh-filters" data-z="filters"></div>
        <div class="sh-list" data-role="catalogue" data-z="list"></div>
      </aside>
      <section class="sh-stage" aria-label="Aperçu">
        <div class="sh-line"><span class="d-lb">Porté par</span><span data-z="wearer"></span><span class="d-sp"></span><span class="d-faint">Rendu de raptoru.fr</span></div>
        <div class="sh-view" data-preview data-z="stage"></div>
      </section>
      <aside class="sh-bench" data-role="item-form" aria-label="Atelier">
        <div class="sh-bench__b" data-z="bench"></div>
        <div class="sh-offers" data-z="offers-wrap"></div>
        <div class="sh-save" data-z="save"></div>
      </aside>
    </div>
    <div class="sh-b" data-scene-z="achats" hidden>
      <section class="sh-buys" aria-label="Achats">
        <div class="sh-line" data-z="buy-filter"></div>
        <div class="sh-buylist" data-z="buys"></div>
      </section>
      <aside class="sh-give" data-z="give"></aside>
    </div>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let items: Item[] = [];
  let purchases: Purchase[] = [];
  let loaded = false;
  let error = '';
  let scene: 'atelier' | 'achats' = 'atelier';
  let query = '';
  let fKind = '';
  let fStatus = '';
  let edit: Edit = blank();
  let isNew = true;
  let baseline = '';
  let idTouched = false;
  let imgNote = '';
  let imgBad = false;
  let offerOpen: Offer | 'new' | null = null;
  let offerCurrency: 'main' | 'bonbons' = 'main';
  let model: { name: string; look: Wearer } | null = null;
  let buyFilter = 'all';
  let buyQ = '';
  let giveKind: 'reward' | 'bonbons' | 'jetons' = 'reward';
  // Un don : une intention par saisie. La même clé jusqu'à ce qu'il aboutisse : un nouvel essai ne crédite jamais deux fois.
  let awardIntent = crypto.randomUUID();
  // Une action à la fois : un double clic n'envoie jamais deux fois (« Donner » crédite le vrai Wallet).
  let acting = false;
  const once = async (
    btn: HTMLElement | null,
    fn: () => Promise<unknown>,
    done?: string,
  ) => {
    if (acting) return false;
    acting = true;
    try {
      return await run(btn, fn, done, REFUS);
    } finally {
      acting = false;
    }
  };

  const dirty = () => JSON.stringify(itemPayload(edit)) !== baseline;
  const saved = () => items.find((i) => i.reward_id === edit.reward_id);
  const selected = () => (isNew ? undefined : saved());
  const resetBase = () => {
    baseline = JSON.stringify(itemPayload(edit));
  };
  resetBase();

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  async function read() {
    try {
      const [a, b] = await Promise.all([
        getJson<Item[]>('/api/cosmetics/items'),
        getJson<Purchase[]>('/api/cosmetics/purchases'),
      ]);
      items = a;
      purchases = b;
      loaded = true;
      error = '';
    } catch (e) {
      error = errText(e);
    }
    paint();
  }
  const tick = poller(read, 7000);

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  const smallLook = (i: {
    kind: Kind;
    label: string;
    rarity: string;
    style: Style;
    image_id: string | null;
  }) =>
    i.kind === 'title'
      ? titleHtml(
          {
            label: i.label || 'Titre',
            rarity: i.rarity,
            style: i.style,
          },
          { size: 'xs' },
        )
      : `<span class="sh-thumb ${i.kind}" data-r="${esc(i.rarity)}">${i.image_id ? `<img src="${esc(imageOf(i.image_id)!)}" alt="">` : gem(i.rarity)}</span>`;
  const onSale = (i: Item) =>
    i.status === 'published' &&
    i.offers.some((o) => offerState(o, Date.now()).tone === 'ok');

  function paintHead() {
    const sale = items.filter(onSale).length;
    patch(
      p.state,
      error && !loaded
        ? stateChip('r', 'Boutique injoignable')
        : !loaded
          ? stateChip('w', 'Lecture…')
          : stateChip(
              sale ? '' : 'off',
              `${fmt(items.length)} objet${items.length > 1 ? 's' : ''} · ${sale} en vente`,
            ),
    );
    patch(
      p.actions,
      `${seg(
        'data-scene',
        [
          ['atelier', 'Atelier'],
          ['achats', 'Achats et dons'],
        ],
        scene,
      )}<button type="button" class="d-btn pri" data-act="new">${ic('plus')}Nouvel objet</button>`,
    );
  }
  function paintShelf() {
    patch(
      z('filters'),
      `<span class="sh-kinds">${[
        ['', 'Tout'],
        ['title', 'Titres'],
        ['badge', 'Badges'],
        ['frame', 'Cadres'],
        ['banner', 'Bannières'],
      ]
        .map(
          ([k, l]) =>
            `<button type="button" class="d-tag ${fKind === k ? 'ok' : 'off'}" data-fkind="${k}" aria-pressed="${fKind === k}">${esc(l!)}</button>`,
        )
        .join(
          '',
        )}</span><label class="d-fld"><select data-filter="status" aria-label="État"><option value="">Tous les états</option>${STATUSES.map(([k, l]) => `<option value="${k}" ${fStatus === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`,
    );
    const q = query.trim().toLowerCase();
    const list = items.filter(
      (i) =>
        (!fKind || i.kind === fKind) &&
        (!fStatus || i.status === fStatus) &&
        (!q ||
          `${i.reward_id} ${i.label} ${i.category} ${i.event_key ?? ''}`
            .toLowerCase()
            .includes(q)),
    );
    const cur = selected()?.reward_id;
    keyed(
      z('list'),
      list.map((i) => ({
        key: i.reward_id,
        html: `<button type="button" class="sh-it d-in ${cur === i.reward_id ? 'on d-vf' : ''}" data-row="${esc(i.reward_id)}" data-edit="${esc(i.reward_id)}">
          <span class="sh-it__l">${smallLook(i)}</span>
          <span class="sh-it__m"><b>${esc(i.label)}</b><small>${esc(KIND_FR[i.kind] ?? i.kind)}${i.offers.length ? ` · ${i.offers.map((o) => `${fmt(o.price)} ${esc(CURRENCY[o.currency])}${o.enabled ? '' : ' (arrêtée)'}`).join(' · ')}` : ' · non vendu'}</small></span>
          <span class="sh-it__r"><span class="d-tag ${i.status === 'published' ? 'ok' : 'off'}">${esc(STATUS_FR[i.status])}</span><small title="Viewers qui l’ont">${fmt(i.owners)} ${ic('user')}</small></span></button>`,
      })),
      `<div class="d-empty">${error ? esc(error) : items.length ? 'Aucun objet ne correspond.' : 'Aucun objet pour l’instant : « Nouvel objet » ouvre l’atelier.'}</div>`,
    );
    paintLooks(z('list'));
  }
  /** Le viewer de l'aperçu, avec l'objet en cours d'édition à sa place. */
  const wearing = (): Wearer => {
    const base: Wearer = model?.look ?? {
      name: 'Pseudo',
      badges: [],
    };
    const img = imageOf(edit.image_id);
    if (edit.kind === 'title')
      return {
        ...base,
        title: {
          label: edit.label || 'Titre',
          rarity: edit.rarity,
          style: edit.style,
        },
      };
    if (edit.kind === 'badge')
      return {
        ...base,
        badges: [
          {
            label: edit.label || 'Badge',
            rarity: edit.rarity,
            image: img,
          },
          ...(base.badges ?? []),
        ].slice(0, 3),
      };
    if (edit.kind === 'frame') return { ...base, frame: img };
    return { ...base, banner: img };
  };
  function paintStage() {
    const w = wearing();
    const k = edit.kind;
    patch(
      z('wearer'),
      `<button type="button" class="d-btn ghost sm" data-act="wearer">${pp(w.name, 18)}${esc(w.name)}${ic('down')}</button>`,
    );
    const name = edit.label || (k === 'title' ? 'Titre' : 'Badge');
    patch(
      z('stage'),
      `${cardHtml(w, { titleEmpty: 'Aucun titre équipé' })}
      <div class="sh-ctx"><div><small>Au survol d’une ligne</small>${cardHtml(w, { variant: 'peek' })}</div>
        <div><small>Podium</small>${podiumHtml(w, '18 240 XP')}</div></div>
      <div class="sh-rows"><small>Classements</small>${rowHtml(w, { rank: 4, value: '12 840' })}${rowHtml(w, { rank: 12, value: '3 120', compact: true })}</div>
      ${
        k === 'title'
          ? `<div class="sh-ext"><small>Extension Twitch</small><div class="sh-ext__r"><strong ${lookAttr(edit.style)}>${esc(name)}</strong><span>Disponible</span></div></div>`
          : k === 'badge'
            ? `<div class="sh-big"><small>Boutique et collection</small><span ${lookAttr(edit.style, 'badge')}>${edit.image_id ? `<img src="${esc(imageOf(edit.image_id)!)}" alt="">` : esc(name.slice(0, 2))}</span><span ${lookAttr(edit.style, 'badge')} style="--rc-size:48px">${edit.image_id ? `<img src="${esc(imageOf(edit.image_id)!)}" alt="">` : esc(name.slice(0, 2))}</span>${badgesHtml([{ label: name, rarity: edit.rarity, image: imageOf(edit.image_id) }], 1, 26)}</div>`
            : k === 'banner'
              ? '<p class="d-note">Seule la droite se voit sur une ligne étroite ; à gauche, le voile protège le pseudo.</p>'
              : ''
      }`,
    );
    paintLooks(z('stage'));
  }
  function paintBench() {
    const st = edit.style;
    const sel = selected();
    const imageKind = edit.kind === 'frame' || edit.kind === 'banner';
    z('bench').innerHTML = `<div class="sh-bh">
        <div><b>${isNew ? 'Nouvel objet' : esc(sel?.label ?? edit.label)}</b><small>${isNew ? 'Rien n’existe avant « Créer »' : `${sel ? `${fmt(sel.owners)} viewer${sel.owners > 1 ? 's' : ''} l’ont` : ''}`}</small></div>
        ${isNew ? '' : `<button type="button" class="d-ib" data-act="item-menu" aria-label="Autres actions">${ic('more')}</button>`}
      </div>
      <div class="sh-kind">${seg('data-kind', KINDS, edit.kind, `block ${isNew ? '' : 'is-fixed'}`)}</div>
      <label class="sh-fl"><span>Nom affiché</span><span class="d-fld"><input type="text" data-f="label" maxlength="60" value="${esc(edit.label)}"></span></label>
      <label class="sh-fl"><span>Description</span><span class="d-fld"><input type="text" data-f="description" maxlength="200" value="${esc(edit.description)}"></span></label>
      <div class="sh-fl"><span>Rareté</span><span class="sh-rar">${RARITIES.map((r) => `<button type="button" data-rarity="${r}" class="${edit.rarity === r ? 'on' : ''}" aria-pressed="${edit.rarity === r}" title="${RARITY_FR[r]}">${gem(r)}<span>${RARITY_FR[r]}</span></button>`).join('')}</span></div>
      <div class="sh-sec" data-role="look-form" ${imageKind ? 'hidden' : ''}>
        <h3>Apparence</h3>
        <div class="d-row"><span>Couleur</span><span class="sh-pair">${sw(!!st.color, 'data-l="use-color"', 'Couleur')}<input type="color" class="sh-col" data-l="color" value="${esc(st.color ?? '#ffffff')}" aria-label="Choisir la couleur"></span></div>
        <div class="d-row"><span>Dégradé</span><span class="sh-pair">${sw(!!st.gradient, 'data-l="use-gradient"', 'Dégradé')}<input type="color" class="sh-col" data-l="from" value="${esc(st.gradient?.from ?? '#ff8a00')}" aria-label="Début du dégradé"><input type="color" class="sh-col" data-l="to" value="${esc(st.gradient?.to ?? '#ffd36b')}" aria-label="Fin du dégradé"></span></div>
        <div class="d-row"><span>Angle</span><span class="sh-pair sh-angle"><input type="range" class="d-range" min="0" max="360" step="15" data-l="angle" value="${st.gradient?.angle ?? 90}" aria-label="Angle du dégradé"><small data-z="angle">${st.gradient?.angle ?? 90}°</small></span></div>
        <div class="sh-fx" data-z="fx"></div>
        <div class="d-row"><span>Graisse</span>${seg(
          'data-weight',
          [
            ['bold', 'Gras'],
            ['normal', 'Normal'],
          ],
          st.weight === 'normal' ? 'normal' : 'bold',
        )}</div>
      </div>
      ${
        edit.kind === 'title'
          ? ''
          : `<div class="sh-sec"><h3>Image</h3>
        <label class="sh-drop ${edit.image_id ? 'has' : ''}">${edit.image_id ? `<img src="${esc(imageOf(edit.image_id)!)}" alt="">` : ic('upload')}<span>${edit.image_id ? 'Remplacer l’image' : 'Dépose l’image ici'}</span><input type="file" accept="image/png,image/webp" data-role="image" aria-label="Image"></label>
        <p class="d-note">${IMAGE_RULE[edit.kind as Exclude<Kind, 'title'>]}${imageKind ? ' Ne sort du brouillon qu’avec son image.' : ''}</p>
        <p class="d-note ${imgBad ? 'bad' : ''}" data-z="img-note">${esc(imgNote)}</p>
        ${edit.image_id ? '<button type="button" class="d-btn ghost sm" data-act="no-image">Retirer l’image</button>' : ''}</div>`
      }
      <div class="sh-sec"><h3>État</h3>${seg('data-status', STATUSES, edit.status, 'block')}<p class="d-note" data-z="status-hint">${esc(STATUS_HINT[edit.status])}</p></div>
      <details class="d-acc" ${isNew ? 'open' : ''}><summary>Disponibilité et détails techniques</summary>
        <label class="sh-fl"><span>Identifiant</span><span class="d-fld"><input type="text" data-f="reward_id" maxlength="48" value="${esc(edit.reward_id)}" ${isNew ? '' : 'disabled'} placeholder="ex. roi-citrouille"></span></label>
        <label class="sh-fl"><span>Événement</span><span class="d-fld"><input type="text" data-f="event_key" maxlength="40" placeholder="ex. halloween-2026" value="${esc(edit.event_key ?? '')}"></span></label>
        <div class="d-row"><span>Débloqué au niveau</span>${fld('data-f="unlock_level" min="1" max="10000" placeholder="aucun"', edit.unlock_level ?? '')}</div>
        <div class="d-row"><span>Ordre</span>${fld('data-f="sort" min="-1000" max="1000"', edit.sort)}</div>
        <label class="sh-fl"><span>Catégorie</span><span class="d-fld"><input type="text" data-f="category" maxlength="32" value="${esc(edit.category)}"></span></label>
        <p class="d-note">Aucun code ni CSS n’est saisi : l’apparence est faite de ces réglages.</p>
      </details>`;
    paintFx();
    paintSave();
    paintOffers();
  }
  function paintFx() {
    const box = z('fx');
    if (!box) return;
    const st = edit.style;
    box.innerHTML = `<span class="sh-fxl">Effet</span><div class="sh-fxs">${EFFECTS.map(([k, l]) => `<button type="button" data-effect="${k}" class="${(st.effect ?? 'none') === k ? 'on' : ''}" aria-pressed="${(st.effect ?? 'none') === k}"><span ${lookAttr({ ...st, effect: k })}>Aa</span><small>${l}</small></button>`).join('')}</div>`;
    paintLooks(box);
  }
  function paintSave() {
    patch(
      z('save'),
      `<span class="d-muted">${dirty() ? 'Pas encore enregistré' : isNew ? '' : 'À jour'}</span><span class="d-sp"></span>
      ${dirty() && !isNew ? '<button type="button" class="d-btn ghost sm" data-act="revert">Annuler</button>' : ''}
      <button type="button" class="d-btn pri sm" data-act="save" ${isNew || dirty() ? '' : 'disabled'}>${isNew ? 'Créer' : 'Enregistrer'}</button>`,
    );
  }
  const offerLine = (o: Offer) => {
    const s = offerState(o, Date.now());
    return `<div class="sh-off" data-offer="${esc(o.offer_id)}">
      <div class="sh-tag"><b>${fmt(o.price)}</b><small>${esc(CURRENCY[o.currency])}</small></div>
      <div class="sh-off__m"><span><i class="d-dot ${s.tone === 'ok' ? '' : s.tone === 'warn' ? 'w' : 'off'}"></i>${esc(s.text)}</span>
        <small>${o.opens_at || o.closes_at ? `${o.opens_at ? `du ${esc(paris(o.opens_at))}` : 'dès maintenant'} ${o.closes_at ? `au ${esc(paris(o.closes_at))}` : 'sans fin'}` : 'Sans limite de dates'}${o.event_key ? ` · ${esc(o.event_key)}` : ''}</small></div>
      <button type="button" class="d-btn ghost sm" data-offer-edit="${esc(o.offer_id)}">Modifier</button></div>`;
  };
  function paintOffers() {
    const sel = selected();
    const wrap = z('offers-wrap');
    if (!sel) {
      wrap.innerHTML = isNew
        ? ''
        : '<div class="sh-sec"><p class="d-note">Enregistre l’objet pour le mettre en vente.</p></div>';
      return;
    }
    const o = offerOpen === 'new' ? null : offerOpen;
    wrap.innerHTML = `<div class="sh-sec" data-role="offers"><h3>Mise en vente</h3>
      ${sel.offers.map(offerLine).join('') || '<p class="d-note">Pas encore en vente.</p>'}
      ${sel.status !== 'published' && sel.offers.length ? '<p class="d-note">L’objet doit être Publié pour être vendu.</p>' : ''}
      ${
        offerOpen
          ? `<div class="sh-oform" data-role="offer-form">
          <div class="d-row"><span>Monnaie</span>${seg(
            'data-ocur',
            [
              ['main', 'Jetons'],
              ['bonbons', 'Bonbons'],
            ],
            offerCurrency,
          )}</div>
          <div class="d-row"><span>Prix</span>${fld('data-o="price" min="1" step="1"', o?.price ?? '')}</div>
          <div class="d-row"><span>En vente</span>${sw(!!o?.enabled, 'data-o="enabled"', 'En vente')}</div>
          <label class="sh-fl"><span>Ouverture, heure de Paris</span><span class="d-fld"><input type="datetime-local" data-o="opens_at" value="${esc(isoToParis(o?.opens_at ?? null))}"></span></label>
          <label class="sh-fl"><span>Fermeture, heure de Paris</span><span class="d-fld"><input type="datetime-local" data-o="closes_at" value="${esc(isoToParis(o?.closes_at ?? null))}"></span></label>
          <label class="sh-fl"><span>Événement</span><span class="d-fld"><input type="text" data-o="event_key" maxlength="40" placeholder="aucun" value="${esc(o?.event_key ?? '')}"></span></label>
          <label class="sh-fl"><span>Identifiant de l’offre</span><span class="d-fld"><input type="text" data-o="offer_id" maxlength="64" value="${esc(o?.offer_id ?? '')}" ${o ? 'readonly' : ''} placeholder="${esc(sel.reward_id)}-${offerCurrency === 'main' ? 'jetons' : 'bonbons'}"></span></label>
          <p class="d-note">Dates vides : sans limite. Avec un événement : en vente seulement quand il est ouvert.</p>
          <div class="sh-pair"><button type="button" class="d-btn ghost sm" data-act="offer-close">Annuler</button><button type="button" class="d-btn pri sm" data-act="offer">Enregistrer l’offre</button></div></div>`
          : `<button type="button" class="d-btn sm" data-act="offer-new">${ic('plus')}Ajouter une offre</button>`
      }</div>`;
  }
  function paintBuys() {
    patch(
      z('buy-filter'),
      `${seg(
        'data-buyf',
        [
          ['all', 'Tout'],
          ['completed', 'Payés'],
          ['refunded', 'Remboursés'],
        ],
        buyFilter,
      )}<label class="d-fld sh-q">${ic('search')}<input type="search" data-buyq placeholder="Viewer ou objet" aria-label="Chercher un achat" value="${esc(buyQ)}"></label>`,
    );
    const s = buyQ.trim().toLowerCase();
    const list = purchases
      .filter(
        (x) =>
          (buyFilter === 'all' || x.status === buyFilter) &&
          (!s || `${x.viewer_name} ${x.reward_id}`.toLowerCase().includes(s)),
      )
      .slice(0, 50);
    keyed(
      z('buys'),
      list.map((x) => {
        const it = items.find((i) => i.reward_id === x.reward_id);
        return {
          key: x.purchase_id,
          html: `<div class="sh-buy d-in ${x.status === 'refunded' ? 'back' : ''}">${pp(x.viewer_name, 30)}<span class="sh-buy__w"><b>${esc(x.viewer_name)}</b><small>${esc(when(x.created_at))}</small></span>
          <span class="sh-buy__o">${it ? smallLook(it) : `<code>${esc(x.reward_id)}</code>`}${it && it.kind !== 'title' ? `<span>${esc(it.label)}</span>` : ''}</span>
          <span class="sh-tag"><b>${fmt(x.price)}</b><small>${esc(CURRENCY[x.currency])}</small></span>
          <span class="sh-buy__s">${x.status === 'refunded' ? `<span class="d-tag off">remboursé${x.refund_reason ? ` (${esc(x.refund_reason)})` : ''}</span>` : `<button type="button" class="d-btn bad sm" data-refund="${esc(x.purchase_id)}">Rembourser…</button>`}</span></div>`,
        };
      }),
      `<div class="d-empty">${purchases.length ? 'Aucun achat ne correspond.' : 'Aucun achat pour l’instant.'}</div>`,
    );
    paintLooks(z('buys'));
  }
  function paintGive() {
    if (z('give').childElementCount) {
      paintGiveItems();
      return;
    }
    z('give').innerHTML =
      `<div class="sh-sec" data-role="award-form"><h3>Donner à un viewer</h3>
      <label class="d-fld sh-q">${ic('search')}<input type="search" data-give-q placeholder="Trouver un viewer" aria-label="Trouver un viewer"></label>
      <div class="sh-hits" data-z="give-hits"></div>
      <label class="sh-fl"><span>Identifiant Twitch</span><span class="d-fld"><input type="text" data-a="viewer" maxlength="32" inputmode="numeric"></span></label>
      <label class="sh-fl"><span>Pseudo</span><span class="d-fld"><input type="text" data-a="viewer_name" maxlength="64"></span></label>
      <span data-z="give-kind"></span>
      <div data-z="give-what"></div>
      <button type="button" class="d-btn pri" data-act="award">Donner</button>
      <p class="d-note">Crédit réel, journalisé. Un nouvel essai après une erreur ne crédite jamais deux fois.</p>
      <p class="d-note">Un remboursement recrédite la monnaie payée et retire l’objet au viewer, une seule fois ; la raison est gardée.</p></div>`;
    paintGiveItems();
  }
  function paintGiveItems() {
    patch(
      z('give-kind'),
      seg(
        'data-give',
        [
          ['reward', 'Un objet'],
          ['bonbons', 'Des Bonbons'],
          ['jetons', 'Des Jetons'],
        ],
        giveKind,
        'block',
      ),
    );
    const what = z('give-what');
    if (what.contains(document.activeElement)) return;
    patch(
      what,
      giveKind === 'reward'
        ? `<label class="sh-fl"><span>Objet</span><span class="d-fld"><select data-a="reward_id">${items
            .filter((i) => i.status !== 'draft')
            .map(
              (i) =>
                `<option value="${esc(i.reward_id)}">${esc(i.label)}</option>`,
            )
            .join('')}</select></span></label>`
        : `<div class="d-row"><span>Quantité</span>${fld('data-a="amount" min="1" step="1"', 1)}</div>`,
    );
  }
  function paint() {
    paintHead();
    for (const el of p.body.querySelectorAll<HTMLElement>('[data-scene-z]'))
      el.hidden = el.dataset.sceneZ !== scene;
    if (scene === 'atelier') {
      paintShelf();
      if (!z('bench').childElementCount) {
        paintBench();
        paintStage();
      } else if (!offerOpen) paintOffers();
    } else {
      paintBuys();
      paintGive();
    }
  }

  // --- Atelier ----------------------------------------------------------------------------------------------------------
  const openItem = (next: Edit, fresh: boolean) => {
    edit = next;
    isNew = fresh;
    idTouched = false;
    imgNote = '';
    imgBad = false;
    offerOpen = null;
    resetBase();
    paintBench();
    paintStage();
    paintShelf();
  };
  const guard = async () =>
    !dirty() ||
    confirmBox({
      title: 'Abandonner ces changements ?',
      body: 'Ils ne sont pas enregistrés.',
      yes: 'Abandonner',
      no: 'Garder',
    });
  const edited = () => {
    paintStage();
    paintSave();
  };
  async function upload(file: File) {
    const purpose = edit.kind as Exclude<Kind, 'title'>;
    const note = (text: string, bad: boolean) => {
      imgNote = text;
      imgBad = bad;
      const el = z('img-note');
      if (el) {
        el.textContent = text;
        el.classList.toggle('bad', bad);
      }
    };
    if (purpose === 'frame') {
      const problems = await frameProblems(file).catch(() => [
        'image illisible',
      ]);
      if (problems.length)
        return note(`Cadre refusé : ${problems.join(' ; ')}.`, true);
    }
    if (acting) return;
    acting = true;
    try {
      const data_base64 = await toBase64(file);
      const r = await postJson<{
        image_id: string;
        width: number;
        height: number;
        size: number;
      }>('/api/cosmetics/images', { data_base64, purpose });
      edit.image_id = r.image_id;
      imgNote = `Image acceptée (${r.width} × ${r.height}, ${fmt(r.size)} o).`;
      imgBad = false;
      paintBench();
      paintStage();
    } catch (e) {
      note(`Image refusée : ${errText(e)}`, true);
    } finally {
      acting = false;
    }
  }
  function askId(
    anchor: HTMLElement,
    o: { title: string; value: string; yes: string },
    send: (to: string) => void,
  ) {
    pop(
      anchor,
      `<form class="d-form"><h3>${esc(o.title)}</h3><label class="d-fld"><input type="text" data-to maxlength="48" value="${esc(o.value)}" aria-label="Identifiant"></label><button class="d-btn pri sm">${esc(o.yes)}</button></form>`,
      (el) =>
        el.addEventListener('submit', (e) => {
          e.preventDefault();
          const to = el
            .querySelector<HTMLInputElement>('[data-to]')!
            .value.trim();
          el.hidePopover();
          if (to) send(to);
        }),
    );
  }
  function chooseWearer(anchor: HTMLElement) {
    pop(
      anchor,
      `<div class="sh-pick"><label class="d-fld">${ic('search')}<input type="search" data-w placeholder="Chercher un viewer" aria-label="Chercher un viewer"></label><div data-wl><button type="button" class="sh-pick__r" data-wid="">${pp('Pseudo', 22)}<span>Viewer fictif</span></button></div></div>`,
      (el) => {
        let t = 0;
        el.addEventListener('input', () => {
          const q = el
            .querySelector<HTMLInputElement>('[data-w]')!
            .value.trim();
          const mine = ++t;
          setTimeout(() => {
            if (mine !== t || !q) return;
            void tryGetJson<ViewerHit[]>(
              `/api/progression/viewers?q=${encodeURIComponent(q)}`,
            ).then((r) => {
              if (mine !== t) return;
              el.querySelector('[data-wl]')!.innerHTML =
                (r ?? [])
                  .map((h) => {
                    const n = h.display_name ?? h.login;
                    return `<button type="button" class="sh-pick__r" data-wid="${esc(h.twitch_user_id)}" data-wn="${esc(n)}">${pp(n, 22)}<span>${esc(n)}</span></button>`;
                  })
                  .join('') || '<div class="d-empty">Personne.</div>';
            });
          }, 180);
        });
        el.addEventListener('click', (e) => {
          const b = (e.target as HTMLElement).closest<HTMLElement>(
            '[data-wid]',
          );
          if (!b) return;
          el.hidePopover();
          if (!b.dataset.wid) {
            model = null;
            return paintStage();
          }
          const name = b.dataset.wn ?? '';
          void getJson<ViewerDetail>(
            `/api/progression/viewers/${b.dataset.wid}`,
          ).then(
            (d) => {
              const by = (id: string | null) =>
                d.inventory.find((i) => i.id === id);
              const t0 = by(d.equipped.title);
              model = {
                name,
                look: {
                  name,
                  title: t0 && {
                    label: t0.label,
                    rarity: t0.rarity,
                    style: t0.style,
                  },
                  badges: d.equipped.badges.flatMap((id) => {
                    const i = by(id);
                    return i
                      ? [
                          {
                            label: i.label,
                            rarity: i.rarity,
                            image: imageUrl(i.image),
                          },
                        ]
                      : [];
                  }),
                  frame: imageUrl(by(d.equipped.frame)?.image),
                  banner: imageUrl(by(d.equipped.banner)?.image),
                },
              };
              paintStage();
            },
            (x) => toast(errText(x), { bad: true }),
          );
        });
      },
    );
  }

  // --- Interaction ------------------------------------------------------------------------------------------------------
  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-q]')) {
      query = t.value;
      return paintShelf();
    }
    if (t.matches('[data-buyq]')) {
      buyQ = t.value;
      return paintBuys();
    }
    if (t.matches('[data-give-q]')) return void findGive(t.value.trim());
    const f = t.dataset.f;
    if (f) {
      const v = t.value.trim();
      if (f === 'unlock_level') edit.unlock_level = v ? Number(v) : null;
      else if (f === 'sort') edit.sort = Number(v) || 0;
      else if (f === 'event_key') edit.event_key = v || null;
      else if (f === 'category') edit.category = v || 'general';
      else if (f === 'reward_id') {
        edit.reward_id = v;
        idTouched = true;
      } else (edit as unknown as Record<string, unknown>)[f] = t.value;
      if (f === 'label') {
        edit.label = t.value.trimStart();
        if (isNew && !idTouched) {
          edit.reward_id = slug(t.value);
          const el = p.body.querySelector<HTMLInputElement>(
            '[data-f="reward_id"]',
          );
          if (el) el.value = edit.reward_id;
        }
      }
      return edited();
    }
    const l = t.dataset.l;
    if (l) {
      const st = edit.style;
      const get = (k: string) =>
        p.body.querySelector<HTMLInputElement>(`[data-l="${k}"]`)!;
      if (l === 'use-color' || l === 'color') {
        st.color =
          l === 'color' || get('use-color').checked ? get('color').value : null;
        if (l === 'color') get('use-color').checked = true;
      } else {
        const on = l === 'use-gradient' ? t.checked : true;
        get('use-gradient').checked = on;
        st.gradient = on
          ? {
              from: get('from').value,
              to: get('to').value,
              angle: Number(get('angle').value),
            }
          : null;
        const a = z('angle');
        if (a) a.textContent = `${get('angle').value}°`;
      }
      paintFx();
      edited();
    }
    if (t.matches('[data-a]')) awardIntent = crypto.randomUUID();
  });
  p.root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.filter) {
      fStatus = t.value;
      return paintShelf();
    }
    if (t.dataset.role === 'image' && t.files?.[0]) {
      void upload(t.files[0]);
      t.value = '';
    }
    if (t.dataset.a) awardIntent = crypto.randomUUID();
  });
  let giveSearch = 0;
  function findGive(q: string) {
    const mine = ++giveSearch;
    const box = z('give-hits');
    if (!q) return box.replaceChildren();
    setTimeout(() => {
      if (mine !== giveSearch) return;
      void tryGetJson<ViewerHit[]>(
        `/api/progression/viewers?q=${encodeURIComponent(q)}`,
      ).then((r) => {
        if (mine !== giveSearch) return;
        box.innerHTML = (r ?? [])
          .slice(0, 5)
          .map((h) => {
            const n = h.display_name ?? h.login;
            return `<button type="button" class="sh-pick__r" data-give-id="${esc(h.twitch_user_id)}" data-give-name="${esc(n)}">${pp(n, 22)}<span>${esc(n)}</span></button>`;
          })
          .join('');
      });
    }, 180);
  }
  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    const a = b.dataset.act;
    const val = (sel: string) =>
      p.body.querySelector<HTMLInputElement>(sel)?.value ?? '';
    if (b.dataset.scene) {
      scene = b.dataset.scene as typeof scene;
      return paint();
    }
    if (b.dataset.fkind !== undefined) {
      fKind = b.dataset.fkind;
      return paintShelf();
    }
    if (b.dataset.edit) {
      const it = items.find((i) => i.reward_id === b.dataset.edit);
      if (!it) return;
      void guard().then((go) => {
        if (!go) return;
        openItem(
          {
            reward_id: it.reward_id,
            kind: it.kind,
            label: it.label,
            description: it.description,
            rarity: it.rarity,
            category: it.category,
            unlock_level: it.unlock_level,
            sort: it.sort,
            status: it.status,
            style: { ...blank().style, ...it.style },
            image_id: it.image_id,
            event_key: it.event_key,
          },
          false,
        );
      });
      return;
    }
    if (a === 'new') {
      void guard().then((go) => {
        if (!go) return;
        scene = 'atelier';
        paint();
        openItem(blank(), true);
        p.body.querySelector<HTMLInputElement>('[data-f="label"]')?.focus();
      });
      return;
    }
    if (a === 'wearer') return chooseWearer(b);
    if (b.dataset.kind && isNew) {
      edit.kind = b.dataset.kind as Kind;
      edit.image_id = null;
      imgNote = '';
      paintBench();
      return paintStage();
    }
    if (b.dataset.rarity) {
      edit.rarity = b.dataset.rarity;
      for (const x of p.body.querySelectorAll<HTMLElement>('[data-rarity]')) {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', String(on));
      }
      return edited();
    }
    if (b.dataset.effect) {
      edit.style.effect = b.dataset.effect;
      paintFx();
      return edited();
    }
    if (b.dataset.weight) {
      edit.style.weight = b.dataset.weight as 'bold' | 'normal';
      paintBench();
      return paintStage();
    }
    if (b.dataset.status) {
      edit.status = b.dataset.status as Status;
      paintBench();
      return paintStage();
    }
    if (b.dataset.ocur) {
      // Sans redessiner : le prix et les dates en cours de saisie restent.
      offerCurrency = b.dataset.ocur as 'main' | 'bonbons';
      const box = b.parentElement!;
      box.style.setProperty('--i', offerCurrency === 'main' ? '0' : '1');
      for (const x of box.children) x.classList.toggle('on', x === b);
      return;
    }
    if (a === 'no-image') {
      edit.image_id = null;
      imgNote = '';
      paintBench();
      return paintStage();
    }
    if (a === 'revert') {
      const it = selected();
      if (it) {
        edit = JSON.parse(baseline) as Edit;
        openItem(edit, false);
      }
      return;
    }
    if (a === 'save') {
      const item = itemPayload(edit as unknown as Record<string, unknown>);
      void once(
        b,
        async () => {
          await postJson('/api/cosmetics/items', item);
          isNew = false;
          resetBase();
        },
        'Enregistré.',
      ).then((ok) => {
        if (!ok) return;
        void read().then(paintBench);
      });
      return;
    }
    if (a === 'item-menu') {
      const it = selected();
      menu(b, '', [
        {
          label: 'Dupliquer…',
          icon: 'copy',
          run: () =>
            askId(
              b,
              {
                title: 'Copie en brouillon',
                value: `${edit.reward_id}-2`,
                yes: 'Dupliquer',
              },
              (to) =>
                void once(
                  b,
                  () =>
                    postJson(
                      `/api/cosmetics/items/${edit.reward_id}/duplicate`,
                      { to },
                    ),
                  'Copie créée en brouillon.',
                ).then(() => read()),
            ),
        },
        {
          label: 'Changer l’identifiant…',
          icon: 'gear',
          disabled: it?.status !== 'draft',
          hint: it?.status === 'draft' ? '' : 'brouillon seulement',
          run: () =>
            askId(
              b,
              {
                title: 'Nouvel identifiant',
                value: edit.reward_id,
                yes: 'Changer',
              },
              (to) => {
                if (to === edit.reward_id) return;
                void once(
                  b,
                  async () => {
                    await postJson(
                      `/api/cosmetics/items/${edit.reward_id}/rename`,
                      { to },
                    );
                    edit.reward_id = to;
                    resetBase();
                  },
                  'Identifiant changé.',
                ).then(() => read().then(paintBench));
              },
            ),
        },
      ]);
      return;
    }
    if (a === 'offer-new') {
      offerOpen = 'new';
      offerCurrency = 'main';
      return paintOffers();
    }
    if (a === 'offer-close') {
      offerOpen = null;
      return paintOffers();
    }
    if (b.dataset.offerEdit) {
      const o = selected()?.offers.find(
        (x) => x.offer_id === b.dataset.offerEdit,
      );
      if (!o) return;
      offerOpen = o;
      offerCurrency = o.currency;
      return paintOffers();
    }
    if (a === 'offer') {
      const o = (k: string) =>
        p.body.querySelector<HTMLInputElement>(
          `[data-role="offer-form"] [data-o="${k}"]`,
        )!;
      const opens = o('opens_at').value
        ? parisToIso(o('opens_at').value)
        : null;
      const closes = o('closes_at').value
        ? parisToIso(o('closes_at').value)
        : null;
      const body = {
        offer_id:
          o('offer_id').value.trim() ||
          `${edit.reward_id}-${offerCurrency === 'main' ? 'jetons' : 'bonbons'}`,
        reward_id: edit.reward_id,
        currency: offerCurrency,
        price: Number(o('price').value),
        enabled: o('enabled').checked,
        opens_at: opens,
        closes_at: closes,
        event_key: o('event_key').value.trim() || null,
      };
      void once(
        b,
        () => postJson('/api/cosmetics/offers', body),
        'Offre enregistrée.',
      ).then((ok) => {
        if (!ok) return;
        offerOpen = null;
        void read().then(paintOffers);
      });
      return;
    }
    if (b.dataset.buyf) {
      buyFilter = b.dataset.buyf;
      return paintBuys();
    }
    if (b.dataset.refund) {
      const x = purchases.find((v) => v.purchase_id === b.dataset.refund);
      if (!x) return;
      void choiceBox({
        title: `Rembourser ${x.viewer_name}`,
        body: `${fmt(x.price)} ${CURRENCY[x.currency]} lui reviennent et l’objet lui est retiré. Une seule fois.`,
        choices: [],
        field: { label: 'Raison (gardée dans le journal)', required: true },
        yes: 'Rembourser',
        danger: true,
      }).then((r) => {
        if (!r) return;
        void once(
          b,
          () =>
            postJson(`/api/cosmetics/purchases/${x.purchase_id}/refund`, {
              reason: r.text,
            }),
          'Remboursé.',
        ).then(() => read());
      });
      return;
    }
    if (b.dataset.give) {
      giveKind = b.dataset.give as typeof giveKind;
      awardIntent = crypto.randomUUID();
      return paintGiveItems();
    }
    if (b.dataset.giveId) {
      const id = p.body.querySelector<HTMLInputElement>('[data-a="viewer"]')!;
      const nm = p.body.querySelector<HTMLInputElement>(
        '[data-a="viewer_name"]',
      )!;
      id.value = b.dataset.giveId;
      nm.value = b.dataset.giveName ?? '';
      awardIntent = crypto.randomUUID();
      z('give-hits').replaceChildren();
      return;
    }
    if (a === 'award') {
      const viewer = val('[data-a="viewer"]').trim();
      const name = val('[data-a="viewer_name"]').trim() || viewer;
      const reward = val('[data-a="reward_id"]');
      const amount = Number(val('[data-a="amount"]'));
      if (!/^\d{1,32}$/.test(viewer))
        return toast('Choisis un viewer ou écris son identifiant Twitch.', {
          bad: true,
        });
      if (giveKind === 'reward' ? !reward : !(amount > 0))
        return toast('Dis ce qui est donné.', { bad: true });
      const item =
        giveKind === 'reward'
          ? { kind: giveKind, reward_id: reward }
          : { kind: giveKind, amount };
      const what =
        giveKind === 'reward'
          ? `« ${items.find((i) => i.reward_id === reward)?.label ?? reward} »`
          : `${fmt(amount)} ${giveKind === 'bonbons' ? 'Bonbons' : 'Jetons'}`;
      void confirmBox({
        title: `Donner ${what} à ${name} ?`,
        body:
          giveKind === 'reward'
            ? 'L’objet rejoint sa collection, journalisé.'
            : 'Crédit réel sur son solde, journalisé.',
        yes: 'Donner',
        no: 'Annuler',
        danger: false,
      }).then((yes) => {
        if (!yes) return;
        void once(
          b,
          async () => {
            await postJson('/api/cosmetics/award', {
              module: 'studio',
              key: awardKey(awardIntent, viewer, item),
              viewer,
              viewer_name: name,
              item,
              reference: 'Studio',
            });
            awardIntent = crypto.randomUUID();
          },
          'Donné.',
        ).then(() => read());
      });
    }
  });

  return {
    setVisible(v: boolean) {
      if (v) tick.start();
      else tick.stop();
    },
  };
}
