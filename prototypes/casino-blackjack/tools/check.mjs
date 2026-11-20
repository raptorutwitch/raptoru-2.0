// Contrôles du prototype dans Chromium (vrais clics) : node tools/check.mjs. Chaque état important est aussi audité
// à taille réelle (565 × 376 et panneau 318 × 496) : aucun chevauchement, aucun texte coupé, rien hors du tapis.
// Captures : captures/*.png. Sortie : « ok » / « KO » par point, et le total. Durée : ~3 min (un délai de secours de
// 45 s est vraiment attendu).
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../start.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(join(ROOT, '../../apps/studio/server/package.json'))('@playwright/test');
const SHOTS = join(ROOT, 'captures');
mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) unlinkSync(join(SHOTS, f));
const PORT = 4532;
const server = await serve(PORT);
let ko = 0;
let n = 0;
const check = (ok, what, extra = '') => {
  n++;
  if (!ok) ko++;
  console.log(`${ok ? 'ok ' : 'KO '} ${what}${extra !== '' ? ` — ${extra}` : ''}`);
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/avatars\.invalid|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
// Toutes les animations de cartes, enregistrées (rotation ? durée ? rejouées après un rafraîchissement ?)
await page.addInitScript(() => {
  globalThis.__anims = [];
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (kf, opts) {
    if (this.classList?.contains('card')) globalThis.__anims.push({ at: performance.now(), kf: JSON.stringify(kf), d: typeof opts === 'object' ? opts.duration : opts });
    return orig.call(this, kf, opts);
  };
});
await page.goto(`http://127.0.0.1:${PORT}/?seed=11`);
const st = () => page.evaluate(() => globalThis.__bj.view.state);
const bal = () => page.evaluate(() => globalThis.__bj.wallet.balance('me'));
const until = async (fn, ms = 60_000, what = '') => {
  const t0 = Date.now();
  for (;;) {
    const s = await st();
    if (s && (await fn(s))) return s;
    if (Date.now() - t0 > ms) throw new Error(`attente dépassée : ${what} (phase ${s?.phase})`);
    await page.waitForTimeout(120);
  }
};
const mine = (s) => s.seats.find((x) => x?.me);
const shot = (name, sel = '#frame') => page.locator(sel).screenshot({ path: join(SHOTS, `${name}.png`) });
const H = '#host';
const text = (sel) => page.locator(sel).first().innerText();
const seatWidth = () => page.evaluate(() => document.querySelector('#host .seat')?.getBoundingClientRect().width ?? 0);
const lab = (k, extra = '') => page.click(`[data-lab="${k}"]${extra}`);
/**
 * L'audit de mise en page d'un écran : les blocs visibles qui ne doivent jamais se chevaucher (cases banque, cartes et
 * total de la banque, centre, places, sabot, languette, pastille), les textes coupés (contenu plus large que la boîte),
 * ce qui sort du tapis ; et la géométrie de l'arc (cases identiques, droites, symétriques, banque centrée).
 */
async function audit(where, host = H) {
  const r = await page.evaluate((hs) => {
    const host = document.querySelector(hs);
    const felt = host.querySelector('.felt');
    const F = felt.getBoundingClientRect();
    const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length;
    const box = (e) => e.getBoundingClientRect();
    const name = (e) => e.dataset.side ? `case ${e.dataset.side}` : e.dataset.seat ? `place ${+e.dataset.seat + 1}` : e.className.split(' ')[0] || e.tagName;
    const open = felt.classList.contains('hist-open');
    const blocks = [
      ...host.querySelectorAll('.side'),
      host.querySelector('[data-zone="dealer"]'),
      host.querySelector('[data-tot="dealer"]'),
      ...host.querySelectorAll('.spot .who, .spot .msg, .spot [data-zone="spot"], .spot [data-tot="spot"]'),
      ...host.querySelectorAll('.seat'),
      host.querySelector('.shoe'),
      host.querySelector('.freepill'),
      open ? null : host.querySelector('.htab'),
      felt.classList.contains('rules-open') ? null : host.querySelector('.rtab'),
    ].filter((e) => vis(e) && (!e.classList.contains('tot') || e.textContent));
    const pad = 1; // une bordure qui se touche n'est pas un chevauchement
    const over = [];
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      const a = box(blocks[i]);
      const b = box(blocks[j]);
      if (a.left + pad < b.right && b.left + pad < a.right && a.top + pad < b.bottom && b.top + pad < a.bottom) over.push(`${name(blocks[i])} × ${name(blocks[j])}`);
    }
    const out = blocks.filter((e) => { const b = box(e); return b.left < F.left - 1 || b.right > F.right + 1 || b.top < F.top - 9 || b.bottom > F.bottom + 1; }).map(name);
    // Textes coupés : pseudos (ceux de la démo, ≤ 8 lettres ; un pseudo Twitch plus long finit en « … », entier au
    // survol), étiquettes, cotes, totaux, boutons, historique.
    const texts = [...host.querySelectorAll('.seat .nm, .side b, .side small, .side .sv, .seat .bet, .seat .tag, .tot, .act b, .btn, .chip, .hround .hno, .hround .hme, .hp li b, .hp__h b, .state b, .msg b, .tip')].filter(vis);
    const cut = texts.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2).map((e) => `${e.className || e.tagName}:${e.textContent.trim().slice(0, 12)}`);
    const sides = [...host.querySelectorAll('.side')].map(box);
    const same = sides.every((b) => Math.abs(b.width - sides[0].width) < 0.5 && Math.abs(b.height - sides[0].height) < 0.5);
    const rot = [...host.querySelectorAll('.side')].some((e) => { const m = new DOMMatrix(getComputedStyle(e).transform); return Math.abs(m.b) > 0.001 || Math.abs(m.c) > 0.001; });
    const mid = F.left + F.width / 2;
    // L'arc : la case i et la case 6 − i en miroir ; la grille du panneau : chaque rangée centrée.
    const flat = host.querySelector('.sides').classList.contains('flat');
    const rows = Object.values(Object.groupBy(sides, (b) => Math.round(b.top)));
    const sym = flat
      ? rows.every((row) => Math.abs(Math.min(...row.map((b) => b.left)) + Math.max(...row.map((b) => b.right)) - 2 * mid) <= 1)
      : sides.every((b, i) => { const o = sides[6 - i]; return Math.abs(b.left + b.width / 2 - mid + (o.left + o.width / 2 - mid)) <= 1 && Math.abs(b.top - o.top) <= 1; });
    const d = box(host.querySelector('[data-zone="dealer"]'));
    const centered = Math.abs(d.left + d.width / 2 - mid) <= 1;
    return { over, out, cut, same, rot, sym, centered };
  }, host);
  const bad = [...r.over, ...r.out.map((x) => `hors du tapis : ${x}`), ...r.cut.map((x) => `coupé : ${x}`)];
  check(bad.length === 0, `${where} : aucun chevauchement, aucun texte coupé, rien hors du tapis`, bad.slice(0, 4).join(' | '));
  check(r.same && !r.rot && r.sym && r.centered, `${where} : 7 cases identiques, droites, symétriques ; cartes de la banque centrées`, JSON.stringify({ same: r.same, rot: r.rot, sym: r.sym, centered: r.centered }));
}
const narrow = async (on) => {
  const is = await page.evaluate(() => document.querySelector('#frame').classList.contains('narrow'));
  if (is !== on) await lab('narrow');
  await page.waitForTimeout(350);
};

/** Jouer ma manche jusqu'au bout : PRÊT avec une mise simple, puis RESTER partout. */
async function playSimpleRound(main = 100) {
  await until((x) => x.phase === 'betting' && mine(x) && !mine(x).bet?.ready, 120_000, 'mises');
  await page.click(`${H} [data-chip="100"]`);
  for (let k = 0; k < main / 100; k++) await page.click(`${H} [data-main]`);
  await page.click(`${H} [data-ready]`);
  for (;;) {
    const s = await until((x) => x.phase === 'settled' || (x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me), 180_000, 'mon tour ou la fin');
    if (s.phase === 'settled') return s;
    await page.keyboard.press('r');
    await page.waitForTimeout(600);
  }
}

try {
  // 1. La table à 5 joueurs, phase de mise.
  let s = await until((x) => x.seats.filter(Boolean).length >= 5, 20_000, 'table de 5');
  check(!!mine(s), 'je suis assis avec 4 joueurs simulés');
  await until((x) => x.phase === 'betting', 90_000, 'mises');
  const avatars = await page.locator(`${H} .seat img.av`).count();
  check(avatars === 5, 'chaque place a son avatar rond', String(avatars));
  check((await page.locator(`${H} .seat`).count()) === 5, 'seules les 5 places occupées sont dessinées (pas 10 boîtes)');
  const title = await text(`${H} .sides__t`);
  check(/pari sur le score de la banque/i.test(title) && !/indépendant|mise comprise/i.test(await text(`${H} .sides`)), 'titre simple « Pari sur le score de la banque », sans texte superflu', title);
  const odds = await page.locator(`${H} [data-side] small`).allInnerTexts();
  check(odds.join('|') === 'paye 11:2|paye 11:2|paye 6:1|paye 4:1|paye 12:1|paye 18:1|paye 12:5', 'cotes « paye a:b », sans virgule', odds.join(' · '));
  const labels = await page.locator(`${H} [data-side] b`).allInnerTexts();
  check(labels.join('|') === '17|18|19|20|21|B|Bust' && (await page.getAttribute(`${H} [data-side="BJ"]`, 'data-full')) === 'Blackjack', '« B » dans la case, « Blackjack » en nom complet', labels.join(' · '));
  check((await page.locator(`${H} .sides__arc textPath`).textContent()).includes('Pari sur le score'), 'le titre suit la courbe sous les cases');
  const arc = await page.evaluate(() => [...document.querySelectorAll('#host [data-side]')].map((b) => Math.round(b.getBoundingClientRect().top)));
  check(arc[0] < arc[3] && arc[6] < arc[3], 'les 7 scores suivent un arc autour de la banque', arc.join(','));
  const lift = await page.evaluate(() => [...document.querySelectorAll('#host .seat')].map((x) => Math.round(x.getBoundingClientRect().top)));
  check(lift[0] < lift[2] && lift[4] < lift[2], 'les places suivent un arc (les bords remontent)', lift.join(','));
  const barH = await page.evaluate(() => document.querySelector('#host .bar').getBoundingClientRect().height);
  check(barH <= 46, 'barre du bas plus mince', `${barH} px`);
  await audit('mises, 5 joueurs');
  await shot('01-mises-5-joueurs');
  check(!(await page.locator(`${H} .htab span`).evaluate((e) => +getComputedStyle(e).opacity)), 'languette Historique discrète : une icône, le mot seulement au survol');
  await page.hover(`${H} .rtab`);
  await page.waitForTimeout(250);
  check(await page.locator(`${H} .rtab span`).evaluate((e) => +getComputedStyle(e).opacity === 1), 'au survol : la languette s’allonge et montre son nom');
  await page.click(`${H} .rtab`);
  await page.waitForTimeout(350);
  const rules = await text(`${H} .rules`);
  check(/21/.test(rules) && /3:2/.test(rules) && /17/.test(rules) && /Assurance/.test(rules) && /Banque bust/.test(rules), 'panneau Règles : 21, blackjack 3:2, banque jusqu’à 17, assurance, banque bust', rules.slice(0, 60).replace(/\n/g, ' '));
  await shot('01b-regles');
  await narrow(true);
  await shot('01c-panneau-regles');
  await narrow(false);
  await page.click(`${H} .rules [data-rules]`);
  await page.mouse.move(2, 2);

  // 2. Les mises : choisir un jeton, toucher où le poser, retirer, jeton libre.
  await page.selectOption('#rig', 'pair8');
  await lab('rig');
  const b0 = await bal();
  await page.click(`${H} [data-chip="100"]`);
  for (let k = 0; k < 3; k++) await page.click(`${H} [data-main]`);
  check((await text(`${H} .seat.me .sb__amt`)) === '300', 'jeton 100 × 3 sur MA place → 300');
  await page.click(`${H} [data-main]`, { button: 'right' });
  check((await text(`${H} .seat.me .sb__amt`)) === '200', 'clic droit sur ma place : retire un jeton → 200');
  await page.click(`${H} [data-chip="500"]`);
  await page.click(`${H} [data-main]`);
  await page.click(`${H} [data-chip="100"]`);
  await page.click(`${H} [data-side="17"]`);
  await page.click(`${H} [data-side="BJ"]`);
  await page.click(`${H} [data-side="BUST"]`);
  await page.click(`${H} [data-undo]`); // retire le dernier jeton posé : BUST
  await page.click(`${H} [data-custom]`);
  await page.fill(`${H} .cuform input`, '250');
  await page.press(`${H} .cuform input`, 'Enter');
  await page.click(`${H} [data-main]`);
  const d = await page.evaluate(() => globalThis.__bj.view.draft);
  check(d.main === 950 && d.side['17'] === 100 && d.side.BJ === 100 && !d.side.BUST, 'mise 950 (200 + 500 + jeton libre 250) + banque 17 : 100 + blackjack : 100', JSON.stringify(d));
  check((await text(`${H} [data-side="17"] .sv`)) === '100', 'case 17 : ma mise en petite étiquette (100)');
  await page.hover(`${H} [data-side="17"]`);
  const tipText = await text(`${H} .tip`);
  check(/Mise 100/.test(tipText) && /\+550/.test(tipText) && /retour 650/.test(tipText), 'bulle exacte : mise 100 · gain net +550 · retour 650 (11:2 = 11 de gain pour 2 misés)', tipText.replace(/\n/g, ' '));
  await page.hover(`${H} [data-main]`);
  const tipMain = await text(`${H} .tip`);
  check(/Mise 950/.test(tipMain) && /\+950/.test(tipMain) && /retour 1\s?900/.test(tipMain) && /\+1\s?425/.test(tipMain) && /retour 2\s?375/.test(tipMain), 'bulle de ma mise : victoire +950 (retour 1 900), blackjack 3:2 +1 425 (retour 2 375)', tipMain.replace(/\n/g, ' '));
  await page.hover(`${H} .shoe`);
  check(/cartes sur 416/.test(await text(`${H} .tip`)), 'le sabot : le détail au survol', (await text(`${H} .tip`)).replace(/\n/g, ' · '));
  await page.mouse.move(2, 2);
  const sum = (await text(`${H} .sum`)).replace(/\s/g, '');
  check(sum.includes('1150') && /reste/.test(sum), 'total engagé 1 150 affiché, avec le solde restant', sum);
  await page.waitForTimeout(700);
  check(b0 - (await bal()) === 1150, 'une seule réservation de 1 150 au Wallet (jamais deux fois)', String(b0 - (await bal())));
  await audit('mises posées (principale + 2 paris banque)');
  await shot('02-mises-preparees');
  await narrow(true);
  await audit('panneau 318 : mises posées', H);
  await shot('02b-panneau-mises');
  await narrow(false);
  await page.click(`${H} [data-ready]`);
  await page.waitForTimeout(300);
  s = await st();
  check(mine(s)?.bet?.ready || s.phase !== 'betting', 'PRÊT : mises verrouillées');
  if (s.phase === 'betting') {
    check(await page.isDisabled(`${H} [data-main]`), 'après PRÊT, ma zone de mise ne bouge plus');
    await shot('03-pret-attente');
  }

  // 3. Mon tour : compréhensible sans lire le centre ; aucun timer agressif.
  s = await until((x) => x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me, 120_000, 'mon tour');
  check(await page.evaluate(() => document.querySelector('#host .bj').classList.contains('my-turn')), 'mon tour : le tapis s’éclaire');
  check((await page.locator(`${H} .seat.me.turn .tag.joue`).innerText()).toUpperCase() === 'JOUE', 'mon tour : l’étiquette verte « JOUE » sur ma place');
  check((await page.locator(`${H} .act .ico`).count()) === 4, 'les 4 actions ont chacune une icône');
  check(!(await page.locator(`${H} .tmbar.show`).count()), 'pas de compte à rebours affiché au début de la décision');
  check(s.turn.deadline - s.turn.startsAt === 30_000, 'première décision : 30 s côté Core', String(s.turn.deadline - s.turn.startsAt));
  check(mine(s).hands[0].cards.map((c) => c.rank).join() === '8,8', 'paire de 8 forcée');
  await audit('décision (mon tour)');
  await shot('04-mon-tour');
  const rot = await page.evaluate(() => globalThis.__anims.filter((a) => /rotate/.test(a.kf)).length);
  const long = await page.evaluate(() => globalThis.__anims.filter((a) => a.d > 260).length);
  check(rot === 0 && long === 0, 'distribution : glissement sans rotation, ≤ 260 ms par carte', `${rot} rotations, ${long} trop longues`);
  // Rafraîchir l'écran : aucune carte déjà visible ne rejoue son animation.
  const before = await page.evaluate(() => globalThis.__anims.length);
  await lab('reload');
  await page.waitForTimeout(250);
  const replayed = await page.evaluate((b) => globalThis.__anims.length - b, before);
  check(replayed === 0, 'après rafraîchissement : aucune animation rejouée', String(replayed));
  // Split avec une réponse perdue : renvoyé, une seule fois.
  await page.click('[data-lab="lose"]');
  const b1 = await bal();
  await page.click(`${H} [data-act="split"]`);
  await until((x) => mine(x).hands.length >= 2, 20_000, 'split');
  await page.waitForTimeout(1500);
  s = await st();
  check(mine(s).hands.length === 2 && b1 - (await bal()) === 950, 'réponse perdue au split : une seule fois (2 mains, 950 débités)', `${mine(s).hands.length}, ${b1 - (await bal())}`);
  for (;;) {
    s = await until((x) => x.phase === 'settled' || (x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me), 180_000, 'fin');
    if (s.phase === 'settled') break;
    await page.keyboard.press('r');
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(380);
  const flying = await page.locator(`${H} .flychip`).count();
  check(flying > 0, 'règlement : des jetons volent entre les places et la banque', String(flying));
  await shot('05a-paiement-en-vol');
  await page.waitForTimeout(900);
  await audit('résultats');
  const res = await page.locator(`${H} .seat .bet.res`).count();
  check(res >= 5, 'résultats : chaque étiquette de mise devient le résultat de la main (paris banque à part)', String(res));
  await shot('05-resultats');
  const r = mine(s).result;
  check((await bal()) === b0 - r.staked + r.paid, 'solde = avant − misé + payé (main, split, deux paris banque)', `${b0} − ${r.staked} + ${r.paid} = ${await bal()}`);
  check(Object.keys(r.side).length === 2, 'les deux paris banque ont été résolus', JSON.stringify(r.side));
  const ops = await page.evaluate(() => globalThis.__bj.wallet.ops().filter((o) => o.user === 'me').map((o) => o.key));
  check(new Set(ops).size === ops.length, 'chaque mouvement du Wallet unique');
  await page.hover(`${H} .htab`);
  await page.click(`${H} .htab`);
  await page.waitForTimeout(350);
  const rounds = await page.locator(`${H} .hround`).count();
  check(rounds >= 1 && (await page.locator(`${H} .hd`).count()) === 0, 'historique : une languette, des manches repliées', `${rounds} manche(s)`);
  await shot('06a-historique-replie');
  await page.click(`${H} .hround`);
  await page.waitForTimeout(250);
  const hist = await text(`${H} .hd`);
  check(/Toi/.test(hist) && /Main · 1\s?900 misés · 2 mains/.test(hist) && /Pari 17 · 100 misés/.test(hist) && /Pari Blackjack · 100 misés/.test(hist) && /payé − misé/.test(hist), 'une manche dépliée : chaque mise, chaque pari banque (misé, retour) et le net', hist.slice(0, 120).replace(/\n/g, ' | '));
  const net17 = r.side['17'].payout ? /retour 650\s*\+550/.test(hist) : /Pari 17 · 100 misés · perdu\s*−100/.test(hist);
  check(net17, 'historique : net et retour brut jamais confondus (17 : retour 650 = +550, ou perdu = −100)');
  await audit('historique ouvert');
  await shot('06-historique');
  await narrow(true);
  await audit('panneau 318 : historique ouvert');
  await shot('06b-panneau-historique');
  await narrow(false);
  await page.click(`${H} .hist [data-hist]`);

  // 4. La table s'adapte au nombre de joueurs (2, 10), dans les deux formats.
  await lab('size', '[data-n="2"]');
  await playSimpleRound();
  await until((x) => x.phase === 'betting' && x.seats.filter(Boolean).length === 2, 60_000, 'table de 2');
  await page.waitForTimeout(400);
  const w2 = await seatWidth();
  check(w2 >= 120, 'à 2 joueurs : des places larges', `${Math.round(w2)} px`);
  await shot('07-table-2');
  // Busted : tout le monde saute (scénario forcé), ma place se grise avec le badge.
  await page.selectOption('#rig', 'allBust');
  await lab('rig');
  await page.click(`${H} [data-chip="100"]`);
  await page.click(`${H} [data-main]`);
  await page.click(`${H} [data-ready]`);
  await until((x) => x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me, 60_000, 'mon tour (bust)');
  await page.keyboard.press('t');
  await page.waitForTimeout(700);
  check(await page.evaluate(() => document.querySelector('#host .seat.me')?.classList.contains('busted')), 'bust : ma place grisée');
  check(await page.isVisible(`${H} .seat.me .bustb`), 'bust : badge « BUSTED » au milieu de la place');
  check((await page.locator(`${H} .seat.me .card`).count()) >= 3 && (await page.isVisible(`${H} .seat.me .bet`)), 'bust : ses cartes et sa mise restent lisibles');
  await audit('busted');
  await shot('07b-busted');
  for (;;) {
    s = await until((x) => x.phase === 'settled' || (x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me), 120_000, 'fin');
    if (s.phase === 'settled') break;
    await page.keyboard.press('r');
    await page.waitForTimeout(600);
  }
  await narrow(true);
  await audit('panneau 318 : 2 joueurs, résultats');
  await shot('08-panneau-2');
  await narrow(false);
  // Assurance : la banque montre un As et a blackjack → j'assure la moitié, payée 2:1.
  const playRig = async (rig, onIns) => {
    await page.selectOption('#rig', rig);
    await lab('rig');
    await until((x) => x.phase === 'betting' && mine(x) && !mine(x).bet?.ready, 120_000, 'mises');
    await page.click(`${H} [data-chip="100"]`);
    await page.click(`${H} [data-main]`);
    if (rig === 'dealerBust') await page.click(`${H} [data-side="20"]`);
    await page.click(`${H} [data-ready]`);
    if (onIns) {
      await until((x) => x.phase === 'insurance', 60_000, 'assurance');
      await page.waitForTimeout(300);
      await onIns();
    }
    for (;;) {
      s = await until((x) => x.phase === 'settled' || (x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me), 120_000, 'fin');
      if (s.phase === 'settled') return s;
      await page.keyboard.press('r');
      await page.waitForTimeout(600);
    }
  };
  s = await playRig('dealerBJ', async () => {
    check((await page.locator(`${H} [data-ins]`).count()) === 2 && /Assurer\s*50/.test(await text(`${H} [data-ins="50"]`)), 'As visible : « Assurer 50 » (la moitié de 100) ou « Non merci »');
    check((await page.locator(`${H} [data-zone="dealer"] .card.back`).count()) === 1, 'pendant l’assurance : la carte cachée reste cachée');
    await audit('assurance proposée');
    await shot('11-assurance');
    const b = await bal();
    await page.click(`${H} [data-ins="50"]`);
    await page.waitForTimeout(400);
    check(b - (await bal()) === 50, 'assurance prise : 50 débités, une fois');
  });
  check(JSON.stringify(mine(s).result.insurance) === '{"stake":50,"payout":150}' && mine(s).result.net === 0, 'blackjack de la banque : assurance payée 2:1 (+100), main perdue (−100), net 0', JSON.stringify(mine(s).result));
  await page.waitForTimeout(900);
  const insMsg = await text(`${H} .spot`);
  check(/Perdu −100/.test(insMsg) && /assurance \+100/.test(insMsg) && /total 0/.test(insMsg), 'résultat lisible : « Perdu −100 · assurance +100 · total 0 »', insMsg.replace(/\n/g, ' '));
  await shot('11b-assurance-payee');
  s = await playRig('aceNoBJ', async () => {
    await page.click(`${H} [data-ins="50"]`);
    await until((x) => x.phase === 'players', 30_000, 'la main continue');
    await page.waitForTimeout(300);
    check(/assurance perdue/.test(await text(`${H} .toast`)), 'pas de blackjack : « assurance perdue, la main continue »', await text(`${H} .toast`));
  });
  check(JSON.stringify(mine(s).result.insurance) === '{"stake":50,"payout":0}', 'As sans blackjack : assurance perdue, la main jouée normalement');
  s = await playRig('evenMoney', async () => {
    check(/Even money/.test(await text(`${H} .bar`)), 'mon blackjack contre un As : « Even money » proposé');
    await page.click(`${H} [data-ins="even"]`);
  });
  check(mine(s).hands[0].verdict === 'even' && mine(s).result.net === 100, 'even money : +100 garanti');
  // La banque saute : ma main vivante gagne, même si mon pari banque perd (jamais « égalité »).
  s = await playRig('dealerBust');
  await page.waitForTimeout(900);
  const lbl = await text(`${H} .seat.me .bet`);
  check(s.outcome === 'BUST' && mine(s).hands.every((h) => h.verdict === 'win' || h.verdict === 'bust') && /\+100/.test(lbl) && !/Égalité/.test(lbl), 'banque bust : ma main gagne (+100), le pari 20 perdu n’en fait pas une égalité', `${lbl} · net ${mine(s).result.net}`);
  await shot('12-banque-bust');

  // Seul à la table, puis un arrivant pendant la manche : il n'apparaît qu'à la suivante (rien ne bouge).
  await lab('size', '[data-n="1"]');
  await until((x) => x.phase === 'betting' && x.seats.filter(Boolean).length === 1, 120_000, 'seul');
  await page.waitForTimeout(300);
  await audit('1 joueur, mises');
  await shot('07c-seul');
  await page.click(`${H} [data-chip="100"]`);
  await page.click(`${H} [data-main]`);
  await page.click(`${H} [data-ready]`);
  await until((x) => x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me, 60_000, 'mon tour (seul)');
  const before1 = await page.locator(`${H} .seat`).count();
  await lab('bot', '[data-style="basic"]');
  await page.waitForTimeout(500);
  check((await page.locator(`${H} .seat`).count()) === before1 && /manche suivante/.test(await text(`${H} .freepill`)), 'un arrivant en pleine manche : aucune place ne bouge, « +1 à la manche suivante »');
  await audit('1 joueur + 1 arrivant, décision');
  for (;;) {
    s = await until((x) => x.phase === 'settled' || (x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me), 120_000, 'fin');
    if (s.phase === 'settled') break;
    await page.keyboard.press('r');
    await page.waitForTimeout(600);
  }
  await until((x) => x.phase === 'betting', 30_000, 'manche suivante');
  await page.waitForTimeout(400);
  check((await page.locator(`${H} .seat`).count()) === 2, 'entre deux manches : l’arrivant prend sa place');
  await lab('size', '[data-n="2"]');

  // 5. Un absent (pose une mise, ne dit jamais PRÊT) : le délai de secours l'exclut et lui rend sa mise.
  await lab('bot', '[data-style="afk"]');
  await page.waitForTimeout(6000); // il pose sa mise
  const afk = await page.evaluate(() => globalThis.__bj.bots.find((b) => b.style === 'afk')?.id);
  await page.click(`${H} [data-chip="100"]`);
  await page.click(`${H} [data-main]`);
  await page.click(`${H} [data-ready]`);
  await page.waitForTimeout(400);
  s = await st();
  check(s.phase === 'betting' && s.betDeadline !== null, 'un joueur n’est pas prêt : la table attend (délai de secours armé, discret)');
  s = await until((x) => x.phase !== 'betting', 60_000, 'délai de secours');
  const afkSeat = s.seats.find((x) => x?.user === afk);
  const afkBal = await page.evaluate((id) => globalThis.__bj.wallet.balance(id), afk);
  check(afkSeat && !afkSeat.inRound && afkBal === 20_000, 'délai de secours : l’absent est exclu, sa mise rendue, la manche part', `${afkBal}`);
  for (;;) {
    s = await until((x) => x.phase === 'settled' || (x.phase === 'players' && x.turn && x.seats[x.turn.seat]?.me), 120_000, 'fin');
    if (s.phase === 'settled') break;
    await page.keyboard.press('r');
    await page.waitForTimeout(600);
  }

  // 6. Table pleine (10), grand format puis panneau ; vue spectateur.
  await lab('nobots');
  await lab('size', '[data-n="10"]');
  await playSimpleRound();
  await until((x) => x.seats.filter(Boolean).length === 10, 30_000, '10 joueurs');
  // Un arrivant en pleine manche n'apparaît pas tout de suite (rien ne bouge) : « +1 à la manche suivante ».

  await page.click('[data-lab="spect"]');
  await playSimpleRound().catch(() => {});
  s = await until((x) => x.phase === 'players' && x.seats.filter((p) => p?.inRound).length >= 8, 180_000, 'manche à 8+');
  await page.waitForTimeout(500);
  const w10 = await seatWidth();
  check(w10 <= 52 && w10 >= 40, 'à 10 joueurs : places compactes', `${Math.round(w10)} px`);
  check((await page.locator('#host2 [data-zone="dealer"] .card.back').count()) === 1, 'spectateur : la carte cachée reste cachée');
  check((await page.locator('#host2 [data-main]:not([hidden]), #host2 [data-ready], #host2 [data-act]').count()) === 0, 'spectateur : aucune commande de mise ni de jeu');
  await audit('10 joueurs, décisions');
  await audit('spectateur, 10 joueurs', '#host2');
  await shot('09-table-10');
  await page.locator('#frame2').scrollIntoViewIfNeeded();
  await shot('09b-spectateur', '#frame2');
  await page.click('[data-lab="spect"]');
  await lab('narrow');
  await page.waitForTimeout(400);
  await audit('panneau 318 : 10 joueurs');
  await shot('10-panneau-10');
  const over = await page.evaluate(() => {
    const host = document.querySelector('#host');
    const hb = host.getBoundingClientRect();
    return [...host.querySelectorAll('.seat, .bar, .dealer, .side')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.right > hb.right + 1 || b.left < hb.left - 1 || b.bottom > hb.bottom + 1;
    }).length;
  });
  check(over === 0, 'panneau à 10 : rien ne déborde', String(over));
  const dealerOk = await page.evaluate(() => {
    const f = document.querySelector('#host .felt').getBoundingClientRect();
    const d = document.querySelector('#host .dealer').getBoundingClientRect();
    return d.top >= f.top - 1 && document.querySelector('#host .felt').scrollTop === 0;
  });
  check(dealerOk, 'panneau à 10 : la banque reste visible (le tapis ne défile pas)');
  await lab('narrow');

  // 7. Déconnexion 6 s puis resynchronisation.
  await lab('offline');
  await page.waitForTimeout(7500);
  const seqs = await page.evaluate(() => {
    const b = globalThis.__bj;
    const t = b.core.tableOf('me') ?? b.view.tableId;
    return [b.view.state.seq, b.core.view(t, 'me').seq];
  });
  check(seqs[1] - seqs[0] <= 1, 'après la coupure : écran resynchronisé sur le Core', seqs.join(' / '));
} catch (e) {
  check(false, 'déroulé', e.message);
}
check(errors.length === 0, 'aucune erreur dans la console', errors.slice(0, 3).join(' | '));
console.log(`\n${n - ko}/${n} contrôles passés`);
await browser.close();
server.close();
process.exit(ko ? 1 : 0);
