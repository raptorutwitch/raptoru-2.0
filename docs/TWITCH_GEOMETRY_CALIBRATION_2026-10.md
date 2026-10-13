# Calibration géométrique du Twitch Video Component (ouverte le 14/10/2026)

**Statut :** audit fait (Astra Max), **aucune mesure réelle Twitch encore relevée**, aucun code modifié.
Références : [`../Raptoru-2.0-HANDOFF.md`](../Raptoru-2.0-HANDOFF.md) ·
[`TEST_REEL_STAGING_2026-10.md`](TEST_REEL_STAGING_2026-10.md).

## 1. Constat : le Lab n'est pas une référence WYSIWYG

Vérifié dans `apps/studio/web/src/extension-lab.ts` sur `ac52bea` :

| Point                                   | Code                                                                     | Effet                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Preset « Layout normal » = lecteur fixe | `PLAYERS.normal = 1280 × 720` (l. 115)                                   | Un seul lecteur supposé ; la vraie taille dépend de la fenêtre, du chat, de la barre latérale |
| Hauteur = 60 % du lecteur               | `TWITCH.videoTargetHeight: 0.6` (l. 46, calcul l. 319)                   | 720 × 0,6 = **432**                                                                           |
| Largeur = 3:2 puis − 48 px              | `videoRatio: 3 / 2`, `videoReservedColumn: 48` (l. 47–49, calcul l. 320) | 432 × 1,5 − 48 = **600** → viewport normal **600 × 432**, qui n'est plus 3:2                  |
| Resize de présentation                  | `transform: scale(...)` sur `.tw-player` (l. 325)                        | Le viewport logique de l'iframe ne change pas : seul l'affichage est réduit                   |
| Iframe recréée                          | `renderStage()` réécrit `stage.innerHTML` (l. 286 →)                     | Certains resizes / changements de preset rechargent l'Extension (état perdu)                  |
| Contexte Twitch mocké                   | paramètres d'URL par surface                                             | Incohérent avec certains presets (ex. résolution annoncée ≠ taille réelle de l'iframe)        |

Les vrais breakpoints de l'UI de l'Extension tombent près des dimensions susceptibles d'être obtenues sur
Twitch : une erreur de quelques dizaines de pixels dans le Lab peut faire valider une mise en page que les
viewers ne verront pas.

## 2. Décision (14/10/2026)

**Ne pas modifier 60 %, 3:2, la colonne de 48 px ni l'UI avant une mesure réelle sur Twitch.** Aucun redesign,
aucun nouveau breakpoint tant que les mesures ne sont pas relevées.

## 3. Prochaine phase

1. **Extension placeholder isolée** sur la chaîne de test **LeCroupier_** : extension Twitch **séparée** de
   Raptoru Live, Video Component seul, **aucun appel réseau** (ni Core, ni legacy). Elle affiche en direct
   `innerWidth` / `innerHeight`, `devicePixelRatio`, le `context` Twitch (`onContext`) et chaque `resize`.
2. **Actions manuelles d'Antoni** (console Twitch) : création de l'extension, Hosted Test, installation sur
   LeCroupier_. Aucun impact sur `raptoru_` ni sur l'Extension publiée.
3. **Grille de mesure** définie avant de mesurer : layout normal / théâtre / plein écran, plusieurs largeurs de
   fenêtre, chat ouvert / fermé, barre latérale ouverte / fermée, zoom navigateur 100 %.
4. **Calibration du Lab** à partir des mesures seulement (`PLAYERS`, `TWITCH`, resize par viewport logique au
   lieu de `transform`, iframe conservée), UX de l'Extension inchangée.

## 3 bis. Build de calibration (instrument de mesure)

Choix d'exécution (14/10/2026) : un ZIP **Hosted Test** du projet Raptoru Live, testé sur LeCroupier_ (au lieu
d'une extension Twitch séparée). **Non validé manuellement, non publié.**

- `npm run build:calibration -w @raptoru/twitch-extension` →
  `apps/twitch-extension/release/raptoru-live-CALIBRATION-video-component-<sha>.zip` (+ `.sha256`).
- **Vraie UI** : mêmes fichiers `extension/` (Hub, carrousel, header, wallet, navigation, vues Soundboard /
  TTS / Bonk / Tombola / Modération, CSS, breakpoints) ; aucune retouche de l'UI.
- **Données** : `calibration/fixtures.js` = réponses de la frontière viewer staging (`ext-facade.ts`) capturées
  sur un Core en mémoire, anonymisées (Viewer_A…H, Mod_Test, sons « Son NN » de même longueur que les vrais
  libellés). Vu en modérateur (5 modules). `calibration/adapter.js` les sert au vrai client
  (`RUNTIME.fixtureCall`, défini seulement par ce build) ; la Tombola de 60 s boucle ; **toute action est
  refusée** (`not_available`). Aucune URL d'API, aucun `onAuthorized` / `listen` Twitch.
- **HUD** (`calibration/hud.js`, Video Component seulement, `position: fixed`, réductible) : inner / client /
  scroll / root, dpr, visualViewport (+ scale), visibilité (document + `onVisibilityChanged`), compteurs de
  resize (window, visualViewport, ResizeObserver) + horodatage, champs `onContext` utiles à la géométrie
  (`n/a` si absents), instanceId + compteur de chargements. Bouton **Grille** : bords colorés, grille 20 px,
  repères 100 px, centre, dimensions et ratio. Chaque état stabilisé est aussi loggé (`[CALIBRATION]`).
- Panel / mobile / config : page statique « Calibration build — Video Component only ».
- Le build échoue si un fichier du paquet contient `raptoru.fr`, `core-staging`, `/v1/ext`, `localhost` ou
  `127.0.0.1`.

## 4. Mesures

_Aucune pour l'instant._
