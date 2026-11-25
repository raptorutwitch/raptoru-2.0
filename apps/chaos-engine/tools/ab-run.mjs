// Déroulé A/B du banc en jeu (docs/chaos/BENCH_EFFETS.md § 8.5), partagé par mesure-jeu.mjs (--ab) et par les tests de
// Studio (vrai runtime Chaos, faux moteur : apps/studio/server/test/chaos-perf-chain.test.ts). Chaque essai passe par
// le Performance Lab de Studio, comme « Lancer la mesure » : sans effet, effet sur l'écran de sa fiche, sans effet. Ne
// touche ni au jeu, ni aux entrées, ni à OBS.
//
// Cycle de vie vérifié CÔTÉ SERVEUR à chaque essai (correction du 25/11 : A/B arrêté par « une mesure en jeu est déjà en
// cours » juste après « done ») :
//   1. Studio libre : aucune mesure en jeu (live_available ; à défaut, Studio antérieur à chaos.10 : statut différent de
//      running) et aucun effet actif dans le moteur ;
//   2. démarrage ; un refus « busy » (Studio antérieur à chaos.10 : la télémétrie précédente n'est libérée qu'à la sortie
//      de son processus) est redemandé tant que le SERVEUR le répond, jusqu'à une échéance : on attend son état, pas une
//      durée fixe ;
//   3. le serveur confirme la mesure de CET effet en cours ;
//   4. fin : statut done ET un nouveau résultat enregistré pour cet effet ;
//   5. effet retiré du moteur.
// Échec ou arrêt demandé : mesure arrêtée, effet arrêté, vérification qu'aucun effet ne reste actif (sinon STOP ALL).

export const AB_PLAN = [
  'diag.watermark',
  'mirror',
  'fog',
  'fog',
  'mirror',
  'diag.watermark',
];
export const AB_PHASES = { reference_s: 10, effect_s: 25, after_s: 10 };
/* global setTimeout */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param api { get(path) → Promise<{status, body}>, post(path, body) → Promise<{status, body}> } (Studio local)
 * @param o { plan, phases, pollMs, readyMs, mark(step), note(obj), say(text), shouldStop() }
 * @returns { done, results: [{effect, at}], failed: null | {effect, reason, …}, clean }
 */
export async function abRun(api, o = {}) {
  const plan = o.plan ?? AB_PLAN;
  const phases = o.phases ?? AB_PHASES;
  const pollMs = o.pollMs ?? 250;
  const readyMs = o.readyMs ?? 15000;
  const runMs =
    (phases.reference_s + phases.effect_s + phases.after_s) * 1000 + 30000;
  const mark = o.mark ?? (() => {});
  const note = o.note ?? (() => {});
  const say = o.say ?? (() => {});
  const stopped = o.shouldStop ?? (() => false);

  const perf = async () => (await api.get('/api/chaos/perf')).body ?? {};
  const active = async () =>
    (await api.get('/api/chaos/state')).body?.status?.active ?? [];
  /** Attend qu'une condition du serveur soit vraie : true, false (échéance) ou 'stop' (arrêt demandé). */
  const until = async (cond, ms, interruptible = true) => {
    const end = Date.now() + ms;
    for (;;) {
      if (interruptible && stopped()) return 'stop';
      let ok;
      try {
        ok = await cond();
      } catch {
        ok = false; // Studio occupé ou injoignable un instant : on redemande
      }
      if (ok) return true;
      if (Date.now() >= end) return false;
      await sleep(pollMs);
    }
  };
  const free = async () => {
    const p = await perf();
    const busy =
      'live_available' in p ? !p.live_available : p.live?.status === 'running';
    return !busy && (await active()).length === 0;
  };
  /** Remet Studio dans un état propre : mesure arrêtée, effet arrêté, aucun effet actif (sinon STOP ALL). */
  const cleanup = async (effect) => {
    await api.post('/api/chaos/perf/live/stop', {}).catch(() => {});
    if (effect) await api.post('/api/chaos/stop', { effect }).catch(() => {});
    let clean = await until(
      async () => (await active()).length === 0,
      5000,
      false,
    );
    if (clean !== true) {
      await api.post('/api/chaos/stop-all', {}).catch(() => {});
      clean = await until(
        async () => (await active()).length === 0,
        5000,
        false,
      );
    }
    note({ step: 'ab-nettoyage', effect, propre: clean === true });
    return clean === true;
  };

  const results = [];
  for (let i = 0; i < plan.length; i++) {
    const effect = plan[i];
    const fail = async (reason, extra = {}) => {
      say(`  ✗ ${effect} : ${reason}`);
      note({ step: 'ab-erreur', effect, reason, ...extra });
      const clean = await cleanup(effect);
      return { done: i, results, failed: { effect, reason, ...extra }, clean };
    };
    const halt = async () => {
      say('  arrêt demandé : mesure et effet arrêtés');
      const clean = await cleanup(effect);
      return {
        done: i,
        results,
        failed: { effect, reason: 'arrêt demandé' },
        clean,
      };
    };

    // 1. Studio libre (aucune mesure, aucune télémétrie, aucun effet).
    const ready = await until(free, readyMs);
    if (ready === 'stop') return halt();
    if (!ready)
      return fail('Studio ne s’est pas libéré (mesure ou effet encore actif)');
    const before = (await perf()).live_results?.[0]?.at ?? null;
    mark(`ab-${i + 1}-${effect}`);

    // 2. Démarrage ; « busy » redemandé tant que le serveur le répond (échéance readyMs).
    let started = false,
      refusal = null;
    const end = Date.now() + readyMs;
    while (!stopped()) {
      const r = await api
        .post('/api/chaos/perf/live/start', {
          effect,
          label: `A/B ${effect}`,
          ...phases,
        })
        .catch((e) => ({
          status: 0,
          body: { error: 'network', message: e.message },
        }));
      if (r.status === 200) {
        started = true;
        break;
      }
      refusal = r.body?.message ?? r.body?.error ?? String(r.status);
      if (r.body?.error !== 'busy' || Date.now() >= end) break;
      note({ step: 'ab-occupe', effect }); // trace : Studio pas encore libre côté serveur
      await sleep(pollMs);
    }
    if (stopped()) return halt();
    if (!started) return fail(`démarrage refusé : ${refusal}`);

    // 3. Le serveur confirme la mesure de CET effet.
    const p1 = await perf();
    if (p1.live?.status !== 'running' || p1.live?.effect !== effect)
      return fail('le serveur ne confirme pas la mesure', {
        live: p1.live?.status ?? null,
      });

    // 4. Fin : done ET un nouveau résultat pour cet effet.
    let last = p1;
    const fin = await until(async () => {
      last = await perf();
      return last.live?.status !== 'running';
    }, runMs);
    if (fin === 'stop') return halt();
    if (!fin) return fail('mesure trop longue');
    if (last.live?.status !== 'done')
      return fail(`mesure ${last.live?.status}`, {
        error: last.live?.error ?? null,
      });
    const saved = last.live_results?.[0];
    if (!saved || saved.effect !== effect || saved.at === before)
      return fail('résultat non enregistré');

    // 5. Effet retiré du moteur.
    const gone = await until(
      async () => !(await active()).some((a) => a.effect === effect),
      readyMs,
    );
    if (gone === 'stop') return halt();
    if (!gone) return fail('effet encore actif après la mesure');
    results.push({ effect, at: saved.at });
    say(`  ✓ ${effect}`);
  }
  return { done: plan.length, results, failed: null, clean: true };
}
