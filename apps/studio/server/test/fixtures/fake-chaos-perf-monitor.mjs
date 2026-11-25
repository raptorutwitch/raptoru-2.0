// Fausse télémétrie du Performance Lab (ChaosEngine.exe --perf-monitor) : une ligne « start », puis un relevé tout de
// suite et à chaque intervalle (--interval-ms, ramené à 100 ms au plus pour des tests rapides). Ne lit rien sur le
// système. S'arrête quand Studio ferme son entrée, ou à son échéance (--deadline-ms).
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const every = Math.min(100, arg('--interval-ms', 500));
const deadline = arg('--deadline-ms', 60000);
const t0 = Date.now();
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
out({
  type: 'start',
  mode: 'monitor',
  system: { cpu: { logical_cores: 4 } },
});
const sample = () =>
  out({
    type: 'sample',
    t_ms: Date.now() - t0,
    gpu_ms_all: 0,
    processes: [],
  });
sample();
const timer = setInterval(() => {
  if (Date.now() - t0 > deadline) process.exit(0);
  sample();
}, every);
process.stdin.on('end', () => {
  clearInterval(timer);
  process.exit(0);
});
process.stdin.resume();
