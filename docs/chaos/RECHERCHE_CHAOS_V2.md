# Recherche Chaos V2 — performances, capture, curseur, rendu

10/11/2026. Labels de preuve : voir [AUDIT_CHAOS_V1.md](AUDIT_CHAOS_V1.md) en tête. Sources numérotées en § 8.

## 1. Environnement réel relevé le 10/11 (PROUVÉ)

| Élément      | Valeur                                                                                        | Conséquence                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GPU / CPU    | RTX 3070 8 Go (pilote 595.79), i7-12700, iGPU Intel UHD 770 présente                          | 2 adaptateurs : OBS peut basculer de méthode de capture                                                    |
| Écran de jeu | `DISPLAY1` XB273U 2560×1440 **à 59 Hz, alors qu'il accepte 165 Hz** à cette résolution        | tout ce qui est affiché est plafonné à ~60 images/s ; à vérifier si c'était le cas le 31/10                |
| Second écran | 1920×1080 à 144 Hz, à gauche                                                                  |                                                                                                            |
| HAGS         | désactivé (`HwSchMode = 1`, journal OBS)                                                      |                                                                                                            |
| OBS          | 33.0.1, **lancé en administrateur**, journal : « **D3D11 GPU priority setup success** »       | OBS a la priorité GPU **temps réel** (code source § 8 [S1]) : en cas de contention, OBS passe avant le jeu |
| Studio       | 2 fenêtres « Raptoru · Halloween » plein écran, au premier plan, transparentes, en permanence | voir AUDIT D1                                                                                              |

## 2. Le prototype qui tranche la question du curseur (PROTO)

`scratchpad/proto-wgc/wgc_cursor.py` (hors dépôt) : capture **Windows.Graphics.Capture** de l'écran où se trouve le
curseur, sans bordure, rien d'affiché, souris jamais touchée, seul un carré de 96 px autour du curseur est enregistré.

- **Curseur demandé** (`IsCursorCaptureEnabled = true`) : le curseur texte (I) est dans l'image.
- **Curseur refusé** (`false`) : **aucun curseur**, et les pixels dessous sont les vrais (la ligne violette de l'interface
  est intacte). Aucun masquage, aucune reconstruction.
- WGC n'envoie une image que quand l'écran change (42 à 50 images/s mesurées sur un bureau qui bouge un peu).

**Conclusion** : l'exclusion du curseur **en amont** est possible sur ce PC, pour le curseur de Windows. C'est
exactement ce que Chromium (donc V1) ne permet pas : il force `prefer_cursor_embedded` et active la capture du curseur
dans WGC ([S2], [S3]) ; la contrainte `cursor: 'never'` est ignorée ([S4]) — V1 l'avait aussi constaté
(`HALLOWEEN.md:126`).

## 3. Pourquoi le jeu semblait tomber à ~10 FPS

Aucune mesure n'existe du 31/10 (journaux disparus). Les causes ci-dessous sont classées par probabilité ; chacune a
son test au § 6.

### C1 — Ce qu'Antoni voyait n'était pas le jeu, mais la copie V1 (très probable, DOC + HYPOTHÈSE)

Pendant un flip ou un flou, l'écran montre **le canvas de la fenêtre Chaos**, pas le jeu. Sa cadence est celle du
pipeline de capture de Chromium, pas celle du jeu :

1. à chaque image, WGC copie l'écran dans une texture « staging » puis `Map(D3D11_MAP_READ)` **bloquant** : le GPU est
   synchronisé avec le CPU ([S3]) ;
2. conversion CPU `ARGB → I420` puis mise à l'échelle (libyuv), 2560×1440 × 4 octets ≈ 14,7 Mo par image ([S2]) ;
3. ré-envoi au GPU pour `<video>`, puis `drawImage` dans un canvas 2D, puis `blur()` CSS plein écran pour le flou ;
4. Chromium limite la capture à 50 % de CPU : l'intervalle entre deux captures vaut **au moins deux fois** la durée
   d'une capture ([S2]).

Le jeu peut donc tourner à 100+ images/s pendant que l'écran n'affiche que 10 à 20 nouvelles images par seconde.
Pour le joueur, c'est « le jeu rame » ; OBS, qui capture le jeu lui-même sur le GPU, reste fluide. **C'est l'explication
la plus simple de l'écart « aperçu OBS fluide / écran catastrophique ».**

### C2 — OBS prioritaire sur le GPU (PROUVÉ que la priorité est active ; impact à mesurer)

OBS en administrateur se met en priorité GPU temps réel (HAGS coupé) ([S1], journal du 10/11). Pendant un « Flou
fort », OBS applique un flou Gaussien de rayon 55 sur une capture 1440p ; Composite Blur indique que le Gaussien coûte
cher à grand rayon ([S5]). Avec la priorité temps réel, **le jeu attend OBS**.

### C3 — Le jeu sort de l'« independent flip » (DOC + HYPOTHÈSE)

Une fenêtre au premier plan qui couvre le jeu oblige DWM à **composer** le jeu (« Composed: Flip ») au lieu de le
laisser s'afficher seul ; latence d'au moins une image en plus, et G-Sync / VRR souvent perdus ([S6], [S7], [S8]).
**Les deux fenêtres V1 sont là en permanence** (AUDIT D1) : cette pénalité existe peut-être **même sans effet**.

### C4 — Effets dessinés coûteux (HYPOTHÈSE)

`radial-gradient` repeint à chaque image (tunnel), `putImageData` étiré plein écran (glitch), vidéo dans une fenêtre
transparente qui force DirectComposition à redessiner à chaque image ([S9]).

### C5 — L'écran à 59 Hz (PROUVÉ aujourd'hui, inconnu pour le 31/10)

N'explique pas 10 FPS, mais plafonne et retarde tout ; à fixer avant toute mesure.

## 4. Comparaison des voies techniques

Notation : ✅ bon · ⚠️ limite · ❌ rédhibitoire.

| Voie                                                                 | Retournement local                                         | Curseur                                                                                           | Coût / latence                                                                     | Jeux                                                         | Verdict                                                                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. getDisplayMedia + canvas (V1)**                                 | ✅                                                         | ❌ curseur incrusté, masquage visible                                                             | ❌ lecture GPU→CPU par image, cadence plafonnée                                    | borderless                                                   | **abandonner**                                                                                                                                                                         |
| **B. OBS seulement (filtres)**                                       | ❌ rien sur l'écran du joueur                              | —                                                                                                 | ✅ GPU, mais priorité OBS (C2)                                                     | tous                                                         | garder **pour le stream**, pas pour l'écran local                                                                                                                                      |
| **C. Projecteur OBS plein écran sur l'écran de jeu**                 | ✅                                                         | ✅ (capture sans curseur possible)                                                                | ⚠️ cadence OBS (60), +1–3 images                                                   | borderless                                                   | ❌ **le projecteur prend les clics et le focus** (pas de fenêtre « traversable ») : contraire à la règle n°1                                                                           |
| **D. Natif : WGC sans curseur → shader D3D11 → fenêtre traversable** | ✅                                                         | ✅ **PROTO** (curseur Windows exclu en amont) ; le vrai curseur est dessiné par Windows au-dessus | ✅ tout sur GPU (comme OBS : `CopyResource`, pas de `Map`) ; +1 à 2 images d'écran | borderless / fenêtré                                         | **recommandée**                                                                                                                                                                        |
| **E. Desktop Duplication (DXGI)**                                    | ✅                                                         | ✅ curseur matériel séparé, ⚠️ curseur logiciel incrusté ([S10])                                  | ✅                                                                                 | ⚠️ perd l'accès sur changement de mode / plein écran ([S11]) | secours de D                                                                                                                                                                           |
| **F. API Magnification**                                             | ❌ échelle ≥ 1 + décalage seulement ([S12])                | —                                                                                                 | ✅ gratuit                                                                         | tous                                                         | ❌ pour le flip ; **la matrice couleur plein écran** ([S13]) est tentante (gris, inversion) mais **état système** : rien ne garantit sa remise à zéro après un crash ([S14]) → écartée |
| **G. Miniature DWM**                                                 | ❌ toujours « de face, en 2D » ([S15]), pas d'écran entier | —                                                                                                 | ✅                                                                                 | —                                                            | ❌                                                                                                                                                                                     |
| **H. Rotation Windows (`DMDO_180`)**                                 | ✅                                                         | change le sens de la souris, changement de mode, scintillement                                    | —                                                                                  | —                                                            | ❌ (règle n°1 + état système)                                                                                                                                                          |
| **I. Injection / hook du jeu**                                       | —                                                          | —                                                                                                 | —                                                                                  | —                                                            | ❌ **interdit**                                                                                                                                                                        |

### Ce que D ne peut pas faire (limites dures)

| Cas                                                                                 | Résultat attendu                                                                                                                                                                                                                                                                                  | Niveau                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Curseur dessiné **par le jeu** (viseur FPS, curseur logiciel Unity `ForceSoftware`) | il fait partie de l'image : il est retourné avec elle. Pour un FPS en « raw input », le curseur Windows est caché : **un seul** curseur, celui du jeu, retourné. Pour un jeu à curseur logiciel, le seul curseur visible sera **retourné** : à refuser pour ce jeu si Antoni le juge inacceptable | DOC (Unity [S16]) + HYPOTHÈSE              |
| Jeu en **plein écran exclusif**                                                     | aucune fenêtre ne passe au-dessus : effet local impossible, seul le stream le montre                                                                                                                                                                                                              | DOC [S11] + `HALLOWEEN.md:144`             |
| Curseur logiciel composé par DWM (grand curseur d'accessibilité, HDR)               | probablement exclu aussi                                                                                                                                                                                                                                                                          | INCONNU (test E5)                          |
| Latence ajoutée                                                                     | 1 à 2 images d'écran (16–33 ms à 60 Hz, 6–12 ms à 165 Hz)                                                                                                                                                                                                                                         | HYPOTHÈSE (test E4)                        |
| Bordure jaune de capture                                                            | retirée par `IsBorderRequired(false)` après accord de Windows ([S17]) ; **PROTO** : aucune bordure vue dans le prototype Python                                                                                                                                                                   | PROTO (à revérifier dans le binaire final) |

## 5. Le curseur sous Windows (synthèse)

- Le curseur matériel est superposé par la carte graphique **au-dessus** de l'image composée : il apparaît au-dessus de
  notre fenêtre sans rien faire ([S10]) ; V1 l'a montré (le vrai curseur restait visible).
- WGC (`IsCursorCaptureEnabled`, Windows 10 2004 et plus) et DDA livrent l'image **sans** ce curseur ([S18], [S10]) ;
  OBS fait de même et redessine lui-même son curseur ([S19]).
- Notre fenêtre est traversable (`WS_EX_TRANSPARENT`, `WS_EX_NOACTIVATE`) : la forme du curseur reste celle du jeu, et
  les clics arrivent à leurs coordonnées réelles. Rien n'est remappé.
- Ce qui est **impossible sans injection** : enlever un curseur dessiné par le jeu dans ses propres pixels.

## 6. Protocole de mesure (à faire avec Antoni)

**Outils** : PresentMon 2.x en ligne de commande (Intel, open source) en administrateur ([S20]) ; statistiques OBS
(dock « Statistiques » + bilan du journal à la fermeture) ; pour Chaos, un compteur d'images interne au rendu.

```
PresentMon.exe --process_name <jeu>.exe --process_name obs64.exe --process_name dwm.exe ^
  --multi_csv --output_file C:\perf\E<n>.csv --timed 60 --terminate_after_timed
```

| Mesure                          | Colonne / source                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| FPS du jeu, temps d'image       | `MsBetweenPresents`                                                                         |
| **Images réellement affichées** | `MsBetweenDisplayChange`, `DisplayedTime`                                                   |
| Mode d'affichage                | `PresentMode` (« Hardware: Independent Flip » = bon ; « Composed: Flip » = composé par DWM) |
| Latence                         | `MsPCLatency` / `MsAllInputToPhotonLatency`                                                 |
| GPU                             | `MsGPUBusy`, Gestionnaire des tâches (moteur 3D par processus), VRAM                        |
| OBS                             | « images manquées (retard de rendu) », temps de rendu moyen                                 |
| Copie Chaos                     | images présentées par le rendu Chaos par seconde (compteur interne)                         |

**Conditions communes** : même scène de jeu, 60 s par palier, écran à **la même fréquence** dans toute la série (de
préférence 165 Hz), OBS ouvert sans diffuser ni enregistrer.

| #   | Palier                                                                 | Ce qu'on vérifie                                                | Seuil proposé                                  |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| E0  | Jeu seul (Studio fermé, OBS fermé)                                     | référence B                                                     | —                                              |
| E1  | + OBS ouvert, scène habituelle                                         | coût OBS                                                        | images affichées ≥ 90 % de B                   |
| E2  | + Studio avec les fenêtres V1 (D1)                                     | **les fenêtres permanentes cassent-elles l'independent flip ?** | aucun « Composed: Flip » si rien n'est affiché |
| E3  | + Studio, fenêtres V1 coupées (Studio › Halloween : overlay désactivé) | idem E1                                                         | = E1                                           |
| E4  | + effet simple (V1 brouillard, puis V2)                                | coût d'un overlay                                               | ≥ 90 % de E1, latence + ≤ 1 image              |
| E5  | + effet lourd (V1 flip, puis V2 flip)                                  | **cadence de la copie vs cadence du jeu**                       | V2 : copie ≥ 95 % de la fréquence d'écran      |
| E6  | + plusieurs effets autorisés                                           | cumul                                                           | ≥ 80 % de E1                                   |
| E7  | retour à la normale                                                    | plus aucune trace                                               | = E1 en < 2 s, plus de fenêtre Chaos           |

Variables à isoler ensuite, une à la fois : OBS administrateur ou non (C2), HAGS, 59 / 165 Hz, mode d'affichage du jeu
(plein écran / sans bordure).

**Limite reconnue** : je ne peux pas lancer Overwatch, Dofus ou un jeu d'horreur, ni contrôler le jeu. Ce protocole
est à exécuter par Antoni (30 à 45 min) ; les CSV suffisent pour l'analyse.

## 7. Rendu et effets : enseignements utiles

- **Flous** : Dual Kawase (descente puis remontée de résolution) coûte beaucoup moins qu'un Gaussien de grand rayon
  ([S21], [S5]) ; flouter à résolution réduite.
- **Un seul passage** suffit pour vignette, tunnel (fonction de distance), grain, scanlines, aberration chromatique
  (3 lectures décalées), déformation par texture de bruit (chaleur, pluie sur vitre).
- **Glitch « datamosh »** : demande l'image précédente (`previous_image` existe dans obs-shaderfilter ≥ 2.5 [S22]).
- **Particules** (confettis, sang, neige) : sprites ou vidéos alpha pré-rendus, pas de simulation lourde.
- **Licences** :
  - shaders gl-transitions : MIT ([S23]) ;
  - obs-shaderfilter, Composite Blur et obs-retro-effects : GPL-2.0 ([S22], [S5], [S24]) ; les utiliser **dans OBS** ne
    nous engage à rien, mais **copier leur code** dans Raptoru, si ;
  - Shadertoy : CC BY-NC-SA 3.0 par défaut, donc **non commercial** ; Lygia : licence Prosperity, non commerciale
    sans parrainage ([S25]). Écartés tous les deux.

  Règle : écrire nos shaders nous-mêmes, ou reprendre du MIT, BSD ou CC0.

- **Sécurité visuelle** : WCAG 2.3.1 limite à 3 flashs par seconde, avec des seuils de luminance et de rouge saturé
  ([S26]) ; pour le mouvement, les guides d'accessibilité des jeux recommandent d'éviter les accélérations et de
  permettre de désactiver les secousses ([S27], [S28]). Twitch n'a qu'un avertissement général ([S29]).
- **Clic d'un viewer sur l'image** : seule une extension de type **video overlay** reçoit des coordonnées sur la vidéo
  (et elle n'existe pas sur mobile) ; le flux a 2 à 5 s de retard, donnée par `hlsLatencyBroadcaster` ([S30], [S31]).
  Donc : effets localisés **lents** (un repère qui reste), jamais rien qui demande de la précision temporelle.

## 8. Sources

- [S1] OBS, `libobs-d3d11/d3d11-subsystem.cpp` (`set_priority`, `D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME` sans HAGS) — https://github.com/obsproject/obs-studio/blob/master/libobs-d3d11/d3d11-subsystem.cpp
- [S2] Chromium, `desktop_capture_device.cc` (WGC à partir de Windows 11 24H2, `prefer_cursor_embedded`, limite 50 % CPU, I420) — https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/media/capture/desktop_capture_device.cc
- [S3] WebRTC, `wgc_capture_session.cc` (texture staging + `Map` ; `IsCursorCaptureEnabled(false)` seulement sans curseur incrusté) — https://webrtc.googlesource.com/src/+/refs/heads/main/modules/desktop_capture/win/wgc_capture_session.cc
- [S4] crbug 1007177 / public-webrtc-logs (contrainte `cursor` sans effet) — https://lists.w3.org/Archives/Public/public-webrtc-logs/2019Apr/0012.html
- [S5] obs-composite-blur (algorithmes, coût du Gaussien, GPL-2.0) — https://github.com/FiniteSingularity/obs-composite-blur
- [S6] Microsoft, « DXGI flip model » (independent flip, MPO, recomposition) — https://devblogs.microsoft.com/directx/dxgi-flip-model/
- [S7] Microsoft, « Demystifying Full Screen Optimizations » — https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/
- [S8] NVIDIA forum, VRR et fenêtres au premier plan — https://forums.developer.nvidia.com/t/fix-vrr-for-overlays-always-on-top-windows/296168
- [S9] Electron, commit sur la vidéo en fenêtre non opaque (miroir) — https://ayakael.net/mirrors/electron/commit/f943b8c940386f196a10cf490ad9122d83ec59f5
- [S10] Microsoft, Desktop Duplication API (pointeur séparé ou incrusté) — https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api
- [S11] Microsoft, `IDXGIOutputDuplication::AcquireNextFrame` (`ACCESS_LOST`) — https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutputduplication-acquirenextframe
- [S12] Microsoft, `MagSetFullscreenTransform` — https://learn.microsoft.com/en-us/windows/win32/api/magnification/nf-magnification-magsetfullscreentransform
- [S13] Microsoft, `MagSetFullscreenColorEffect` — https://learn.microsoft.com/en-us/windows/win32/api/magnification/nf-magnification-magsetfullscreencoloreffect
- [S14] NVDA, cycles init/uninit de la loupe — https://github.com/nvaccess/nvda/pull/20069
- [S15] Greg Schechter (DWM), « APIs in the Desktop Window Manager » — https://learn.microsoft.com/en-gb/archive/blogs/greg_schechter/apis-in-the-desktop-window-manager
- [S16] Unity, `CursorMode` — https://docs.unity.com/en-us/engine/current/script-reference/unityengine/cursormode
- [S17] Microsoft, `GraphicsCaptureSession.IsBorderRequired` — https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired
- [S18] Microsoft, `GraphicsCaptureSession.IsCursorCaptureEnabled` — https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.iscursorcaptureenabled
- [S19] OBS, `libobs-winrt/winrt-capture.cpp` (« disable cursor capture if possible since ours performs better ») — https://github.com/obsproject/obs-studio/blob/master/libobs-winrt/winrt-capture.cpp
- [S20] PresentMon, mode console — https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md
- [S21] ARM, SIGGRAPH 2015 (Dual Kawase) — https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_notes.pdf
- [S22] obs-shaderfilter — https://github.com/exeldro/obs-shaderfilter
- [S23] gl-transitions — https://github.com/gl-transitions/gl-transitions
- [S24] obs-retro-effects — https://github.com/FiniteSingularity/obs-retro-effects
- [S25] Lygia (licences) — https://www.npmjs.com/package/lygia
- [S26] W3C, WCAG 2.2 « Three Flashes or Below Threshold » — https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- [S27] Game Accessibility Guidelines (scintillements, mal des transports) — https://gameaccessibilityguidelines.com/avoid-flickering-images-and-repetitive-patterns/
- [S28] Xbox Accessibility Guideline 117 — https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/117
- [S29] Twitch, avertissement épilepsie — https://legal.twitch.com/en/legal/seizure-warning
- [S30] Twitch Extensions, référence (`onContext`, `hlsLatencyBroadcaster`) — https://dev.twitch.tv/docs/extensions/reference/
- [S31] Twitch, « Just add time travel » (2019) — https://blog.twitch.tv/en/2019/08/21/just-add-time-travel-building-your-games-for-both-streamers-and-viewers-cd0c54f78b64/
- [S32] Microsoft, `SetWindowDisplayAffinity` (`WDA_EXCLUDEFROMCAPTURE`, fenêtres de premier niveau, DWM requis) — https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity
