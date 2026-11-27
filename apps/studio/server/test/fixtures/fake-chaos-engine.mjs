// Faux moteur Chaos (tests du pilote Studio) : parle le protocole v2 sur stdin/stdout, sans GPU ni fenêtre.
// FAKE_CHAOS_CRASH_AFTER=n : quitte brutalement (code 7) à la n-ième commande, pour éprouver la relance.
// FAKE_CHAOS_OLD=1 : moteur d'avant le catalogue d'effets (n'annonce pas ses commandes).
// FAKE_CHAOS_EFFECTS=a,b : effets que « effect.activate » accepte (défaut : flip).
// FAKE_CHAOS_VIEWER=1 : demandes des viewers (lot 2) — registre à emplacements, deux écrans, config.get, cycle de vie
// (accepted → started → ended après FAKE_CHAOS_PLAY_MS), refus de la politique reject, effect.cancel, et un événement
// « fake.request » par effect.request reçu (les tests vérifient ce que le moteur a reçu, ou jamais reçu).
// FAKE_CHAOS_DISABLED=a,b : effets désactivés dans leur fiche (refusés aux sources communautaires).
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';

const out = (o) => process.stdout.write(`${JSON.stringify({ v: 2, ...o })}\n`);
const crashAfter = Number(process.env.FAKE_CHAOS_CRASH_AFTER ?? 0);
const activable = (process.env.FAKE_CHAOS_EFFECTS ?? 'flip').split(',');
const active = [];
let n = 0;
let pings = 0;

// ---------- mode viewers (FAKE_CHAOS_VIEWER=1) ----------
const viewer = process.env.FAKE_CHAOS_VIEWER === '1';
const playMs = Number(process.env.FAKE_CHAOS_PLAY_MS ?? 150);
const disabled = (process.env.FAKE_CHAOS_DISABLED ?? '').split(',');
const D1 = String.raw`\\.\DISPLAY1`;
const D2 = String.raw`\\.\DISPLAY2`;
const MONITORS = [
  { device: D1, key: 'left', label: 'Écran gauche', order: 0, primary: true },
  { device: D2, key: 'right', label: 'Écran droit', order: 1, primary: false },
];
const REGISTRY = {
  schema: 'raptoru.chaos.registry',
  version: 1,
  engine_limits: { max_active_effects: 4 },
  slots: {
    transform: { label: 'Transformation', order: 0, max_active: 1 },
    filter: { label: 'Filtre', order: 1, max_active: 2 },
  },
  effects: [
    { id: 'flip', slot: 'transform', internal: false },
    { id: 'mirror', slot: 'transform', internal: false },
    { id: 'blur', slot: 'filter', internal: false },
    { id: 'blink', slot: 'filter', internal: true },
  ],
};
const SCREENS = { flip: 'right', mirror: 'right', blur: 'primary' };
const vactive = [];
const now = () => Date.now();
const view = (a, extra = {}) => ({
  request_id: a.request_id,
  effect: a.effect,
  state: a.state,
  source: a.source,
  target: { kind: 'screen', mode: 'E', device: a.device },
  started: a.startedAt != null,
  ...(a.startedAt != null ? { running_ms: now() - a.startedAt } : {}),
  ...extra,
});
function finish(a, outcome, reason) {
  const i = vactive.indexOf(a);
  if (i >= 0) vactive.splice(i, 1);
  clearTimeout(a.timer);
  out({
    type: 'event',
    event: `effect.${outcome}`,
    t_ms: 3,
    ...view({ ...a, state: 'finished' }, { outcome, reason }),
  });
}
function viewerCmd(c, res, err) {
  switch (c.cmd) {
    case 'describe':
      return (res({ registry: REGISTRY, implemented: [] }), true);
    case 'config.get':
      return (
        res({
          safety: {
            max_duration_ms: 30000,
            max_active_effects: 4,
            safe_mode: false,
          },
          effects: Object.fromEntries(
            REGISTRY.effects.map((e) => [
              e.id,
              {
                enabled: !disabled.includes(e.id),
                screen: SCREENS[e.id] ?? 'primary',
                cursor: true,
              },
            ]),
          ),
        }),
        true
      );
    case 'targets.list':
      return (res({ monitors: MONITORS, windows: [] }), true);
    case 'status':
      return (
        res({ active: vactive.map((a) => view(a)), queued: [], surfaces: [] }),
        true
      );
    case 'effect.request': {
      out({
        type: 'event',
        event: 'fake.request',
        t_ms: 1,
        request_id: c.request_id,
        body: c,
      });
      const def = REGISTRY.effects.find((e) => e.id === c.effect);
      if (!def)
        return (err('unknown_effect', `effet inconnu : ${c.effect}`), true);
      const kind = c.source?.kind ?? 'test';
      if (disabled.includes(c.effect) && kind !== 'studio' && kind !== 'test')
        return (err('effect_disabled', `${c.effect} est désactivé`), true);
      const device = c.target?.device;
      if (
        c.target?.kind === 'screen' &&
        !MONITORS.some((m) => m.device === device)
      )
        return (err('screen_missing', `écran introuvable : ${device}`), true);
      const a = {
        request_id: c.request_id,
        effect: c.effect,
        source: c.source,
        device,
        state: 'starting',
      };
      const here = vactive.filter((x) => x.device === device);
      const why = here.some((x) => x.effect === c.effect)
        ? 'same_effect_active'
        : here.filter(
              (x) =>
                REGISTRY.effects.find((e) => e.id === x.effect)?.slot ===
                def.slot,
            ).length >= REGISTRY.slots[def.slot].max_active
          ? 'slot_busy'
          : null;
      if (why) {
        const v = view(
          { ...a, state: 'finished' },
          { outcome: 'rejected', reason: why },
        );
        res(v);
        out({ type: 'event', event: 'effect.rejected', t_ms: 2, ...v });
        return true;
      }
      vactive.push(a);
      out({ type: 'event', event: 'effect.accepted', t_ms: 2, ...view(a) });
      res(view(a));
      a.timer = setTimeout(() => {
        a.state = 'active';
        a.startedAt = now();
        out({ type: 'event', event: 'effect.started', t_ms: 4, ...view(a) });
        a.timer = setTimeout(() => finish(a, 'ended', 'duration'), playMs);
      }, 20);
      return true;
    }
    case 'effect.cancel': {
      const a = vactive.find((x) => x.request_id === c.request_id);
      if (!a)
        return (
          err('unknown_request', `demande inconnue : ${c.request_id}`),
          true
        );
      finish(a, 'ended', c.reason ?? 'canceled');
      return (res({ canceled: true }), true);
    }
    case 'stop_all': {
      const all = [...vactive];
      for (const a of all) finish(a, 'ended', c.reason ?? 'stop_all');
      return (res({ stopped: all.length }), true);
    }
  }
  return false;
}
out({
  type: 'event',
  event: 'engine.ready',
  t_ms: 1,
  engine: 'fake',
  version: '0',
  protocol: 2,
  args: process.argv.slice(2),
  ...(process.env.FAKE_CHAOS_OLD === '1'
    ? {}
    : {
        commands: [
          'hello',
          'ping',
          'describe',
          'status',
          'diagnostics',
          'targets.list',
          'effect.request',
          'effect.cancel',
          'effect.activate',
          'effect.stop',
          'stop_all',
          'config.get',
          'config.set',
          'config.reset',
          'preset.set',
          'preset.delete',
          'shutdown',
          'obs.plan',
          'effect.obs_lost',
        ],
      }),
});
createInterface({ input: process.stdin }).on('line', (line) => {
  const c = JSON.parse(line);
  n++;
  if (crashAfter && n >= crashAfter) process.exit(7);
  const res = (result) => out({ type: 'response', id: c.id, ok: true, result });
  const err = (code, message) =>
    out({ type: 'response', id: c.id, ok: false, error: { code, message } });
  if (viewer && viewerCmd(c, res, err)) return;
  switch (c.cmd) {
    case 'ping':
      pings++;
      return res({ t_ms: 0, pings });
    case 'describe':
      return res({
        registry: { schema: 'raptoru.chaos.registry', version: 1, effects: [] },
        implemented: [],
      });
    case 'status':
      return res({ active, queued: [], surfaces: [] });
    case 'targets.list':
      return res({
        monitors: [
          {
            device: String.raw`\\.\DISPLAY1`,
            label: 'Écran principal · 2560×1440',
            primary: true,
          },
        ],
        windows: [{ hwnd: 42, title: 'Jeu', process: 'jeu.exe' }],
      });
    case 'effect.request':
      if (c.effect !== 'flip')
        return err('unknown_effect', `effet inconnu : ${c.effect}`);
      active.push(c);
      out({
        type: 'event',
        event: 'effect.accepted',
        t_ms: 2,
        request_id: c.request_id,
      });
      return res({
        request_id: c.request_id,
        state: 'starting',
        source: c.source,
        target: c.target,
      });
    case 'effect.activate':
      if (!activable.includes(c.effect))
        return err('unknown_effect', `effet inconnu : ${c.effect}`);
      active.push({ request_id: c.request_id, effect: c.effect });
      return res({
        effect: c.effect,
        kind: c.kind,
        screen: 'right',
        activations: [
          { request_id: c.request_id, state: 'starting', source: c.source },
        ],
      });
    case 'effect.stop': {
      const before = active.length;
      active.splice(
        0,
        active.length,
        ...active.filter((x) => x.effect !== c.effect),
      );
      return res({ effect: c.effect, stopped: before - active.length });
    }
    case 'stop_all':
      active.length = 0;
      return res({ stopped: 1 });
    case 'shutdown':
      res({ bye: true });
      return process.exit(0);
    default:
      return err('unknown_command', String(c.cmd));
  }
});
process.stdin.on('end', () => process.exit(0));
