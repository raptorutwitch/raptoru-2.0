// Halloween — « Ambiance OBS » card (docs/HALLOWEEN.md § 6 bis): the decor source for the viewers (the spider around
// the webcam, bats now and then, a dark vignette). Every switch acts at once on the source in OBS; « Lancer un vol »
// plays the bats now. The card shows what is real: whether a source is open in OBS, whether the decor media are here.

export interface AmbianceStatus {
  ambiance?: {
    settings: {
      enabled: boolean;
      spider: boolean;
      bats: boolean;
      bats_every_min: number;
      vignette: boolean;
      vignette_strength: number;
    };
    connected: boolean;
    url: string;
    spider_ready: boolean;
    bats_ready: boolean;
  };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** The source's URL showing some layers only (the token stays after the #). */
export function layerUrl(url: string, layers: string) {
  const [base, token] = url.split('#');
  return `${base}?layers=${layers}#${token ?? ''}`;
}

export function ambianceCard(s: AmbianceStatus | null) {
  const a = s?.ambiance;
  if (!a) return '<p class="hw-hint">Chargement…</p>';
  const st = a.settings;
  const check = (key: string, on: boolean, label: string, ok = true) =>
    `<label class="hw-check"><input type="checkbox" data-ambiance="${key}"${on ? ' checked' : ''}${ok ? '' : ' disabled'}/> ${label}${ok ? '' : ' <span class="hw-warn">(média absent de ce PC)</span>'}</label>`;
  const state = !st.enabled
    ? '<div class="hw-state warn"><span class="hw-dot"></span>Ambiance coupée (la source n’affiche rien)</div>'
    : a.connected
      ? '<div class="hw-state ok"><span class="hw-dot"></span>Ambiance active · source ouverte dans OBS</div>'
      : '<div class="hw-state bad"><span class="hw-dot"></span>Ambiance active · aucune source ouverte (ajoute-la dans OBS)</div>';
  return `${state}
    <div class="hw-form">
      ${check('enabled', st.enabled, '<b>Ambiance active</b>')}
      ${check('spider', st.spider, 'Araignée autour de la cam', a.spider_ready)}
      ${check('bats', st.bats, 'Vols de chauves-souris', a.bats_ready)}
      <label>Un vol toutes les (min) <input type="number" min="0" max="120" step="1" value="${st.bats_every_min}" data-ambiance="bats_every_min"/></label>
      ${check('vignette', st.vignette, 'Vignette sombre sur les bords')}
      <label>Intensité <input type="range" min="10" max="100" step="5" value="${Math.round(st.vignette_strength * 100)}" data-ambiance="vignette_strength"/></label>
      <button type="button" class="hw-small" data-act="ambiance-bats"${st.enabled && st.bats ? '' : ' disabled'}>Lancer un vol maintenant</button>
    </div>
    <p class="hw-hint">Source navigateur OBS, <b>1920 × 1080</b>, au-dessus de la scène (pas sur l’écran du jeu : seuls les viewers la voient). 0 min = vols seulement sur le bouton.</p>
    <p class="hw-hint">Tout : <code class="hw-url">${esc(a.url)}</code></p>
    <p class="hw-hint">Seulement l’araignée (à placer sur ta cam) : <code class="hw-url">${esc(layerUrl(a.url, 'spider'))}</code></p>
    <p class="hw-hint">Chauves-souris et vignette : <code class="hw-url">${esc(layerUrl(a.url, 'bats,vignette'))}</code></p>`;
}

/** One changed control → the settings patch (pure, tested). */
export function ambiancePatch(
  field: string,
  input: HTMLInputElement | { checked: boolean; value: string },
) {
  if (field === 'bats_every_min')
    return {
      bats_every_min: Math.min(
        120,
        Math.max(0, Math.round(Number(input.value) || 0)),
      ),
    };
  if (field === 'vignette_strength')
    return {
      vignette_strength: Math.min(1, Math.max(0.1, Number(input.value) / 100)),
    };
  if (['enabled', 'spider', 'bats', 'vignette'].includes(field))
    return { [field]: input.checked };
  return null;
}
