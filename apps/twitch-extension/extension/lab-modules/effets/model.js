// LAB ONLY — faux Core de Chaos V2 pour la maquette « Effets live » : file, emplacements du moteur, délais, remboursements,
// modération, scénarios. Il tient le rôle du futur module `chaos` du Core (lot 2) : la vue lit `snapshot()` et `quote()`,
// elle ne calcule rien elle-même. Règles par défaut proposées : docs/chaos/EXTENSION_EFFETS_LIVE.md § 4.
// Pur (horloge et hasard injectés) : testé par test/effets-live-model.test.js.
import { EFFECTS, SLOTS, defaultDuration, defaultTier, effectById, minPrice, mockPrice } from './catalog.js';

export const QUEUE_MAX = 3; // Q5 : 3 demandes en attente au plus
export const QUEUE_TTL_S = 180; // Q5 : une demande non jouée après 3 min est remboursée
export const VIEWER_COOLDOWN_S = 60; // un viewer ne relance pas le même effet avant 1 min après sa fin
export const REFUND_BEFORE = 0.25; // Q3/Q4 : arrêté avant 25 % de sa durée → remboursé d'office

export const SCENARIOS = Object.freeze({
  normal: 'Live animé',
  calme: 'Live calme',
  file_pleine: 'File pleine',
  pause: 'Chaos en pause',
  hors_live: 'Hors live',
  mode_doux: 'Mode doux',
  plein_ecran: 'Jeu en plein écran exclusif',
  solde_bas: 'Solde bas',
});

const OTHERS = ['Kiwi_57', 'LaMouetteRieuse', 'PtitChef', 'MamieGamer', 'xXSasukeXx', 'Bubulle'];

/** Hasard reproductible (tests, captures). */
export function seeded(seed = 7) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const slotOf = (r) => effectById(r.effect).slot;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function createChaosMock({
  scenario = 'normal',
  me = { id: '42', name: 'Toi' },
  balance = 12000,
  now = Date.now(),
  random = seeded(7),
  simulate = true,
} = {}) {
  let seq = 0;
  const s = {
    status: 'open', // open | paused | offline
    safe: false, // mode doux : effets photosensibles refusés
    exclusive: false, // jeu en plein écran exclusif : seuls les calques restent possibles
    game: 'Overwatch 2',
    balance,
    active: [],
    queue: [],
    done: [], // demandes terminées (jouées, annulées, expirées, retirées), la plus récente d'abord
    cooldowns: new Map(), // `${viewer}:${effect}` → fin (ms)
    globalCd: new Map(), // effet → fin (ms), effets photosensibles
    simulate,
    nextBot: now + 9000,
  };

  function make(effect, tier, duration, buyer, t, { price, by = 'viewer' } = {}) {
    const e = effectById(effect);
    return {
      id: `r${++seq}`,
      effect,
      label: e.label,
      tier,
      duration,
      price: price ?? mockPrice(e, tier, duration),
      buyer,
      by,
      state: 'queued',
      created: t,
      started: null,
      ends: null,
      refunded: false,
      reason: null,
      actor: null,
    };
  }

  const canStart = (r) => {
    const e = effectById(r.effect);
    return s.active.filter((a) => slotOf(a) === e.slot).length < SLOTS[e.slot].capacity && !s.active.some((a) => a.effect === r.effect);
  };

  function start(r, t) {
    s.queue = s.queue.filter((q) => q !== r);
    r.state = 'active';
    r.started = t;
    r.ends = t + r.duration * 1000;
    s.active.push(r);
  }

  function finish(r, state, t, { refund = false, actor = null, reason = null } = {}) {
    s.active = s.active.filter((a) => a !== r);
    s.queue = s.queue.filter((q) => q !== r);
    r.state = state;
    r.finished = t;
    r.actor = actor;
    r.reason = reason;
    if (refund) credit(r);
    s.done.unshift(r);
    s.done.length = Math.min(s.done.length, 30);
    if (state === 'done' || state === 'removed') {
      s.cooldowns.set(`${r.buyer.id}:${r.effect}`, t + VIEWER_COOLDOWN_S * 1000);
      const g = effectById(r.effect).globalCooldown;
      if (g) s.globalCd.set(r.effect, t + g * 1000);
    }
  }

  function credit(r) {
    if (r.refunded || !r.price) return false;
    r.refunded = true;
    if (r.buyer.id === me.id) s.balance += r.price;
    return true;
  }

  /** Attente estimée (s) avant qu'une demande de cet effet puisse démarrer, derrière `ahead` (déjà en file). */
  function eta(effect, ahead, t) {
    const e = effectById(effect);
    const lanes = s.active.filter((a) => slotOf(a) === e.slot).map((a) => a.ends - t);
    while (lanes.length < SLOTS[e.slot].capacity) lanes.push(0);
    for (const q of ahead.filter((x) => slotOf(x) === e.slot)) {
      lanes.sort((a, b) => a - b);
      lanes[0] += q.duration * 1000;
    }
    lanes.sort((a, b) => a - b);
    let wait = lanes[0];
    const same = [...s.active, ...ahead].filter((x) => x.effect === effect);
    for (const x of same) wait = Math.max(wait, (x.ends ?? t + x.duration * 1000) - t);
    return Math.max(0, Math.ceil(wait / 1000));
  }

  /** Ce qui empêche CE viewer d'acheter cet effet maintenant (indépendant du palier et de la durée), ou null. */
  function blockFor(e, t, viewer = me) {
    if (s.status === 'offline') return { code: 'offline', label: 'Hors live', detail: 'Les effets s’achètent pendant le live.' };
    if (s.status === 'paused') return { code: 'paused', label: 'En pause', detail: 'Le streamer a mis les effets en pause.' };
    if (s.exclusive && e.capture) return { code: 'incompatible', label: 'Pas sur ce jeu', detail: `${s.game} est en plein écran exclusif : seuls les calques (Brouillard, Clignement, Flash) passent.` };
    if (s.safe && e.photosensitive) return { code: 'safe_mode', label: 'Mode doux', detail: 'Effet lumineux désactivé pendant ce live.' };
    const cd = s.cooldowns.get(`${viewer.id}:${e.id}`);
    if (cd && cd > t) return { code: 'cooldown', label: mmss(Math.ceil((cd - t) / 1000)), detail: `Tu pourras relancer ${e.label} dans ${mmss(Math.ceil((cd - t) / 1000))}.`, until: cd };
    const mine = [...s.queue, ...s.active].find((r) => r.effect === e.id && r.buyer.id === viewer.id);
    if (mine) return { code: mine.state === 'active' ? 'mine_active' : 'mine_queued', label: mine.state === 'active' ? 'Le tien, en cours' : 'Le tien, en file', detail: 'Ton effet est déjà en route.' };
    const g = s.globalCd.get(e.id);
    if (g && g > t) return { code: 'global_cooldown', label: mmss(Math.ceil((g - t) / 1000)), detail: `Un ${e.label} vient d’être joué : prochain possible dans ${mmss(Math.ceil((g - t) / 1000))}.`, until: g };
    return null;
  }

  /** Prix et issue pour un réglage précis : ce que le Core répondra avant la confirmation. */
  function quote(effect, tier, duration, t) {
    const e = effectById(effect);
    const price = mockPrice(e, tier, duration);
    const block = blockFor(e, t);
    const startsNow = canStart({ effect }) && !s.queue.some((q) => slotOf(q) === e.slot);
    const outcome = startsNow ? { kind: 'now' } : { kind: 'queue', position: s.queue.length + 1, eta: eta(effect, s.queue, t) };
    let refuse = block;
    if (!refuse && outcome.kind === 'queue' && s.queue.length >= QUEUE_MAX)
      refuse = { code: 'queue_full', label: 'File pleine', detail: `${QUEUE_MAX} effets attendent déjà. Réessaie dans un instant, ou choisis un effet qui part tout de suite.` };
    if (!refuse && outcome.kind === 'queue' && s.queue.some((q) => q.buyer.id === me.id))
      refuse = { code: 'one_waiting', label: '1 en attente', detail: 'Tu as déjà un effet dans la file : attends qu’il passe.' };
    if (!refuse && s.balance < price)
      refuse = { code: 'insufficient_funds', label: 'Solde', detail: `Il te manque ${(price - s.balance).toLocaleString('fr-FR')} Jetons.` };
    return { price, outcome, block: refuse };
  }

  function buy(effect, tier, duration, expectedPrice, t, buyer = me) {
    const e = effectById(effect);
    if (!e || !e.tiers.includes(tier) || !e.durations.includes(duration)) return { ok: false, code: 'invalid_request', message: 'Réglage inconnu.' };
    const q = buyer === me ? quote(effect, tier, duration, t) : quoteFor(e, tier, duration, t, buyer);
    if (q.block) return { ok: false, code: q.block.code, message: q.block.detail };
    if (expectedPrice !== q.price) return { ok: false, code: 'price_changed', message: 'Le prix a changé : vérifie avant de confirmer.' };
    if (buyer.id === me.id) s.balance -= q.price;
    const r = make(effect, tier, duration, buyer, t, { price: q.price });
    if (q.outcome.kind === 'now') start(r, t);
    else s.queue.push(r);
    return { ok: true, request: r, outcome: q.outcome };
  }

  /** Achat simulé d'un autre viewer (mêmes règles, sans solde). */
  function quoteFor(e, tier, duration, t, viewer) {
    const price = mockPrice(e, tier, duration);
    const block = blockFor(e, t, viewer);
    const now = canStart({ effect: e.id }) && !s.queue.some((q) => slotOf(q) === e.slot);
    const full = !now && s.queue.length >= QUEUE_MAX;
    const waiting = !now && s.queue.some((q) => q.buyer.id === viewer.id);
    return { price, outcome: now ? { kind: 'now' } : { kind: 'queue' }, block: block ?? (full || waiting ? { code: 'queue_full', detail: '' } : null) };
  }

  function tick(t) {
    for (const r of [...s.active]) if (r.ends <= t) finish(r, 'done', t);
    for (const r of [...s.queue])
      if (t - r.created > QUEUE_TTL_S * 1000) finish(r, 'expired', t, { refund: true, reason: 'Pas joué en 3 min : remboursé.' });
    for (const r of [...s.queue]) if (s.status === 'open' && canStart(r)) start(r, t);
    if (s.simulate && s.status === 'open' && t >= s.nextBot) {
      s.nextBot = t + 14000 + Math.floor(random() * 10000);
      const e = EFFECTS[Math.floor(random() * EFFECTS.length)];
      const viewer = { id: `bot-${Math.floor(random() * OTHERS.length)}`, name: OTHERS[Math.floor(random() * OTHERS.length)] };
      const tier = e.tiers[Math.floor(random() * e.tiers.length)];
      const duration = e.durations[Math.min(1, e.durations.length - 1)];
      buy(e.id, tier, duration, mockPrice(e, tier, duration), t, viewer);
    }
  }

  // --- Modération (Régie) -------------------------------------------------------------------------------------------
  const find = (id) => [...s.active, ...s.queue, ...s.done].find((r) => r.id === id) ?? null;
  const moderation = {
    /** Retire une demande de la file, avec ou sans remboursement (motif obligatoire si pas de remboursement). */
    cancel(id, { refund, reason }, t) {
      const r = s.queue.find((q) => q.id === id);
      if (!r) return { ok: false, message: 'Cette demande n’est plus dans la file.' };
      finish(r, 'cancelled', t, { refund, actor: 'Modération', reason });
      return { ok: true };
    },
    /** Arrête un effet en cours ; sans choix explicite, remboursé s'il a joué moins de 25 % de sa durée. */
    remove(id, { refund, reason }, t) {
      const r = s.active.find((a) => a.id === id);
      if (!r) return { ok: false, message: 'Cet effet est déjà terminé.' };
      const early = (t - r.started) / (r.duration * 1000) < REFUND_BEFORE;
      finish(r, 'removed', t, { refund: refund ?? early, actor: 'Modération', reason });
      return { ok: true, refunded: r.refunded };
    },
    /** Rembourse après coup une demande terminée (une seule fois). */
    refund(id, reason, t) {
      const r = find(id);
      if (!r || r.state === 'queued' || r.state === 'active') return { ok: false, message: 'Seule une demande terminée se rembourse après coup.' };
      if (!credit(r)) return { ok: false, message: r.refunded ? 'Déjà remboursée.' : 'Rien à rembourser (effet offert).' };
      r.refundReason = reason;
      r.refundedAt = t;
      return { ok: true };
    },
    /** STOP ALL : tout ce qui joue s'arrête (remboursé selon la règle des 25 %) et Chaos passe en pause ; la file attend. */
    stopAll(t) {
      for (const r of [...s.active]) moderation.remove(r.id, { refund: undefined, reason: 'Tout arrêter' }, t);
      s.status = 'paused';
      return { ok: true };
    },
    setPaused(on) {
      if (s.status !== 'offline') s.status = on ? 'paused' : 'open';
      return { ok: true };
    },
    /** Effet offert par la modération : gratuit, passe devant la file. */
    trigger(effect, tier, duration, t) {
      const r = make(effect, tier, duration, { id: 'mod', name: 'Modération' }, t, { price: 0, by: 'mod' });
      if (canStart(r)) start(r, t);
      else s.queue.unshift(r);
      return { ok: true, request: r };
    },
  };

  function snapshot(t) {
    const pos = (r) => s.queue.indexOf(r) + 1;
    const view = (r) => ({
      ...r,
      position: r.state === 'queued' ? pos(r) : null,
      eta: r.state === 'queued' ? eta(r.effect, s.queue.slice(0, pos(r) - 1), t) : null,
      expiresIn: r.state === 'queued' ? Math.max(0, Math.ceil((r.created + QUEUE_TTL_S * 1000 - t) / 1000)) : null,
      remaining: r.state === 'active' ? Math.max(0, Math.ceil((r.ends - t) / 1000)) : null,
      progress: r.state === 'active' ? Math.min(1, (t - r.started) / (r.duration * 1000)) : null,
      mine: r.buyer.id === me.id,
    });
    return {
      status: s.status,
      safe: s.safe,
      exclusive: s.exclusive,
      game: s.game,
      balance: s.balance,
      queueMax: QUEUE_MAX,
      active: s.active.map(view),
      queue: s.queue.map(view),
      history: s.done.map(view),
      mine: [...s.active, ...s.queue, ...s.done].filter((r) => r.buyer.id === me.id).map(view).slice(0, 6),
      effects: EFFECTS.map((e) => {
        // La carte dit ce qui bloque avant tout réglage : règles du viewer, puis file (au réglage par défaut), puis solde.
        const q = quote(e.id, defaultTier(e), defaultDuration(e), t);
        const queueBlock = q.block && ['queue_full', 'one_waiting'].includes(q.block.code) ? q.block : null;
        const block = blockFor(e, t) ?? queueBlock;
        const playing = s.active.find((a) => a.effect === e.id);
        return {
          id: e.id,
          block: block ?? (s.balance < minPrice(e) ? { code: 'insufficient_funds', label: 'Solde', detail: 'Pas assez de Jetons.' } : null),
          playing: playing ? { by: playing.buyer.name, remaining: Math.max(0, Math.ceil((playing.ends - t) / 1000)) } : null,
          startsNow: q.outcome.kind === 'now',
          minPrice: minPrice(e),
        };
      }),
    };
  }

  // --- Scénarios (Lab) ----------------------------------------------------------------------------------------------
  function seed(t) {
    const other = (i) => ({ id: `bot-${i}`, name: OTHERS[i] });
    const past = (effect, tier, duration, i, agoS, state, extra = {}) => {
      const r = make(effect, tier, duration, i === 'me' ? me : other(i), t - agoS * 1000);
      Object.assign(r, { state, started: t - agoS * 1000, finished: t - (agoS - duration) * 1000 }, extra);
      s.done.push(r);
    };
    if (scenario === 'calme') {
      s.simulate = false;
      past('blur', 'marque', 10, 'me', 400, 'done');
      return;
    }
    // Un live animé : deux effets à l'écran, un en file, un historique varié.
    const fog = make('fog', 'marque', 20, other(2), t - 6000);
    start(fog, t - 6000);
    const flip = make('flip', 'marque', 30, other(5), t - 18000);
    start(flip, t - 18000);
    s.queue.push(make('mirror', 'horizontal', 10, other(1), t - 20000));
    s.cooldowns.set(`${me.id}:shake`, t + 41000);
    past('shake', 'extreme', 10, 'me', 30, 'done');
    past('vhs', 'abimee', 10, 3, 95, 'done');
    past('zoom', 'leger', 10, 4, 150, 'removed', { actor: 'Modération', reason: 'Combat de boss', refunded: true });
    past('pixelate', 'marque', 20, 0, 260, 'expired', { refunded: true, reason: 'Pas joué en 3 min : remboursé.' });
    past('color', 'nb', 10, 'me', 330, 'done');
    if (scenario === 'file_pleine') {
      s.queue.push(make('flip', 'marque', 20, other(3), t - 9000), make('mirror', 'vertical', 10, other(4), t - 4000));
    }
    if (scenario === 'pause') s.status = 'paused';
    if (scenario === 'hors_live') {
      s.status = 'offline';
      s.active = [];
      s.queue = [];
    }
    if (scenario === 'mode_doux') s.safe = true;
    if (scenario === 'plein_ecran') {
      s.exclusive = true;
      s.active = s.active.filter((r) => !effectById(r.effect).capture);
      s.queue = [];
    }
    if (scenario === 'solde_bas') s.balance = 1800;
  }
  seed(now);

  return { snapshot, quote, buy, tick, moderation, me, scenario };
}

export { mmss };
