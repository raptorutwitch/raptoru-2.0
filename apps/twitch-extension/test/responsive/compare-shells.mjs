// Opens the shell comparison page (legacy ↔ v2, side by side) in the default browser.
//   npm run lab:compare   (or double-click « Comparer legacy et v2.cmd »)
// A local server on 127.0.0.1:4480 serves this worktree's extension with fictitious local data (calibration or demo
// fixtures) and the Lab's content policy: no call to the Core, Twitch, the installed Studio or the published extension
// is possible. Nothing is written. Ctrl+C (or closing the window) stops it.
import console from 'node:console';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4480);
const server = await startServer(port, {
  csp: true,
  pages: {
    '/': join(HERE, 'compare-shells.html'),
    '/compare-shells.js': join(HERE, 'compare-shells.js'),
  },
}).catch((e) => {
  console.error(
    `Impossible d’ouvrir le port ${port} (${e.code ?? e.message}). Une comparaison est peut-être déjà ouverte.`,
  );
  process.exit(1);
});
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(
  `Comparaison legacy ↔ v2 : ${url}\nFerme cette fenêtre (ou Ctrl+C) pour l’arrêter.`,
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
