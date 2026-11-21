// Opens the Casino test bench in the default browser.
//   npm run casino:bench   (or node test/responsive/casino-bench.mjs)
// A local server serves this worktree's real extension: by default the whole extension (Raptoru Live's header, the
// Mini-jeux module) in an interactive demo against a LOCAL Core (casino-demo/local-core.js: the Core's own game engines
// bundled for the browser, fictitious Jetons in the page's memory); or one game alone on frozen fixture states
// (casino-fixtures.js). No call to the Core, Twitch, the installed Studio or the published extension, no real debit.
// Only test/responsive/out/casino-demo-core.js (ignored by git) is written. Ctrl+C (or closing the window) stops it.
import console from 'node:console';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { startServer } from './server.mjs';
import { buildDemoCore } from './casino-demo/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4472);
const page = (name) => join(HERE, name);
await buildDemoCore();
const server = await startServer(port, {
  csp: true,
  pages: {
    '/': page('casino-bench.html'),
    '/casino-bench.js': page('casino-bench.js'),
    // Served under /demo/ (not the root): the harness's own CSS <link>s are relative to ITS document (as in
    // production), and only /demo/* is mapped by server.mjs to the extension's real files.
    '/demo/casino-harness.html': page('casino-harness.html'),
    '/demo/casino-harness.js': page('casino-harness.js'),
    '/demo/casino-fixtures.js': page('casino-fixtures.js'),
    '/demo/casino-fixture-client.js': page('casino-fixture-client.js'),
  },
}).catch((e) => {
  console.error(
    `Impossible d’ouvrir le port ${port} (${e.code ?? e.message}). Un banc est peut-être déjà ouvert.`,
  );
  process.exit(1);
});
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(
  `Banc de test du Casino : ${url}\nFerme cette fenêtre (ou Ctrl+C) pour l’arrêter.`,
);
if (!process.argv.includes('--no-open')) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}
