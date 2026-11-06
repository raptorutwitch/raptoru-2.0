import { CAUTION, cautionMutePrice, cautionPrice } from '@raptoru/schemas';
import {
  clock,
  drawer,
  errText,
  esc,
  fmt,
  hhmm,
  keyed,
  page,
  patch,
  poller,
  seg,
  stateChip,
} from '../ds/ds.js';
import { getJson } from '../http.js';
import { loadSettings, type SettingView } from '../module-settings.js';
import {
  cautionDetail,
  cautionLocks,
  cautionOpen,
  cautionRow,
  toVerifyText,
  type CautionState,
  type CautionView,
} from './sanctions-model.js';
import { bindSettings, settingRows } from './setting-rows.js';

// Caution : libérer une sanction contre des Jetons, depuis le chat seulement (`!caution pseudo`, puis `oui` ou `non`). La page ne
// bouge aucun Jeton et n'appelle pas Twitch : elle montre le devis, l'exécuteur, les tarifs et le sort de chaque caution. Le prix
// du devis vient des formules partagées avec le Core (`cautionPrice`, `cautionMutePrice`), jamais d'un calcul propre à la page.

export function mountCautionPage(root: HTMLElement) {
  const p = page(root, { title: 'Caution', mod: 'sanction' });
  p.body.innerHTML = `<div class="sx">
    <section class="sx-main">
      <div class="sx-alert" data-z="alert"></div>
      <h2 class="d-lb">Le devis</h2>
      <div class="sx-quote" data-z="quote"></div>
      <h2 class="d-lb sx-h">Historique</h2>
      <div class="sx-ledger" data-z="ledger"></div>
    </section>
    <aside class="sx-side">
      <h2 class="d-lb">Avant de libérer</h2>
      <div class="sx-locks" data-z="locks"></div>
      <h2 class="d-lb sx-h">Tarifs</h2>
      <div data-z="rates"></div>
      <h2 class="d-lb sx-h">Règles</h2>
      <ul class="sx-rules">
        <li><code>!caution pseudo</code> lève un timeout Twitch actif, jamais un ban permanent.</li>
        <li>Le payeur répond <code>oui</code> ou <code>non</code> en 30 s. Un devis garde son prix.</li>
        <li>Les Jetons ne sont débités qu’après une relecture de Twitch.</li>
        <li>Remboursés une seule fois si la levée échoue à coup sûr, jamais automatiquement si le résultat est incertain.</li>
      </ul>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let s: CautionState | null = null;
  let error: string | null = null;
  let settings: SettingView[] | null = null;
  let kind: 'timeout' | 'mute' = 'timeout';
  let left = 300;

  async function read() {
    try {
      s = await getJson<CautionState>('/api/caution/state');
      error = null;
    } catch (e) {
      error = errText(e);
    }
    paint();
  }
  const tick = poller(read, 3000);

  const rate = (key: string, fallback: number) =>
    settings?.find((x) => x.key === key)?.value ?? fallback;
  const price = () =>
    kind === 'timeout'
      ? cautionPrice(
          left,
          rate('caution.price_per_minute', CAUTION.pricePerMinute),
        )
      : cautionMutePrice(
          left,
          rate('caution.mute_price_per_10s', CAUTION.mutePricePer10s),
        );
  function paintQuote() {
    const out = p.body.querySelector<HTMLElement>('[data-price]');
    const time = p.body.querySelector<HTMLElement>('[data-left]');
    if (out && time) {
      out.textContent = fmt(price());
      time.textContent = clock(left);
      return;
    }
    z('quote').innerHTML = `<div class="sx-q">
      <div class="sx-qs">${seg(
        'data-kind',
        [
          ['timeout', 'Timeout Twitch'],
          ['mute', 'Sourdine du streamer'],
        ],
        kind,
      )}</div>
      <label class="sx-ql"><span>Temps restant <b data-left>${clock(left)}</b></span><input class="d-range sx-rule" type="range" data-time min="10" max="${kind === 'timeout' ? 1800 : 300}" step="10" value="${left}" aria-label="Temps restant"></label>
      <p class="sx-qp"><b class="d-num" data-price>${fmt(price())}</b><span>Jetons</span></p>
      <small>${kind === 'timeout' ? 'Chaque minute commencée compte.' : 'Chaque tranche de 10 s commencée compte.'} Simulation : rien n’est débité ici.</small>
    </div>`;
  }
  function paint() {
    const ex = s?.executor;
    const silent = ex?.seen_ms_ago !== undefined && ex.seen_ms_ago >= 15_000;
    patch(
      p.state,
      !s
        ? stateChip('w', error ?? 'Lecture…')
        : error
          ? stateChip('w', error)
          : s.to_verify
            ? stateChip('r', toVerifyText(s.to_verify))
            : !ex || silent
              ? stateChip('r', 'Exécuteur Twitch absent')
              : s.ready
                ? stateChip('', 'Prête')
                : stateChip('w', 'Pas prête'),
    );
    const open = s?.recent.filter(cautionOpen).length ?? 0;
    patch(
      z('alert'),
      `${s?.to_verify ? `<p class="sx-due-bar">${esc(toVerifyText(s.to_verify))} : Jetons débités, levée incertaine. Regarde sur Twitch, aucun remboursement automatique.</p>` : ''}${open ? `<p class="sx-open">${open} caution${open > 1 ? 's' : ''} en cours</p>` : ''}`,
    );
    patch(z('locks'), s ? cautionLocks(s) : '');
    patch(
      z('rates'),
      settingRows(settings, [
        'caution.price_per_minute',
        'caution.mute_price_per_10s',
      ]),
    );
    keyed(
      z('ledger'),
      (s?.recent ?? []).map((r) => ({
        key: r.request_id,
        html: cautionRow(r),
      })),
      `<div class="d-empty">${s ? 'Aucune caution.' : esc(error ?? '')}</div>`,
    );
    paintQuote();
  }
  function openRow(r: CautionView) {
    drawer({
      kicker: `Caution · ${hhmm(r.created_at)}`,
      title: r.target?.name ?? r.target_input,
      body: cautionDetail(r),
    });
  }

  p.root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b?.dataset.kind) {
      kind = b.dataset.kind as typeof kind;
      left = Math.min(left, kind === 'timeout' ? 1800 : 300);
      z('quote').innerHTML = '';
      return paintQuote();
    }
    const id = b?.dataset.rq;
    const r = id && s?.recent.find((x) => x.request_id === id);
    if (r) openRow(r);
  });
  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-time]')) {
      left = Number(t.value);
      paintQuote();
    }
  });
  bindSettings(
    p.root,
    () => settings,
    (next) => {
      settings = next;
      paint();
    },
  );

  paint();
  return {
    setVisible(v: boolean) {
      if (v) {
        tick.start();
        void loadSettings().then((x) => {
          settings = x;
          paint();
        });
      } else tick.stop();
    },
  };
}
