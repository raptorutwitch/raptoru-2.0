// Badge d'environnement : un build qui n'est pas la Production (Hosted Test sur le Core staging) le dit
// sur chaque surface, pour qu'aucun testeur ne le confonde avec l'Extension réelle. Le build Production
// (runtime-config sans `environment`) n'affiche rien.
import { RUNTIME } from './runtime-config.js';

export function mountEnvironmentBadge(doc = globalThis.document) {
  const env = RUNTIME.environment;
  if (!env || env === 'production' || !doc?.body) return null;
  const badge = doc.createElement('div');
  badge.className = 'env-badge';
  badge.setAttribute('role', 'note');
  badge.textContent = `${String(env).toUpperCase()} · test`;
  badge.title = `Build ${RUNTIME.buildId || '?'} · ${RUNTIME.apiBase || ''}`;
  // Inline: no shared stylesheet to grow for a test-only marker.
  Object.assign(badge.style, {
    position: 'fixed',
    top: '4px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    padding: '1px 8px',
    borderRadius: '999px',
    background: 'rgba(255, 153, 0, 0.92)',
    color: '#111',
    font: '700 10px/16px system-ui, sans-serif',
    letterSpacing: '0.04em',
    pointerEvents: 'none',
  });
  doc.body.append(badge);
  return badge;
}
