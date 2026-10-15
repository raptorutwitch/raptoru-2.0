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
  html`<button type="button" class="bkc-wipe" ${demo ? 'tabindex="-1"' : 'data-bkc="clear" title="Vider toutes les munitions (annulable)" aria-label="Vider toutes les munitions"'}><span class="bkc-wipe__ic">${TRASH}</span></button>`;

function template() {
  return html`
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
`;
}

/**
 * @param {{
 *   document: Document,
 *   renderEmote: (emote: object) => Node,
 *   onFire: (emote: object) => Promise<boolean>,
 *   onSalve: (emotes: object[], cadenceMs: number, key: string) => Promise<boolean>,
 *   newKey: () => string,
 *   onHelp?: () => void,
 * }} deps `onHelp`: the « ? » button (the host opens the Bonk tutorial).
 */
export function createBonkChargeur({ document, renderEmote, onFire, onSalve, newKey, onHelp = () => {} }) {
  const model = createChargeurModel({ maxShots: FALLBACK_MAX_SHOTS });
  const m = model.state;
  const config = { cost: 0, cadence: { min: 90, max: 600 }, auto: false, ready: true, reason: '' };
  const ui = { collapsed: false };
  const timers = [];
  let reloading = false;
  /** Idempotency of an Auto salve: the same salve retried keeps its key (Core replays, never pays twice). */
  let pending = null;
  /** Running « one unit less » animation per munition. */
  const takes = new WeakMap();

  const root = document.createElement('div');
  root.className = 'bkc is-empty';
  root.innerHTML = template();
  const q = (sel) => root.querySelector(sel);
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
  helpButton.title = 'Tutoriel Bonk';
  helpButton.setAttribute('aria-label', 'Tutoriel Bonk');
  helpButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onHelp();
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
    // FLIP: where each munition was, so that the others glide into a freed place instead of jumping.
    const before = new Map([...car.children].map((el) => [el, el.getBoundingClientRect().left]));
    const live = new Map();
    [...car.children].forEach((el) => live.set(el.dataset.id, el));
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
      const order = [...car.children];
      if (order[idx] !== el) car.insertBefore(el, order[idx] ?? null);
      // What is left of this emote (the same in both modes: switching keeps the chargeur as it is).
      const left = model.leftOf(id);
      el.querySelector('.bkc-badge').textContent = String(left);
      el.classList.toggle('is-spent', !left);
      const isNext = !shown && next === id;
      if (isNext) shown = true;
      el.classList.toggle('is-next', isNext);
    });
    // Removed: out of the row at once (no in-row collapse, no drift), a ghost plays the exit in place.
    // All ghosts first: removing one would move the next before it is measured (« Vider »).
    live.forEach((el) => ghostOut(el));
    live.forEach((el) => el.remove());
    if (typeof car.animate === 'function')
      before.forEach((left, el) => {
        const d = el.isConnected ? left - el.getBoundingClientRect().left : 0;
        if (Math.abs(d) > 0.5)
          el.animate([{ transform: `translateX(${d}px)` }, { transform: 'none' }], {
            duration: 220,
            easing: 'cubic-bezier(.3,.7,.3,1)',
          });
      });
    requestAnimationFrame(fades);
  }
  /**
   * Exit of a munition: a fixed ghost at its place tints grey-red,
   * shrinks and fades. Not shown when the munition is out of sight (scrolled away, chargeur folded).
   */
  function ghostOut(el) {
    const r = el.getBoundingClientRect();
    const box = carbox.getBoundingClientRect();
    if (ui.collapsed || !document.body || typeof el.animate !== 'function') return;
    if (!r.width || r.right <= box.left || r.left >= box.right) return;
    const ghost = el.cloneNode(true);
    ghost.className = 'bkc-am bkc-ghost';
    ghost.removeAttribute('role');
    ghost.removeAttribute('title');
    ghost.removeAttribute('data-id');
    ghost.querySelector('.bkc-badge')?.remove();
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(ghost);
    const tint = 'grayscale(.75) sepia(.4) hue-rotate(-35deg)';
    const done = () => ghost.remove();
    ghost
      .animate(
        [
          { transform: 'none', opacity: 1, filter: 'none' },
          { transform: 'scale(.92)', opacity: 0.9, filter: tint, offset: 0.2 },
          { transform: 'scale(.55)', opacity: 0, filter: tint },
        ],
        { duration: 260, easing: 'cubic-bezier(.3,.6,.4,1)' },
      )
      .finished.then(done, done);
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
    root.classList.toggle('is-auto', auto);
    root.classList.toggle('is-collapsed', ui.collapsed);
    root.classList.toggle('is-busy', m.busy);
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
    // After syncCar: `is-empty` adds the « + » socket at the head of the row, which would push the last
    // munition 33 px right before syncCar measures it (its exit ghost would then start off its place).
    root.classList.toggle('is-empty', !n);
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
  /** One feedback bubble above the dock. `kind`: ok (green), error (red, stays longer), info (neutral). */
  function toast(text, withUndo = false, kind = 'ok') {
    q('[data-bkc-toast]').textContent = text;
    toastEl.dataset.kind = kind;
    toastEl.classList.toggle('has-undo', withUndo);
    restart(toastEl, 'is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), withUndo || kind === 'error' ? 4000 : 1600);
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
          toast('Emote retirée du chargeur', false, 'info');
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
      toast('Emote retirée du chargeur', false, 'info');
    }
  });
  root.addEventListener('click', (e) => {
    if (swallow) {
      swallow = false;
      return;
    }
    const am = e.target.closest('.bkc-am');
    if (am && car.contains(am)) {
      if (model.dec(am.dataset.id)) {
        // One unit less (pile > 1): the munition itself shrinks, fades and tints (150 ms), then comes back
        // with its new count. The last unit leaves in place (syncCar → ghostOut).
        if (m.items.some((it) => it.emote.id === am.dataset.id) && typeof am.animate === 'function') {
          const tint = 'grayscale(.75) sepia(.4) hue-rotate(-35deg)';
          takes.get(am)?.cancel(); // a fast second click restarts it, never stacks
          takes.set(am, am.animate(
            [
              { transform: 'none', opacity: 1, filter: 'none' },
              { transform: 'scale(.72)', opacity: 0.35, filter: tint, borderColor: 'rgba(255, 98, 80, .7)', offset: 0.55 },
              { transform: 'none', opacity: 1, filter: 'none' },
            ],
            { duration: 270, easing: 'ease-out' },
          ));
        }
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
        toast('Chargeur vidé', true, 'info');
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
      case 'nav':
        car.scrollBy({ left: Number(a.dataset.dir) * car.clientWidth * 0.8, behavior: 'smooth' });
        break;
    }
  });
  sync();

  return {
    node: root,
    helpButton,
    /** A feedback from the host (send result, error) in the chargeur's bubble. */
    notice(text, kind = 'ok') {
      if (text) toast(text, false, kind);
    },
    /** Bonk tutorial: shows the dock unfolded while `on`. */
    showcase(on) {
      root.classList.toggle('is-tour', Boolean(on));
      if (on && ui.collapsed) {
        ui.collapsed = false;
        sync();
      }
    },
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
          toast(`Chargeur plein · ${m.maxShots} max`, false, 'info');
        }
        return result;
      }
      sync({ pop: true });
      const thumb = car.querySelector(`[data-id="${CSS.escape(emote.id)}"]`);
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
