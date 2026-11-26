// LAB ONLY — faux Core de Chaos V2 pour la maquette « Interactions » : file, emplacements et sécurité du moteur,
// délais, remboursements, crédits d'effets offerts, modération, scénarios. Il tient le rôle du futur module `chaos` du
// Core (lot 2) : la vue lit `snapshot()` et `quote()`, elle ne calcule ni prix ni règle. Règles provisoires et modèle de
// données : docs/chaos/EXTENSION_INTERACTIONS.md § 8 à 10. Pur (horloge et hasard injectés) : testé par
// test/interactions-model.test.js. Les rôles simulés ne protègent rien.
import { EFFECTS, ENGINE, SLOTS, defaultChoice, describeChoice, durationRange, effectById, minPrice, normalizeChoice, presetOf, priceOf } from '../../modules/interactions/catalog.js';
import { BURST, FAILURES, QUEUE_MAX, QUEUE_TTL_S, REFUND_POLICY, STUDIO_GRACE_S, VIEWER_COOLDOWN_S, creditMismatch, mmss } from '../../modules/interactions/rules.js';
export { BURST, FAILURES, QUEUE_MAX, QUEUE_TTL_S, REFUND_BEFORE, REFUND_POLICY, STUDIO_GRACE_S, VIEWER_COOLDOWN_S, conditionsFor, creditMismatch, creditTerms, mmss } from '../../modules/interactions/rules.js';
const RECEIPTS_MAX = 50; // clés d'idempotence retenues (le Core les garde en base)

export const SCENARIOS = Object.freeze({
  normal: 'Live animé',
  calme: 'Live calme',
  file_pleine: 'File pleine',
  pause: 'Achats suspendus',
  hors_live: 'Hors live',
  desactive: 'Chaos désactivé',
  studio_coupe: 'Studio ou moteur interrompu',
  mode_doux: 'Mode doux',
  capture_ko: 'Image du jeu indisponible (Studio)',
  echecs: 'Pannes au démarrage (remboursements)',
  solde_bas: 'Solde bas',
});

const OTHERS = ['Kiwi_57', 'LaMouetteRieuse', 'PtitChef', 'MamieGamer', 'xXSasukeXx', 'Bubulle'];

/** Hasard reproductible (tests, captures). */
export function seeded(seed = 7) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const slotOf = (r) => effectById(r.effect).slot;
const hasReason = (reason) => String(reason ?? '').trim().length >= 3;

export function createChaosMock({
  scenario = 'normal',
  me = { id: '42', name: 'Toi' },
  balance = 60000,
  now = Date.now(),
  random = seeded(7),
  simulate = true,
  capS = ENGINE.safetyDurationS, // Sécurité › durée maximale (Studio)
  maxActive = ENGINE.safetyMaxActive, // Sécurité › effets actifs en même temps (Studio)
  restore = null, // état exporté (exportState) : le faux Core survit à un rechargement de la page (Lab)
  policy = REFUND_POLICY,
} = {}) {
  let seq = 0;
  let cseq = 0;
  const s = {
    status: 'open', // open | paused (achats suspendus) | offline | disabled (Chaos coupé) | engine_down (Studio / moteur)
    safe: false, // mode doux : effets photosensibles refusés
    // Studio ne peut pas capturer l'image du jeu (le moteur le constate : vrai plein écran exclusif de Windows, fenêtre
    // introuvable…) : les effets qui transforment l'image attendent ; les calques restent possibles. Jamais déduit du
    // mode d'affichage choisi dans le jeu.
    captureDown: false,
    downSince: null, // Studio déconnecté depuis… (ms)
    failQueue: [], // Lab : échecs à appliquer aux prochains démarrages (scénario « Pannes au démarrage »)
    ledger: [], // journal des transactions : débits, remboursements, crédits utilisés et rendus (le plus récent d'abord)
    game: 'Overwatch 2',
    balance,
    active: [],
    queue: [],
    done: [], // demandes terminées (jouées, annulées, expirées, retirées), la plus récente d'abord
    cooldowns: new Map(), // `${viewer}:${effect}` → fin (ms)
    globalCd: new Map(), // effet → fin (ms), effets photosensibles
    credits: [], // crédits d'effets offerts (tous les viewers)
    creditLog: [], // attributions, utilisations, restitutions, retraits — le plus récent d'abord
    burst: [], // achats à charges acceptés, joués l'un après l'autre (BURST)
    burstStarts: [], // heures de départ des achats à charges (minute glissante, tout le chat)
    charges: new Map(), // `${viewer}:${effect}:${preset}` → { n, at } (charges restantes au moment `at`)
    receipts: new Map(), // clé d'idempotence d'un achat → sa réponse (un double envoi ne débite jamais deux fois)
    simulate,
    nextBot: now + 9000,
    capS,
    maxActive,
  };

  function make(effect, choice, buyer, t, { price, by = 'viewer', credit = null, charged = false } = {}) {
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
      charged, // achat à charges (file BURST, pas de délai par viewer)
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

  /** Démarre, ou constate un échec avant démarrage (Lab : file d'échecs) : alors tout est rendu. */
  function startOrFail(r, t) {
    const code = s.failQueue.shift();
    if (code) return finish(r, 'failed', t, { refund: true, actor: 'Studio', reason: FAILURES[code], code });
    return start(r, t);
  }

  function start(r, t) {
    s.queue = s.queue.filter((q) => q !== r);
    s.burst = s.burst.filter((q) => q !== r);
    if (r.charged) s.burstStarts.push(t);
    r.state = 'active';
    r.started = t;
    r.ends = t + r.duration * 1000;
    s.active.push(r);
  }

  function log(kind, credit, t, extra = {}) {
    s.creditLog.unshift({ kind, credit: credit.id, effect: credit.effect, viewer: credit.viewer, at: t, ...extra });
    s.creditLog.length = Math.min(s.creditLog.length, 40);
  }

  function finish(r, state, t, { refund = false, actor = null, reason = null, code = null } = {}) {
    s.active = s.active.filter((a) => a !== r);
    s.queue = s.queue.filter((q) => q !== r);
    s.burst = s.burst.filter((q) => q !== r);
    r.state = state;
    r.finished = t;
    r.actor = actor;
    r.reason = reason;
    r.code = code;
    if (refund) credit(r, t, reason);
    // Un achat à charges qui n'a jamais joué rend aussi sa charge.
    if (refund && r.charged && !r.started) giveCharge(r.buyer, effectById(r.effect), r.choice, t);
    s.done.unshift(r);
    s.done.length = Math.min(s.done.length, 30);
    if ((state === 'done' || state === 'removed') && !r.charged) {
      s.cooldowns.set(`${r.buyer.id}:${r.effect}`, t + VIEWER_COOLDOWN_S * 1000);
      const g = effectById(r.effect).globalCooldown;
      if (g) s.globalCd.set(r.effect, t + g * 1000);
    }
  }

  /** Une ligne du journal des transactions, une seule fois par clé (rejouer un remboursement n'en crée pas un second). */
  function ledger(entry) {
    if (s.ledger.some((x) => x.key === entry.key)) return false;
    s.ledger.unshift(entry);
    s.ledger.length = Math.min(s.ledger.length, 200);
    return true;
  }

  /** Rembourse une demande : les Jetons débités, ou le crédit utilisé (rendu utilisable), une seule fois (clé refund:id). */
  function credit(r, t = now, reason = null) {
    if (r.refunded) return false;
    if (r.credit) {
      const c = s.credits.find((x) => x.id === r.credit);
      if (!c) return false;
      c.state = 'available';
      c.usedAt = null;
      c.request = null;
      r.refunded = true;
      log('restored', c, t, { request: r.id });
      ledger({ key: `refund:${r.id}`, kind: 'credit_restored', viewer: r.buyer.id, request: r.id, amount: 0, at: t, reason });
      return true;
    }
    if (!r.price) return false;
    if (!ledger({ key: `refund:${r.id}`, kind: 'refund', viewer: r.buyer.id, request: r.id, amount: r.price, at: t, reason })) return false;
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

  /** Ce qui empêche tout le monde d'acheter cet effet maintenant (live, Chaos, Studio, jeu, mode doux), ou null. */
  function blockStatus(e) {
    if (s.status === 'offline') return { code: 'offline', label: 'Hors live', detail: 'Les effets s’achètent pendant le live.' };
    if (s.status === 'disabled') return { code: 'disabled', label: 'Désactivé', detail: 'Chaos est désactivé pendant ce live.' };
    if (s.status === 'engine_down') return { code: 'engine_down', label: 'Indisponible', detail: 'Studio ne répond plus : rien n’est débité, les achats reprennent dès son retour.' };
    if (s.status === 'paused') return { code: 'paused', label: 'Suspendu', detail: 'Les achats d’effets sont suspendus pour le moment.' };
    if (s.captureDown && e.capture) return { code: 'capture_unavailable', label: 'Indisponible', detail: 'Studio ne capte pas l’image du jeu en ce moment : cet effet revient dès qu’elle est de retour. Brouillard, Paupières et Flash restent possibles.' };
    if (s.safe && e.photosensitive) return { code: 'safe_mode', label: 'Mode doux', detail: 'Effet lumineux désactivé pendant ce live.' };
    return null;
  }
  /** Délai commun d'un effet (Flash : un par minute pour tout le chat), ou null. */
  function globalBlock(e, t) {
    const g = s.globalCd.get(e.id);
    if (!g || g <= t) return null;
    const left = Math.ceil((g - t) / 1000);
    return { code: 'global_cooldown', label: mmss(left), detail: `Un ${e.label} vient de passer : prochain possible dans ${mmss(left)}.`, until: g };
  }

  // --- Charges (achats rapides d'un préréglage `charges`) --------------------------------------------------------
  const chargeKey = (viewer, e, c) => `${viewer.id}:${e.id}:${c.style}`;
  /** Charges du viewer à l'instant t : { n, max, nextS (prochaine charge dans… s, null si plein), rechargeS }. */
  function chargesOf(viewer, e, c, t) {
    const def = presetOf(e, c)?.charges;
    if (!def) return null;
    const ms = def.rechargeS * 1000;
    const st = s.charges.get(chargeKey(viewer, e, c)) ?? { n: def.max, at: t };
    const gained = Math.max(0, Math.floor((t - st.at) / ms));
    const n = Math.min(def.max, st.n + gained);
    const at = n >= def.max ? t : st.at + gained * ms;
    return { n, max: def.max, rechargeS: def.rechargeS, nextS: n >= def.max ? null : Math.max(1, Math.ceil((at + ms - t) / 1000)), at };
  }
  function takeCharge(viewer, e, c, t) {
    const ch = chargesOf(viewer, e, c, t);
    // La recharge en cours continue (son départ ne bouge pas) ; un réservoir plein commence à se recharger maintenant.
    s.charges.set(chargeKey(viewer, e, c), { n: ch.n - 1, at: ch.n >= ch.max ? t : ch.at });
  }
  function giveCharge(viewer, e, c, t) {
    const ch = chargesOf(viewer, e, c, t);
    if (ch) s.charges.set(chargeKey(viewer, e, c), { n: Math.min(ch.max, ch.n + 1), at: ch.at });
  }
  const burstRecent = (t) => s.burstStarts.filter((x) => t - x < 60_000).length + s.burst.length;

  /** Ce qui empêche CE viewer d'acheter cet effet maintenant (indépendant du réglage), ou null. */
  function blockFor(e, t, viewer = me) {
    const st = blockStatus(e);
    if (st) return st;
    const cd = s.cooldowns.get(`${viewer.id}:${e.id}`);
    if (cd && cd > t) {
      const left = Math.ceil((cd - t) / 1000);
      return { code: 'cooldown', label: mmss(left), detail: `Tu pourras relancer ${e.label} dans ${mmss(left)}.`, until: cd };
    }
    const mine = [...s.queue, ...s.active].find((r) => r.effect === e.id && r.buyer.id === viewer.id && !r.charged);
    if (mine) return { code: mine.state === 'active' ? 'mine_active' : 'mine_queued', label: mine.state === 'active' ? 'Le tien joue' : 'Le tien attend', detail: 'Ton effet est déjà en route.' };
    return globalBlock(e, t);
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
    const charges = usedCredit ? null : chargesOf(viewer, e, c, t);
    if (charges) {
      // Achat à charges : ni délai par viewer ni file de 3, mais ses propres plafonds (BURST) et le solde.
      const ahead = s.burst.length;
      const startsNow = !ahead && canStart({ effect }) && !s.queue.some((q) => q.effect === effect);
      const outcome = startsNow ? { kind: 'now' } : { kind: 'burst', position: ahead + 1, eta: Math.max(0, eta(effect, [...s.queue.filter((q) => q.effect === effect), ...s.burst], t)) };
      let refuse = blockStatus(e) ?? globalBlock(e, t);
      if (!refuse && charges.n < 1) refuse = { code: 'no_charge', label: `0/${charges.max}`, detail: `Plus de charge : la prochaine revient dans ${charges.nextS} s.` };
      if (!refuse && ahead >= BURST.maxPending) refuse = { code: 'burst_full', label: 'File pleine', detail: `${BURST.maxPending} clignements attendent déjà : réessaie dans un instant.` };
      if (!refuse && burstRecent(t) >= BURST.perMinute) refuse = { code: 'burst_rate', label: 'Trop rapide', detail: `${BURST.perMinute} clignements par minute au plus pour tout le chat : réessaie dans quelques secondes.` };
      if (!refuse && viewer === me && s.balance < price) refuse = { code: 'insufficient_funds', label: 'Solde', detail: `Il te manque ${(price - s.balance).toLocaleString('fr-FR')} Jetons.` };
      return { price, fullPrice: total, lines, choice: c, outcome, block: refuse, credit: null, charges };
    }
    const block = blockFor(e, t, viewer);
    const startsNow = canStart({ effect }) && !s.queue.some((q) => slotOf(q) === e.slot) && !s.burst.some((q) => q.effect === effect);
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
    return { price, fullPrice: total, lines, choice: c, outcome, block: refuse, credit: usedCredit, charges: null };
  }

  /**
   * Achat. `pay` : { credit: id } pour payer avec un crédit, { key } = clé d'idempotence de l'intention (un double clic
   * ou un renvoi réseau rend la même réponse, sans second débit — comme le Core avec Idempotency-Key).
   */
  function buy(effect, choice, expectedPrice, t, buyer = me, pay = {}) {
    if (pay.key && s.receipts.has(pay.key)) return { ...s.receipts.get(pay.key), duplicate: true };
    const out = doBuy(effect, choice, expectedPrice, t, buyer, pay);
    if (pay.key) {
      s.receipts.set(pay.key, out);
      if (s.receipts.size > RECEIPTS_MAX) s.receipts.delete(s.receipts.keys().next().value);
    }
    return out;
  }
  function doBuy(effect, choice, expectedPrice, t, buyer, pay) {
    const e = effectById(effect);
    if (!e || e.planned) return { ok: false, code: 'invalid_request', message: 'Effet inconnu.' };
    const range = durationRange(e, normalizeChoice(e, choice, ENGINE.maxDurationS), s.capS);
    if (Number(choice?.duration) > range.max && !range.fixed) return { ok: false, code: 'duration_out_of_range', message: `${range.max} s au plus pendant ce live.` };
    const q = quote(effect, choice, t, buyer, pay);
    if (q.block) return { ok: false, code: q.block.code, message: q.block.detail };
    if (expectedPrice !== q.price) return { ok: false, code: 'price_changed', message: 'Le prix a changé : vérifie avant de confirmer.' };
    if (buyer.id === me.id && !q.credit) s.balance -= q.price;
    const r = make(effect, q.choice, buyer, t, { price: q.price, credit: q.credit?.id ?? null, charged: Boolean(q.charges) });
    ledger({ key: `buy:${pay.key ?? r.id}`, kind: q.credit ? 'credit_used' : 'debit', viewer: buyer.id, request: r.id, amount: q.credit ? 0 : q.price, at: t, reason: null });
    if (q.credit) {
      q.credit.state = 'used';
      q.credit.usedAt = t;
      q.credit.request = r.id;
      log('used', q.credit, t, { request: r.id });
    }
    if (q.charges) takeCharge(buyer, e, q.choice, t);
    if (q.outcome.kind === 'now') startOrFail(r, t);
    else if (q.charges) s.burst.push(r);
    else s.queue.push(r);
    return { ok: true, request: r, outcome: q.outcome };
  }

  function tick(t) {
    for (const r of [...s.active]) if (r.ends <= t) finish(r, 'done', t);
    for (const r of [...s.queue, ...s.burst])
      if (t - r.created > QUEUE_TTL_S * 1000) finish(r, 'expired', t, { refund: true, reason: 'Jamais démarré en 3 min : remboursé.', code: 'queue_expired' });
    // Studio déconnecté plus de STUDIO_GRACE_S : ce qui attendait est rendu (il ne démarrera pas de sitôt).
    if (s.status === 'engine_down' && s.downSince != null && t - s.downSince >= STUDIO_GRACE_S * 1000)
      for (const r of [...s.queue, ...s.burst]) finish(r, 'failed', t, { refund: true, actor: 'Studio', reason: FAILURES.studio_offline, code: 'studio_offline' });
    for (const r of [...s.queue]) if (s.status === 'open' && canStart(r)) startOrFail(r, t);
    // Achats à charges : un à la fois, dans l'ordre, BURST.gapS après la fin du précédent du même effet.
    const next = s.burst[0];
    if (next && s.status === 'open' && canStart(next) && !s.queue.some((q) => q.effect === next.effect)) {
      const last = s.done.find((d) => d.effect === next.effect && d.started)?.finished ?? 0;
      if (t - last >= BURST.gapS * 1000) startOrFail(next, t);
    }
    s.burstStarts = s.burstStarts.filter((x) => t - x < 60_000);
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
      const r = [...s.queue, ...s.burst].find((q) => q.id === id);
      // Démarrée entre-temps (annulée « pendant son démarrage ») : arrêtée, avec le remboursement qui était voulu.
      if (!r && s.active.some((a) => a.id === id)) return { ...moderation.remove(id, { refund, reason }, t), started: true };
      if (!r) return { ok: false, message: 'Cette demande n’est plus dans la file.' };
      if (!refund && (r.price || r.credit) && !hasReason(reason)) return { ok: false, message: 'Un motif est obligatoire sans remboursement.' };
      finish(r, 'cancelled', t, { refund, actor: 'Modération', reason });
      return { ok: true };
    },
    /** Arrête un effet en cours ; sans choix explicite, remboursé s'il a joué moins de 25 % de sa durée. */
    remove(id, { refund, reason = null } = {}, t) {
      const r = s.active.find((a) => a.id === id);
      if (!r) return { ok: false, message: 'Cet effet est déjà terminé.' };
      const early = (t - r.started) / (r.duration * 1000) < policy.stoppedBelow;
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
      if (s.status === 'open') s.status = 'paused';
      return { ok: true };
    },
    setPaused(on) {
      // Seulement entre ouverts et suspendus : hors live, Chaos coupé ou Studio interrompu ne se lèvent pas d'ici.
      if (s.status === 'open' || s.status === 'paused') s.status = on ? 'paused' : 'open';
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
      burst: s.burst.map(view),
      burstMax: BURST.maxPending,
      status: s.status,
      safe: s.safe,
      captureDown: s.captureDown,
      ledger: s.ledger.filter((l) => l.viewer === me.id).slice(0, 20),
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
        // Préréglages à charges de cet effet : la jauge du viewer (Un clignement).
        const charged = (e.presets ?? []).filter((p) => p.charges).map((p) => ({ preset: p.id, ...chargesOf(me, e, { style: p.id }, t) }));
        return {
          id: e.id,
          block: block ?? (s.balance < low && !owned ? { code: 'insufficient_funds', label: 'Solde', detail: 'Pas assez de Jetons.' } : null),
          playing: playing ? { by: playing.buyer.name, mine: playing.buyer.id === me.id, remaining: Math.max(0, Math.ceil((playing.ends - t) / 1000)) } : null,
          startsNow: q.outcome.kind === 'now',
          minPrice: low,
          credits: owned,
          charges: charged,
        };
      }),
    };
  }

  /**
   * Lab : l'état complet, pour qu'un rechargement de la page retrouve achats, file et crédits (store.js). Le vrai Core
   * garde tout cela en base (demandes, crédits, charges, reçus d'idempotence) ; seuls favoris, ordre et derniers
   * réglages restent dans le navigateur (prefs.js).
   */
  function exportState() {
    return JSON.stringify({ ...s, cooldowns: [...s.cooldowns], globalCd: [...s.globalCd], charges: [...s.charges], receipts: [...s.receipts], seq, cseq, scenario });
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
    if (scenario === 'desactive') {
      s.status = 'disabled';
      s.active = [];
      s.queue = [];
    }
    if (scenario === 'studio_coupe') {
      // Le moteur s'est arrêté : ce qui jouait est interrompu et rendu ; la file attend son retour (remboursée après 3 min).
      // Politique des effets démarrés puis interrompus : rendus s'ils ont joué moins de la moitié (réglable, tracé).
      for (const r of [...s.active]) {
        const played = (t - r.started) / (r.duration * 1000);
        const refund = played < policy.interruptedBelow;
        finish(r, 'interrupted', t, { refund, actor: 'Studio', reason: `Studio interrompu à ${Math.round(played * 100)} % : ${refund ? 'remboursé' : 'non remboursé (joué plus de la moitié)'}.`, code: 'interrupted' });
      }
      s.status = 'engine_down';
      s.downSince = t;
    }
    if (scenario === 'mode_doux') s.safe = true;
    if (scenario === 'capture_ko') {
      s.captureDown = true;
      s.active = s.active.filter((x) => !effectById(x.effect).capture);
      s.queue = [];
    }
    // Lab : les prochains démarrages échouent, une raison après l'autre (tous remboursés), puis tout redevient normal.
    if (scenario === 'echecs') {
      s.simulate = false;
      s.failQueue = ['studio_offline', 'engine_unavailable', 'effect_refused', 'capture_unavailable', 'trigger_error', 'network', 'no_ack'];
    }
    if (scenario === 'solde_bas') s.balance = 1500;
  }
  let restored = false;
  if (restore) {
    try {
      const x = JSON.parse(restore);
      if (x.scenario === scenario) {
        Object.assign(s, x, { cooldowns: new Map(x.cooldowns), globalCd: new Map(x.globalCd), charges: new Map(x.charges), receipts: new Map(x.receipts) });
        delete s.seq;
        delete s.cseq;
        delete s.scenario;
        seq = x.seq;
        cseq = x.cseq;
        restored = true;
      }
    } catch {
      /* état illisible : scénario neuf */
    }
  }
  if (!restored) seed(now);

  /** Lab : le prochain démarrage échoue avec ce code (tests, scénario « Pannes au démarrage »). */
  const failNext = (code) => s.failQueue.push(code);

  return { snapshot, quote, buy, tick, moderation, setCap, exportState, failNext, me, scenario, restored };
}

