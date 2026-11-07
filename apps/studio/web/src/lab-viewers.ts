import { esc } from './ds/ds.js';
import { postJson, tryGetJson } from './http.js';

// Les viewers fictifs des simulateurs du Lab. Aucun compte réel : des identifiants réservés au Lab, avec leur portefeuille
// fictif dans le Core du Lab. Un seul message par viewer peut attendre en TTS : plusieurs viewers permettent de remplir une file.

export const LAB_VIEWERS = [
  { id: '900101', name: 'Viewer Lab' },
  { id: '900201', name: 'Luna_lab' },
  { id: '900202', name: 'Kiwi_lab' },
  { id: '900203', name: 'Nox_lab' },
  { id: '900204', name: 'Mila_lab' },
] as const;

export const labViewer = (id: string) =>
  LAB_VIEWERS.find((v) => v.id === id) ?? LAB_VIEWERS[0];

export const viewerOptions = (selected?: string) =>
  LAB_VIEWERS.map(
    (v) =>
      `<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>${esc(v.name)}</option>`,
  ).join('');

export const labBalance = async (id: string) =>
  (await tryGetJson<{ tokens: number }>(`/api/lab/wallet/${id}`))?.tokens ??
  null;

export const creditLab = (id: string, tokens: number) =>
  postJson('/api/lab/wallet', { viewer_id: id, op: 'adjust', tokens });
