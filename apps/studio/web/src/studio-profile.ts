// Studio profile card (ASTRA-P1-019 lot 2, D6): Lab (default) or Production, in the same app.
// Read-only view of the Studio server's /api/profile (never a secret: the pairing code cannot
// authenticate). Every change goes through Electron main (native confirmation, then server restart).

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
  production: {
    configured: boolean;
    config_error: string | null;
    core_origin: string | null;
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

const STATE: Record<ProductionState, [string, string]> = {
  inactive: ['', 'Inactif (profil Lab)'],
  not_configured: ['', 'Non configuré'],
  not_paired: ['warn', 'Non appairé'],
  connecting: ['warn', 'Connexion…'],
  connected: ['ok', 'Connecté'],
  core_unreachable: ['ko', 'Core inaccessible'],
  revoked: ['ko', 'Révoqué'],
  update_required: ['ko', 'Mise à jour requise'],
  tls_invalid: ['ko', 'TLS invalide'],
  identity_mismatch: ['ko', 'Identité liée à un autre Core'],
  start_failed: ['ko', 'Démarrage impossible'],
};

const bridge = (
  window as unknown as { raptoruStudio?: { profile?: ProfileBridge } }
).raptoruStudio?.profile;
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

export function mountStudioProfile(
  card: HTMLElement,
  topbar: HTMLElement | null,
) {
  let message = '';
  let status: ProfileStatus | null = null;

  const act = async (fn: () => Promise<Result>) => {
    if (!bridge) {
      message = 'Disponible dans l’application Raptoru Studio (Electron).';
      render();
      return;
    }
    const r: Result = await fn().catch((e: Error): Result => ({
      ok: false,
      message: e.message,
    }));
    message =
      r.ok || r.error === 'cancelled'
        ? ''
        : (r.message ?? r.error ?? 'Action refusée');
    await refresh();
  };

  function render() {
    if (!status) {
      card.innerHTML = '<h2>Profil Studio</h2><p class="muted">Chargement…</p>';
      return;
    }
    const p = status.production;
    const [cls, label] = STATE[p.state];
    const prod = status.effective === 'production';
    if (topbar)
      topbar.textContent = prod
        ? 'Profil Production · Core distant (test local)'
        : 'Profil Lab · local uniquement · aucun crédit réel';
    card.innerHTML = `
      <h2>Profil Studio <span class="badge ${prod ? 'warn' : 'ok'}">${prod ? 'Production' : 'Lab'}</span></h2>
      ${status.notice ? `<p class="badge-line"><span class="badge ko">!</span> ${esc(status.notice)}</p>` : ''}
      <dl class="profile-dl">
        <dt>Core de production</dt><dd>${p.core_origin ? `<code>${esc(p.core_origin)}</code>${p.custom_ca ? ' · certificat de test approuvé' : ''}` : esc(p.config_error ?? 'Non configuré')}</dd>
        <dt>État</dt><dd><span class="badge ${cls}">${label}</span>${p.detail ? ` <span class="muted">${esc(p.detail)}</span>` : ''}</dd>
        <dt>Installation</dt><dd>${p.installation_id ? `<code>${esc(p.installation_id)}</code>` : p.identity === 'corrupt' ? 'Identité illisible (régénération explicite requise)' : '—'}</dd>
        <dt>Code d’appairage</dt><dd>${p.pairing_code ? `<code class="pairing-code">${esc(p.pairing_code)}</code> <button type="button" data-act="copy">Copier</button>` : '—'}</dd>
      </dl>
      <p class="muted">Le code d’appairage se donne à l’opérateur du Core ; il ne permet pas de se connecter. Les URL OBS des lecteurs changent avec le profil.</p>
      <div class="actions">
        ${prod ? '<button type="button" data-act="lab">Revenir au profil Lab</button>' : `<button type="button" data-act="production" ${p.configured ? '' : 'disabled'}>Activer le profil Production</button>`}
        ${!prod && p.identity !== 'none' ? '<button type="button" class="danger" data-act="regenerate">Régénérer l’identité…</button>' : ''}
      </div>
      ${message ? `<p class="badge-line"><span class="badge ko">!</span> ${esc(message)}</p>` : ''}`;
  }

  card.addEventListener('click', (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')
      ?.dataset.act;
    if (a === 'copy' && status?.production.pairing_code)
      void navigator.clipboard?.writeText(status.production.pairing_code);
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
    render();
  }
  render();
  void refresh();
  setInterval(() => void refresh(), 3000);
}
