# Machine à sous n°2 — prototype local

Deuxième machine du Casino : les mécaniques de Book of Ra Deluxe (audit du 19/11), habillées des émotes de la chaîne,
dans le visuel exact de la machine à fruits intégrée. **Prototype indépendant** : aucun lien avec l'extension, le Core
ni le Wallet ; Jetons fictifs (ce navigateur). La machine à fruits, le Coffre et la roulette ne sont pas touchés.

## Lancer

```
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\agent\prototypes\casino-emotes"
node start.mjs
```

Puis http://127.0.0.1:4520/ (ouvert tout seul). Ou double-clic sur `Lancer la machine 2.cmd`. Il faut Node et le dépôt
installé (Chromium de Playwright sert à préparer les émotes).

## Ce que contient le dossier

| Chemin | Rôle |
| --- | --- |
| `src/manifest.js` | **Le seul fichier à modifier pour changer une émote** : fichier, animation native, effets |
| `src/engine.js` | Le moteur (bandes, table, lignes, tours gratuits, extension, scénarios de test) |
| `src/game.js`, `src/book.css` | L'écran : la machine à fruits + ce qui est nouveau |
| `src/sfx.js` | Les sons nouveaux, synthétisés |
| `vendor/` | Copie **sans changement** de la machine intégrée (commit `b7332c26`) : `frame.js`, `reels.js`, `audio.js`, `bets.js`, `skin.js`, `casino.css`, `slot.css` |
| `assets/emotes/` | Copies des émotes (générées) : image fixe 256 px + GIF d'origine pour les animées |
| `tools/rtp.mjs` | RTP exact du moteur + simulation |
| `tools/check.mjs` | Contrôles dans Chromium |

Tes fichiers d'origine (`C:\Users\Antoni\Desktop\Mes projets\Emote pour Slots`) sont seulement **lus** : jamais
renommés, modifiés ni supprimés.

## Changer une émote

1. Mets le nom du fichier dans `src/manifest.js` (champ `file` du symbole).
2. Relance `node start.mjs` (il refait seulement les copies qui ont changé).

## Contrôles

- `node tools/rtp.mjs` : le RTP exact, puis une simulation du moteur.
- `node tools/check.mjs [tours Auto]` : les contrôles dans Chromium (300 tours Auto par défaut). Les captures sont
  écrites dans `captures/`.
