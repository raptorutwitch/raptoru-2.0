# Audit de Chaos V1 (Halloween 2026)

10/11/2026 — branche `docs/chaos-v2-research` (depuis `origin/main` `afe98cf`). Recherche seulement : aucun code modifié.
Suite : [RECHERCHE](RECHERCHE_CHAOS_V2.md) · [ARCHITECTURE](ARCHITECTURE_CHAOS_V2.md) ·
[CATALOGUE](CATALOGUE_EFFETS_CHAOS_V2.md) · [ROADMAP](ROADMAP_CHAOS_V2.md) · [QUESTIONS](QUESTIONS_OUVERTES_CHAOS_V2.md).

Niveaux de preuve utilisés dans tout le dossier :

| Label         | Sens                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| **PROUVÉ**    | observé dans notre environnement (PC d'Antoni, dépôt, journaux)            |
| **PROTO**     | reproduit dans un prototype isolé (scratchpad, rien d'affiché)             |
| **DOC**       | documentation officielle ou code source (Microsoft, Chromium, OBS, Twitch) |
| **EXTERNE**   | source externe (issue, forum, blog)                                        |
| **HYPOTHÈSE** | raisonnement à tester                                                      |
| **INCONNU**   | non démontré                                                               |

## 1. En une phrase

Chaos V1 est la partie « effets d'écran » de la boutique Halloween. Elle est fermée depuis le 02/11, sa monnaie
était les **Bonbons** (pas les Jetons), et elle reposait sur **deux fenêtres Electron transparentes au premier plan**
au-dessus du jeu, plus des **filtres OBS** pour les viewers.

## 2. Chaîne complète (ce qui existe réellement)

```
Extension (module Événements) ─┐                         Core (event-shop)
Chat (!peur flip / !peur blur) ─┴─► achat : live gate → verrou chaîne → idempotence → règles → débit Bonbons + "queued"
                                            │ (une seule exécution à la fois par chaîne : refus "busy", pas de file)
Studio runtime (claim toutes les 0,7 s) ◄───┘ lease = fenêtre de démarrage
  ├─ effet dessiné / média → page overlay  (fenêtre « Raptoru Halloween »)          ─► OBS la voit (capture d'écran)
  └─ flip / blur          → page role=chaos (fenêtre « Raptoru Chaos », exclue)     ─► OBS ne la voit pas
                                 └─ au "started" : Studio active le filtre OBS « Raptoru Chaos · … » (ObsActions,
                                    action temporaire, durée + 3 s) ; coupé à la fin / STOP ALL
rapport started / ended / failed ─► Core : ack ; balayage (20 s non pris / 15 s non démarré → remboursé ;
                                    démarré sans fin en 90 s → "unknown", non remboursé)
```

### 2.1 Fichiers et responsabilités

| Rôle                                                                                    | Fichier                                                                                       | État                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Fenêtres Electron (overlay + Chaos), capture d'écran, raccourci STOP ALL `Ctrl+Maj+F12` | `apps/studio/desktop/src/halloween-overlay.ts`                                                | opérationnel                                       |
| Choix de l'écran capturé                                                                | `apps/studio/desktop/src/capture-window.ts` (+ test)                                          | opérationnel                                       |
| Position du curseur envoyée à la page Chaos (60 Hz)                                     | `apps/studio/desktop/src/chaos-preload.cts`                                                   | opérationnel                                       |
| Lecteur : effets dessinés, médias, flip / blur par capture                              | `apps/studio/server/halloween-overlay/overlay.js` (+ `.css`)                                  | opérationnel                                       |
| Runtime Studio : claim, routage, délais, STOP ALL, tests                                | `apps/studio/server/src/halloween/runtime.ts`                                                 | opérationnel                                       |
| Filtres OBS « Raptoru Chaos · … » (création, activation)                                | `apps/studio/server/src/halloween/chaos-obs.ts`                                               | opérationnel                                       |
| Client OBS WebSocket (reconnexion 1/2/5/10 s)                                           | `apps/studio/server/src/bonk-lab/obs.ts`                                                      | opérationnel, partagé                              |
| Actions OBS temporaires, retour conditionnel, persistance `obs-reverts.json`            | `apps/studio/server/src/channel-points/obs-actions.ts`                                        | opérationnel, partagé                              |
| Boutique Core : achat, règles, claim, ack, balayage, STOP ALL                           | `apps/core-api/src/event-shop/service.ts`, `catalog.ts`, `packages/schemas/src/event-shop.ts` | opérationnel                                       |
| Live gate (achats payants seulement en live)                                            | `apps/core-api/src/stream/live-gate.ts`                                                       | opérationnel                                       |
| Studio › Halloween › Chaos (tests, capture OBS, préparer les filtres)                   | `apps/studio/web/src/pages/halloween.ts`, `halloween-model.ts`                                | opérationnel                                       |
| Extension (module Événements, achat en deux temps)                                      | `apps/twitch-extension/extension/shared/events-shop.js`                                       | absent de l'extension publiée présumée (`0bf7907`) |

### 2.2 Le rendu local des effets « Chaos » (flip, blur)

`overlay.js:370-481` + `halloween-overlay.ts:139-166` :

1. la page `role=chaos` appelle `getDisplayMedia({ video: { frameRate: { ideal: 60 } } })` ;
2. Electron répond avec l'écran couvert par la fenêtre ; la fenêtre est exclue des captures
   (`setContentProtection(true)` = `WDA_EXCLUDEFROMCAPTURE`, **PROUVÉ** : affinité 17 lue sur la fenêtre le 10/11) ;
3. chaque image : `<video>` → `canvas 2D` (`drawImage`) → **masquage du curseur** (`hideCursor`, bloc de 60 px copié
   depuis le fond à gauche, positions « maintenant » et « juste avant ») → CSS `transform` (`rotate(180deg)`,
   `scaleX(-1)`, `scaleY(-1)`) ou `filter: blur()` ;
4. le canvas est opaque et n'apparaît qu'avec sa première image (0,5 à 0,9 s après le déclenchement, commit `b712e812`).

C'est exactement l'origine des défauts décrits par Antoni : **copie de l'écran affichée par-dessus**, **deux
curseurs** (Chromium incruste toujours le curseur, `HALLOWEEN.md:126`), **carré** qui suit la souris (`hideCursor`).

### 2.3 Les autres effets

`overlay.js:155-332`, dans la fenêtre overlay (non exclue, donc vue par OBS) : HTML/CSS/canvas dessinés **par-dessus**
le jeu, sans capture.

## 3. Inventaire des effets

| Effet                                                                                                          | Où                                                    | Classement                                   | Remarques (chemin)                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Écran retourné (180°, miroir H, retournement V)                                                                | fenêtre Chaos + filtre OBS `shader_filter`            | **1. opérationnel** (défauts visuels connus) | `overlay.js:441-456`, `chaos-obs.ts:30-41` ; params réglables seulement en test (`halloween.ts:840-849`) : achat réel toujours « rotate 10 s » |
| Flou faible / moyen / fort                                                                                     | fenêtre Chaos + `obs_composite_blur` r = 10 / 25 / 55 | **1. opérationnel**                          | `overlay.js:458-481` ; « certains flous excessifs » (Antoni)                                                                                   |
| Clignement                                                                                                     | overlay                                               | **1. opérationnel**                          | paupières CSS, `overlay.js:155-173`                                                                                                            |
| Brouillard                                                                                                     | overlay                                               | **2. partiel**                               | un `div` semi-opaque (`.fx-fog`, opacité ≤ 0,72) : ne réduit pas le contraste, « trop léger »                                                  |
| Vision tunnel                                                                                                  | overlay                                               | **1. opérationnel**                          | `radial-gradient` **repeint à chaque image** pendant les transitions (`overlay.js:195-217`)                                                    |
| Yeux dans le noir, Silhouette                                                                                  | overlay                                               | **1. opérationnel**                          | SVG/CSS                                                                                                                                        |
| Signal corrompu (glitch)                                                                                       | overlay                                               | **2. partiel**                               | bruit 320×180 `putImageData` étiré plein écran + 5 bandes, ~11 Hz ; « trop discret » ; refusé en mode sûr                                      |
| Screamers (26 vidéos) et apparitions                                                                           | overlay                                               | **1. opérationnel**                          | WebM VP9 alpha ; validé en vrai le 28/10                                                                                                       |
| Curseur transformé avec l'écran                                                                                | —                                                     | **3. abandonné**                             | étudié le 30/10, écarté (`HALLOWEEN.md:131-136`)                                                                                               |
| FX Cam (prison, bighead, pixel, drunk, glitch, rage, mute), Couleur Cam, Votekick Zoom / Mute, mute Random Ban | OBS seulement (shaderfilter, Move)                    | **1. opérationnel**, hors Chaos              | `packages/schemas/src/fx-cam.ts`, `votekick/mute-controller.ts` ; shaders collés à la main dans OBS                                            |
| « FX / Chaos Control » (points de chaîne)                                                                      | —                                                     | **5. documenté, absent**                     | `CHANNEL_POINTS_V1.md:58`                                                                                                                      |
| Pluie/gouttes, sang, neige, scanlines, flashbang, barres cinéma, ping viewer                                   | —                                                     | **5. absents du code**                       | nulle part dans le dépôt                                                                                                                       |
| Downstream Keyer                                                                                               | —                                                     | **non utilisé par Chaos**                    | seulement la scène « Alerte complète » en DSK 1 (`EFFECTS_PLAYER.md:108`)                                                                      |

Effets expérimentaux (4.) : aucun dans le code. La « rotation animée » du flip a existé le 30/10 puis a été retirée
(elle montrait le vrai bureau dans les coins, `b712e812`).

## 4. Économie, file et sécurité (ce qui est réutilisable)

**Solide et réutilisable (PROUVÉ par les tests du dépôt, `event-shop.test.ts`, intégration PostgreSQL) :**

- débit et admission dans une seule transaction sous verrou de la chaîne ; clé d'idempotence par viewer
  (`service.ts:401-508`) ;
- remboursement **seulement si l'effet n'a jamais démarré** ; « démarré sans fin » = `unknown` sans remboursement
  (`service.ts:651-759`) ;
- STOP ALL : rembourse ce qui attend, termine ce qui joue (`stopped`) ; jamais rien rejoué après un redémarrage ;
- actions OBS temporaires à **retour conditionnel** et persistantes (`obs-actions.ts:366-397`) : un filtre resté
  allumé après un crash de Studio est coupé au redémarrage ;
- STOP ALL global `Ctrl+Maj+F12` dans Electron main, échéance dure côté page (`overlay.js:509-513`).

**Défauts trouvés (non corrigés, recherche seulement) :**

| #   | Défaut                                                                                                                                                                                                                                      | Preuve                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Les deux fenêtres plein écran restent ouvertes en permanence** au-dessus de l'écran principal dès que Studio tourne (réglage `overlay_enabled` à `true` par défaut, adresse Chaos toujours fournie), même boutique fermée depuis le 02/11 | **PROUVÉ** le 10/11 : 2 fenêtres « Raptoru · Halloween » 2048×1152 DIP (2560×1440), `TOPMOST + LAYERED + TRANSPARENT + NOREDIRECTIONBITMAP`, l'une avec affinité 17 ; `runtime.ts:90, 904-908` |
| D2  | Le Core accepte un achat flip / blur même si la fenêtre Chaos est absente (le « prêt » ne regarde que l'overlay) : échec puis remboursement 3 s après                                                                                       | `runtime.ts:324-328, 391-399` (rapport de cartographie)                                                                                                                                        |
| D3  | Les paramètres des articles (mode, intensité, durée) n'ont pas d'éditeur : les achats réels utilisent toujours les valeurs d'usine                                                                                                          | `halloween.ts:1047-1064`                                                                                                                                                                       |
| D4  | Pas de file : un achat pendant un effet est refusé `busy` (le viewer réessaie)                                                                                                                                                              | `service.ts:514-592`                                                                                                                                                                           |
| D5  | Hors live, les articles paraissent achetables puis l'achat est refusé ; le libellé `stream_offline` manque dans le module                                                                                                                   | `service.ts:1192-1270`, `events-shop.js:24-50`                                                                                                                                                 |
| D6  | Le test `halloween-chaos.test.ts` remplace ObsActions par un faux : il ne prouve ni le retour conditionnel ni la reprise après redémarrage                                                                                                  | `halloween-chaos.test.ts:94-103`                                                                                                                                                               |
| D7  | Chaos dépend de la connexion OBS de Bonk et du runtime des points de chaîne                                                                                                                                                                 | `index.ts:1480-1495`                                                                                                                                                                           |
| D8  | Studio lancé en administrateur ne peut pas capturer (Chromium refuse)                                                                                                                                                                       | `HALLOWEEN.md:144` ; **PROTO** 10/11 : `CreateForMonitor` refusé (`0x80070005`) dans un processus Electron depuis un terminal élevé                                                            |

## 5. Ce que dit l'historique

- 30/10 (`63c17a98`, `f9a7dabc`, `b712e812`) : création de Chaos, puis correctifs après le premier essai d'Antoni (« le
  vrai bureau derrière l'image qui tourne, deux curseurs, flashs noirs / attente »).
- `REPRISE_2026-10-28_2026-11-04.md:102` : « Curseur Chaos : limite acceptée, reporté ».
- **Aucune trace écrite** dans le dépôt des chutes de FPS du 31/10 : c'est le constat oral d'Antoni (mandat Chaos V2).
- Les journaux OBS du 31/10 n'existent plus (OBS n'en garde que 10) ; aucun journal Studio Halloween n'est conservé.

## 6. Bilan

| À garder                                                                                                                                                                                              | À remplacer                                                                                                                                                                    | À supprimer                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Règles économiques et machine à états de l'event-shop (idempotence, remboursement si jamais démarré, `unknown`, STOP ALL) ; ObsActions temporaires ; raccourci global ; tests Core ; médias screamers | Rendu local par `getDisplayMedia` + canvas (cause du double curseur, du carré et très probablement des chutes de fluidité, voir RECHERCHE § 3) ; brouillard et glitch dessinés | Fenêtres plein écran permanentes (D1) ; masquage du curseur `hideCursor` |
