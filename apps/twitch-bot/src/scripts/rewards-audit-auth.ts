import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadTwitchAppConfig } from '../config.js';
import {
  requestToken,
  TWITCH_AUTHORIZE_URL,
  validateAccessToken,
} from '../twitch/auth.js';
import { waitForAuthorizationCode } from './twitch-auth.js';

// READ-ONLY consent for the rewards audit (docs/RECOMPENSES_TWITCH.md, phase 1). A separate authorization of
// raptoru_ that asks Twitch for ONE right, `channel:read:redemptions` (read the rewards and which ones this app may
// manage) — never a right to change anything. It keeps NO refresh token: the access token expires by itself (~4 h) and
// can never be renewed, so no other grant (the bot's, the Lab's, Production's) is ever touched. Written outside the
// repository only (the repo is public).
//   TWITCH_AUDIT_TOKEN_FILE=C:\Users\Antoni\.raptoru\twitch-audit-broadcaster.json
//   npx tsx --env-file=<apps/twitch-bot/.env of the main checkout> src/scripts/rewards-audit-auth.ts

const SCOPE = 'channel:read:redemptions';
const target = process.env.TWITCH_AUDIT_TOKEN_FILE;
if (!target) {
  console.error(
    'TWITCH_AUDIT_TOKEN_FILE est requis (un fichier HORS du dépôt, par exemple dans C:\\Users\\Antoni\\.raptoru).',
  );
  process.exit(1);
}
const path = resolve(target);
if (/[\\/]Raptoru 2\.0( - Worktrees)?[\\/]/i.test(path)) {
  console.error(
    'Refusé : ce fichier serait dans le dépôt (public). Choisis un dossier hors du dépôt.',
  );
  process.exit(1);
}
const config = loadTwitchAppConfig();
const redirectUri =
  process.env.TWITCH_REDIRECT_URI ?? 'http://localhost:3789/callback';
const state = randomUUID();
const url = new URL(TWITCH_AUTHORIZE_URL);
url.search = new URLSearchParams({
  response_type: 'code',
  client_id: config.TWITCH_CLIENT_ID,
  redirect_uri: redirectUri,
  scope: SCOPE,
  state,
  force_verify: 'true',
}).toString();

const code = await waitForAuthorizationCode({
  redirectUri,
  state,
  timeoutMs: 5 * 60_000,
  onListening: () => {
    console.log(
      '\nOuvre ce lien dans ton navigateur, connecte-toi avec le compte raptoru_ et accepte :\n',
    );
    console.log(url.toString());
    console.log(
      `\nDroit demandé : ${SCOPE} (lecture seule). En attente pendant 5 minutes…`,
    );
  },
});
const exchanged = await requestToken({
  client_id: config.TWITCH_CLIENT_ID,
  client_secret: config.TWITCH_CLIENT_SECRET,
  code,
  grant_type: 'authorization_code',
  redirect_uri: redirectUri,
});
if (!exchanged.ok) {
  console.error('Twitch a refusé l’échange du code : recommence.');
  process.exit(1);
}
const info = await validateAccessToken(exchanged.token.access_token);
if (!info) {
  console.error('Twitch a refusé le nouveau jeton : recommence.');
  process.exit(1);
}
if (info.user_id !== config.TWITCH_BROADCASTER_ID) {
  console.error(
    `Refusé : connecté en ${info.login}, il faut le compte du streamer (raptoru_). Rien n’a été enregistré.`,
  );
  process.exit(1);
}
const scopes = info.scopes ?? [];
if (scopes.some((s) => s !== SCOPE)) {
  console.error(
    `Refusé : Twitch a accordé d’autres droits que ${SCOPE}. Rien n’a été enregistré.`,
  );
  process.exit(1);
}
mkdirSync(dirname(path), { recursive: true });
// The access token only: no refresh token is kept (never renewable).
writeFileSync(
  path,
  JSON.stringify(
    {
      accessToken: exchanged.token.access_token,
      scopes,
      login: info.login,
      userId: info.user_id,
      expiresAt: Date.now() + (info.expires_in ?? 0) * 1000,
      purpose: 'rewards-audit (lecture seule, non renouvelable)',
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `\nAutorisation de lecture enregistrée (${info.login}, valable ~${Math.round((info.expires_in ?? 0) / 3600)} h, non renouvelable).`,
);
console.log(
  'Tu peux fermer la page. Dis-moi « autorisation faite » : je lance l’audit.',
);
