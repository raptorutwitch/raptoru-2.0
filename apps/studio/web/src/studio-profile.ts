// Studio profile (ASTRA-P1-019 lot 2, D6): Lab (default) or Production, in the same app.
// Read-only view of the Studio server's /api/profile (never a secret: the pairing code cannot
// authenticate). Every change goes through Electron main (native confirmation, then server restart).
import { copy, esc, ic, patch, stateChip, toast } from './ds/ds.js';

type ProductionState =
  | 'inactive'
  | 'not_configured'
  | 'not_paired'
  | 'connecting'
  | 'connected'
  | 'core_unreachable'
  | 'revoked'
  | 'update_required'
  | 'tls_invalid'
  | 'identity_mismatch'
  | 'start_failed';

type ProfileStatus = {
  selected: 'lab' | 'production';
  effective: 'lab' | 'production';
  notice: string | null;
  build?: {
    version: string;
    sha: string | null;
    packaged: boolean;
    built_at: string | null;
  };
  production: {
    configured: boolean;
    config_error: string | null;
    core_origin: string | null;
    /** « Staging » (build constant) or « Test (environnement) ». */
    label?: string | null;
    channel_id?: string | null;
    custom_ca: boolean;
    identity: 'none' | 'present' | 'corrupt';
    installation_id: string | null;
    pairing_code: string | null;
    state: ProductionState;
    detail: string | null;
  };
};
type Result = { ok?: boolean; error?: string; message?: string };
type ProfileBridge = {
  select(name: 'lab' | 'production'): Promise<Result>;
  regenerate(): Promise<Result>;
};

const STATE: Record<ProductionState, ['' | 'w' | 'r' | 'off', string]> = {
  inactive: ['off', 'Inactif (profil Lab)'],
  not_configured: ['off', 'Non configuré'],
  not_paired: ['w', 'Non appairé'],
  connecting: ['w', 'Connexion…'],
  connected: ['', 'Connecté'],
  core_unreachable: ['r', 'Serveur inaccessible'],
  revoked: ['r', 'Révoqué'],
  update_required: ['r', 'Mise à jour requise'],
  tls_invalid: ['r', 'Certificat invalide'],
  identity_mismatch: ['r', 'Identité liée à un autre serveur'],
  start_failed: ['r', 'Démarrage impossible'],
};

const bridge = (
  window as unknown as { raptoruStudio?: { profile?: ProfileBridge } }
).raptoruStudio?.profile;

/**
 * `topbar`: the profile line of the sidebar, kept current on every page. `head`: the version and the state, for the page's
 * head. Only the sidebar line keeps being read while the page is closed.
 */
export function mountStudioProfile(
  card: HTMLElement,
  topbar: HTMLElement | null,
  head?: (actions: string, chip: string) => void,
) {
  let status: ProfileStatus | null = null;

  const act = async (fn: () => Promise<Result>) => {
    if (!bridge) {
      toast('Disponible dans l’application Raptoru Studio.', { bad: true });
      return;
    }
    const r: Result = await fn().catch((e: Error): Result => ({
      ok: false,
      message: e.message,
    }));
    if (!r.ok && r.error !== 'cancelled')
      toast(r.message ?? r.error ?? 'Action refusée', { bad: true });
    await refresh();
  };

  /** At least one read was attempted: an unread profile is then said, never an endless « Chargement… ». */
  let attempted = false;
  function render() {
    if (!status) {
      patch(
        card,
        attempted
          ? '<p class="d-note bad">Le serveur Studio ne répond pas : profil non confirmé. Nouvel essai toutes les 3 secondes.</p>'
          : '<p class="d-note">Chargement…</p>',
      );
      head?.('', attempted ? stateChip('w', 'Profil non confirmé') : '');
      return;
    }
    const p = status.production;
    const [dot, label] = STATE[p.state];
    const prod = status.effective === 'production';
    const b = status.build;
    const build = b
      ? `Studio ${b.version}${b.sha ? ` · ${b.sha}` : ''}${b.packaged ? '' : ' · dev'}`
      : 'Studio';
    const host = p.core_origin ? p.core_origin.replace(/^https:\/\//, '') : '';
    // Dérivé du profil EFFECTIF confirmé par le serveur : en Production le serveur paie réellement.
    if (topbar) {
      topbar.textContent = prod
        ? `Production${p.label && p.label !== 'Production' ? ` ${p.label}` : ''}${p.state === 'connected' ? '' : ` · ${label}`} · actions réelles`
        : 'Lab · Jetons fictifs';
      topbar.title = `${build}${prod ? ` · ${host} · ${label} · les Jetons, achats et récompenses sont réels` : ' · aucun Jeton réel ; Twitch et OBS peuvent rester connectés'}`;
      topbar.dataset.profile = prod ? 'production' : 'lab';
      topbar.dataset.short = prod ? 'PROD' : 'LAB';
    }
    head?.(
      `<span class="d-faint">${esc(build)}</span>`,
      prod
        ? stateChip('r', 'Production · actions réelles')
        : stateChip('', 'Lab · Jetons fictifs'),
    );
    patch(
      card,
      `${status.notice ? `<p class="d-note bad">${esc(status.notice)}</p>` : ''}
      <div class="sy-plugs">
        <article class="sy-plug d-vf-off ${prod ? '' : 'on d-vf'}">
          <h3>${ic('flask')}Lab</h3>
          <p>Serveur local et Jetons fictifs. Rien de ce qui se passe ici ne touche tes viewers.</p>
          ${prod ? '<button type="button" class="d-btn" data-act="lab">Revenir au profil Lab</button>' : ''}
        </article>
        <article class="sy-plug sy-plug--prod ${prod ? 'on d-vf' : ''}">
          <h3>${ic('live')}Production${p.label && p.label !== 'Production' ? ` · ${esc(p.label)}` : ''}${stateChip(dot, label)}</h3>
          <p>Le vrai stream : vrais viewers, vrais Jetons. Studio agit réellement sur la chaîne.</p>
          ${p.detail ? `<p class="d-note">${esc(p.detail)}</p>` : ''}
          ${prod ? '' : `<button type="button" class="d-btn danger" data-act="production" ${p.configured ? '' : 'disabled'}>Passer en Production…</button>`}
        </article>
      </div>
      <h2 class="d-lb">Appairage</h2>
      <div class="sy-pair">${p.pairing_code ? `<code>${esc(p.pairing_code)}</code><button type="button" class="d-btn sm" data-act="copy">${ic('copy')}Copier</button>` : '<span class="d-note">Aucun code d’appairage.</span>'}${!prod && p.identity !== 'none' ? '<button type="button" class="d-btn sm bad" data-act="regenerate">Régénérer l’identité…</button>' : ''}</div>
      <p class="d-note">Le code d’appairage se donne à l’opérateur du serveur ; il ne permet pas de se connecter. Les adresses OBS des lecteurs changent avec le profil.</p>
      <details class="d-acc"><summary>Détails techniques</summary><dl class="d-kv">
        <dt>Version</dt><dd>${esc(b?.version ?? '?')}${b?.sha ? ` · source ${esc(b.sha)}` : ''}${b && !b.packaged ? ' · développement' : ''}</dd>
        <dt>Serveur de production</dt><dd>${p.core_origin ? `${esc(p.core_origin)}${p.label ? ` · ${esc(p.label)}` : ''}${p.channel_id ? ` · chaîne ${esc(p.channel_id)}` : ''}${p.custom_ca ? ' · certificat de test approuvé' : ''}` : esc(p.config_error ?? 'Non configuré')}</dd>
        <dt>Installation</dt><dd>${p.installation_id ? esc(p.installation_id) : p.identity === 'corrupt' ? 'Identité illisible (régénération explicite requise)' : 'Aucune'}</dd>
      </dl></details>`,
    );
  }

  card.addEventListener('click', (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')
      ?.dataset.act;
    if (a === 'copy' && status?.production.pairing_code)
      copy(status.production.pairing_code, 'Code copié');
    if (a === 'production') void act(() => bridge!.select('production'));
    if (a === 'lab') void act(() => bridge!.select('lab'));
    if (a === 'regenerate') void act(() => bridge!.regenerate());
  });

  async function refresh() {
    try {
      const res = await fetch('/api/profile', {
        headers: { 'x-raptoru-studio': '1' },
      });
      if (res.ok) status = (await res.json()) as ProfileStatus;
    } catch {
      /* server restarting: keep the last view */
    }
    attempted = true;
    // Jamais lu : l’état n’est pas confirmé (pas de « Lab sûr » supposé).
    if (!status && topbar) {
      topbar.textContent = 'Profil non confirmé';
      topbar.dataset.profile = 'unknown';
      topbar.dataset.short = '?';
    }
    render();
  }
  render();
  void refresh();
  setInterval(() => void refresh(), 3000);
}
