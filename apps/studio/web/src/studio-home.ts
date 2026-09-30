// « Studio » tab: single entry point. Local runtime state (Postgres, base Lab, Core local, providers,
// OBS, players), module access and Dev/Lab tools. Talks only to the local Studio server; no secret.

type Service = {
  id: string;
  label: string;
  state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'error';
  detail: string;
  since: string;
};
type RuntimeStatus = {
  enabled: boolean;
  packaged: boolean;
  dataRoot: string;
  services?: Service[];
  ports?: Record<string, number>;
  restartsInWindow?: number;
};
type BonkStatus = {
  enabled: boolean;
  obs?: boolean;
  sourceReady?: boolean;
  error?: string | null;
};
type SoundStatus = { enabled: boolean; ready?: boolean; error?: string | null };
type Prototypes = {
  available: boolean;
  items: { name: string; entry: string; updatedAt: string }[];
};
type LogLine = {
  seq: number;
  at: string;
  source: string;
  level: 'info' | 'error';
  text: string;
};

const HEADERS = { 'x-raptoru-studio': '1' };
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
const BADGE: Record<Service['state'], [string, string]> = {
  ready: ['ok', 'Prêt'],
  starting: ['warn', 'Démarrage'],
  degraded: ['warn', 'Partiel'],
  error: ['ko', 'Erreur'],
  stopped: ['', 'Arrêté'],
};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: HEADERS });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function mountStudioHome(root: HTMLElement) {
  root.innerHTML = `
    <section class="hero"><div>
      <h1>Raptoru Studio</h1>
      <p>Runtime local du stream : Studio démarre et surveille lui-même ce dont Hub, Bonk et Soundboard ont besoin. Aucun terminal, aucun <code>npm run bonk:lab</code>.</p>
    </div></section>
    <div class="grid home-grid">
      <article class="card">
        <h2>Runtime local</h2>
        <div data-slot="services"><p class="muted">Chargement…</p></div>
        <div class="actions"><button type="button" data-act="restart">Réessayer / redémarrer le Core local</button></div>
      </article>
      <article class="card">
        <h2>Connexions</h2>
        <div data-slot="links"></div>
      </article>
      <article class="card">
        <h2>Modules</h2>
        <div class="home-modules">
          <a class="home-module" href="/?tab=extension-lab&amp;surface=video"><b>Hub</b><span>Extension Lab · Vidéo</span></a>
          <a class="home-module" href="/?tab=extension-lab&amp;surface=panel"><b>Bonk</b><span>Core local · providers · overlay OBS</span></a>
          <a class="home-module" href="/?tab=soundboard"><b>Soundboard</b><span>Banque, réglages, lecteur local</span></a>
          <span class="home-module is-off"><b>TTS V2</b><span>Prototype validé (D3) · intégration à venir</span></span>
          <span class="home-module is-off"><b>Tombola V2</b><span>Simulation du Lab · migration à venir</span></span>
          <span class="home-module is-off"><b>Modération V2</b><span>Conception D4 · non implémentée</span></span>
        </div>
      </article>
      <article class="card">
        <h2>Dev / Lab</h2>
        <div class="home-links">
          <a href="/?tab=extension-lab&amp;surface=video">Extension Lab · Vidéo</a>
          <a href="/?tab=extension-lab&amp;surface=panel">Extension Lab · Panel</a>
          <a href="/?tab=extension-lab&amp;surface=mobile">Extension Lab · Mobile</a>
          <a href="/?tab=soundboard">Soundboard config</a>
          <a href="/?tab=test-lab">Test Lab (Core 3000 · bot · logs)</a>
        </div>
        <h3>Prototypes</h3>
        <div data-slot="protos"><p class="muted">—</p></div>
      </article>
      <article class="card wide">
        <h2>Journal du runtime</h2>
        <pre class="home-log" data-slot="log">—</pre>
      </article>
    </div>`;

  const slot = (name: string) =>
    root.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let logSeq = 0;
  const logLines: LogLine[] = [];

  root
    .querySelector('[data-act="restart"]')!
    .addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      await fetch('/api/runtime/restart', {
        method: 'POST',
        headers: HEADERS,
      }).catch(() => {});
      setTimeout(() => {
        btn.disabled = false;
      }, 1500);
      void refresh();
    });

  async function loadPrototypes() {
    const p = await getJson<Prototypes>('/api/dev/prototypes');
    const box = slot('protos');
    if (!p || !p.available) {
      box.innerHTML =
        '<p class="muted">Disponibles quand Studio est lancé depuis le repo (jamais embarqués dans la release).</p>';
      return;
    }
    box.innerHTML = p.items.length
      ? `<div class="home-links">${p.items.map((i) => `<a href="${esc(i.entry)}" target="_blank" rel="noopener">${esc(i.name)}${i.entry.endsWith('calibrate.html') ? ' · calibration' : ''}</a>`).join('')}</div>`
      : '<p class="muted">Aucun prototype avec page d’entrée.</p>';
  }

  async function refresh() {
    const [rt, bonk, sound, logs] = await Promise.all([
      getJson<RuntimeStatus>('/api/runtime/status'),
      getJson<BonkStatus>('/api/bonk-lab/status'),
      getJson<SoundStatus>('/api/sound-lab/status'),
      getJson<LogLine[]>(`/api/test-lab/logs?since=${logSeq}`),
    ]);
    const services = slot('services');
    if (!rt)
      services.innerHTML = '<p class="bad">Serveur Studio injoignable.</p>';
    else if (!rt.enabled)
      services.innerHTML =
        '<p class="muted">Runtime géré par <code>npm run bonk:lab</code> (mode Lab source).</p>';
    else
      services.innerHTML = (rt.services ?? [])
        .map((s) => {
          const [cls, txt] = BADGE[s.state];
          return `<div class="row home-row"><span>${esc(s.label)}</span><span><span class="badge ${cls}">${txt}</span></span></div><p class="home-detail">${esc(s.detail)}</p>`;
        })
        .join('');
    const obs = bonk?.enabled
      ? bonk.obs
        ? bonk.sourceReady
          ? ['ok', 'Connecté · source active']
          : ['warn', 'Connecté · source Bonk inactive']
        : ['', 'Non connecté']
      : ['', 'Indisponible'];
    const player = sound?.enabled
      ? sound.ready
        ? ['ok', 'Actif']
        : ['warn', 'En attente d’activation']
      : ['', 'Indisponible'];
    slot('links').innerHTML = `
      <div class="row home-row"><span>OBS WebSocket</span><span><span class="badge ${obs[0]}">${obs[1]}</span></span></div>
      <p class="home-detail">Connexion depuis la carte « Bonk OBS Lab » de l’Extension Lab (mot de passe jamais stocké).</p>
      <div class="row home-row"><span>Lecteur Soundboard</span><span><span class="badge ${player[0]}">${player[1]}</span></span></div>
      <p class="home-detail">Un clic d’activation par chargement (règle d’autoplay), dans l’onglet Soundboard config.</p>
      <div class="row home-row"><span>Données locales</span><span>${rt ? (rt.packaged ? 'Application installée' : 'Repo (dev)') : '—'}</span></div>
      <p class="home-detail">${esc(rt?.dataRoot ?? '—')} · .env et jetons lus ici, jamais embarqués.</p>
      <div class="row home-row"><span>Production</span><span>SAMMI + StreamElements</span></div>
      <p class="home-detail">Studio tourne en mode test : aucun débit réel, aucune action sur la chaîne de prod.</p>`;
    if (Array.isArray(logs) && logs.length) {
      logSeq = logs[logs.length - 1]!.seq;
      logLines.push(
        ...logs.filter((l) =>
          ['runtime', 'labcore', 'postgres', 'studio'].includes(l.source),
        ),
      );
      logLines.splice(0, Math.max(0, logLines.length - 14));
      slot('log').textContent =
        logLines
          .map(
            (l) =>
              `${l.at.slice(11, 19)} ${l.source.padEnd(8)} ${l.level === 'error' ? '✗ ' : ''}${l.text}`,
          )
          .join('\n') || '—';
    }
  }

  const loop = async () => {
    if (!visible) return;
    await refresh();
    timer = setTimeout(() => void loop(), 2000);
  };
  void loadPrototypes();
  return {
    setVisible(v: boolean) {
      visible = v;
      clearTimeout(timer);
      if (v) void loop();
    },
  };
}
