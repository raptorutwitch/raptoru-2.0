// LAB ONLY — faux Core de Chaos V2 pour la maquette « Interactions » : file, emplacements et sécurité du moteur,
// délais, remboursements, crédits d'effets offerts, modération, scénarios. Il tient le rôle du futur module `chaos` du
// Core (lot 2) : la vue lit `snapshot()` et `quote()`, elle ne calcule ni prix ni règle. Règles provisoires et modèle de
// données : docs/chaos/EXTENSION_INTERACTIONS.md § 8 à 10. Pur (horloge et hasard injectés) : testé par
// test/interactions-model.test.js. Les rôles simulés ne protègent rien.
import { EFFECTS, ENGINE, SLOTS, defaultChoice, describeChoice, durationRange, effectById, minPrice, normalizeChoice, priceOf } from './catalog.js';

export const QUEUE_MAX = 3; // 3 demandes en attente au plus
export const QUEUE_TTL_S = 180; // une demande jamais démarrée après 3 min est remboursée intégralement
export const VIEWER_COOLDOWN_S = 60; // un viewer ne relance pas le même effet avant 1 min après sa fin
export const REFUND_BEFORE = 0.25; // proposition : arrêté avant 25 % de sa durée → remboursement proposé d'office

export const SCENARIOS = Object.freeze({
  normal: 'Live animé',
  calme: 'Live calme',
  file_pleine: 'File pleine',
  pause: 'Achats suspendus',
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

export const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const slotOf = (r) => effectById(r.effect).slot;
const hasReason = (reason) => String(reason ?? '').trim().length >= 3;

/** Ce qu'un crédit permet, en une ligne : « 20 s au plus · Dense au plus ». */
export function creditTerms(credit) {
  const e = effectById(credit.effect);
  const k = credit.constraints ?? {};
  const parts = [];
  if (k.maxS) parts.push(`${k.maxS} s au plus`);
  if (k.levels?.length) parts.push(k.levels.map((l) => e.levels?.find((x) => x.id === l)?.label ?? l).join(' ou '));
  if (k.presets?.length) parts.push(k.presets.map((p) => e.presets?.find((x) => x.id === p)?.label ?? p).join(' ou '));
  return parts.join(' · ') || 'tous les réglages';
}

/** Ce qui empêche ce réglage d'être payé avec ce crédit, ou null. */
export function creditMismatch(credit, e, c) {
  const k = credit.constraints ?? {};
  if (credit.effect !== e.id) return `Ce crédit est pour ${effectById(credit.effect).label}.`;
  if (k.maxS && c.duration > k.maxS) return `Ton crédit couvre ${k.maxS} s au plus.`;
  if (k.levels?.length && !k.levels.includes(c.level)) return `Ton crédit couvre : ${creditTerms(credit)}.`;
  if (k.presets?.length && !k.presets.includes(c.style)) return `Ton crédit couvre : ${creditTerms(credit)}.`;
  return null;
}

export function createChaosMock({
  scenario = 'normal',
  me = { id: '42', name: 'Toi' },
  balance = 60000,
  now = Date.now(),
  random = seeded(7),
  simulate = true,
  capS = ENGINE.safetyDurationS, // Sécurité › durée maximale (Studio)
  maxActive = ENGINE.safetyMaxActive, // Sécurité › effets actifs en même temps (Studio)
} = {}) {
  let seq = 0;
  let cseq = 0;
  const s = {
    status: 'open', // open | paused (achats suspendus) | offline
    safe: false, // mode doux : effets photosensibles refusés
    exclusive: false, // jeu en plein écran exclusif : seuls les calques restent possibles
    game: 'Overwatch 2',
    balance,
    active: [],
    queue: [],
    done: [], // demandes terminées (jouées, annulées, expirées, retirées), la plus récente d'abord
    cooldowns: new Map(), // `${viewer}:${effect}` → fin (ms)
    globalCd: new Map(), // effet → fin (ms), effets photosensibles
    credits: [], // crédits d'effets offerts (tous les viewers)
    creditLog: [], // attributions, utilisations, restitutions, retraits — le plus récent d'abord
    simulate,
    nextBot: now + 9000,
    capS,
    maxActive,
  };

  function make(effect, choice, buyer, t, { price, by = 'viewer', credit = null } = {}) {
    const e = effectById(effect);
    return {
      id: `r${++seq}`,
      effect,
      label: e.label,
      choice,
      summary: describeChoice(e, choice),
      duration: choice.duration,
      price: price ?? priceOf(e, choice).total,
      credit, // id du crédit utilisé à la place des Jetons
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

  // Un effet démarre si son emplacement a de la place, si le même effet ne joue pas déjà et si le plafond Sécurité
  // d'effets simultanés (4 par défaut) n'est pas atteint.
  const canStart = (r) => {
    const e = effectById(r.effect);
    return (
      s.active.length < s.maxActive &&
      s.active.filter((a) => slotOf(a) === e.slot).length < SLOTS[e.slot].capacity &&
      !s.active.some((a) => a.effect === r.effect)
    );
  };

  function start(r, t) {
    s.queue = s.queue.filter((q) => q !== r);
    r.state = 'active';
    r.started = t;
    r.ends = t + r.duration * 1000;
    s.active.push(r);
  }

  function log(kind, credit, t, extra = {}) {
    s.creditLog.unshift({ kind, credit: credit.id, effect: credit.effect, viewer: credit.viewer, at: t, ...extra });
    s.creditLog.length = Math.min(s.creditLog.length, 40);
  }

  function finish(r, state, t, { refund = false, actor = null, reason = null } = {}) {
    s.active = s.active.filter((a) => a !== r);
    s.queue = s.queue.filter((q) => q !== r);
    r.state = state;
    r.finished = t;
    r.actor = actor;
    r.reason = reason;
    if (refund) credit(r, t);
    s.done.unshift(r);
    s.done.length = Math.min(s.done.length, 30);
    if (state === 'done' || state === 'removed') {
      s.cooldowns.set(`${r.buyer.id}:${r.effect}`, t + VIEWER_COOLDOWN_S * 1000);
      const g = effectById(r.effect).globalCooldown;
      if (g) s.globalCd.set(r.effect, t + g * 1000);
    }
  }

  /** Rembourse une demande : les Jetons débités, ou le crédit utilisé (rendu utilisable), une seule fois. */
  function credit(r, t = now) {
    if (r.refunded) return false;
    if (r.credit) {
      const c = s.credits.find((x) => x.id === r.credit);
      if (!c) return false;
      c.state = 'available';
      c.usedAt = null;
      c.request = null;
      r.refunded = true;
      log('restored', c, t, { request: r.id });
      return true;
    }
    if (!r.price) return false;
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
    for (const x of [...s.active, ...ahead].filter((y) => y.effect === effect)) wait = Math.max(wait, (x.ends ?? t + x.duration * 1000) - t);
    if (s.active.length >= s.maxActive) wait = Math.max(wait, Math.min(...s.active.map((a) => a.ends - t)));
    return Math.max(0, Math.ceil(wait / 1000));
  }

  /** Ce qui empêche CE viewer d'acheter cet effet maintenant (indépendant du réglage), ou null. */
  function blockFor(e, t, viewer = me) {
    if (s.status === 'offline') return { code: 'offline', label: 'Hors live', detail: 'Les effets s’achètent pendant le live.' };
    if (s.status === 'paused') return { code: 'paused', label: 'Suspendu', detail: 'Les achats d’effets sont suspendus pour le moment.' };
    if (s.exclusive && e.capture) return { code: 'incompatible', label: 'Pas sur ce jeu', detail: `${s.game} est en plein écran exclusif : seuls Brouillard, Paupières et Flash passent.` };
    if (s.safe && e.photosensitive) return { code: 'safe_mode', label: 'Mode doux', detail: 'Effet lumineux désactivé pendant ce live.' };
    const cd = s.cooldowns.get(`${viewer.id}:${e.id}`);
    if (cd && cd > t) {
      const left = Math.ceil((cd - t) / 1000);
      return { code: 'cooldown', label: mmss(left), detail: `Tu pourras relancer ${e.label} dans ${mmss(left)}.`, until: cd };
    }
    const mine = [...s.queue, ...s.active].find((r) => r.effect === e.id && r.buyer.id === viewer.id);
    if (mine) return { code: mine.state === 'active' ? 'mine_active' : 'mine_queued', label: mine.state === 'active' ? 'Le tien joue' : 'Le tien attend', detail: 'Ton effet est déjà en route.' };
    const g = s.globalCd.get(e.id);
    if (g && g > t) {
      const left = Math.ceil((g - t) / 1000);
      return { code: 'global_cooldown', label: mmss(left), detail: `Un ${e.label} vient de passer : prochain possible dans ${mmss(left)}.`, until: g };
    }
    return null;
  }

  const myCredits = (viewer = me) => s.credits.filter((c) => c.viewer.id === viewer.id && c.state === 'available');

  /**
   * Prix et issue pour un réglage précis : ce que le Core répondra avant la confirmation. `pay` : { credit: id } pour
   * payer avec un crédit d'effet (prix 0, réglage borné par le crédit).
   */
  function quote(effect, choice, t, viewer = me, pay = {}) {
    const e = effectById(effect);
    const c = normalizeChoice(e, choice, s.capS);
    const { total, lines } = priceOf(e, c);
    const usedCredit = pay.credit ? s.credits.find((x) => x.id === pay.credit && x.viewer.id === viewer.id && x.state === 'available') : null;
    const price = usedCredit ? 0 : total;
    const block = blockFor(e, t, viewer);
    const startsNow = canStart({ effect }) && !s.queue.some((q) => slotOf(q) === e.slot);
    const outcome = startsNow ? { kind: 'now' } : { kind: 'queue', position: s.queue.length + 1, eta: eta(effect, s.queue, t) };
    let refuse = block;
    if (!refuse && pay.credit && !usedCredit) refuse = { code: 'credit_unavailable', label: 'Crédit', detail: 'Ce crédit n’est plus disponible.' };
    if (!refuse && usedCredit) {
      const why = creditMismatch(usedCredit, e, c);
      if (why) refuse = { code: 'credit_mismatch', label: 'Crédit', detail: why };
    }
    if (!refuse && outcome.kind === 'queue' && s.queue.length >= QUEUE_MAX)
      refuse = { code: 'queue_full', label: 'File pleine', detail: `${QUEUE_MAX} effets attendent déjà. Réessaie dans un instant, ou choisis un effet qui part tout de suite.` };
    if (!refuse && outcome.kind === 'queue' && s.queue.some((q) => q.buyer.id === viewer.id))
      refuse = { code: 'one_waiting', label: '1 en attente', detail: 'Tu as déjà un effet dans la file : attends qu’il passe.' };
    if (!refuse && !usedCredit && viewer === me && s.balance < price)
      refuse = { code: 'insufficient_funds', label: 'Solde', detail: `Il te manque ${(price - s.balance).toLocaleString('fr-FR')} Jetons.` };
    return { price, fullPrice: total, lines, choice: c, outcome, block: refuse, credit: usedCredit };
  }

  function buy(effect, choice, expectedPrice, t, buyer = me, pay = {}) {
    const e = effectById(effect);
    if (!e || e.planned) return { ok: false, code: 'invalid_request', message: 'Effet inconnu.' };
    const range = durationRange(e, normalizeChoice(e, choice, ENGINE.maxDurationS), s.capS);
    if (Number(choice?.duration) > range.max && !range.fixed) return { ok: false, code: 'duration_out_of_range', message: `${range.max} s au plus pendant ce live.` };
    const q = quote(effect, choice, t, buyer, pay);
    if (q.block) return { ok: false, code: q.block.code, message: q.block.detail };
    if (expectedPrice !== q.price) return { ok: false, code: 'price_changed', message: 'Le prix a changé : vérifie avant de confirmer.' };
    if (buyer.id === me.id && !q.credit) s.balance -= q.price;
    const r = make(effect, q.choice, buyer, t, { price: q.price, credit: q.credit?.id ?? null });
    if (q.credit) {
      q.credit.state = 'used';
      q.credit.usedAt = t;
      q.credit.request = r.id;
      log('used', q.credit, t, { request: r.id });
    }
    if (q.outcome.kind === 'now') start(r, t);
    else s.queue.push(r);
    return { ok: true, request: r, outcome: q.outcome };
  }

  function tick(t) {
    for (const r of [...s.active]) if (r.ends <= t) finish(r, 'done', t);
    for (const r of [...s.queue])
      if (t - r.created > QUEUE_TTL_S * 1000) finish(r, 'expired', t, { refund: true, reason: 'Jamais démarré en 3 min : remboursé.' });
    for (const r of [...s.queue]) if (s.status === 'open' && canStart(r)) start(r, t);
    if (s.simulate && s.status === 'open' && t >= s.nextBot) {
      s.nextBot = t + 14000 + Math.floor(random() * 10000);
      const e = EFFECTS[Math.floor(random() * EFFECTS.length)];
      const viewer = { id: `bot-${Math.floor(random() * OTHERS.length)}`, name: OTHERS[Math.floor(random() * OTHERS.length)] };
      const c = defaultChoice(e);
      if (e.presets?.length) c.style = e.presets[Math.floor(random() * e.presets.length)].id;
      const n = normalizeChoice(e, c, s.capS, { reset: true });
      buy(e.id, n, priceOf(e, n).total, t, viewer);
    }
  }

  function addCredit(viewer, effect, constraints, source, reason, t) {
    const c = { id: `c${++cseq}`, viewer, effect, constraints: constraints ?? {}, source, reason, grantedAt: t, state: 'available', usedAt: null, request: null };
    s.credits.unshift(c);
    log('granted', c, t, { by: source.by, reason });
    return c;
  }

  // --- Modération. Le vrai Core vérifiera le rôle côté serveur ; ici, aucun contrôle. ----------------------------
  const find = (id) => [...s.active, ...s.queue, ...s.done].find((r) => r.id === id) ?? null;
  const moderation = {
    /** Retire une demande de la file : jamais démarrée, donc remboursée intégralement sauf choix contraire motivé. */
    cancel(id, { refund = true, reason = null } = {}, t) {
      const r = s.queue.find((q) => q.id === id);
      if (!r) return { ok: false, message: 'Cette demande n’est plus dans la file.' };
      if (!refund && (r.price || r.credit) && !hasReason(reason)) return { ok: false, message: 'Un motif est obligatoire sans remboursement.' };
      finish(r, 'cancelled', t, { refund, actor: 'Modération', reason });
      return { ok: true };
    },
    /** Arrête un effet en cours ; sans choix explicite, remboursé s'il a joué moins de 25 % de sa durée. */
    remove(id, { refund, reason = null } = {}, t) {
      const r = s.active.find((a) => a.id === id);
      if (!r) return { ok: false, message: 'Cet effet est déjà terminé.' };
      const early = (t - r.started) / (r.duration * 1000) < REFUND_BEFORE;
      if (refund === false && (r.price || r.credit) && !hasReason(reason)) return { ok: false, message: 'Un motif est obligatoire sans remboursement.' };
      finish(r, 'removed', t, { refund: refund ?? early, actor: 'Modération', reason });
      return { ok: true, refunded: r.refunded };
    },
    /** Rembourse après coup une demande terminée (une seule fois, motif obligatoire). */
    refund(id, reason, t) {
      const r = find(id);
      if (!r || r.state === 'queued' || r.state === 'active') return { ok: false, message: 'Seule une demande terminée se rembourse après coup.' };
      if (!hasReason(reason)) return { ok: false, message: 'Un motif est obligatoire.' };
      if (!credit(r, t)) return { ok: false, message: r.refunded ? 'Déjà remboursée.' : 'Rien à rembourser (effet offert).' };
      r.refundReason = reason;
      r.refundedAt = t;
      return { ok: true };
    },
    /** STOP ALL : tout ce qui joue s'arrête (règle des 25 %), les achats sont suspendus ; la file attend. */
    stopAll(t) {
      for (const r of [...s.active]) moderation.remove(r.id, { refund: undefined, reason: 'Tout arrêter' }, t);
      if (s.status !== 'offline') s.status = 'paused';
      return { ok: true };
    },
    setPaused(on) {
      if (s.status !== 'offline') s.status = on ? 'paused' : 'open';
      return { ok: true };
    },
    /** Effet offert par la modération : gratuit, passe devant la file. */
    trigger(effect, choice, t) {
      const e = effectById(effect);
      const r = make(effect, normalizeChoice(e, choice, s.capS), { id: 'mod', name: 'Modération' }, t, { price: 0, by: 'mod' });
      if (canStart(r)) start(r, t);
      else s.queue.unshift(r);
      return { ok: true, request: r };
    },
    /** Crédit d'effet offert à un viewer (utilisable plus tard, une fois) ; motif obligatoire. */
    grantCredit({ viewer, effect, constraints = {}, reason, by = 'Modération', kind = 'moderator' }, t) {
      if (!effectById(effect) || effectById(effect).planned) return { ok: false, message: 'Effet inconnu.' };
      if (!viewer?.id) return { ok: false, message: 'Choisis un viewer.' };
      if (!hasReason(reason)) return { ok: false, message: 'Un motif est obligatoire.' };
      return { ok: true, credit: addCredit(viewer, effect, constraints, { kind, by }, reason.trim(), t) };
    },
    /** Retire un crédit pas encore utilisé (motif obligatoire). */
    revokeCredit(id, reason, t) {
      const c = s.credits.find((x) => x.id === id);
      if (!c || c.state !== 'available') return { ok: false, message: 'Ce crédit n’est plus disponible.' };
      if (!hasReason(reason)) return { ok: false, message: 'Un motif est obligatoire.' };
      c.state = 'revoked';
      log('revoked', c, t, { reason: reason.trim(), by: 'Modération' });
      return { ok: true };
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
    const credits = myCredits();
    return {
      status: s.status,
      safe: s.safe,
      exclusive: s.exclusive,
      game: s.game,
      balance: s.balance,
      queueMax: QUEUE_MAX,
      capS: s.capS,
      maxActive: s.maxActive,
      active: s.active.map(view),
      queue: s.queue.map(view),
      history: s.done.map(view),
      mine: [...s.active, ...s.queue, ...s.done].filter((r) => r.buyer.id === me.id).map(view).slice(0, 8),
      credits,
      creditLog: s.creditLog.filter((l) => l.viewer.id === me.id),
      allCredits: s.credits,
      allCreditLog: s.creditLog,
      viewers: [me, ...OTHERS.map((name, i) => ({ id: `bot-${i}`, name }))],
      effects: EFFECTS.map((e) => {
        // La carte dit ce qui bloque avant tout réglage : règles du viewer, puis file (au réglage par défaut), puis solde.
        const q = quote(e.id, defaultChoice(e), t);
        const queueBlock = q.block && ['queue_full', 'one_waiting'].includes(q.block.code) ? q.block : null;
        const block = blockFor(e, t) ?? queueBlock;
        const playing = s.active.find((a) => a.effect === e.id);
        const low = minPrice(e);
        const owned = credits.filter((c) => c.effect === e.id).length;
        return {
          id: e.id,
          block: block ?? (s.balance < low && !owned ? { code: 'insufficient_funds', label: 'Solde', detail: 'Pas assez de Jetons.' } : null),
          playing: playing ? { by: playing.buyer.name, mine: playing.buyer.id === me.id, remaining: Math.max(0, Math.ceil((playing.ends - t) / 1000)) } : null,
          startsNow: q.outcome.kind === 'now',
          minPrice: low,
          credits: owned,
        };
      }),
    };
  }

  /** Lab : plafond Sécurité changé dans Studio (30 s par défaut, 60 s au plus). */
  function setCap(cap) {
    s.capS = Math.min(ENGINE.maxDurationS, Math.max(5, cap));
  }

  // --- Scénarios (Lab) ----------------------------------------------------------------------------------------------
  function seed(t) {
    const other = (i) => ({ id: `bot-${i}`, name: OTHERS[i] });
    const pick = (effect, patch = {}) => {
      const e = effectById(effect);
      const d = defaultChoice(e);
      return normalizeChoice(e, { ...d, ...patch, opts: { ...d.opts, ...patch.opts } }, s.capS, { reset: Boolean(patch.style || patch.level) });
    };
    const past = (effect, patch, i, agoS, state, extra = {}) => {
      const c = pick(effect, patch);
      const r = make(effect, c, i === 'me' ? me : other(i), t - agoS * 1000);
      Object.assign(r, { state, started: t - agoS * 1000, finished: t - (agoS - c.duration) * 1000 }, extra);
      s.done.push(r);
      return r;
    };
    // Crédits du viewer : un gagné à la tombola (offert depuis Studio), un donné par un modérateur, un déjà utilisé.
    addCredit(me, 'flip', { maxS: 20 }, { kind: 'streamer', by: 'Raptoru_' }, 'Gagnant de la tombola du 24/11', t - 86_400_000 * 2);
    addCredit(me, 'fog', { maxS: 15, levels: ['marque', 'dense'] }, { kind: 'moderator', by: 'LeCroupier_' }, 'Bravo pour le clutch', t - 3_600_000);
    const used = addCredit(me, 'blur', { maxS: 10 }, { kind: 'reward', by: 'Daily 30 jours (à venir)' }, 'Récompense de série', t - 86_400_000 * 5);
    const consume = (r) => {
      r.credit = used.id;
      r.price = 0;
      used.state = 'used';
      used.usedAt = r.started;
      used.request = r.id;
      log('used', used, r.started, { request: r.id });
    };
    if (scenario === 'calme') {
      s.simulate = false;
      consume(past('blur', {}, 'me', 400, 'done'));
      return;
    }
    // Un live animé : deux effets à l'écran, un en file, un historique varié.
    start(make('fog', pick('fog', { duration: 20 }), other(2), t - 6000), t - 6000);
    start(make('flip', pick('flip', { duration: 30 }), other(5), t - 18000), t - 18000);
    s.queue.push(make('mirror', pick('mirror'), other(1), t - 20000));
    s.cooldowns.set(`${me.id}:shake`, t + 41000);
    past('shake', { opts: { intensity: 1 } }, 'me', 30, 'done');
    past('vhs', {}, 3, 95, 'done');
    past('zoom', { opts: { factor: 4, point: [0.3, 0.4] } }, 4, 150, 'removed', { actor: 'Modération', reason: 'Combat de boss', refunded: true });
    past('pixelate', { duration: 20 }, 0, 260, 'expired', { refunded: true, reason: 'Jamais démarré en 3 min : remboursé.' });
    consume(past('blur', {}, 'me', 330, 'done'));
    if (scenario === 'file_pleine') s.queue.push(make('flip', pick('flip', { duration: 20 }), other(3), t - 9000), make('mirror', pick('mirror', { style: 'alterne' }), other(4), t - 4000));
    if (scenario === 'pause') s.status = 'paused';
    if (scenario === 'hors_live') {
      s.status = 'offline';
      s.active = [];
      s.queue = [];
    }
    if (scenario === 'mode_doux') s.safe = true;
    if (scenario === 'plein_ecran') {
      s.exclusive = true;
      s.active = s.active.filter((x) => !effectById(x.effect).capture);
      s.queue = [];
    }
    if (scenario === 'solde_bas') s.balance = 1500;
  }
  seed(now);

  return { snapshot, quote, buy, tick, moderation, setCap, me, scenario };
}

