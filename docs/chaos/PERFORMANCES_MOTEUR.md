# Moteur Chaos : performances (capture, rendu, présentation)

> **Statut (23/11/2026)** : branche locale `feat/chaos-engine`. Optimisations implémentées et mesurées **en laboratoire**
> (jeu témoin, § 7). **Aucune mesure sur un vrai jeu** : Overwatch et OBS se mesurent avec la procédure du § 9, avec
> l'accord d'Antoni. Le retournement par Windows (couche Entrées) reste **expérimental et coupé** : voir
> [ETUDE_PERFORMANCES_RETOURNEMENT.md](ETUDE_PERFORMANCES_RETOURNEMENT.md).

Objectif : exécuter des effets graphiques ambitieux au coût le plus faible possible, sans rendre le jeu moins agréable.
Ce document dit ce qui est retenu, pourquoi, ce qui est mesuré et ce qui ne l'est pas encore.

## 1. Architecture retenue

```
jeu (sa fenêtre) ──► DWM compose l'écran ──► Windows.Graphics.Capture (une capture par cible, partagée)
                                                   │  trame lue SANS COPIE (empruntée au pool jusqu'à la suivante)
                                                   ▼
                     FrameBuilder (réutilisé) : passes plein écran → cible finale ; calques par-dessus
                                                   │  passes intermédiaires dans un pool, à render_scale
                                                   ▼
                     Swap chain DirectComposition (3 tampons, alpha prémultiplié) ── Present(0), jamais bloquant
                                                   │
                     fenêtre calque traversable au-dessus du jeu ──► DWM compose ──► écran
                     cadence : une image par nouvelle capture, ou par retour de balayage de l'écran de la cible
```

| Étage        | Choix                                                                                                                                                 | Pourquoi                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Capture      | Windows.Graphics.Capture (WGC), fenêtre du jeu par défaut, écran entier en option                                                                     | seule API qui capture **une fenêtre** sans injection ; curseur exclu à la source ; sans bordure               |
| Lecture      | **sans copie** : la trame est lue directement ; copie persistante seulement pour un flou (mipmaps)                                                    | une copie plein écran par image en moins (§ 4, O2)                                                            |
| Rendu        | Direct3D 11, un périphérique, `FrameBuilder` réutilisé par surface, pool de cibles, cache de shaders (mémoire + disque, préchauffé au démarrage)      | aucune allocation par image dans le moteur ; aucun shader compilé pendant un effet                            |
| Présentation | DirectComposition, `Present(0)` toujours                                                                                                              | `Present(1)` suit l'écran **principal** (60 Hz ici) même sur l'écran à 144 Hz et bloque le fil de rendu (§ 2) |
| Cadence      | capture : à l'arrivée de chaque image ; animation et calques : **rythmeur** calé sur l'écran de la cible (`IDXGIOutput::WaitForVBlank`)               | animations et calques à la fréquence de l'écran réel ; jamais deux images par période                         |
| Sobriété     | rien redessiné si l'image décrite n'a pas changé ; rien si la cible est masquée ; capture fermée 2 s après le dernier effet ; repos : 4 réveils par s | le travail ne dépend que de ce qui change                                                                     |
| Adaptatif    | section `performance` : profils, cadence max, passes max, résolution des passes, budget GPU, réaction à la surcharge (§ 5)                            | limiter le coût des futurs effets de façon **explicite, annoncée et déterministe**                            |

Inchangés : registre, ordonnanceur, contrats d'effets, transitions, intégration Studio, chiens de garde, arrêts,
restauration automatique. Ajouter un effet reste une entrée de registre et quelques lignes ([GUIDE_EFFETS.md](GUIDE_EFFETS.md)) ;
le moteur décide seul de la copie, de la cadence et des paliers.

## 2. Recherche ciblée (documentation officielle, 23/11)

« Silencieux » = la documentation ne dit rien ; la ligne dit alors ce qui a été décidé et comment le vérifier.

| Sujet                                      | Ce que disent les sources                                                                                                                                                                                                                                                                                           | Décision                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WGC : pool de trames                       | une trame est empruntée par `TryGetNextFrame` et rendue au pool à sa libération ; ne pas garder de référence après ([screen-capture](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture)) ; nombre de tampons libre                                                                    | trame gardée **empruntée** jusqu'à la suivante, pool de 3 (une pour le rendu, deux pour Windows)                                                                             |
| WGC : `SystemRelativeTime`                 | instant QPC où le compositeur a rendu l'image ([doc](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframe.systemrelativetime))                                                                                                                                                 | sert à mesurer la latence de capture et la latence ajoutée (§ 6)                                                                                                             |
| WGC : `MinUpdateInterval`, `DirtyRegion`   | présents seulement depuis Windows 11 24H2 (26100), **sans description**                                                                                                                                                                                                                                             | `MinUpdateInterval` = 1 / cadence plafonnée (§ 5) ; effet sur le travail de DWM à mesurer ; régions modifiées non utilisées                                                  |
| WGC : bind flags des trames                | silencieux                                                                                                                                                                                                                                                                                                          | lus à l'exécution (`GetDesc`) : sans `SHADER_RESOURCE`, copie (repli automatique)                                                                                            |
| Desktop Duplication                        | écran entier seulement ; une duplication par sortie et par processus ; accès perdu au changement de mode, au plein écran, au bureau sécurisé ; régions modifiées fournies ([desktop-dup-api](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api)) ; `WDA_EXCLUDEFROMCAPTURE` : silencieux | **non retenu** : ne capture pas une fenêtre (mode par défaut), plus de cas de perte, aucun gain démontré. L'interface `ICaptureSource` permet de l'ajouter plus tard         |
| Présentation et écrans à fréquences mixtes | « the DXGI swapchain API always uses the cadence of the primary monitor » ([compositor clock](https://learn.microsoft.com/en-us/windows/win32/directcomp/compositor-clock/compositor-clock))                                                                                                                        | `Present(0)` + rythmeur par écran (`WaitForVBlank`, repli minuteur haute résolution). Mesuré le 22/11 : animations à 60 i/s sur l'écran 144 Hz avec `Present(1)`             |
| Horloge du compositeur                     | `DCompositionWaitForCompositorClock` (build 22000) ; cadence quand les écrans diffèrent : silencieux                                                                                                                                                                                                                | non utilisée (rien ne garantit l'écran visé)                                                                                                                                 |
| Mise en mémoire tampon                     | flip model ; latence max 1 (`SetMaximumFrameLatency`)                                                                                                                                                                                                                                                               | 3 tampons gardés : avec 2, le GPU attendrait que DWM libère l'image affichée                                                                                                 |
| DWM, jeu et calque                         | un contenu par-dessus le jeu fait revenir DWM en composition (« When an overlay such as the Game Bar is present, the DWM reassumes control » : [Demystifying FSO](https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/)) ; plan matériel (MPO) selon le matériel                          | **limite assumée** de tout calque sans injection : le jeu passe de « Hardware: Independent Flip » à « Composed: Flip » pendant l'effet. Se vérifie avec PresentMon (§ 9)     |
| PresentMon                                 | ETW : administrateur ou groupe « Utilisateurs du journal de performances » ([README](https://github.com/GameTechDev/PresentMon/blob/main/README.md))                                                                                                                                                                | intégré au banc (`--presentmon`, `--game`), jamais lancé sans accord                                                                                                         |
| Priorité GPU (`SetGPUThreadPriority`)      | −7 à 7 ; effet sous l'ordonnancement matériel du GPU : silencieux                                                                                                                                                                                                                                                   | **non retenu** : pendant un effet, le joueur voit l'image du calque ; baisser sa priorité retarderait justement ce qu'il voit                                                |
| Capture récursive                          | `WDA_EXCLUDEFROMCAPTURE` : la fenêtre n'apparaît que sur l'écran ([doc](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity))                                                                                                                                           | mode fenêtre : la capture ne voit que la fenêtre du jeu, jamais le calque. Mode écran entier : calque exclu des captures (donc aussi de la capture d'écran d'OBS, limite R5) |
| `DiscardView` ou `ClearRenderTargetView`   | aucune consigne officielle                                                                                                                                                                                                                                                                                          | effacement rapide gardé : il sépare l'attente du tampon (DWM) du coût réel des passes dans les mesures                                                                       |

## 3. Point de départ (référence du 23/11, commit `9dba730f`)

- Chaque image capturée était **copiée** en entier dans une texture persistante (avec mipmaps), même pour un 180° exact.
- Animations et calques : `Present(1)`, donc **60 i/s sur l'écran à 144 Hz** et fil de rendu bloqué jusqu'à 16,7 ms.
  Pendant une animation, les captures arrivant entre deux présentations étaient perdues (jeu vu à 60 i/s).
- La boucle demandait des attentes de 1 ms : sans `timeBeginPeriod`, Windows les arrondit à 15,6 ms (résolution du
  minuteur par processus depuis Windows 10 2004).
- Cible masquée (jeu en arrière-plan) : rendu et présentation continuaient.
- Une image identique (calque immobile) était redessinée à chaque réveil.
- Plusieurs allocations par image (constructeur d'image, listes, LINQ, étiquettes de mesure).
- Repos : un réveil toutes les 15 ms.
- Repli de qualité : un seul palier (coins noirs), réglage `engine.quality`.

## 4. Optimisations apportées

| #   | Optimisation                                                                                                                                                  | Gain attendu                                                                 | Garde-fou                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| O1  | **Rythmeur par écran** (`src/Present/Pacer.cs`) et `Present(0)` toujours                                                                                      | animations et calques à la fréquence de l'écran de la cible ; fil non bloqué | repli minuteur haute résolution si l'écran n'est pas sur l'adaptateur du moteur ; fil endormi sans besoin |
| O2  | **Capture sans copie** : SRV sur la trame WGC (vues mises en cache par tampon du pool), copie seulement pour un flou ; texture persistante créée à la demande | une copie plein écran par image en moins (lecture + écriture)                | bind flags vérifiés ; `performance.zero_copy=false` (interrupteur de secours)                             |
| O3  | **Image inchangée = rien à faire** : empreinte de l'image décrite (passes, constantes, calques, réglages ; le temps seulement si un shader lit `misc.x`)      | un calque immobile ne coûte plus rien au GPU                                 | toute nouvelle capture redessine                                                                          |
| O4  | **Cible masquée** : ni rendu ni présentation ; la capture continue pour un retour immédiat                                                                    | zéro GPU du moteur quand le jeu n'est pas au premier plan                    | comportement visible inchangé (la fenêtre était déjà cachée)                                              |
| O5  | **Zéro allocation par image** : `FrameBuilder` par surface, passes et constantes réutilisées, étiquettes en cache, boucles sans LINQ                          | moins de ramasse-miettes pendant un effet                                    | —                                                                                                         |
| O6  | **Repos** : un réveil toutes les 250 ms (entretien, battement) au lieu de 15 ms ; les commandes réveillent toujours immédiatement                             | CPU au repos                                                                 | chiens de garde à 2 s et 10 s inchangés                                                                   |
| O7  | Mesures GPU relevées à chaque tour (plus de mesures perdues) ; mipmaps mesurées à part (`capture:mips`)                                                       | diagnostic fiable                                                            | —                                                                                                         |

## 5. Performance adaptative (`performance`, configuration v5)

| Réglage         | qualite    | equilibre (défaut) | economie  | Bornes                  | Rôle                                                                               |
| --------------- | ---------- | ------------------ | --------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `max_fps`       | 0 (écran)  | 0 (écran)          | 60        | 0, ou 30 à 360          | cadence de traitement maximale par cible ; aussi `MinUpdateInterval` de la capture |
| `max_passes`    | 8          | 6                  | 3         | 1 à 8                   | passes GPU par image et par cible ; au-delà, l'effet est refusé (`too_costly`)     |
| `render_scale`  | 1          | 1                  | 0,5       | 0,25 à 1                | résolution des passes intermédiaires (la dernière est toujours pleine)             |
| `gpu_budget_ms` | 4          | 2                  | 1         | 0,25 à 16               | temps GPU du moteur toléré par image                                               |
| `on_overload`   | `signaler` | `reduire`          | `reduire` | `signaler` ou `reduire` | réaction à une surcharge                                                           |
| `zero_copy`     | vrai       | vrai               | vrai      | —                       | interrupteur de secours de O2                                                      |

- Choisir un profil applique toutes ses valeurs ; changer une valeur à la main donne le profil `personnalise`.
- **Refus** : à la demande, si le registre déclare plus de passes (`gpu.passes`) que `max_passes` (réponse
  `too_costly`) ; au rendu, si les passes réelles d'une image dépassent `max_passes`, seul l'effet fautif échoue
  (`effect.failed`, `too_costly`), les autres continuent.
- **Surcharge** : temps GPU estimé par image au-delà du budget, ou traitement p95 au-delà d'une période d'image,
  **deux intervalles de suite**.
  - `reduire` : un palier de plus, annoncé par `engine.degraded` (`level`, `reason`, `action`) : 1 coins noirs au lieu
    du flou, 2 passes intermédiaires à demi-résolution, 3 cadence divisée par deux. Retour d'un palier après 5 s saines
    (`engine.recovered`).
  - `signaler` : `engine.over_budget`, rien ne change.
- Visible dans la télémétrie (`performance.level`, `frame_gpu_est_ms`, `rate_hz`) et dans Studio › Chaos › Moteur.
- Migration v4 → v5 : `engine.quality = high` devient le profil `qualite`, `auto` le profil `equilibre`.

## 6. Mesures : protocole reproductible

**Banc** `bin\chaos-bench.exe` ([tests/Bench.cs](../../apps/chaos-engine/tests/Bench.cs)). Visible, jamais lancé par
les contrôles automatiques ; refuse de tourner si un jeu ou une application plein écran est actif (revérifié avant
chaque scénario).

| Scénario       | Quoi                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| A `aucun`      | jeu témoin seul, aucun moteur                                          |
| B `repos`      | moteur lancé, aucun effet                                              |
| C `flip-coupe` | retournement sans animation (transitions `cut`)                        |
| D `flip-anime` | retournement animé, entrée et sortie de 3 s (pour mesurer l'animation) |
| E `passes`     | retournement + `diag.passes` (4 passes de 12 échantillons)             |
| F `calque`     | calque simple sans capture (`diag.marker`)                             |

- **Jeu témoin** : fenêtre Direct3D flip model (comme un jeu fenêtré sans bordure), 1280×720 au centre de l'écran
  secondaire, cadence visée (`--probe-fps`, 0 = libre) et charge GPU réglable (`--probe-load`, passes de 24
  échantillons) pour simuler un jeu limité par le GPU.
- **Par phase** (avant, entrée, pendant, sortie, après) :
  - témoin : images/s, durée médiane, p99, max, à-coups, pire fenêtre de 250 ms, temps GPU d'une image ;
  - **temps GPU de chaque processus** (moteur, témoin, `dwm.exe`) lu dans les compteurs « GPU Engine » de Windows,
    sans droits d'administrateur : le coût caché de la composition et de la capture apparaît chez `dwm` ;
  - CPU du moteur ; télémétrie interne (capture, présentation, traitement, latence de capture, durée de `Present`,
    latence ajoutée estimée, GPU par passe, mémoire vidéo, ramasse-miettes) ;
  - activation (demande → première image visible) et arrêt (annulation → fin).
- **Deux versions, même banc, mêmes conditions** : `--engine <ChaosEngine.exe>` ; réglages : `--set
performance.zero_copy=false`.
- **Moteur ≠ joueur** : le temps GPU et le traitement sont le coût du moteur ; la **latence ajoutée** est le retard de
  l'image transformée sur celle que le jeu aurait affichée. Elle est estimée par le moteur : composition de l'image du
  jeu (`SystemRelativeTime`) → prochaine composition après `Present`. Le vrai « clic → photon » ne se mesure qu'avec
  PresentMon (§ 9).

## 7. Résultats (laboratoire)

Coût de chaque effet (moteur hors écran, OBS isolé) : [BENCH_EFFETS.md](BENCH_EFFETS.md) (25/11). Le coût fixe de la
capture, de la présentation et de la composition à l'écran se mesure en jeu (BENCH_EFFETS.md § 6).

## 8. Le curseur et OBS

**Curseur** : étude complète dans [ETUDE_CURSEUR.md](ETUDE_CURSEUR.md). Avec le calque, le curseur matériel ne peut
pas suivre la rotation (il est dessiné à la position réelle, qui est aussi le point du clic) ; la seule piste sans
changement de mode masque le curseur matériel et montre le curseur que Windows dessine dans la capture, retourné avec
l'image. Prérequis vérifiés par le prototype `chaos-bench.exe --cursor-proto` ; décision d'Antoni attendue.

**OBS** (aucune scène modifiée) :

- Les scènes d'Antoni utilisent la « Capture d'écran » (`monitor_capture`, curseur capturé) ; son journal du 23/11
  indique la méthode **WGC** pour l'écran principal. Aucune « Capture de jeu ».
- En mode fenêtre (défaut), le calque est une fenêtre normale au-dessus du jeu : la capture d'écran le voit, transitions
  comprises. En mode écran entier, il est exclu des captures (sinon il se capturerait lui-même).
- Une « Capture de jeu » (crochet dans le jeu) ne verrait jamais le calque : elle copie les images du jeu lui-même.
- Le curseur que montre OBS est à sa position réelle (non retourné), comme pour Antoni.
- Vérification sans OBS : `chaos-bench.exe --obs-compat` lit une mire retournée avec chaque méthode de capture d'OBS
  (BitBlt, WGC écran et fenêtre, DXGI, fenêtre du calque), en mode fenêtre, en mode écran entier et en pleine
  rotation. Résultats au § 7.

## 9. Procédure réelle : Overwatch et OBS (avec l'accord d'Antoni)

Prérequis, une fois :

1. Ajouter le compte au groupe « Utilisateurs du journal de performances » (invite administrateur), puis fermer et
   rouvrir la session : `net localgroup "Utilisateurs du journal de performances" %USERNAME% /add`. Sinon, lancer le
   terminal en administrateur.
2. Télécharger PresentMon (console, [GameTechDev/PresentMon](https://github.com/GameTechDev/PresentMon/releases)).

Mesure (5 minutes, **hors direct**, OBS ouvert sur la scène habituelle sans diffuser, Overwatch en **fenêtré sans
bordure** dans le champ d'entraînement, aucun autre jeu) :

```
apps\chaos-engine\bin\chaos-bench.exe --game Overwatch.exe --presentmon <chemin>\PresentMon.exe --autorise-pendant-un-jeu
```

- Le banc enchaîne `repos`, `flip-coupe`, `flip-anime`, `repos` sur la fenêtre d'Overwatch (quelques secondes
  chacun ; rester dans le jeu sans toucher la souris pendant les retournements).
- Résultat par phase : images/s, durée médiane et p99 des images du jeu, à-coups, **mode de présentation** (passage
  d'« Independent Flip » à « Composed: Flip » attendu pendant l'effet), temps GPU du jeu, du moteur et de `dwm`.
- Puis la même chose avec `--set performance.profile=economie` pour comparer.
- À noter à la main : sensation de latence, curseur d'Overwatch, aperçu d'OBS (le calque y apparaît-il ?).

Si PresentMon refuse les options de session (`--session_name`, `--stop_existing_session`, version 2), le lancer
seul pendant le banc : `PresentMon.exe --process_name Overwatch.exe --output_file ow.csv --qpc_time`.

## 10. Limites encore présentes

- **Jeu en composition pendant un effet** : tout calque au-dessus d'un jeu fait reprendre la main à DWM (perte de
  l'« independent flip », de G-Sync selon les réglages). Inévitable sans injection ; à chiffrer avec PresentMon.
- **Latence ajoutée** : l'image transformée arrive au mieux une composition après celle du jeu (≈ 7 ms à 144 Hz,
  ≈ 17 ms à 60 Hz) ; estimée, pas mesurée « clic → photon ».
- **OBS** : voir § 8 ; une « Capture de jeu » ne verra jamais le calque.
- **Curseur** : voir § 8.
- Rythmeur : `WaitForVBlank` en fenêtré n'est pas documenté explicitement ; repli minuteur prévu ; cadence vérifiée
  par la télémétrie (`present_fps`, `pacer`).
- `MinUpdateInterval` : sémantique non documentée ; son effet sur le travail de DWM est à mesurer (profil économie).
