// Diagnostic mobile (audit du 23/11, _recherches/audit-mobile-twitch-2026-11-23 § 11 P0-1) : comprendre sur un vrai
// téléphone pourquoi un écran reste vide. INERTE sauf dans un paquet construit avec `--diagnostic` (RUNTIME.diagnostics,
// réservé à Hosted Test) : sans ce drapeau, startDiagnostic() ne pose aucun écouteur et diagMark() ne fait rien.
// Avec le drapeau : les erreurs JavaScript (y compris les promesses rejetées), les étapes du Casino et les changements de
// taille sont notés en mémoire dès le démarrage ; le panneau ne s'ouvre que par un geste volontaire — 5 touchers en
// moins de 4 s sur le titre de l'écran (« Raptoru Live » à l'accueil, le nom du module ailleurs).
// Rien n'est envoyé nulle part. Aucune donnée personnelle : ni pseudo, ni identifiant, ni solde, ni jeton (les chaînes
// qui ressemblent à un jeton sont masquées, les URL perdent leurs paramètres sauf platform/anchor/mode/popout).

const MAX = 60;
const OPEN_TAPS = 5;
const OPEN_WINDOW_MS = 4000;
const TITLES = '.jdm-module__screen-title, .rh-brand';
const SESSION_KEY = 'raptoru:diag';
const SAFE_PARAMS = ['platform', 'anchor', 'mode', 'popout'];

let on = false;
let runtime = {};
const journal = [];
let panel = null;
let pill = null;

/** Masque ce qui pourrait identifier ou authentifier : jetons JWT, longues chaînes opaques, paramètres d'URL. */
export function scrub(value) {
  return String(value ?? '')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[jeton masqué]')
    .replace(/(https?:\/\/[^\s?#"')]+)[?#][^\s"'):]*/g, '$1') // (s'arrête au « :ligne:colonne » d'une pile)
    .replace(/(https?:\/\/)[^/\s"')]+/g, '$1…')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[masqué]')
    .slice(0, 500);
}

function push(kind, text) {
  journal.push({ t: Math.round(globalThis.performance?.now?.() ?? 0), kind, text: scrub(text) });
  if (journal.length > MAX) journal.splice(10, 1); // garde les 10 premières entrées (le démarrage) et les plus récentes
  if (panel && !panel.hidden) paint();
}

/** Une étape (« casino: état reçu ») : no-op hors build de diagnostic. */
export function diagMark(scope, text) {
  if (on) push('étape', `${scope} · ${text}`);
}

const stackOf = (e) =>
  String(e?.stack ?? '')
    .split('\n')
    .slice(0, 5)
    .map((l) => l.trim())
    .join(' | ');

/** Démarre le diagnostic si le paquet le permet ; à appeler le plus tôt possible (app/boot.js). */
export function startDiagnostic(rt = {}, win = globalThis.window) {
  if (on || rt.diagnostics !== true || !win?.document) return false;
  on = true;
  runtime = rt;
  push('étape', `démarrage · ${rt.buildId ?? '?'}`);
  win.addEventListener(
    'error',
    (e) => {
      const el = e.target;
      if (el && el !== win && el.tagName) {
        push('ressource', `${el.tagName.toLowerCase()} non chargé : ${el.src || el.href || ''}`);
        return;
      }
      push('erreur', `${e.message} @ ${e.filename ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''} ${stackOf(e.error)}`);
    },
    true,
  );
  win.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    push('promesse', `${r?.name ?? typeof r}: ${r?.message ?? r?.code ?? r} ${stackOf(r)}`);
  });
  let lastSize = '';
  const size = () => {
    const vv = win.visualViewport;
    const s = `${win.innerWidth}×${win.innerHeight}${vv ? ` · visible ${Math.round(vv.width)}×${Math.round(vv.height)}` : ''}`;
    if (s !== lastSize) push('taille', (lastSize = s));
  };
  size();
  win.addEventListener('resize', size);
  win.visualViewport?.addEventListener?.('resize', size);
  // Le geste d'ouverture : 5 touchers sur le titre (un toucher simple n'y fait rien d'autre).
  let taps = [];
  win.document.addEventListener(
    'click',
    (e) => {
      if (!e.target?.closest?.(TITLES)) return;
      const now = Date.now();
      taps = [...taps.filter((t) => now - t < OPEN_WINDOW_MS), now];
      if (taps.length >= OPEN_TAPS) {
        taps = [];
        remember(win, true);
        open(win);
      }
    },
    true,
  );
  if (recalled(win)) showPill(win);
  return true;
}

function remember(win, value) {
  try {
    if (value) win.sessionStorage.setItem(SESSION_KEY, '1');
    else win.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* mémoire seulement */
  }
}
function recalled(win) {
  try {
    return win.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

// --- Le relevé -----------------------------------------------------------------------------------------------------
const rect = (el) => {
  if (!el) return 'absent';
  const b = el.getBoundingClientRect();
  return `${Math.round(b.width)}×${Math.round(b.height)} @${Math.round(b.left)},${Math.round(b.top)}`;
};
const yes = (v) => (v ? 'oui' : 'non');
function supports(win, css) {
  try {
    return win.CSS?.supports?.(css) === true;
  } catch {
    return false;
  }
}
function storage(win, name) {
  try {
    const s = win[name];
    if (!s) return 'absent';
    s.setItem('raptoru:diag-test', '1');
    s.removeItem('raptoru:diag-test');
    return 'oui';
  } catch (e) {
    return `refusé (${e?.name ?? 'erreur'})`;
  }
}

function casinoReport(win) {
  const doc = win.document;
  const hosts = [...doc.querySelectorAll('.cz-host')];
  if (!hosts.length) return ['Casino : aucun écran de jeu ouvert'];
  const host = hosts.find((h) => h.getClientRects().length) ?? hosts[0];
  const D = host.shadowRoot;
  const q = (s) => D?.querySelector(s);
  const body = q('#body');
  const out = [
    `Casino : ${hosts.length} écran(s) · conteneur ${rect(host)}`,
    `  corps : ${body ? `« ${body.className} » ${rect(body)}` : 'absent'}`,
    `  feuilles adoptées : ${D?.adoptedStyleSheets?.length ?? 'n/a'} · <link> : ${D?.querySelectorAll('link').length ?? 0}`,
  ];
  const msg = q('.cz-load, .cz-err');
  if (msg) out.push(`  message affiché : « ${msg.textContent.trim().replace(/\s+/g, ' ').slice(0, 120)} »`);
  const cab = q('.cab');
  if (!cab) {
    out.push('  cabine de machine à sous : absente');
    return out;
  }
  const reels = [...D.querySelectorAll('.reel')];
  const cells = reels.map((r) => r.querySelectorAll('.cell').length);
  const syms = [...D.querySelectorAll('.reel .sym')];
  const shown = syms.filter((s) => {
    const b = s.getBoundingClientRect();
    return b.width > 4 && b.height > 4;
  }).length;
  const spin = q('#spin');
  const bet = q('#bet');
  const cs = win.getComputedStyle?.(q('.window') ?? cab);
  out.push(
    `  cabine ${rect(cab)} · scène ${rect(q('.stage'))}`,
    `  vitre ${rect(q('.window'))} · rouleaux ${rect(q('.reels'))}`,
    `  rouleaux : ${reels.length} · cases par rouleau : ${cells.join(',') || '0'} · symboles : ${syms.length} dont ${shown} visibles (> 4 px)`,
    `  1er rouleau ${rect(reels[0])} · 1re case ${rect(q('.reel .cell'))} · 1er symbole ${rect(syms[0])}`,
    `  bande 1 : ${q('.tape')?.style.transform || 'aucune transformation'} · --peek ${cs?.getPropertyValue('--peek').trim() || '?'}`,
    `  Lancer ${rect(spin)} · contenu ${yes(spin && spin.innerHTML.trim().length > 0)} · mise « ${bet?.value ?? 'absente'} »`,
  );
  return out;
}

function report(win) {
  const doc = win.document;
  const root = doc.documentElement;
  const vv = win.visualViewport;
  const params = new URLSearchParams(win.location.search);
  const kept = SAFE_PARAMS.filter((k) => params.has(k))
    .map((k) => `${k}=${params.get(k)}`)
    .join('&');
  const lines = [
    'Raptoru Live — diagnostic',
    `Build : ${runtime.buildId ?? '?'} · shell ${runtime.shell ?? '?'} · ${runtime.environment ?? runtime.mode ?? '?'}`,
    `Relevé : ${new Date().toISOString()} · ${Math.round((win.performance?.now?.() ?? 0) / 1000)} s après le chargement`,
    `Page : ${win.location.pathname.split('/').pop()}${kept ? `?${kept}` : ''}`,
    `Moteur : ${scrub(win.navigator?.userAgent ?? '?')}`,
    `CSS : container-type ${yes(supports(win, 'container-type: size'))} · cqh ${yes(supports(win, 'height: 1cqh'))} · :has ${yes(supports(win, 'selector(:has(a))'))} · dvh ${yes(supports(win, 'height: 1dvh'))} · zoom ${yes(supports(win, 'zoom: 1'))}`,
    `JS : adoptedStyleSheets ${yes('adoptedStyleSheets' in (win.ShadowRoot?.prototype ?? {}))} · ResizeObserver ${yes(typeof win.ResizeObserver === 'function')} · AudioContext ${yes(!!(win.AudioContext || win.webkitAudioContext))} · localStorage ${storage(win, 'localStorage')} · sessionStorage ${storage(win, 'sessionStorage')}`,
    `Fenêtre : ${win.innerWidth}×${win.innerHeight} · document ${root.clientWidth}×${root.clientHeight} (contenu ${root.scrollWidth}×${root.scrollHeight}, défilé ${Math.round(win.scrollY)})`,
    `Visible : ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} échelle ${vv.scale} décalage ${Math.round(vv.offsetTop)}` : 'visualViewport absent'} · écran ${win.screen?.width}×${win.screen?.height} · dpr ${win.devicePixelRatio} · ${win.screen?.orientation?.type ?? '?'}`,
    `Mise en page : surface ${root.dataset.surface ?? '?'} · profil ${root.dataset.profile ?? '?'} · --vh ${root.style.getPropertyValue('--vh') || '?'} · mq [${root.dataset.mq ?? ''}]`,
    `Écran : panneau ${doc.getElementById('panel')?.dataset.view ?? '?'} · mini-jeux ${doc.querySelector('.mg')?.dataset.screen ?? '—'} · titre « ${doc.querySelector('.jdm-module__screen-name')?.textContent.trim() ?? '—'} »`,
    ...casinoReport(win),
    `Journal (${journal.length}) :`,
    ...journal.map((j) => `  +${j.t} ms [${j.kind}] ${j.text}`),
  ];
  return lines.join('\n');
}

// --- Le panneau ----------------------------------------------------------------------------------------------------
const css = (el, styles) => Object.assign(el.style, styles);
// Shown / hidden through `display` itself: an inline `display` (the panel's flex) wins over the `hidden` attribute.
const show = (el, on, display) => {
  el.hidden = !on;
  el.style.display = on ? display : 'none';
};
function button(doc, label, onClick) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = label;
  css(b, { flex: '1 1 0', minHeight: '40px', padding: '0 6px', border: '1px solid #7c5cbf', borderRadius: '8px', background: '#2a1d45', color: '#fff', font: '600 13px system-ui, sans-serif' });
  b.addEventListener('click', onClick);
  return b;
}

let text = null;
let status = null;
function paint() {
  if (!panel || !text) return;
  text.value = report(panel.ownerDocument.defaultView);
}

function showPill(win) {
  const doc = win.document;
  if (pill) return show(pill, true, 'inline-block');
  pill = doc.createElement('button');
  pill.type = 'button';
  pill.textContent = 'Diag';
  pill.setAttribute('aria-label', 'Ouvrir le diagnostic');
  css(pill, { position: 'fixed', right: '6px', bottom: '6px', zIndex: '2147483000', minWidth: '44px', minHeight: '32px', padding: '0 8px', border: '1px solid #f2c65f', borderRadius: '16px', background: 'rgba(20,12,34,.92)', color: '#f2c65f', font: '700 12px system-ui, sans-serif' });
  pill.addEventListener('click', () => open(win));
  doc.body.append(pill);
}

function open(win) {
  const doc = win.document;
  showPill(win);
  if (!panel) {
    panel = doc.createElement('section');
    panel.setAttribute('aria-label', 'Diagnostic');
    css(panel, { position: 'fixed', left: '4px', right: '4px', bottom: '4px', top: '4px', zIndex: '2147483001', display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', border: '1px solid #f2c65f', borderRadius: '10px', background: 'rgba(10,6,18,.97)', color: '#eee', boxSizing: 'border-box' });
    const bar = doc.createElement('div');
    css(bar, { display: 'flex', gap: '6px' });
    text = doc.createElement('textarea');
    text.readOnly = true;
    text.spellcheck = false;
    css(text, { flex: '1 1 auto', minHeight: '0', width: '100%', boxSizing: 'border-box', resize: 'none', padding: '6px', border: '0', borderRadius: '6px', background: '#000', color: '#d8ffd8', font: '10.5px/1.3 ui-monospace, monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflowX: 'hidden', overflowY: 'auto' });
    status = doc.createElement('small');
    css(status, { color: '#f2c65f', font: '12px system-ui, sans-serif', minHeight: '14px' });
    bar.append(
      button(doc, 'Actualiser', () => {
        paint();
        status.textContent = 'Relevé actualisé.';
      }),
      button(doc, 'Copier', () => void copy(win)),
      button(doc, 'Fermer', () => {
        show(panel, false);
      }),
      button(doc, 'Désactiver', () => {
        show(panel, false);
        if (pill) show(pill, false);
        remember(win, false);
      }),
    );
    panel.append(bar, status, text);
    doc.body.append(panel);
  }
  show(panel, true, 'flex');
  status.textContent = 'Fais une capture d’écran, ou Copier puis colle le texte.';
  paint();
}

async function copy(win) {
  paint();
  try {
    await win.navigator.clipboard.writeText(text.value);
    status.textContent = 'Copié dans le presse-papiers.';
    return;
  } catch {
    /* la WebView peut refuser l'accès au presse-papiers : sélection manuelle */
  }
  text.focus();
  text.select();
  let ok;
  try {
    ok = win.document.execCommand?.('copy') === true;
  } catch {
    ok = false;
  }
  status.textContent = ok ? 'Copié dans le presse-papiers.' : 'Copie refusée : texte sélectionné, appui long → Copier, ou capture d’écran.';
}

/** Tests : état interne (le relevé sans le panneau). */
export const __diag = { journal, report, reset: () => ((on = false), journal.splice(0), (panel = null), (pill = null)) };
