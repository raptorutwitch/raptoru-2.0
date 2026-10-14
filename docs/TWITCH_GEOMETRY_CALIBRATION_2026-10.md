# Calibration géométrique du Twitch Video Component (ouverte le 14/10/2026)

**Statut :** mesures relevées sur Twitch (LeCroupier_, build de calibration), cible **65 % · 3:2 · dimensions
automatiques OFF → 565×376** décidée ; profil compact-video porté dans l'extension et Lab recalé (branche
`feat/compact-video-port`, poussée jusqu'à `c7f20de`, dans le ZIP Hosted Test `c7f20de4430a` ; **validation
d'Antoni non consignée**). Voir §4 et §5. Statut global du projet : `../Raptoru-2.0-ETAT-PROJET.md` § 0.
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

Relevées par Antoni sur Twitch (Hosted Test, LeCroupier_, HUD du build de calibration), viewport logique de
l'iframe du Video Component :

| Height Target | Ratio | Dimensions automatiques | Viewport mesuré      | Rendu                             |
| ------------- | ----- | ----------------------- | -------------------- | --------------------------------- |
| 60 %          | 3:2   | OFF                     | 521×347              | net                               |
| 65 %          | 3:2   | OFF                     | **565×376**          | net — **cible retenue**           |
| 75 %          | 3:2   | OFF                     | 651×434              | net, composition appréciée        |
| 65 %          | —     | ON, scale_pixels 651    | (651 logique réduit) | composition du 75 % mais **flou** |
| 65 %          | —     | ON, scale_pixels 600    | (600 logique réduit) | **flou**                          |

`scale_pixels` est une largeur logique de référence (1920 le confirme), pas une résolution : l'autoscale
réduit l'image, d'où le flou. Décision : 65 % · 3:2 · OFF, et recomposer **nativement** dans 565×376 la
composition du rendu 651×434 (aucun transform/zoom global).

## 5. Profil compact-video et Lab (14/10/2026)

- **Extension (source de vérité)** : profil compact-video du Video Component dans `hub.css`, `tts-v2.css`,
  `soundboard.css`, `tombola-v2.css` (fenêtre commune : largeur ≥ 521 px, hauteur 321–400 px) + bouton monnaie
  unique TTS, source Twitch de Bonk (`shared/bonk-twitch-source.js`), noms longs au survol
  (`shared/hover-marquee.js`, **dette UX : défilement encore un peu saccadé**), liste complète des participants
  Tombola sans « Tout voir ». Règle de scroll : contenu fixe sans scroll global, seules les listes défilent.
- **Calibration** = outil seulement (fixtures + HUD) : il emballe la vraie extension, plus de CSS propre.
- **Lab** : preset **« Twitch réel — Desktop standard » 565×376** (référence) et « Comparaison 75 % » 651×434 ;
  iframe à sa vraie taille logique (plus de lecteur 1280×720, de 60 %, de « 3:2 − 48 px », de transform), même
  instance conservée au changement de preset et au redimensionnement ; décor Twitch approximatif autour.
- **OAuth emotes (Bonk)** : ~~sur le Core staging, `POST /v1/ext/emotes/oauth/start` répondait
  `409 twitch_emotes_unavailable`~~ — corrigé depuis : OAuth sur `/v1/ext` (`6d7d381`, `c7f20de`), déployé au
  staging le 14/10/2026 et validé en Hosted Test sauf l'affichage overlay.
