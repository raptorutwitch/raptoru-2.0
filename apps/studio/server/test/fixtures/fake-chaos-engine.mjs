// Faux moteur Chaos (tests du pilote Studio) : parle le protocole v2 sur stdin/stdout, sans GPU ni fenêtre.
// FAKE_CHAOS_CRASH_AFTER=n : quitte brutalement (code 7) à la n-ième commande, pour éprouver la relance.
// FAKE_CHAOS_OLD=1 : moteur d'avant le catalogue d'effets (n'annonce pas ses commandes).
import process from 'node:process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify({ v: 2, ...o })}\n`);
const crashAfter = Number(process.env.FAKE_CHAOS_CRASH_AFTER ?? 0);
const active = [];
let n = 0;
let pings = 0;
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
      if (c.effect !== 'flip')
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
