// Bonk lot 5 — the chargeur (salves). Port of the validated prototype
// prototypes/bonk-salves-ux/serie7/final.html (« Switch à droite »). Persistent DOM: built once, then only
// the parts that change are updated (no re-render, no animation restart); the host moves the same node
// between renders (like the emote picker). Fixed row: [well][Manuel/Auto 72 px][slot 28 px][price 84 px] —
// nothing moves or resizes between Manuel and Auto. Economy: the host's onFire (Manuel, one individual
// Bonk per click) and onSalve (Auto, one atomic salve) talk to Core; this view never decides a price.
import { BONK_SPEEDS, createChargeurModel } from './bonk-chargeur-model.js';

const TRASH =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6.1 1.8h3.8l.6 1.3h3.3v1.6H2.2V3.1h3.3zM3.4 5.8h9.2l-.8 8.4H4.2z"/></svg>';
const BOLT =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.6 1.2 3.4 9.1h4.1l-1.1 5.7 6.2-8H8.5z"/></svg>';
const SWITCH_TIP =
  'Manuel : 1 clic = 1 Bonk · Auto : 1 clic = toute la salve (clic pour changer)';
/** Canonical Core bound, used only until Core has sent its own (older Core without salves). */
const FALLBACK_MAX_SHOTS = 10;

const html = (strings, ...values) =>
  strings.reduce((out, s, i) => out + s + (values[i] ?? ''), '');
const sw = (demo) =>
  html`<button type="button" class="bkc-sw${demo === 'auto' ? ' is-auto' : ''}" ${demo ? 'tabindex="-1"' : `data-bkc="mode" role="switch" title="${SWITCH_TIP}"`}><span class="bkc-sw__k"><span class="bkc-sw__lbl"><span class="m">Manuel</span><span class="a">Auto</span></span></span></button>`;
const bolt = (demo) =>
  html`<button type="button" class="bkc-bolt" data-level="${demo ? 3 : 2}" ${demo ? 'tabindex="-1"' : 'data-bkc="speed"'}><span class="bkc-bolt__ic"><span class="bkc-bolt__o">${BOLT}</span><span class="bkc-bolt__f">${BOLT}</span></span><span class="bkc-bolt__ticks"><i></i><i></i><i></i><i></i></span></button>`;
const wipe = (demo) =>
  html`<button type="button" class="bkc-wipe" ${demo ? 'tabindex="-1"' : 'data-bkc="clear" title="Vider toutes les munitions" aria-label="Vider toutes les munitions"'}><span class="bkc-wipe__ic">${TRASH}</span></button>`;

function template() {
  return html`
    <p class="bkc-hint"><span class="bkc-hint__dot"></span>Touche une emote pour la charger</p>
    <div class="bkc-wrap"><div class="bkc-wrap__in">
      <div class="bkc-dock" data-bkc-dock>
        <button type="button" class="bkc-grab" data-bkc="fold" data-spot-target="grab" title="Réduire / déplier le chargeur" aria-label="Réduire ou déplier le chargeur"><i></i></button>
        <div class="bkc-left">
          <div class="bkc-fold"><div class="bkc-fold__in">
            <div class="bkc-well" data-spot-target="car">
              ${wipe()}
              <div class="bkc-carbox" data-bkc-carbox>
                <div class="bkc-car" data-bkc-car role="list" aria-label="Munitions chargées"></div>
                <button type="button" class="bkc-arr bkc-arr--l" data-bkc="nav" data-dir="-1" tabindex="-1" aria-label="Défiler vers la gauche"><i></i></button>
                <button type="button" class="bkc-arr bkc-arr--r" data-bkc="nav" data-dir="1" tabindex="-1" aria-label="Défiler vers la droite"><i></i></button>
              </div>
            </div>
          </div></div>
          <div class="bkc-gl"><div class="bkc-g" data-bkc-gauge></div><span class="bkc-count" data-bkc-count title="Munitions prêtes / chargées"></span></div>
        </div>
        <div class="bkc-right">
          ${sw()}
          <span class="bkc-opt">${bolt()}</span>
          <button type="button" class="bkc-cta" data-bkc="cta"><span class="bkc-cta__in" data-bkc-label></span><span class="bkc-cta__bar" data-bkc-bar></span></button>
        </div>
      </div>
    </div></div>
    <div class="bkc-toast" role="status" aria-live="polite"><span data-bkc-toast></span><button type="button" data-bkc="undo">Annuler</button></div>
    <div class="bkc-shade" data-bkc-shade>
      <div class="bkc-help" role="dialog" aria-label="Aide du chargeur Bonk">
        <div class="bkc-help__head"><b>Le chargeur Bonk</b><span>survole une ligne pour voir où c’est</span><button type="button" class="bkc-help__x" data-bkc="help-close" title="Fermer" aria-label="Fermer l’aide">✕</button></div>
        <div class="bkc-help__row" data-spot="car"><span class="bkc-help__demo" inert><span class="bkc-am bkc-demo"><span class="bkc-am__glyph">😀</span><b class="bkc-badge">3</b></span></span><span class="bkc-help__t"><b>Charger</b> : touche une emote du catalogue (+1). Dans le chargeur : clic −1, clic droit retire tout.</span></div>
        <div class="bkc-help__row" data-spot="mode"><span class="bkc-help__demo" inert>${sw('manual')}</span><span class="bkc-help__t"><b>Manuel</b> : 1 clic = 1 Bonk. <b>Auto</b> : 1 clic = tout ce qui reste, d’affilée.</span></div>
        <div class="bkc-help__row" data-spot="speed"><span class="bkc-help__demo" inert>${bolt(true)}</span><span class="bkc-help__t"><b>Vitesse</b> (Auto) : chaque clic passe au niveau suivant — Lent, Moyen, Rapide, Très rapide.</span></div>
        <div class="bkc-help__row" data-spot="cta"><span class="bkc-help__demo" inert><span class="bkc-cta bkc-demo"><span class="bkc-cta__in">◆ 200</span></span></span><span class="bkc-help__t"><b>Tirer / Envoyer</b> : le bouton affiche le prix du clic. Chargeur vide : <b>↻ Recharger</b> (gratuit).</span></div>
        <div class="bkc-help__row" data-spot="clear"><span class="bkc-help__demo" inert><span class="bkc-help__pair">${wipe(true)}<span class="bkc-grab bkc-demo"><i></i></span></span></span><span class="bkc-help__t"><b>Vider</b> : languette rouge à gauche des munitions (annulable) · <b>Réduire</b> : on garde le tir et le mode.</span></div>
      </div>
    </div>`;
}

/**
 * @param {{
 *   document: Document,
 *   renderEmote: (emote: object) => Node,
 *   onFire: (emote: object) => Promise<boolean>,
 *   onSalve: (emotes: object[], cadenceMs: number, key: string) => Promise<boolean>,
 *   newKey: () => string,
 * }} deps
 */
export function createBonkChargeur({ document, renderEmote, onFire, onSalve, newKey }) {
  const model = createChargeurModel({ maxShots: FALLBACK_MAX_SHOTS });
  const m = model.state;
  const config = { cost: 0, cadence: { min: 90, max: 600 }, auto: false, ready: true, reason: '' };
  const ui = { collapsed: false, help: false };
  const timers = [];
  let reloading = false;
  /** Idempotency of an Auto salve: the same salve retried keeps its key (Core replays, never pays twice). */
  let pending = null;

  const root = document.createElement('div');
  root.className = 'bkc is-empty';
  root.innerHTML = template();
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => root.querySelectorAll(sel);
  const car = q('[data-bkc-car]');
  const carbox = q('[data-bkc-carbox]');
  const gauge = q('[data-bkc-gauge]');
  const count = q('[data-bkc-count]');
  const cta = q('[data-bkc="cta"]');
  const label = q('[data-bkc-label]');
  const bar = q('[data-bkc-bar]');
  const modeBtn = q('[data-bkc="mode"]');
  const speedBtn = q('[data-bkc="speed"]');
  const dock = q('[data-bkc-dock]');
  const toastEl = q('.bkc-toast');

  const helpButton = document.createElement('button');
  helpButton.type = 'button';
  helpButton.className = 'bkc-help-btn';
  helpButton.textContent = '?';
  helpButton.title = 'Aide du chargeur Bonk';
  helpButton.setAttribute('aria-label', 'Aide du chargeur Bonk');
  helpButton.addEventListener('click', (event) => {
    event.stopPropagation();
    ui.help = !ui.help;
    sync();
  });

  const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n).replace(/\s/g, ' ');
  const restart = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  // --- gauge, carousel ------------------------------------------------------------------------------
  function syncGauge(filled, opts = {}) {
    const n = model.total();
    while (gauge.children.length < n) {
      const s = document.createElement('i');
      if (opts.pop) s.classList.add('pop');
      gauge.append(s);
    }
    while (gauge.children.length > n) gauge.lastElementChild.remove();
    [...gauge.children].forEach((s, i) => {
      const was = s.classList.contains('f');
      const f = i < filled;
      s.classList.toggle('f', f);
      s.classList.toggle('n', m.mode === 'manual' && f && i === filled - 1);
      if (was && !f && opts.shot) restart(s, 'shot');
    });
  }
  function syncCar() {
    const live = new Map();
    [...car.children].forEach((el) => !el.dataset.gone && live.set(el.dataset.id, el));
    const next = m.mode === 'manual' ? model.nextId() : null;
    let shown = false;
    m.items.forEach((it, idx) => {
      const id = it.emote.id;
      let el = live.get(id);
      if (!el) {
        el = document.createElement('span');
        el.className = 'bkc-am is-in';
        el.dataset.id = id;
        el.setAttribute('role', 'listitem');
        el.title = `${it.emote.label ?? id} · clic : −1 · clic droit : retirer`;
        el.append(renderEmote(it.emote));
        const badge = document.createElement('b');
        badge.className = 'bkc-badge';
        el.append(badge);
        el.addEventListener('animationend', (e) => {
          if (e.animationName === 'bkc-in') el.classList.remove('is-in');
        });
      }
      live.delete(id);
      const order = [...car.children].filter((x) => !x.dataset.gone);
      if (order[idx] !== el) car.insertBefore(el, order[idx] ?? null);
      // What is left of this emote (the same in both modes: switching keeps the chargeur as it is).
      const left = model.leftOf(id);
      el.querySelector('.bkc-badge').textContent = String(left);
      el.classList.toggle('is-spent', !left);
      const isNext = !shown && next === id;
      if (isNext) shown = true;
      el.classList.toggle('is-next', isNext);
    });
    live.forEach((el) => {
      el.dataset.gone = '1';
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 240);
    });
    requestAnimationFrame(fades);
  }
  function fades() {
    const max = car.scrollWidth - car.clientWidth;
    const s = car.scrollLeft > 2;
    const e = car.scrollLeft < max - 2;
    car.classList.toggle('f-s', s);
    car.classList.toggle('f-e', e);
    carbox.classList.toggle('has-l', s);
    carbox.classList.toggle('has-r', e);
  }
  function ensureVisible(el, behavior = 'smooth') {
    const l = el.offsetLeft;
    if (l < car.scrollLeft + 4 || l + el.offsetWidth > car.scrollLeft + car.clientWidth - 4)
      car.scrollTo({ left: l - (car.clientWidth - el.offsetWidth) / 2, behavior });
  }

  // --- state → DOM ---------------------------------------------------------------------------------
  function sync(opts = {}) {
    const n = model.total();
    const rem = model.remaining();
    const auto = m.mode === 'auto';
    root.classList.toggle('is-empty', !n);
    root.classList.toggle('is-auto', auto);
    root.classList.toggle('is-collapsed', ui.collapsed);
    root.classList.toggle('is-busy', m.busy);
    root.classList.toggle('is-help', ui.help);
    helpButton.classList.toggle('is-on', ui.help);
    // A salve is admitted and paid as one block: the switch is locked (visibly) until it has played.
    modeBtn.classList.toggle('is-auto', auto);
    modeBtn.setAttribute('aria-checked', String(auto));
    modeBtn.disabled = m.busy || !config.auto;
    modeBtn.title = m.busy ? 'Salve en cours…' : config.auto ? SWITCH_TIP : 'Auto indisponible pour le moment';
    speedBtn.dataset.level = String(m.speed);
    speedBtn.title = `Vitesse : ${BONK_SPEEDS[m.speed - 1].name} (${m.speed}/4) · clic : niveau suivant`;
    speedBtn.setAttribute('aria-label', speedBtn.title);
    // The button: a price (Manuel = one Bonk, Auto = the remaining salve), or a free reload.
    const act = model.action();
    const text = act === 'rearm' ? '↻ Recharger' : `◆ ${fmt(model.price(config.cost))}`;
    cta.dataset.act = act;
    cta.classList.toggle('is-salve', act === 'send');
    cta.classList.toggle('is-rearm', act === 'rearm');
    cta.classList.toggle('is-busy', m.busy);
    cta.disabled = act === 'none' || m.busy || (act !== 'rearm' && !config.ready);
    cta.title = !config.ready && act !== 'rearm'
      ? config.reason
      : act === 'send'
        ? `Envoyer les ${rem} Bonk restants d’affilée`
        : act === 'rearm'
          ? 'Recharger le chargeur (gratuit)'
          : 'Tirer 1 Bonk';
    cta.setAttribute('aria-label', `${cta.title} · ${text}`);
    if (label.textContent !== text) {
      const bump = label.textContent && act !== 'rearm';
      label.textContent = text;
      if (bump) restart(label, 'bump');
    }
    if (!reloading) {
      count.textContent = n ? `${rem}/${n}` : '';
      syncGauge(rem, opts);
    }
    syncCar();
  }

  // --- reload: segments one after the other, accelerating, then a glow (≈ 0,7 s) — validated ------
  function stopReload() {
    timers.splice(0).forEach(clearTimeout);
    reloading = false;
  }
  function reload() {
    stopReload();
    const n = model.total();
    if (!n) return;
    const target = model.remaining();
    reloading = true;
    syncGauge(0);
    count.textContent = `0/${n}`;
    const T = 640;
    for (let i = 0; i < target; i++) {
      const at = 50 + T * Math.pow(i / Math.max(1, target), 0.78);
      timers.push(
        setTimeout(() => {
          const s = gauge.children[i];
          if (s) {
            s.style.setProperty('--heat', String((i + 1) / target));
            s.classList.add('f');
            restart(s, 'pop');
          }
          count.textContent = `${i + 1}/${n}`;
        }, at),
      );
    }
    timers.push(
      setTimeout(() => {
        reloading = false;
        restart(gauge, 'glow');
        restart(cta, 'ready');
        sync();
      }, 50 + T + 140),
    );
  }

  // --- feedback ------------------------------------------------------------------------------------
  let toastTimer = null;
  let undo = null;
  function toast(text, withUndo = false) {
    q('[data-bkc-toast]').textContent = text;
    toastEl.classList.toggle('has-undo', withUndo);
    restart(toastEl, 'is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), withUndo ? 3500 : 1500);
  }
  /** A ghost of the emote travelling from `from` to `to` (fixed layer, no layout impact). */
  function flight(emote, from, to, { duration = 300, rise = 26, end = 0.6 } = {}) {
    if (!from || !to || !document.body) return Promise.resolve();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'bkc-flight';
    ghost.append(renderEmote(emote));
    ghost.style.left = `${a.left + a.width / 2 - 14}px`;
    ghost.style.top = `${a.top + a.height / 2 - 14}px`;
    document.body.append(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const done = () => ghost.remove();
    if (typeof ghost.animate !== 'function') {
      done();
      return Promise.resolve();
    }
    return ghost
      .animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - rise}px) scale(.95)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.15 },
        ],
        { duration, easing: 'cubic-bezier(.3,.6,.4,1)' },
      )
      .finished.then(done, done);
  }
  /** Shot feedback: the emote leaves the price button upwards (the real Bonk plays on stream). */
  function launch(emote) {
    const r = cta.getBoundingClientRect();
    const to = { getBoundingClientRect: () => ({ left: r.left + 40, top: r.top - 150, width: 0, height: 0 }) };
    void flight(emote, cta, to, { duration: 520, rise: 40, end: 0.7 });
  }

  // --- actions -------------------------------------------------------------------------------------
  function fireManual() {
    const shot = model.fire();
    if (!shot) return;
    stopReload();
    sync({ shot: true });
    launch(shot.emote);
    const nx = car.querySelector('.is-next');
    if (nx) ensureVisible(nx);
    void Promise.resolve(onFire(shot.emote)).then((ok) => {
      if (ok) return;
      model.unfire(shot); // refused (wallet, Studio offline…): the munition is not lost
      sync();
    });
  }
  function sendSalve() {
    const shots = model.salve();
    if (!shots) return;
    stopReload();
    const cadence = model.cadenceMs(config.cadence);
    const sig = `${shots.map((e) => e.id).join(',')}@${cadence}`;
    if (!pending || pending.sig !== sig) pending = { sig, key: newKey() };
    sync();
    void Promise.resolve(onSalve(shots, cadence, pending.key)).then((ok) => {
      if (!ok) {
        model.endSalve(false); // refused: nothing consumed, nothing paid (Core is atomic)
        sync();
        return;
      }
      pending = null;
      // Admitted and paid: the chargeur empties at the salve's cadence (the stream plays it), then reloads.
      shots.forEach((emote, i) =>
        timers.push(
          setTimeout(() => {
            m.pos += 1;
            bar.style.width = `${((i + 1) / shots.length) * 100}%`;
            sync({ shot: true });
            launch(emote);
            if (i === shots.length - 1)
              timers.push(
                setTimeout(() => {
                  model.endSalve(true);
                  bar.style.width = '0';
                  sync();
                  reload();
                  toast(`Salve ×${shots.length} envoyée · rechargement`);
                }, 280),
              );
          }, i * cadence),
        ),
      );
    });
  }

  // --- events (captive: nothing here scrolls or clicks through to the page) --------------------------
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!e.target.closest('[data-bkc-car]')) return;
      const a = car.querySelector('.bkc-am');
      car.scrollBy({ left: Math.sign(e.deltaY || e.deltaX) * ((a ? a.offsetWidth : 30) + 5), behavior: 'smooth' });
    },
    { passive: false },
  );
  car.addEventListener('scroll', fades, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(fades).observe(car);

  let drag = null;
  let longPress = null;
  let swallow = false;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-bkc-car]')) drag = { x: e.clientX, l: car.scrollLeft, moved: false };
    const am = e.target.closest('.bkc-am');
    if (am && car.contains(am) && !m.busy)
      longPress = setTimeout(() => {
        swallow = true;
        if (model.remove(am.dataset.id)) {
          sync();
          toast('Emote retirée du chargeur');
        }
      }, 480);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = e.clientX - drag.x;
    if (!drag.moved && Math.abs(d) < 5) return;
    drag.moved = true;
    clearTimeout(longPress);
    car.classList.add('is-drag');
    car.scrollLeft = drag.l - d;
  });
  const endDrag = () => {
    clearTimeout(longPress);
    if (drag?.moved) {
      swallow = true;
      car.classList.remove('is-drag');
    }
    drag = null;
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const am = e.target.closest('.bkc-am');
    if (am && car.contains(am) && model.remove(am.dataset.id)) {
      sync();
      toast('Emote retirée du chargeur');
    }
  });
  q('[data-bkc-shade]').addEventListener('mouseover', (e) => {
    const row = e.target.closest('[data-spot]');
    qa('.bkc-spot').forEach((x) => x.classList.remove('bkc-spot'));
    if (!row) return;
    const spot = row.dataset.spot;
    const target =
      spot === 'mode' ? modeBtn
        : spot === 'speed' ? speedBtn
          : spot === 'cta' ? cta
            : spot === 'clear' ? q('[data-bkc="clear"]')
              : q('[data-spot-target="car"]');
    target?.classList.add('bkc-spot');
  });
  q('[data-bkc-shade]').addEventListener('mouseleave', () => qa('.bkc-spot').forEach((x) => x.classList.remove('bkc-spot')));

  root.addEventListener('click', (e) => {
    if (swallow) {
      swallow = false;
      return;
    }
    // A click outside the help card only closes it (never reaches what is underneath).
    if (ui.help && e.target.closest('[data-bkc-shade]') && !e.target.closest('.bkc-help')) {
      ui.help = false;
      sync();
      return;
    }
    const am = e.target.closest('.bkc-am');
    if (am && car.contains(am) && !am.dataset.gone) {
      if (model.dec(am.dataset.id)) {
        restart(am, 'hit');
        sync();
      }
      return;
    }
    const a = e.target.closest('[data-bkc]');
    if (!a) return;
    switch (a.dataset.bkc) {
      case 'mode':
        // Continuity: the chargeur stays exactly as it is (no reset, no reload animation).
        if (model.setMode(m.mode === 'manual' ? 'auto' : 'manual')) sync();
        break;
      case 'speed':
        model.cycleSpeed();
        sync();
        restart(a, 'zap');
        break;
      case 'cta':
        if (a.dataset.act === 'fire') fireManual();
        else if (a.dataset.act === 'send') sendSalve();
        else if (a.dataset.act === 'rearm') {
          model.rearm();
          sync();
          reload();
        }
        break;
      case 'clear':
        if (m.busy) break;
        undo = model.clear();
        stopReload();
        sync();
        toast('Chargeur vidé', true);
        break;
      case 'undo':
        if (!undo) break;
        model.restore(undo);
        undo = null;
        toastEl.classList.remove('is-on');
        sync();
        reload();
        break;
      case 'fold':
        ui.collapsed = !ui.collapsed;
        sync();
        restart(dock, 'settle');
        break;
      case 'help-close':
        ui.help = false;
        sync();
        break;
      case 'nav':
        car.scrollBy({ left: Number(a.dataset.dir) * car.clientWidth * 0.8, behavior: 'smooth' });
        break;
    }
  });
  // Escape closes the help (only while it is open).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.help) {
      ui.help = false;
      sync();
    }
  });

  sync();

  return {
    node: root,
    helpButton,
    /**
     * Core's rules and availability (from the module): price of a Bonk, salve bounds, whether a click
     * can be paid now. `volley` absent (older Core) = no Auto, chargeur bounded by the canonical 10.
     */
    configure({ cost, volley, ready = true, reason = '' }) {
      config.cost = Number(cost) || 0;
      config.auto = Boolean(volley);
      config.ready = ready;
      config.reason = reason;
      if (volley) {
        model.setMaxShots(volley.max_shots);
        config.cadence = { min: volley.cadence_min_ms, max: volley.cadence_max_ms };
      }
      if (!config.auto && m.mode === 'auto' && !m.busy) model.setMode('manual');
      sync();
    },
    /** A catalogue click: one munition (the emote flies from its cell into the chargeur). */
    add(emote, fromCell = null) {
      const result = model.add(emote);
      if (!result.ok) {
        if (result.reason === 'full') {
          restart(gauge, 'shake');
          toast(`Chargeur plein · ${m.maxShots} max`);
        }
        return result;
      }
      sync({ pop: true });
      const thumb = car.querySelector(`[data-id="${CSS.escape(emote.id)}"]:not([data-gone])`);
      if (thumb && !ui.collapsed) ensureVisible(thumb, 'auto');
      void flight(emote, fromCell, ui.collapsed ? count : thumb).then(() => {
        if (thumb && !ui.collapsed) restart(thumb, 'land');
      });
      return result;
    },
    /** After the host moved the node into a new render: restore what layout may have reset. */
    attached() {
      requestAnimationFrame(fades);
    },
    /** Identity / channel change: a new chargeur. */
    reset() {
      stopReload();
      model.clear();
      model.endSalve(false);
      model.setMode('manual');
      pending = null;
      undo = null;
      sync();
    },
  };
}
