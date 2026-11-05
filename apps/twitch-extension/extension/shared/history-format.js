// How an interaction row of a history reads (cost, icon, quantity): the viewer's « Historique » (ui.js) and the
// moderation V1 history (moderation-v1.js).
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

export function historyCost(row) {
  if (row?.cost == null || !Number.isFinite(Number(row.cost))) return '';
  const units = {
    channelpoints: 'PDC',
    jetons: 'jetons',
  };
  const unit = units[row.currency] || String(row.currency || 'unités');
  return `${fmt(row.cost)} ${unit}`;
}

export function historyActionIcon(action) {
  return ({ tts: '💬', soundboard: '🔊', bonk: '🔨' })[String(action || '').toLowerCase()] || '✦';
}

export function historyQuantity(row) {
  const quantity = Number(row?.quantity ?? row?.count);
  return Number.isFinite(quantity) && quantity > 1 ? ` ×${fmt(quantity)}` : '';
}
