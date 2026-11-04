// Boutique cosmétique V1 (docs/COSMETIC_SHOP.md) — Studio's « Boutique » tab: create and edit titles and badges (texts,
// look, badge image, state), preview them exactly as raptoru.fr draws them (the Core's own stylesheet, served by Studio),
// sell them by offers (Jetons or Bonbons, price, on / off, Paris opening and closing times, event), follow the purchases
// (refund with a reason) and give an item, Bonbons or Jetons by hand. The Core checks everything; Studio never decides.

import './cosmetics.css';
import { frameProblemsOf, itemPayload } from './cosmetics-item.js';

type Json = Record<string, unknown>;
type Style = {
  color: string | null;
  gradient: { from: string; to: string; angle: number } | null;
  effect: string;
  weight: 'normal' | 'bold';
};
type Offer = {
  offer_id: string;
  reward_id: string;
  currency: 'main' | 'bonbons';
  price: number;
  enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  event_key: string | null;
  sort: number;
};
type Kind = 'title' | 'badge' | 'frame' | 'banner';
const KIND_FR: Record<Kind, string> = {
  title: 'Titre',
  badge: 'Badge',
  frame: 'Cadre d’avatar',
  banner: 'Bannière',
};
/** Each image kind's rule, as the Core checks it on the bytes (apps/core-api/src/cosmetics/images.ts). */
const IMAGE_RULE_FR: Record<Exclude<Kind, 'title'>, string> = {
  badge: 'PNG ou WebP fixe, 128 × 128 et 40 Ko au plus',
  frame:
    'PNG ou WebP fixe, carré de 128 à 512 px (512 conseillé), 96 Ko au plus ; centre transparent (l’avatar occupe le cercle central de 62,5 %), 8 px vides sur les bords',
  banner:
    'PNG ou WebP fixe, format 4:1 de 1024 × 256 à 2048 × 512, 256 Ko au plus ; rien d’important dans les 40 % de gauche (voilés sous le pseudo)',
};
/** raptoru.fr's avatar sizes (rows compact / normal, hover card, podium, profile): the frame is drawn at each. */
const FRAME_SIZES = [30, 38, 64, 84, 112];

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

type Item = {
  reward_id: string;
  kind: Kind;
  label: string;
  description: string;
  rarity: string;
  category: string;
  unlock_level: number | null;
  sort: number;
  status: 'draft' | 'published' | 'hidden' | 'archived';
  style: Partial<Style>;
  image_id: string | null;
  event_key: string | null;
  owners: number;
  offers: Offer[];
};
type Purchase = {
  purchase_id: string;
  viewer_id: string;
  viewer_name: string;
  reward_id: string;
  currency: 'main' | 'bonbons';
  price: number;
  status: 'completed' | 'refunded';
  created_at: string;
  refund_reason: string | null;
};

const HEADERS = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const fmt = (n: number) => Number(n || 0).toLocaleString('fr-FR');
const STATUS_FR: Record<string, string> = {
  draft: 'Brouillon',
  published: 'Publié',
  hidden: 'Masqué',
  archived: 'Archivé',
};
const EFFECT_FR: Record<string, string> = {
  none: 'Aucun',
  glow: 'Lueur',
  shine: 'Brillance',
  pulse: 'Pulsation',
  rainbow: 'Arc-en-ciel',
  sparkle: 'Étincelles',
};
const CURRENCY_FR: Record<string, string> = {
  main: 'Jetons',
  bonbons: 'Bonbons',
};
const RARITY_FR: Record<string, string> = {
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
  event: 'Événement',
};

/** The look on an element, exactly as raptoru.fr applies it (the classes and variables of the Core's stylesheet). */
export function applyLook(
  el: HTMLElement,
  kind: 'title' | 'badge',
  style: Partial<Style>,
) {
  el.className = kind === 'title' ? 'rc-title' : 'rc-badge';
  if (kind === 'title' && style.gradient) el.classList.add('rc-grad');
  if (style.effect && style.effect !== 'none')
    el.classList.add(`rc-fx-${style.effect}`);
  const set = (k: string, v: string | null | undefined) =>
    v ? el.style.setProperty(k, v) : el.style.removeProperty(k);
  set('--rc-color', style.color ?? null);
  set('--rc-from', style.gradient?.from);
  set('--rc-to', style.gradient?.to);
  set('--rc-angle', style.gradient ? `${style.gradient.angle}deg` : null);
  set('--rc-weight', style.weight === 'normal' ? '400' : '700');
}

/** Europe/Paris wall time (datetime-local) ↔ an instant with its offset, whatever the clock change. */
export function parisToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return (
      Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t
    );
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  const off = Math.round(offsetAt(t) / 60000);
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${sign}${hh}:${mm}`;
}
export function isoToParis(iso: string | null): string {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

const BLANK: Omit<Item, 'owners' | 'offers'> = {
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
};

export function mountCosmetics(root: HTMLElement) {
  let items: Item[] = [];
  let purchases: Purchase[] = [];
  let edit: Omit<Item, 'owners' | 'offers'> & { isNew: boolean } = {
    ...BLANK,
    isNew: true,
  };
  let flash = '';
  let error = '';
  let visible = false;
  let view: 'atelier' | 'achats' = 'atelier';
  let query = '';
  let fKind = '';
  let fStatus = '';

  // The Core's own stylesheet, once (the preview = the site's rendering).
  if (!document.querySelector('link[data-rc-style]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/cosmetics/style.css';
    link.dataset.rcStyle = '1';
    document.head.append(link);
  }

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new Error(String(out.error ?? `HTTP ${res.status}`));
    return out;
  };
  // One action at a time: a double click must not send twice (« Donner » credits the real Wallet, one key per click).
  let acting = false;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (acting) return;
    acting = true;
    try {
      await fn();
      flash = ok;
    } catch (e) {
      flash = `Refusé : ${(e as Error).message}`;
    } finally {
      acting = false;
    }
    await load();
  };
  const load = async () => {
    try {
      items = (await call('/api/cosmetics/items')) as unknown as Item[];
      purchases = (await call(
        '/api/cosmetics/purchases',
      )) as unknown as Purchase[];
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
    render();
  };

  /** A frame around a neutral avatar, with raptoru.fr's geometry (the avatar is 62.5 % of the slot). */
  const framed = (image: string | null, av: number) => {
    const slot = Math.round(av / 0.625);
    return `<span class="rc-av" style="--av:${av}px;--slot:${slot}px"><span class="rc-av-img"></span>${image ? `<img class="rc-av-frame" src="/cosmetics/images/${esc(image)}" alt="">` : ''}</span>`;
  };
  const bannerHtml = (image: string | null, name: string, wide = true) =>
    `<span class="rc-banner${wide ? '' : ' rc-banner-s'}"${image ? ` style="--banner:url('/cosmetics/images/${esc(image)}')"` : ''}><span class="rc-banner-veil"></span>${framed(null, wide ? 64 : 30)}<b>${esc(name)}</b></span>`;
  const lookHtml = (kind: Kind, label: string, image: string | null) =>
    kind === 'frame'
      ? framed(image, 30)
      : kind === 'banner'
        ? bannerHtml(image, label || 'Bannière', false)
        : kind === 'title'
          ? `<span data-look>${esc(label || 'Titre')}</span>`
          : `<span data-look>${image ? `<img src="/cosmetics/images/${esc(image)}" alt="">` : esc((label || 'B').slice(0, 2))}</span>`;

  /** After each render: every [data-look] gets its item's look (classes + variables, never HTML). */
  const paintLooks = () => {
    root.querySelectorAll<HTMLElement>('[data-row]').forEach((row) => {
      const it = items.find((i) => i.reward_id === row.dataset.row);
      const el = row.querySelector<HTMLElement>('[data-look]');
      if (it && el && (it.kind === 'title' || it.kind === 'badge'))
        applyLook(el, it.kind, it.style);
    });
    const prev = root.querySelectorAll<HTMLElement>(
      '[data-preview] [data-look]',
    );
    const k = edit.kind;
    if (k === 'title' || k === 'badge')
      prev.forEach((el) => applyLook(el, k, edit.style));
  };

  const offerRow = (o: Offer) =>
    `<tr><td><code>${esc(o.offer_id)}</code></td><td>${fmt(o.price)} ${esc(CURRENCY_FR[o.currency])}</td><td>${o.enabled ? 'en vente' : 'arrêtée'}</td><td>${o.opens_at ? esc(new Date(o.opens_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })) : '—'} → ${o.closes_at ? esc(new Date(o.closes_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })) : '—'}</td><td>${esc(o.event_key ?? '—')}</td><td><button type="button" class="rs-btn sm quiet" data-offer-edit="${esc(o.offer_id)}">Modifier</button></td></tr>`;

  /** Catalogue rows, filtered (type, state, text); redrawn alone while typing in the search box. */
  const catalogueRows = () => {
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
    return (
      list
        .map(
          (i) =>
            `<tr data-row="${esc(i.reward_id)}"${!edit.isNew && edit.reward_id === i.reward_id ? ' aria-current="true"' : ''}><td class="rc-preview-cell">${lookHtml(i.kind, i.label, i.image_id)}</td><td><b>${esc(i.label)}</b><small><code>${esc(i.reward_id)}</code>${i.event_key ? ` · ${esc(i.event_key)}` : ''}</small></td><td>${esc(KIND_FR[i.kind] ?? i.kind)}</td><td><span class="rs-chip is-${i.status}">${esc(STATUS_FR[i.status])}</span></td><td>${i.offers.map((o) => `${fmt(o.price)} ${esc(CURRENCY_FR[o.currency])}${o.enabled ? '' : ' (arrêtée)'}`).join(' · ') || '<span class="rs-muted">non vendu</span>'}</td><td class="num">${fmt(i.owners)}</td><td class="cs-actions"><button type="button" class="rs-btn sm quiet" data-edit="${esc(i.reward_id)}">Modifier</button> <button type="button" class="rs-btn sm quiet" data-dup="${esc(i.reward_id)}">Dupliquer</button></td></tr>`,
        )
        .join('') ||
      `<tr><td colspan="7" class="rs-muted">${items.length ? 'Aucun objet ne correspond aux filtres.' : 'Aucun objet pour l’instant : « Nouvel objet » ouvre l’atelier.'}</td></tr>`
    );
  };

  function render() {
    if (!visible) return;
    if (error && !items.length) {
      root.innerHTML = `<div class="rs-page"><header class="rs-page-head"><h1>Boutique</h1></header><p class="rs-muted">Boutique indisponible : ${esc(error)} (Core du profil sans la boutique ?).</p></div>`;
      return;
    }
    const sel = items.find(
      (i) => i.reward_id === edit.reward_id && !edit.isNew,
    );
    const st = edit.style;
    const imageKind = edit.kind === 'frame' || edit.kind === 'banner';
    const opt = (map: Record<string, string>, cur: string) =>
      Object.entries(map)
        .map(
          ([k, v]) =>
            `<option value="${k}" ${cur === k ? 'selected' : ''}>${v}</option>`,
        )
        .join('');
    root.innerHTML = `<div class="rs-page rs-form cs">
      <header class="rs-page-head rs-head-row"><div><h1>Boutique</h1>
        <p>Titres, badges, cadres et bannières : un seul catalogue, rendu comme sur raptoru.fr. Le Core fixe prix, soldes et possession.</p></div>
        <button type="button" class="rs-btn primary" data-act="new">Nouvel objet</button></header>
      ${flash ? `<p class="rs-flash${/^(Refusé|Image refusée|Cadre refusé)/.test(flash) ? ' is-bad' : ''}" role="status">${esc(flash)}</p>` : ''}
      <div class="rs-seg" role="tablist" aria-label="Boutique">
        <button type="button" role="tab" data-view="atelier" aria-selected="${view === 'atelier'}">Catalogue et atelier</button>
        <button type="button" role="tab" data-view="achats" aria-selected="${view === 'achats'}">Achats et dons</button>
      </div>
      ${view === 'achats' ? achatsHtml() : atelierHtml(sel, st, imageKind, opt)}
    </div>`;
    paintLooks();
  }

  function atelierHtml(
    sel: Item | undefined,
    st: Partial<Style>,
    imageKind: boolean,
    opt: (map: Record<string, string>, cur: string) => string,
  ) {
    return `
      <section class="rs-panel"><h2>Catalogue</h2>
        <div class="rs-filters">
          <input type="search" data-q placeholder="Rechercher (nom, identifiant, événement)" value="${esc(query)}" aria-label="Rechercher dans le catalogue">
          <select data-filter="kind" aria-label="Type"><option value="">Tous les types</option>${opt(KIND_FR, fKind)}</select>
          <select data-filter="status" aria-label="État"><option value="">Tous les états</option>${opt(STATUS_FR, fStatus)}</select>
        </div>
        <div class="rs-scroll"><table class="rs-tbl"><thead><tr><th>Aperçu</th><th>Objet</th><th>Type</th><th>État</th><th>Offres</th><th class="num">Possédé par</th><th></th></tr></thead><tbody data-role="catalogue">${catalogueRows()}</tbody></table></div>
      </section>
      <section class="rs-panel" data-role="atelier"><h2>${edit.isNew ? 'Atelier — nouvel objet' : `Atelier — « ${esc(edit.label)} » <span class="rs-chip is-${edit.status}">${esc(STATUS_FR[edit.status])}</span>`}</h2>
        <div class="cs-atelier">
        <div class="cs-form" data-role="item-form">
          <div class="rs-step"><h2><i>1</i> Type et identifiant</h2>
            <div class="rs-fields">
              <label>Type <select data-f="kind" ${edit.isNew ? '' : 'disabled'}>${opt(KIND_FR, edit.kind)}</select><small>${edit.isNew ? 'Figé après la création.' : 'Figé.'}</small></label>
              <label>Identifiant <input data-f="reward_id" maxlength="48" value="${esc(edit.reward_id)}" ${edit.isNew ? '' : 'disabled'} placeholder="ex. roi-citrouille"><small>Ne change plus une fois l’objet sorti du brouillon.</small></label>
            </div>
            ${!edit.isNew && edit.status === 'draft' ? '<p><button type="button" class="rs-btn sm quiet" data-act="rename">Changer l’identifiant…</button></p>' : ''}</div>
          <div class="rs-step"><h2><i>2</i> Présentation</h2>
            <div class="rs-fields">
              <label>Nom affiché <input data-f="label" maxlength="60" value="${esc(edit.label)}"></label>
              <label>Catégorie <input data-f="category" maxlength="32" value="${esc(edit.category)}"></label>
              <label class="span2">Description <input data-f="description" maxlength="200" value="${esc(edit.description)}"></label>
              <label>Rareté <select data-f="rarity">${opt(RARITY_FR, edit.rarity)}</select></label>
            </div></div>
          <div class="rs-step"><h2><i>3</i> Apparence</h2>
            <div class="cs-look" data-role="look-form" ${imageKind ? 'hidden' : ''}>
              <label class="rs-check"><input type="checkbox" data-l="use-color" ${st.color ? 'checked' : ''}> <span>Couleur</span></label>
              <label>Couleur <input type="color" data-l="color" value="${esc(st.color ?? '#ffffff')}"></label>
              <label class="rs-check"><input type="checkbox" data-l="use-gradient" ${st.gradient ? 'checked' : ''}> <span>Dégradé</span></label>
              <label>de <input type="color" data-l="from" value="${esc(st.gradient?.from ?? '#ff8a00')}"></label>
              <label>à <input type="color" data-l="to" value="${esc(st.gradient?.to ?? '#ffd36b')}"></label>
              <label>Angle <input type="range" min="0" max="360" step="15" data-l="angle" value="${st.gradient?.angle ?? 90}"></label>
              <label>Effet <select data-l="effect">${opt(EFFECT_FR, st.effect ?? 'none')}</select></label>
              <label>Graisse <select data-l="weight"><option value="bold" ${st.weight !== 'normal' ? 'selected' : ''}>Gras</option><option value="normal" ${st.weight === 'normal' ? 'selected' : ''}>Normal</option></select></label>
            </div>
            ${
              edit.kind !== 'title'
                ? `<div class="cs-image"><label>Image <input type="file" accept="image/png,image/webp" data-role="image"><small>${IMAGE_RULE_FR[edit.kind]}.</small></label>${edit.image_id ? `<button type="button" class="rs-btn sm quiet" data-act="no-image">Retirer l’image</button>` : ''}</div>${imageKind ? '<p class="rs-note">Un cadre ou une bannière ne sort du brouillon qu’avec son image.</p>' : ''}`
                : ''
            }
            <p class="rs-muted">Aucun code ni CSS n’est saisi : l’apparence est faite de ces réglages.</p></div>
          <div class="rs-step"><h2><i>4</i> Disponibilité</h2>
            <div class="rs-fields">
              <label>État <select data-f="status">${opt(STATUS_FR, edit.status)}</select><small>Publié : visible et vendable avec une offre. Masqué : hors boutique, gardé par ceux qui l’ont. Archivé : idem, retiré de la gestion courante.</small></label>
              <label>Événement <input data-f="event_key" maxlength="40" placeholder="ex. halloween-2026" value="${esc(edit.event_key ?? '')}"></label>
              <label>Débloqué au niveau <input type="number" data-f="unlock_level" min="1" placeholder="aucun" value="${edit.unlock_level ?? ''}"></label>
              <label>Ordre <input type="number" data-f="sort" min="-1000" max="1000" value="${edit.sort}"></label>
            </div></div>
        </div>
        <aside class="cs-side">
          <div class="rc-studio-preview" data-preview>
            <p class="rs-muted">Aperçu (rendu de raptoru.fr)</p>
            ${
              edit.kind === 'frame'
                ? `<p class="rc-preview-line">${FRAME_SIZES.map((s) => framed(edit.image_id, s)).join('')}</p><p class="rs-muted">Lignes compacte et normale, carte de survol, podium, profil.</p>`
                : edit.kind === 'banner'
                  ? `<p class="rc-preview-line">${bannerHtml(edit.image_id, 'Pseudo')}</p><p class="rc-preview-line">${bannerHtml(edit.image_id, 'Pseudo', false)}</p><p class="rs-muted">En-tête du profil et carte de survol (voile à gauche), puis une ligne étroite : seule la droite se voit.</p>`
                  : `<p class="rc-preview-line"><b>Pseudo</b> ${lookHtml(edit.kind, edit.label, edit.image_id)}</p>`
            }
            ${edit.kind === 'badge' ? `<p class="rc-preview-line rc-preview-big">${lookHtml('badge', edit.label, edit.image_id)}</p>` : ''}
          </div>
          <button type="button" class="rs-btn primary" data-act="save">${edit.isNew ? 'Créer' : 'Enregistrer'}</button>
          <p class="rs-muted">Enregistrer en « Publié » rend l’objet visible sur le site ; il n’est en vente qu’avec une offre active (section 5).</p>
        </aside>
        </div>
      </section>
      ${
        sel
          ? `<section class="rs-panel rs-step" data-role="offers"><h2><i>5</i> Offres de « ${esc(sel.label)} »</h2>
        <div class="rs-scroll"><table class="rs-tbl"><thead><tr><th>Offre</th><th>Prix</th><th>État</th><th>Ouverture → fermeture (Paris)</th><th>Événement</th><th></th></tr></thead><tbody>
          ${sel.offers.map(offerRow).join('') || '<tr><td colspan="6" class="rs-muted">Pas encore en vente.</td></tr>'}
        </tbody></table></div>
        <div class="cs-offer" data-role="offer-form">
          <label>Offre <input data-o="offer_id" maxlength="64" placeholder="${esc(sel.reward_id)}-jetons"></label>
          <label>Monnaie <select data-o="currency"><option value="main">Jetons</option><option value="bonbons">Bonbons</option></select></label>
          <label>Prix <input type="number" data-o="price" min="1" step="1"></label>
          <label class="rs-check"><input type="checkbox" data-o="enabled"> <span>En vente</span></label>
          <label>Ouverture <input type="datetime-local" data-o="opens_at"></label>
          <label>Fermeture <input type="datetime-local" data-o="closes_at"></label>
          <label>Événement <input data-o="event_key" maxlength="40" placeholder="(aucun)"></label>
          <div><button type="button" class="rs-btn" data-act="offer">Enregistrer l’offre</button></div>
        </div>
        <p class="rs-muted">L’objet doit être <b>Publié</b> pour être vendu. Dates en heure de Paris (vide : sans limite). Avec un événement : en vente seulement quand cet événement est ouvert. Un même objet peut avoir une offre en Jetons et une autre en Bonbons.</p>
      </section>`
          : edit.isNew
            ? ''
            : '<section class="rs-panel"><p class="rs-muted">Enregistre l’objet pour lui ajouter des offres.</p></section>'
      }`;
  }

  function achatsHtml() {
    return `<div class="cs-achats">
      <section class="rs-panel"><h2>Derniers achats</h2>
        <p class="rs-muted">« Rembourser… » recrédite la monnaie payée et retire l’objet au viewer, une seule fois ; la raison est journalisée.</p>
        <div class="rs-scroll"><table class="rs-tbl"><thead><tr><th>Quand</th><th>Viewer</th><th>Objet</th><th>Payé</th><th>État</th><th></th></tr></thead><tbody>
        ${
          purchases
            .slice(0, 50)
            .map(
              (p) =>
                `<tr><td>${esc(new Date(p.created_at).toLocaleString('fr-FR'))}</td><td>${esc(p.viewer_name)} <small>${esc(p.viewer_id)}</small></td><td><code>${esc(p.reward_id)}</code></td><td>${fmt(p.price)} ${esc(CURRENCY_FR[p.currency])}</td><td>${p.status === 'refunded' ? `remboursé${p.refund_reason ? ` (${esc(p.refund_reason)})` : ''}` : 'payé'}</td><td>${p.status === 'completed' ? `<button type="button" class="rs-btn sm danger" data-refund="${esc(p.purchase_id)}">Rembourser…</button>` : ''}</td></tr>`,
            )
            .join('') ||
          '<tr><td colspan="6" class="rs-muted">Aucun achat.</td></tr>'
        }
        </tbody></table></div>
      </section>
      <section class="rs-panel"><h2>Donner à un viewer</h2>
        <div class="rs-fields" data-role="award-form">
          <label>Identifiant Twitch <input data-a="viewer" maxlength="32"></label>
          <label>Pseudo <input data-a="viewer_name" maxlength="64"></label>
          <label>Quoi <select data-a="kind"><option value="reward">un objet de la Boutique</option><option value="bonbons">des Bonbons</option><option value="jetons">des Jetons</option></select></label>
          <label>Objet <select data-a="reward_id">${items
            .filter((i) => i.status !== 'draft')
            .map(
              (i) =>
                `<option value="${esc(i.reward_id)}">${esc(i.label)}</option>`,
            )
            .join('')}</select></label>
          <label>Quantité <input type="number" data-a="amount" min="1" step="1" value="1"><small>Pour les Bonbons et les Jetons.</small></label>
          <div><button type="button" class="rs-btn" data-act="award">Donner</button></div>
        </div>
        <p class="rs-muted">Crédit réel sur le Core du profil, une fois par clic (clé unique), journalisé.</p>
      </section>
    </div>`;
  }

  const readItemForm = () => {
    const f = (k: string) =>
      root.querySelector<HTMLInputElement>(
        `[data-role="item-form"] [data-f="${k}"], [data-f="${k}"]`,
      )!;
    const l = (k: string) =>
      root.querySelector<HTMLInputElement>(`[data-l="${k}"]`)!;
    const level = f('unlock_level').value.trim();
    edit = {
      ...edit,
      reward_id: edit.isNew ? f('reward_id').value.trim() : edit.reward_id,
      kind: (edit.isNew ? f('kind').value : edit.kind) as Kind,
      label: f('label').value.trim(),
      description: f('description').value.trim(),
      category: f('category').value.trim() || 'general',
      rarity: f('rarity').value,
      status: f('status').value as Item['status'],
      sort: Number(f('sort').value) || 0,
      unlock_level: level ? Number(level) : null,
      event_key: f('event_key').value.trim() || null,
      style: {
        color: l('use-color').checked ? l('color').value : null,
        gradient: l('use-gradient').checked
          ? {
              from: l('from').value,
              to: l('to').value,
              angle: Number(l('angle').value),
            }
          : null,
        effect: l('effect').value,
        weight: l('weight').value as 'bold' | 'normal',
      },
    };
  };

  // Live preview while editing the look or the name; the search box redraws the catalogue rows only.
  root.addEventListener('input', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.matches('[data-q]')) {
      query = (t as HTMLInputElement).value;
      const body = root.querySelector('[data-role="catalogue"]');
      if (body) body.innerHTML = catalogueRows();
      paintLooks();
      return;
    }
    if (
      !t.closest('[data-role="look-form"]') &&
      !t.closest('[data-role="item-form"]')
    )
      return;
    readItemForm();
    root
      .querySelectorAll<HTMLElement>('[data-preview] [data-look]')
      .forEach((el) => {
        const k = edit.kind;
        if (k === 'title') el.textContent = edit.label || 'Titre';
        if (k === 'title' || k === 'badge') applyLook(el, k, edit.style);
      });
  });

  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.filter) {
      if (t.dataset.filter === 'kind') fKind = t.value;
      else fStatus = t.value;
      readItemForm();
      render();
      return;
    }
    if (t.dataset.f === 'kind') {
      readItemForm();
      render();
    }
    if (t.dataset.role === 'image' && t.files?.[0]) {
      readItemForm();
      void upload(t.files[0], edit.kind === 'title' ? 'badge' : edit.kind);
    }
  });

  /** The atelier: a frame is checked here first (transparent centre, empty border); the Core checks every file again. */
  async function upload(file: File, purpose: Exclude<Kind, 'title'>) {
    if (purpose === 'frame') {
      const problems = await frameProblems(file).catch(() => [
        'image illisible',
      ]);
      if (problems.length) {
        flash = `Cadre refusé : ${problems.join(' ; ')}.`;
        render();
        return;
      }
    }
    {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result).split(',')[1] ?? '';
        void call('/api/cosmetics/images', { data_base64: b64, purpose }).then(
          (r) => {
            edit.image_id = String(r.image_id);
            flash = `Image acceptée (${r.width} × ${r.height}, ${fmt(Number(r.size))} o).`;
            render();
          },
          (e: Error) => {
            flash = `Image refusée : ${e.message}`;
            render();
          },
        );
      };
      reader.readAsDataURL(file);
    }
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const editId = t.closest<HTMLElement>('[data-edit]')?.dataset.edit;
    const dupId = t.closest<HTMLElement>('[data-dup]')?.dataset.dup;
    const offerId =
      t.closest<HTMLElement>('[data-offer-edit]')?.dataset.offerEdit;
    const refundId = t.closest<HTMLElement>('[data-refund]')?.dataset.refund;
    const o = (k: string) =>
      root.querySelector<HTMLInputElement>(
        `[data-role="offer-form"] [data-o="${k}"]`,
      )!;
    const toView = t.closest<HTMLElement>('[data-view]')?.dataset.view;
    const showAtelier = () =>
      root
        .querySelector('[data-role="atelier"]')
        ?.scrollIntoView({ block: 'start' });
    if (toView === 'atelier' || toView === 'achats') {
      if (view === 'atelier') readItemForm(); // the atelier's unsaved fields survive the switch
      view = toView;
      render();
    } else if (editId) {
      const it = items.find((i) => i.reward_id === editId)!;
      edit = {
        ...BLANK,
        ...it,
        style: { ...BLANK.style, ...it.style },
        isNew: false,
      };
      flash = '';
      render();
      showAtelier();
    } else if (dupId) {
      const to = prompt(
        'Identifiant de la copie (brouillon) :',
        `${dupId}-2`,
      )?.trim();
      if (to)
        void act(
          () => call(`/api/cosmetics/items/${dupId}/duplicate`, { to }),
          'Copie créée (brouillon).',
        );
    } else if (offerId && edit) {
      const off = items
        .flatMap((i) => i.offers)
        .find((x) => x.offer_id === offerId)!;
      o('offer_id').value = off.offer_id;
      o('currency').value = off.currency;
      o('price').value = String(off.price);
      o('enabled').checked = off.enabled;
      o('opens_at').value = isoToParis(off.opens_at);
      o('closes_at').value = isoToParis(off.closes_at);
      o('event_key').value = off.event_key ?? '';
    } else if (refundId) {
      const reason = prompt(
        'Raison du remboursement (gardée dans le journal) :',
      )?.trim();
      if (reason)
        void act(
          () => call(`/api/cosmetics/purchases/${refundId}/refund`, { reason }),
          'Remboursé.',
        );
    } else if (a === 'new') {
      edit = { ...BLANK, isNew: true };
      flash = '';
      view = 'atelier';
      render();
      showAtelier();
    } else if (a === 'no-image') {
      readItemForm();
      edit.image_id = null;
      render();
    } else if (a === 'save') {
      readItemForm();
      const item = itemPayload(edit);
      void act(async () => {
        await call('/api/cosmetics/items', item);
        edit.isNew = false;
      }, 'Enregistré.');
    } else if (a === 'rename') {
      const to = prompt(
        'Nouvel identifiant (possible tant que l’objet est un brouillon) :',
        edit.reward_id,
      )?.trim();
      if (to && to !== edit.reward_id)
        void act(async () => {
          await call(`/api/cosmetics/items/${edit.reward_id}/rename`, { to });
          edit.reward_id = to;
        }, 'Identifiant changé.');
    } else if (a === 'offer') {
      const opens = o('opens_at').value
        ? parisToIso(o('opens_at').value)
        : null;
      const closes = o('closes_at').value
        ? parisToIso(o('closes_at').value)
        : null;
      void act(
        () =>
          call('/api/cosmetics/offers', {
            offer_id:
              o('offer_id').value.trim() ||
              `${edit.reward_id}-${o('currency').value === 'main' ? 'jetons' : 'bonbons'}`,
            reward_id: edit.reward_id,
            currency: o('currency').value,
            price: Number(o('price').value),
            enabled: o('enabled').checked,
            opens_at: opens,
            closes_at: closes,
            event_key: o('event_key').value.trim() || null,
          }),
        'Offre enregistrée.',
      );
    } else if (a === 'award') {
      const w = (k: string) =>
        root.querySelector<HTMLInputElement>(
          `[data-role="award-form"] [data-a="${k}"]`,
        )!;
      const kind = w('kind').value;
      void act(
        () =>
          call('/api/cosmetics/award', {
            module: 'studio',
            key: `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            viewer: w('viewer').value.trim(),
            viewer_name:
              w('viewer_name').value.trim() || w('viewer').value.trim(),
            item:
              kind === 'reward'
                ? { kind, reward_id: w('reward_id').value }
                : { kind, amount: Number(w('amount').value) },
            reference: 'Studio',
          }),
        'Donné.',
      );
    }
  });

  return {
    setVisible(on: boolean) {
      visible = on;
      if (on) void load();
    },
  };
}
