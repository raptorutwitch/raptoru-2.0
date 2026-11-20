// Blackjack (prototype) — la page : le Core simulé, mon écran, une vue spectateur, et le Lab.
import { createCore, createWallet } from './core-sim.js';
import { createClient } from './client.js';
import { createTableView } from './view.js';
import { createBot } from './bots.js';
import { Sfx } from './sfx.js';
import { dealerDistribution, fullShoe, OUTCOMES } from './odds.js';
import { SIDE_LABEL, SIDE_PAYS, sideReturn } from './paytable.js';

const $ = (q) => document.querySelector(q);
const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
const ME = 'me';
const wallet = createWallet({ [ME]: 50_000 });
const core = createCore({ wallet, lab: true, seed: Number(new URLSearchParams(location.search).get('seed')) || Date.now() });
const me = createClient(core, { user: ME, name: 'Antoni' });
const bots = [];

// --- Mon solde (fictif), avec son mouvement ----------------------------------------------------------------------
const bal = $('#balance');
const paintBalance = () => (bal.textContent = fmt(wallet.balance(ME)));
let deltaT;
wallet.onChange((op) => {
  if (op.user !== ME) return;
  paintBalance();
  const d = $('#delta');
  d.textContent = `${op.delta > 0 ? '+' : '−'}${fmt(Math.abs(op.delta))}`;
  d.className = `delta show ${op.delta > 0 ? 'plus' : 'minus'}`;
  clearTimeout(deltaT);
  deltaT = setTimeout(() => (d.className = 'delta'), 1400);
});
paintBalance();

// --- Mon écran ---------------------------------------------------------------------------------------------------
const logEl = $('#log');
const LOG_LABEL = { betting: 'nouvelle manche', bet: 'mise', ready: 'PRÊT', shuffle: 'nouveau sabot', deal: 'distribution', turn: 'tour', card: 'carte', stand: 'reste', split: 'split', reveal: 'carte cachée retournée', dealer_card: 'carte banque', settle: 'règlement', seat_free: 'place libérée', join: 'arrivée', leave: 'départ', rejoin: 'retour', disconnect: 'déconnexion', reconnect: 'reconnexion', resume: 'reprise du Core' };
let lastLogged = 0;
function log(ev) {
  if (!ev || ev.seq <= lastLogged) return;
  lastLogged = ev.seq;
  const extra = ev.type === 'stand' && ev.why !== 'player' ? ` (${ev.why === 'timeout' ? 'temps écoulé' : 'joueur parti'})` : ev.type === 'seat_free' ? ` (${ev.name}, ${ev.reason === 'absent' ? 'absent' : 'parti'})` : ev.type === 'settle' ? ` → banque ${SIDE_LABEL[ev.outcome] ?? ev.outcome}` : ev.seat !== undefined ? ` place ${ev.seat + 1}` : '';
  logEl.textContent = `#${ev.seq} ${LOG_LABEL[ev.type] ?? ev.type}${extra}\n${logEl.textContent}`.slice(0, 4000);
}
let view = null;
function mountMine() {
  view?.destroy();
  view = createTableView($('#host'), { client: me, onTitle: (t) => ($('#title').textContent = t), log });
  return view;
}
mountMine();
$('#back').addEventListener('click', () => view.lobby());

// --- La vue spectateur (un autre viewer) -------------------------------------------------------------------------
let spect = null;
const spectClient = createClient(core, { user: 'spectateur', name: 'Spectateur' });
function toggleSpect() {
  const f = $('#frame2');
  f.hidden = !f.hidden;
  $('#spectBtn').classList.toggle('on', !f.hidden);
  if (f.hidden) return spect?.destroy(), (spect = null);
  spect = createTableView($('#host2'), { client: spectClient, spectator: true, onTitle: (t) => ($('#title2').textContent = t.replace('Blackjack', 'Spectateur')) });
  const t = core.tableOf(ME);
  if (t) spect.open(t);
  else spect.lobby();
}
$('#back2').addEventListener('click', () => spect?.lobby());

// --- Démarrage : une table vivante tout de suite (moi + 4 joueurs simulés) ---------------------------------------
async function addBot(style, tableId = core.tableOf(ME)) {
  const b = createBot(core, { style, tableId });
  bots.push(b);
  try {
    await b.start();
  } catch (e) {
    flash(e.code === 'table_full' ? 'Table complète (10 places).' : e.code ?? String(e));
  }
}
(async () => {
  await view.join(null);
  for (let i = 0; i < 4; i++) await addBot('basic');
})();

// --- Lab -----------------------------------------------------------------------------------------------------------
const RIGS = {
  pair8: (s) => ({ seats: { [s]: [8, 8] }, dealer: [6, 10] }),
  resplit: (s) => ({ seats: { [s]: [8, 8] }, dealer: [6, 10], then: [8, 8, 8, 3, 10, 2, 10] }),
  pairA: (s) => ({ seats: { [s]: [1, 1] }, dealer: [9, 7], then: [10, 10] }),
  double11: (s) => ({ seats: { [s]: [6, 5] }, dealer: [6, 10] }),
  bj: (s) => ({ seats: { [s]: [1, 10] }, dealer: [9, 8] }),
  dealerBJ: () => ({ dealer: [1, 10] }),
  aceNoBJ: () => ({ dealer: [1, 7] }),
  evenMoney: (s) => ({ seats: { [s]: [1, 10] }, dealer: [1, 9] }),
  dealerBJ10: () => ({ dealer: [10, 1] }),
  dealerBust: () => ({ dealer: [6, 10], then: Array(30).fill(10) }),
  soft17: () => ({ dealer: [1, 6] }),
  allBust: (s, seats) => ({ seats: Object.fromEntries(seats.map((i) => [i, [10, 6]])), dealer: [10, 7], then: Array(40).fill(10) }),
  push: (s) => ({ seats: { [s]: [10, 10] }, dealer: [10, 10] }),
};
function flash(text) {
  const a = $('#armed');
  a.textContent = text;
}
$('#lab').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-lab]');
  if (!b) return;
  const k = b.dataset.lab;
  const t = core.tableOf(ME);
  if (k === 'give') wallet.apply(`lab:give:${Date.now()}:${Math.random()}`, ME, Number(b.dataset.n), 'Lab');
  else if (k === 'zero') wallet.balance(ME) && wallet.apply(`lab:zero:${Date.now()}`, ME, -wallet.balance(ME), 'Lab');
  else if (k === 'bot') await addBot(b.dataset.style);
  else if (k === 'size') {
    // Ajuster le nombre de joueurs à ma table (moi compris) : ajouter des joueurs simulés, ou en faire partir.
    if (!t) return flash('Assieds-toi d’abord.');
    const want = Number(b.dataset.n);
    const here = () => core.view(t, ME).seats.filter((x) => x && x.status !== 'left').length; // un partant reste visible jusqu'à la fin de sa manche
    while (here() < want) await addBot('basic');
    for (const x of [...bots].reverse()) {
      if (here() <= want) break;
      if (core.tableOf(x.id) !== t || x.stopped) continue;
      await x.remove();
      bots.splice(bots.indexOf(x), 1);
    }
    flash(`${want} joueurs : les places se recomposent entre deux manches.`);
  } else if (k === 'crowd') for (let i = 0; i < 15; i++) await addBot('basic', null);
  else if (k === 'nobots') {
    for (const x of bots.splice(0)) await x.remove();
  } else if (k === 'rig') {
    const id = $('#rig').value;
    if (!t || !id) return flash(t ? 'Choisis un scénario.' : 'Assieds-toi d’abord.');
    const v = core.view(t, ME);
    const mine = v.seats.find((x) => x?.me);
    core.rig(t, RIGS[id](mine?.seat ?? 0, v.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)));
    flash(`Armé pour la prochaine manche : ${$('#rig').selectedOptions[0].textContent}. (Pose une mise.)`);
  } else if (k === 'offline') {
    await me.setOnline(false);
    b.classList.add('on');
    setTimeout(async () => (await me.setOnline(true), b.classList.remove('on')), 6000);
  } else if (k === 'lose') {
    me.loseNextAnswer();
    flash('La prochaine réponse du Core à mon écran sera perdue : l’action est renvoyée avec le même identifiant.');
  } else if (k === 'reload') {
    const was = view.tableId;
    mountMine();
    if (was) await view.open(was);
    else await view.lobby();
  } else if (k === 'crash') {
    core.crash();
    b.classList.add('on');
    setTimeout(() => (core.resume(), b.classList.remove('on')), 5000);
  } else if (k === 'narrow') {
    const f = $('#frame');
    f.classList.toggle('narrow');
    b.classList.toggle('on', f.classList.contains('narrow'));
    $('#tag').textContent = f.classList.contains('narrow') ? 'Extension · panneau 318 × 496' : 'Extension · composant vidéo 565 × 376';
  } else if (k === 'spect') toggleSpect();
});
$('#maxWin').addEventListener('change', (e) => core.setLimits({ maxWin: Number(e.target.value) }));
$('#sound').addEventListener('change', (e) => Sfx.setEnabled(e.target.checked));
$('#vol').addEventListener('input', (e) => Sfx.setVolume(e.target.value / 100));

// La grille exacte (calculée ici même, src/odds.js)
const d = dealerDistribution(fullShoe(8));
$('#pays').innerHTML = '<span>Banque</span><span>proba. exacte</span><span>100 rendent · RTP</span>' + OUTCOMES.map((o) => `<b>${SIDE_LABEL[o]}</b><span>${(100 * d[o]).toFixed(2)} %</span><span>${sideReturn(o, 100)} · ${(100 * d[o] * SIDE_PAYS[o]).toFixed(1)} %</span>`).join('');

// Pour les contrôles automatiques (tools/check.mjs)
globalThis.__bj = { core, wallet, me, get view() { return view; }, bots, addBot, RIGS };
