# Effet « Wasted » avec ralenti global dans OBS : étude de faisabilité (24/11/2026)

Étude seule. OBS n'a été ni lancé, ni contacté (**aucune connexion obs-websocket**), ni modifié. Rien n'a été installé,
rien n'a été commité. Étude voisine menée en parallèle : [ETUDE_OBS_REPLAY.md](ETUDE_OBS_REPLAY.md) (replay des
N dernières secondes) ; le recouvrement est traité au § 9.

**Légende des preuves**

| Marque    | Sens                                                                   |
| --------- | ---------------------------------------------------------------------- |
| **CODE**  | lu dans le code source, à la version citée                             |
| **DOC**   | documentation officielle, notes de version, base de connaissances OBS  |
| **FORUM** | témoignages : forum OBS, avis, issues GitHub                           |
| **LOCAL** | relevé en lecture seule sur ce PC le 24/11, ou document du projet      |
| **INF**   | inférence ou estimation de ma part, **à mesurer** avant toute décision |

## 0. Verdict

1. **Un vrai ralenti du direct, avec rattrapage, est possible dans OBS pour toute l'image** (jeu, cam, overlays).
   - Il faut un filtre qui garde les dernières images dans des textures GPU et choisit laquelle afficher (CODE).
   - Aucune fonction native d'OBS ne le fait. Le « Render Delay » est fixe et plafonné à 500 ms. Le « Video Delay
     (Async) » est fixe et ne s'applique qu'aux sources asynchrones. Le « Stream Delay » est fixe et s'applique après
     l'encodage (CODE, DOC).
2. **Ce filtre est déjà installé : Dynamic Delay 0.1.4 (Exeldro)**, chargé par OBS 33.0.1 (LOCAL). Code lu :
   - ralenti de 0,1 à 99,9 %, rattrapage de 100,1 à 1000 %, rampes adoucies (11 courbes) ;
   - retour exact au direct ;
   - **vidéo seulement**, pilotable **uniquement par raccourcis** (CODE) ;
   - plus maintenu depuis novembre 2022.
3. **Le son ne peut pas suivre le ralenti du direct** avec les outils existants. En V1 : son du jeu coupé ou étouffé,
   « sting » Wasted par-dessus. La synchro son/image revient exactement à la fin de l'effet (CODE).
4. **Mémoire : environ 0,5 Go de VRAM par seconde de retard en 1080p60** (0,88 Go en 1440p).
   - Un Wasted « standard » (3 s à 33 %) accumule environ 2,1 s de retard, soit 1,1 à 1,3 Go pendant environ 5 s.
   - Sur la RTX 3070 (8 Go, partagés avec le jeu), c'est le **risque n° 1**.
   - Réglage par défaut du plugin (10 s) appliqué à l'écran 1440p : **8,8 Go**, plus que la carte. C'est une **cause
     plausible** des plantages de l'ancien effet (INF, § 3 Q7).
5. **Architecture recommandée, en deux temps :**
   1. **Prototype sans code natif**, avec des plugins déjà installés : un **calque « Wasted » au-dessus du programme**.
      - Contenu du calque : un clone de la scène actuelle (Source Clone) + Dynamic Delay (durée ≤ 2,5 s, activé
        seulement pendant l'effet) + la correction colorimétrique native.
      - Le calque est posé sous les alertes. La bannière passe par le lecteur d'effets existant.
      - Studio envoie **un seul lot obs-websocket `SerialFrame`**, exécuté par OBS en phase avec son rendu, qui déroule
        toute la chronologie.
   2. **Cible fiable : un plugin OBS natif Raptoru**, sur le modèle du « Render Delay » d'OBS (`gpu-delay.c`) :
      - réserve de textures bornée ;
      - chronologie interne avec retour automatique au direct ;
      - requêtes « vendor » obs-websocket avec état et accusés ;
      - son en option.
   - **Variante de secours, 100 % fonctions OBS : le « Wasted replay »**. Le dernier moment est rejoué à 50 %, son
     ralenti et synchrone, puis on coupe vers le direct, sans rattrapage. C'est la chaîne de l'étude replay (§ 9).
6. **Rien n'est validé.** Tout passe d'abord par un banc sur une **OBS portable** séparée (GO d'Antoni), puis par un
   test d'endurance de 3 à 4 h, avant toute utilisation en direct.

## 1. Environnement relevé (lecture seule)

| Élément                | Valeur                                                                                                                                                                                                                                                                                                                                                           | Preuve                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| OBS                    | **33.0.1** (`obs64.exe`). Dernière version : 33.0.3 (22/11/2026). Plugins internes dans `core\` depuis OBS 33                                                                                                                                                                                                                                                    | LOCAL, DOC                                               |
| obs-websocket          | 5.7.6, port 4455 (relevé du 10/11)                                                                                                                                                                                                                                                                                                                               | LOCAL ([OBS_ENVIRONNEMENT.md](../OBS_ENVIRONNEMENT.md))  |
| Profil `Profil_Twitch` | sortie avancée ; encodeur `obs_nvenc_h264_tex` ; canevas et sortie 1920×1080, 60 i/s, NV12 / 709 / partiel ; Stream Delay désactivé ; Replay Buffer activé dans les réglages (20 s, 512 Mo max) ; l'enregistrement utilise l'encodeur du stream (`RecEncoder=none`)                                                                                              | LOCAL (`basic.ini`, clés de sortie seulement)            |
| Capture                | « Écran » 2560×1440 en WGC, écran à 59 Hz                                                                                                                                                                                                                                                                                                                        | mandat, OBS_ENVIRONNEMENT O8                             |
| Machine                | RTX 3070 **8 Go** (+ Intel UHD 770), 64 Go de RAM, i7-12700                                                                                                                                                                                                                                                                                                      | LOCAL                                                    |
| Ancien effet           | la collection active contient une scène **« Slow Mo FAIL »**, exclue du DSK 1. Vestige probable de l'ancien Wasted. **Non ouverte** (hors mandat)                                                                                                                                                                                                                | LOCAL ([EFFECTS_PLAYER.md](../EFFECTS_PLAYER.md) l. 108) |
| Studio ↔ OBS           | client v5 minimal (`apps/studio/server/src/bonk-lab/obs.ts`) ; exécuteur typé (`channel-points/obs-actions.ts`) qui utilise déjà `SetSourceFilterEnabled`, `SetSourceFilterSettings`, `SetSceneItemEnabled`, `SetCurrentProgramScene`, `SetInputMute`, `TriggerMediaInputAction`, `GetSourceScreenshot` ; verrous de coupure du micro partagés (`mute-holds.ts`) | CODE (dépôt)                                             |

**Plugins tiers utiles ici** (fichiers dans `obs-plugins\64bit`, l'emplacement « legacy » d'OBS 33)

| Plugin (Exeldro, GPL-2.0) | Installé | Dernière version           | Rôle possible                        | Point d'attention                                                                                                        |
| ------------------------- | -------- | -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Dynamic Delay             | 0.1.4    | 0.1.4 (code du 29/11/2022) | ralenti et rattrapage du direct      | plus maintenu ; 8 issues ouvertes sans réponse                                                                           |
| Replay Source             | 1.8.0    | 1.8.2 (02/11/2026)         | replay ralenti depuis la RAM         | 1.8.1 « Fix crash with OBS 31 », 1.8.2 « Fix crash with internal frames for OBS 32+ » : **l'installée précède les deux** |
| Freeze Filter             | 0.3.3    | 0.3.5 (16/07/2025)         | arrêt sur image                      | 0.3.5 corrige les couleurs des sources sRGB                                                                              |
| Source Clone              | 0.1.5    | 0.2.3 (13/03/2026)         | clone de la « scène actuelle »       | 0.2.1 et 0.2.2 corrigent une fuite et un plantage **du son cloné**                                                       |
| Downstream Keyer (DSK)    | 0.4.1    | 0.4.5 (28/10/2026)         | calque au-dessus du programme        | déjà utilisé (« Alerte complète » en DSK 1)                                                                              |
| Move                      | 3.2.1    | 3.2.2 (14/11/2026)         | animer un réglage de filtre          | —                                                                                                                        |
| obs-shaderfilter          | 2.6.1    | 2.6.1 (24/10/2026)         | rendu : écho, vignette, désaturation | cassé par OBS 33 le 10/11, réparé                                                                                        |

- Dynamic Delay se charge sous OBS 33.0.1 : le relevé du 10/11 compte 0 « not loaded » (LOCAL). Le journal n'a pas été
  relu aujourd'hui.
- L'emplacement legacy reste chargé « until at least OBS Studio 34.0 », annoncée vers août 2027 (DOC, KB OBS).
- Changement d'OBS 33 qui a cassé des plugins : « breaking change for any plugins using libobs/graphics
  gs_image_file » (DOC). Dynamic Delay n'utilise pas `gs_image_file` (CODE).

## 2. Ce qui rend le ralenti possible

- **Image** (DOC, backend-design) :
  - à chaque image (1/60 s), le thread graphique d'OBS dessine les sources des canaux de sortie dans la texture finale ;
  - cette texture est convertie (NV12), horodatée, puis envoyée aux encodeurs ;
  - le flux envoyé à Twitch reste donc **continu**, quoi que dessinent les sources.
- **Sources** (DOC, reference-sources) :
  - les sources synchrones (capture d'écran ou de jeu, scènes, navigateur) dessinent sur le GPU à chaque image ;
  - les sources asynchrones (webcam, média) poussent des images en RAM, affichées selon leur horodatage.
- **Filtre vidéo** :
  - il peut rendre sa cible dans une texture (`gs_texrender`) puis dessiner autre chose ;
  - garder N textures et dessiner une ancienne donne un retard ; changer laquelle au fil du temps donne une vitesse ;
  - c'est exactement ce que font le « Render Delay » d'OBS (`gpu-delay.c`, retard fixe ≤ 500 ms) et Dynamic Delay
    (retard variable) (CODE).
- **Son** (DOC) :
  - il tourne sur un autre thread, par paquets de 1024 échantillons (environ 21 ms), source par source, indépendamment
    de l'image ;
  - une source qui annonce une autre fréquence d'échantillonnage est rééchantillonnée automatiquement ;
  - la source média et Replay Source s'en servent pour ralentir le son : elles annoncent « fréquence × vitesse ». Le son
    est alors **plus lent et plus grave**, effet « bande magnétique » (CODE `media.c` l. 362 ; `replay-source.c`
    l. 2775).
- **Canaux de sortie** :
  - le canal 0 porte le programme ;
  - le Downstream Keyer dessine ses scènes sur des canaux ≥ 1, **par-dessus** (CODE `downstream-keyer-dock.cpp`).

## 3. Réponses aux questions obligatoires

### Q1. Peut-on ralentir une source OBS en direct ? Comment ?

**Oui, et seulement avec un filtre GPU à tampon.** Fonctionnement de Dynamic Delay 0.1.4, lu dans `dynamic-delay.c`
(CODE).

**Tampon**

- À chaque image, la cible est rendue dans une **nouvelle** `gs_texrender` (`GS_RGBA`, 8 bits), ajoutée à un tampon
  circulaire avec son horodatage. Aucune copie vers la RAM.
- Les images plus récentes que `duration` sont gardées : 10 s par défaut, jusqu'à 10 000 s. Les plus anciennes sont
  recyclées.

**Vitesse et retard**

- À chaque tick, le retard évolue : `time_diff += (1 − speed) × dt`, borné entre 0 et `duration`.
- L'image affichée est la plus ancienne de moins de `time_diff`. C'est l'image la plus proche : pas d'interpolation.
- Les changements de vitesse suivent une rampe : `easing_duration`, 1 s par défaut, 11 courbes.
- Retour automatique à 100 % près du direct (`time_diff < easing/2`) et près du bord du tampon.

**Réglages et commandes**

- Réglages : `duration`, `easing`, `easing_duration`, `slow_forward` (%), `fast_forward` (%), `slow_backward`,
  `fast_backward`, `text_source`, `text_format`.
- Raccourcis enregistrés **sur la source parente** : `slow_forward`, `fast_forward`, `forward`, `skip_end` (saut au
  direct), `skip_begin`, `pause`, `backward`, `slow_backward`, `fast_backward`.
- **Aucun traitement audio** : pas de `filter_audio`, pas d'indicateur audio. Les avis le confirment : « only the screen
  is delayed, not the audio tracks » (FORUM).
- Désactiver le filtre libère toutes les textures (CODE ; note de version 0.1.3).

**Pilotage depuis Studio**

- Requête obs-websocket `TriggerHotkeyByName` avec `hotkeyName` et `contextName` (le nom de la source parente).
  `contextName` existe depuis obs-websocket 5.4.0 ; la version installée est 5.7.6 (DOC, tags).
- La requête simule l'appui puis le relâchement (CODE `RequestHandler_General.cpp`).
- La doc avertit : « Hotkey functionality in obs-websocket comes as-is » (DOC). Le filtre ne renvoie aucun état.

**Fonctions natives qui ne conviennent pas** (CODE)

| Fonction                                     | Limite                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Render Delay (`gpu_delay`)                   | retard fixe, 0 à 500 ms                                                            |
| Video Delay (Async)                          | retard fixe, 0 à 20 000 ms, sources asynchrones seulement ; retarde aussi leur son |
| Vitesse de la source média (`speed_percent`) | 1 à 200 %, fichiers locaux seulement ; tout changement **redémarre** le média      |
| Stream Delay                                 | retard fixe de toute la sortie encodée, sans changement possible en direct         |

### Q2. Peut-on ralentir toute la composition (sortie programme) ? Sinon, quelles illusions équivalentes ?

**Pas directement.** OBS n'offre aucun emplacement de filtre sur la sortie programme elle-même. Le seul retard global,
le Stream Delay, est fixe et s'applique après l'encodage (DOC, INF). Équivalents, du plus large au plus étroit :

1. **Calque « programme »** (recommandé pour le prototype) :
   - Source Clone, de type **« Scène actuelle »**, clone `obs_frontend_get_current_scene()` (CODE ; type présent dès
     0.1.5, vérifié au tag) ;
   - placé dans une scène du DSK (canal ≥ 1, au-dessus du programme), le clone reçoit ses propres filtres sans toucher
     aux scènes existantes ;
   - le ralenti couvre **la scène en direct, quelle qu'elle soit**, avec jeu, cam et overlays ;
   - ce qui est au-dessus (alertes du DSK, bannière) reste en direct, et c'est voulu.
2. **Filtre posé sur la scène de jeu** : les scènes acceptent des filtres. Plus simple (un seul plugin), mais limité à
   cette scène et sensible aux changements de scène (FORUM : « filter on a scene delayed only the screen »).
3. **Scène dédiée** (`SetCurrentProgramScene`) : probablement le principe de l'ancienne « Slow Mo FAIL » (INF).
4. **Replay ralenti** (architecture C) : le Replay Buffer enregistre la sortie programme encodée.
   - Sa lecture ralentie montre **tout**, son compris, mais c'est le passé.
   - Il n'y a pas de rattrapage : on coupe vers le direct.

### Q3. Comment le stream reste-t-il « en direct » pendant le ralenti ?

**Il le reste, par construction** (DOC + CODE).

- OBS compose toujours 60 images par seconde, avec des horodatages réels. L'encodeur et Twitch reçoivent un flux
  ininterrompu, et la latence Twitch ne change pas.
- Pendant l'effet, la zone filtrée montre des images passées (retard D, jusqu'à environ 2 s).
- Dans le même appel de rendu, le filtre continue d'enregistrer l'image présente : il capture d'abord, dessine ensuite
  (`dynamic_delay_video_render`).
- Les viewers voient tout : le moment ralenti, puis la suite en accéléré jusqu'à rejoindre le direct. Rien n'est perdu.
  C'est l'inverse du replay, qui masque le direct pendant la lecture.
- Le Replay Buffer, l'enregistrement et la VOD contiennent le ralenti tel que diffusé.

### Q4. Rattrapage du direct, mémoire, cadence, synchro A/V

**Rattrapage : oui** (CODE).

- `fast_forward` va de 100,1 à 1000 %. Atterrissage automatique à 100 % quand le retard passe sous la moitié de la rampe.
- `skip_end` rejoint le direct immédiatement : c'est le filet de sécurité.

**Formules**

- Retard accumulé : **D = ∫(1 − v) dt** pendant le ralenti.
- Durée du rattrapage à la vitesse v_r : **D / (v_r − 1)**.

**Mémoire par image et par seconde de retard (60 i/s)**

| Format stocké               | Par image | Par seconde | D = 1 s | 2 s     | 3 s     | 5 s     | 10 s    |
| --------------------------- | --------- | ----------- | ------- | ------- | ------- | ------- | ------- |
| 1080p RGBA 8 bits (GPU)     | 8,3 Mo    | 0,50 Go     | 0,50 Go | 1,00 Go | 1,49 Go | 2,49 Go | 4,98 Go |
| 1440p RGBA 8 bits (GPU)     | 14,7 Mo   | 0,88 Go     | 0,88 Go | 1,77 Go | 2,65 Go | 4,42 Go | 8,85 Go |
| 1080p NV12 (GPU, maison)    | 3,1 Mo    | 0,19 Go     | 0,19 Go | 0,37 Go | 0,56 Go | 0,93 Go | 1,87 Go |
| 540p RGBA (demi-définition) | 2,1 Mo    | 0,12 Go     | 0,12 Go | 0,25 Go | 0,37 Go | 0,62 Go | 1,24 Go |
| H.264 encodé à 6 Mb/s       | —         | 0,75 Mo     | 0,75 Mo | 1,5 Mo  | 2,3 Mo  | 3,8 Mo  | 7,5 Mo  |
| H.264 encodé à 50 Mb/s      | —         | 6,3 Mo      | 6,3 Mo  | 12,5 Mo | 19 Mo   | 31 Mo   | 63 Mo   |

- À 30 i/s, diviser par deux. Les tailles GPU réelles ajoutent un petit surcoût d'alignement du pilote (INF).
- Le débit réel du stream n'a pas été lu : 6 Mb/s est une hypothèse.
- **L'encodé est réservé au replay** (C) : ralentir le direct à partir d'images encodées imposerait un décodage en boucle,
  donc de la latence et de la complexité, sans gain (INF).
- **Particularité de Dynamic Delay** (CODE) :
  - une fois activé depuis plus de `duration` secondes, il garde **`duration` × i/s images**, quel que soit le retard
    réel ;
  - régler donc `duration` = D max + 0,3 à 0,5 s, et n'activer le filtre que pendant l'effet ;
  - il crée une texture par image jusqu'à remplir le tampon : pas de réserve préallouée.

**Scénarios (calque en 1080p60, rampes de 0,4 s)** (INF, calcul)

| Scénario | Ralenti          | D max   | Rattrapage     | Durée totale | Dynamic Delay (`duration`) | Plugin natif RGBA / NV12 |
| -------- | ---------------- | ------- | -------------- | ------------ | -------------------------- | ------------------------ |
| Court    | 50 % pendant 2 s | ≈ 1,1 s | 200 %, ≈ 1,4 s | ≈ 3,8 s      | 1,5 s → **0,75 Go**        | 0,56 / 0,21 Go           |
| Standard | 33 % pendant 3 s | ≈ 2,1 s | 250 %, ≈ 1,7 s | ≈ 5,1 s      | 2,5 s → **1,24 Go**        | 1,08 / 0,40 Go           |
| Long     | 25 % pendant 4 s | ≈ 3,2 s | 300 %, ≈ 1,9 s | ≈ 6,3 s      | 3,5 s → **1,74 Go**        | 1,58 / 0,59 Go           |

**Cadence** (INF, d'après le choix de l'image la plus proche)

- Une vitesse en 1/n répète chaque image régulièrement : 50 % → 2 fois, 33 % → 3 fois, 25 % → 4 fois.
- 40 % donne un motif irrégulier 2-3-2-3, donc une saccade.
- Mouvement effectif : 60 × v i/s. À 33 %, 20 i/s : un « saccadé ciné », acceptable pour un Wasted ; 50 % est plus
  fluide.
- La capture d'un écran à 59 Hz dans un canevas à 60 i/s produit un doublon par seconde environ, répété 3 fois en
  ralenti à 33 %. Passer l'écran à 60, 120 ou 165 Hz (observation O8).

**Synchro son/image**

- Pendant l'effet, le décalage vaut D, car le son reste en direct.
- À la fin, il revient **exactement** à 0 : `time_diff` est borné à 0 et l'image la plus récente est dessinée (CODE).
- Aucune dérive ne s'accumule d'un effet à l'autre.

### Q5. Que devient le son ?

| Option                                                                        | Synchro                           | Coût / fiabilité                                                     | Rendu                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Son du direct inchangé                                                        | décalé de D (jusqu'à environ 2 s) | nul                                                                  | lèvres de la cam décalées ; sons du jeu « en avance » sur l'image                                                              |
| **Jeu coupé ou baissé de −20 dB, fondu de 150 ms, + sting Wasted**            | aucun décalage audible            | nul ; `SetInputMute` / `SetInputVolume`, déjà utilisés par Studio    | proche de GTA ; **recommandé en V1**                                                                                           |
| Jeu étouffé + sting                                                           | décalage masqué                   | nul ; filtre natif « Égaliseur 3 bandes » (ou VST) activé par Studio | effet « sous l'eau »                                                                                                           |
| Replay (C) : son du replay ralenti                                            | **synchrone** (horodatages × 1/v) | faible ; fonctions OBS                                               | grave, effet « bande magnétique » (CODE `media.c`)                                                                             |
| Plugin natif : filtre audio à vitesse variable, horloge partagée avec l'image | synchrone                         | à construire (§ 6)                                                   | grave au ralenti, aigu au rattrapage (le couper) ; hauteur conservée seulement avec SoundTouch (LGPL-2.1) ou Rubber Band (GPL) |

- **Micro** : à laisser en direct par défaut. La réaction d'Antoni fait partie du gag, et un décalage lèvres/voix
  d'au plus 2 s est masqué par le sting et la désaturation. Réglable en coupé ou baissé.
- Toute coupure passe par les **verrous partagés** de `mute-holds.ts`, pour ne pas entrer en conflit avec un Random
  Ban qui coupe déjà le micro (LOCAL).

### Q6. Coût CPU / GPU

| Brique                              | GPU                                                                                                                                    | CPU                                          | Mémoire                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Dynamic Delay (calque 1080p)        | 1 rendu vers une texture + 1 dessin par image, environ 1 Go/s de trafic mémoire, face aux 448 Go/s de la RTX 3070 : négligeable (INF)  | environ 0 : aucune relecture (CODE)          | VRAM : tableau Q4                                                                                  |
| Clone de la scène actuelle          | la scène du programme est composée deux fois **pendant l'effet** (textures partagées, INF)                                             | ≈ 0                                          | 0 au repos si le calque est masqué et le filtre désactivé (CODE pour le filtre, INF pour le clone) |
| Filtre de Replay Source (non async) | copie GPU → RAM à chaque image, avec lecture dans la même image (CODE), donc blocage ; la doc OBS conseille d'attendre une image (DOC) | `memcpy` d'environ 0,5 Go/s en 1080p60 (INF) | RAM brute ; 15 à 17 Go signalés (FORUM)                                                            |
| Replay Buffer + source média        | partage l'encodeur NVENC du stream (`RecEncoder=none`, LOCAL) ; décodage matériel possible                                             | faible                                       | 15 à 20 Mo écrits par sauvegarde (INF)                                                             |
| Plugin natif (cible)                | comme Dynamic Delay, sans allocation pendant l'effet ; NV12 = 2 passes de conversion de plus                                           | ≈ 0                                          | −62 % de VRAM en NV12                                                                              |

Signalements de Dynamic Delay **sur RTX 3070** (FORUM, forum OBS) :

- « from smooth 60fps stream with under 10% GPU usage to like under 10fps and 99% GPU usage » (décembre 2023) ;
- un autre utilisateur, même carte, en octobre 2024.

Explication probable : un tampon de 10 s par défaut, soit 5 Go en 1080p60, qui sature la VRAM (INF).

### Q7. Risques de plantage, de désynchronisation et de fuite

| #   | Risque                                                                                                                                                             | Preuve                                                                                                                                       | Gravité                     | Parade                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **VRAM saturée** : saccades, « rendering lag », plantage du pilote ou d'OBS                                                                                        | CODE (`duration` × i/s images gardées) ; FORUM (99 % GPU, plantages au-delà de 10 s) ; LOCAL (8 Go). Défaut 10 s sur l'écran 1440p = 8,85 Go | **élevée**                  | calque 1080p ; `duration` ≤ 2,5 s ; filtre activé seulement pendant l'effet ; VRAM mesurée au banc ; plugin natif : budget fixe et abandon si l'allocation échoue |
| R2  | Réduire `duration` pendant le rendu fait libérer les textures depuis un autre thread : risque d'**accès après libération**                                         | CODE : `dynamic_delay_update` → `free_textures`, sans verrou, pendant que le thread graphique lit le tampon                                  | **élevée** (plantage)       | Studio n'écrit **jamais** `duration` ; réglages modifiés seulement filtre désactivé                                                                               |
| R3  | Studio s'arrête au milieu : le retard monte jusqu'à `duration` puis la vitesse revient à 100 %. Le stream reste **décalé** (image seule) jusqu'à une remise à zéro | CODE : le retour automatique ne ramène pas au direct                                                                                         | moyenne                     | lot `SerialFrame` exécuté dans OBS ; remise à zéro à chaque (re)connexion de Studio ; raccourci OBS « Retour au direct » ; STOP ALL                               |
| R4  | Changement de scène pendant l'effet : un filtre posé sur une scène n'enregistre plus                                                                               | CODE (rendu seulement si la source est affichée) ; FORUM (#5)                                                                                | faible avec le calque clone | calque « scène actuelle » ; sinon abandon sur `CurrentProgramSceneChanged`                                                                                        |
| R5  | Raccourcis « as-is », exécution différée, noms identiques entre instances                                                                                          | DOC, CODE                                                                                                                                    | faible                      | `contextName`, noms uniques, contrôle préalable (`GetSourceFilter`, `GetHotkeyList`)                                                                              |
| R6  | Plugin non maintenu depuis 2022, emplacement legacy (fin au plus tôt avec OBS 34), API qui bouge (OBS 33 a cassé 4 plugins le 10/11)                               | GitHub, KB, LOCAL                                                                                                                            | moyenne                     | Studio détecte l'absence du filtre et passe en mode dégradé (§ 6) ; plugin natif à terme ; relire le journal après chaque mise à jour                             |
| R7  | Replay Source 1.8.0 installé : les correctifs de plantage pour OBS 31 et 32+ sont postérieurs                                                                      | notes de version 1.8.1 et 1.8.2 ; avis (« crashes… when replays are being cleared out » sur OBS 31)                                          | élevée **si utilisé**       | ne pas l'utiliser pour Wasted ; mise à jour 1.8.2 seulement avec GO et sauvegarde                                                                                 |
| R8  | Source Clone 0.1.5 avec son cloné                                                                                                                                  | notes 0.2.1 (fuite) et 0.2.2 (plantage du son)                                                                                               | moyenne                     | son du clone **désactivé** (c'est le défaut, CODE) ; 0.2.3 optionnelle (exige OBS ≥ 31.1)                                                                         |
| R9  | Couleurs légèrement différentes : filtre non conscient du sRGB                                                                                                     | INF (Freeze Filter a dû le corriger en 0.3.5, PR #11)                                                                                        | faible                      | contrôle visuel au banc ; masqué par la désaturation                                                                                                              |
| R10 | Une texture créée par image au démarrage (environ 150 × 8 Mo en 2,5 s), tout libéré d'un coup à la fin                                                             | CODE                                                                                                                                         | faible à moyenne            | mesure au banc ; plugin natif : réserve préallouée                                                                                                                |
| R11 | Bannière dans une **nouvelle** source navigateur HTTP : plafond de 6 connexions par hôte (incident du 22/11)                                                       | LOCAL (projet)                                                                                                                               | moyenne                     | réutiliser le lecteur d'effets existant, ou une page locale `file://`                                                                                             |
| R12 | Déclenchements Twitch rapprochés ou chevauchés                                                                                                                     | INF                                                                                                                                          | moyenne                     | verrou global, aucun chevauchement, délai de recharge, refus hors des scènes autorisées                                                                           |
| R13 | Bogue d'un plugin natif maison : **OBS tombe en direct**                                                                                                           | INF                                                                                                                                          | élevée tant que non éprouvé | banc portable, endurance, code minimal calqué sur `gpu-delay.c`                                                                                                   |
| R14 | Écran à 59 Hz : doublon environ une fois par seconde, amplifié au ralenti                                                                                          | INF                                                                                                                                          | faible (esthétique)         | écran à 60 / 120 / 165 Hz (réglage d'Antoni)                                                                                                                      |

**Hypothèse sur l'ancien plantage (non vérifiée)**

- La scène « Slow Mo FAIL » existe, et Dynamic Delay comme Replay Source sont installés.
- Dynamic Delay au réglage par défaut (10 s) sur la capture 1440p demande 8,85 Go de VRAM ; Replay Source 1.8.0 plante
  sous OBS ≥ 31.
- Ces deux causes plausibles s'ajoutent aux hotkeys de SAMMI.
- Pour trancher : lire la scène et les journaux de plantage de l'époque (GO, § 6, étape 0).

### Q8. Plusieurs heures de stream sans instabilité ?

- **Dynamic Delay activé seulement pendant l'effet** : la mémoire revient à zéro après chaque effet, car la
  désactivation libère tout (CODE ; note 0.1.3). Rien ne s'accumule en théorie.
- **Laissé activé en permanence** : la mémoire reste constante (recyclage du tampon, CODE), mais 1,2 Go de VRAM sont
  immobilisés pendant tout le stream.
- L'issue « Memory consumption (memory leak?) » correspond en fait au stockage brut qui grossit avec `duration`. L'auteur
  répond : « For 1080p60 that is about 500MB per second » (FORUM). La lecture du code ne montre pas de fuite : chaque
  image retirée du tampon est réutilisée ou détruite (CODE).
- **Risques résiduels sur la durée** :
  - fragmentation de la VRAM par les allocations répétées (INF, peu probable) ;
  - R2, évité par la règle d'usage ;
  - abandon du plugin.
- **Il faut un test d'endurance avant le direct** :
  - 3 à 4 h, avec un jeu lancé, un effet toutes les 2 à 3 min (80 à 120 effets) ;
  - mémoire GPU suivie avec `nvidia-smi --query-gpu=memory.used --format=csv -l 1` ;
  - `GetStats` (`renderSkippedFrames`, `outputSkippedFrames`) et journal OBS ;
  - test « clap » son/image après les effets.
- **Critères d'acceptation** :
  - mémoire revenue à la référence ±64 Mo après chaque effet ;
  - 0 plantage ou gel ;
  - images perdues au rendu < 0,1 % ;
  - décalage son/image < 1 image après l'effet.

## 4. Architectures comparées

| Arch.                                                              | Faisabilité                                  | Qualité                                                                             | Latence au déclenchement                                 | Ressources                                                                     | Complexité                                                    | Fiabilité                                                                                      | Compatibilité                                                                                                                      | Risques principaux                                                                                 | Pilotage Studio                                                                | Potentiel Twitch  |
| ------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------- |
| **A. Plugin natif : filtre à tampon GPU**                          | ✅ (même schéma que `gpu-delay.c`, CODE)     | excellente : image exacte, fondu entre images possible, son en option               | 1 image                                                  | VRAM ≈ D × 60 × image (1,08 Go RGBA / 0,40 Go NV12 pour 2,1 s) ; CPU ≈ 0       | élevée : C, CI Windows, GPL, tests GPU                        | potentiellement la meilleure (réserve bornée, chronologie interne, retour garanti) ; code neuf | à recompiler si l'API d'OBS change                                                                                                 | R13 : un bogue fait tomber OBS                                                                     | requêtes « vendor » + événements, état et accusés                              | ✅                |
| **B. Source maison à tampon interne** (sur son propre canal)       | ✅                                           | idem A, couvre toutes les scènes sans Source Clone ni DSK                           | 1 image                                                  | idem A ; son possible via le mix capté et les pistes (INF)                     | très élevée : canaux, garde contre la récursion, API frontend | idem A, plus de surface                                                                        | idem A                                                                                                                             | récursion si la source est posée dans le programme                                                 | idem A                                                                         | ✅                |
| **C. Replay Buffer + source média à 50 %**                         | ✅ aujourd'hui, fonctions OBS                | encodée (débit du stream) ; 30 i/s effectifs à 50 % ; vitesse **constante**         | 0,5 à 1 s, à mesurer ([REPLAY § 0](ETUDE_OBS_REPLAY.md)) | disque 15 à 20 Mo, décodage matériel                                           | moyenne (chaîne de l'étude replay)                            | **haute** (fonctions OBS)                                                                      | API stable (obs-websocket 5.x)                                                                                                     | pas de rattrapage : le direct est **perdu** pendant la lecture ; délais d'écriture aberrants rares | requêtes standard + `ReplayBufferSaved`                                        | ✅                |
| **D. Scène dédiée + média** (arrêt sur image + animation)          | ✅                                           | illusion : pas de vrai ralenti                                                      | ≈ 0 à 150 ms (capture en mémoire)                        | négligeables                                                                   | faible                                                        | **très haute**                                                                                 | fonctions OBS                                                                                                                      | rendu moins spectaculaire                                                                          | requêtes standard                                                              | ✅ (mode dégradé) |
| **E. Source vidéo intermédiaire pilotée par Studio** (Electron)    | ⚠️ techniquement, ❌ en pratique             | inférieure : recompression, latence                                                 | ≥ 2 à 5 images + tampon                                  | copie GPU → CPU → GPU d'environ 0,5 Go/s dans chaque sens + encodage           | très élevée                                                   | faible                                                                                         | NDI / caméra virtuelle / navigateur                                                                                                | récursion du programme, plafond de 6 connexions, charge                                            | —                                                                              | —                 |
| **F. Traitement GPU des images captées** (shaders)                 | ✅ comme **habillage**, ❌ comme ralenti     | bonne pour le rendu : écho, flou de mouvement, désaturation                         | 0                                                        | ≈ 0                                                                            | faible                                                        | haute                                                                                          | Correction colorimétrique native ; shaderfilter (tiers) : `previous_image` / `previous_output` = 1 image d'historique (CODE 2.6.1) | aucun ralenti réel                                                                                 | `SetSourceFilterEnabled` / `SetSourceFilterSettings`                           | ✅ (complément)   |
| **G1. Dynamic Delay 0.1.4** (installé), en calque                  | ✅ **aujourd'hui**                           | image exacte, plus proche voisine, rampes ; **vidéo seule**                         | 1 à 2 images (raccourci différé, INF)                    | VRAM = `duration` × 60 × image (1,24 Go pour 2,5 s) ; allocations au démarrage | faible à moyenne : réglages OBS + orchestration Studio        | moyenne : non maintenu, R2/R3, aucun retour d'état ; **endurance obligatoire**                 | chargé sous OBS 33.0.1 (relevé du 10/11) ; legacy jusqu'à OBS 34 au moins                                                          | R1, R2, R3, R6                                                                                     | raccourcis via `TriggerHotkeyByName` + `contextName` dans un lot `SerialFrame` | ✅                |
| **G2. Replay Source** 1.8.0 (installé ; 1.8.2 disponible)          | ✅ (replay ralenti depuis la RAM, son grave) | image brute, vitesse modifiable pendant la lecture                                  | quelques images                                          | RAM brute environ 0,5 Go/s ; copie GPU → RAM **permanente**                    | moyenne                                                       | **faible avec 1.8.0** (correctifs postérieurs)                                                 | 1.8.2 visée OBS 32+                                                                                                                | R7, mémoire                                                                                        | raccourcis, `TriggerMediaInputAction`                                          | ⚠️                |
| **G3. Freeze Filter** 0.3.3 (installé)                             | ✅                                           | arrêt sur image ; option de rafraîchissement = « image par image » live             | 1 image                                                  | 1 texture                                                                      | faible                                                        | haute                                                                                          | 0.3.5 corrige le sRGB                                                                                                              | peu                                                                                                | `SetSourceFilterEnabled`                                                       | ✅ (mode dégradé) |
| **G4. Source Record / « backtrack » d'Aitum**                      | ✅ pour du replay encodé par source          | encodée                                                                             | ≈ C                                                      | faibles                                                                        | moyenne                                                       | non évaluée ici                                                                                | Source Record 0.5.0 (07/11/2026)                                                                                                   | relève de l'étude replay                                                                           | —                                                                              | —                 |
| **H. Moteur Chaos** (WGC + fenêtre DirectComposition)              | ⚠️ partiel                                   | ralentit **la fenêtre du jeu seulement** ; vue par OBS parce qu'OBS capture l'écran | 1 à 2 images                                             | 14,7 Mo par image en 1440p                                                     | moyenne (le moteur existe)                                    | moyenne                                                                                        | indépendant d'OBS                                                                                                                  | **le joueur voit aussi le ralenti** ; cam, overlays et son non ralentis                            | protocole du moteur                                                            | ⚠️                |
| **N. Fonctions natives** (Render Delay, Video Delay, Stream Delay) | ❌ pour un ralenti                           | —                                                                                   | —                                                        | —                                                                              | —                                                             | —                                                                                              | —                                                                                                                                  | —                                                                                                  | —                                                                              | —                 |

**Notes par architecture**

- **A / B**
  - Le motif est éprouvé : OBS embarque le même (`gpu-delay.c` : tampon de `gs_texrender`, rendu conscient de
    l'espace colorimétrique). Le nouveau code se limite donc à une tête de lecture variable et à une réserve
    préallouée.
  - B évite deux plugins tiers, mais doit poser sa source sur un canal de sortie libre, comme le fait le DSK. Si la
    source était posée **dans** le programme, elle s'y rendrait elle-même en boucle.
  - Pilotage propre via `obs_websocket_register_vendor` et `obs_websocket_vendor_register_request` (en-tête
    `obs-websocket-api.h`, CODE), comme le fait déjà le DSK.
- **C**
  - Détail dans l'étude replay. Pour Wasted, on ajoute `speed_percent` = 50 sur la source média.
  - Un changement de vitesse redémarre le média : pas de rampe (CODE `obs-ffmpeg-source.c`).
  - Le son est ralenti, plus grave et synchrone (CODE `media.c`).
  - Le direct n'est pas montré pendant la lecture.
- **D** :
  - le lecteur d'effets fait déjà des captures **en mémoire** (`GetSourceScreenshot`, [EFFECTS_PLAYER.md](../EFFECTS_PLAYER.md)) ;
  - arrêt sur image + zoom + désaturation + bannière + sting, sans aucun plugin ;
  - c'est le mode dégradé naturel.
- **E**
  - Un processus Electron ne peut pas s'insérer dans le pipeline GPU d'OBS. Il devrait sortir les images (caméra
    virtuelle, NDI, capture d'un projecteur), les garder, puis les réinjecter, pour un résultat inférieur à un filtre
    GPU.
  - Studio reste l'**orchestrateur**, jamais le transport d'images.
- **F** : `previous_output` permet un écho / une traînée qui **vend** le ralenti (traînées de mouvement). C'est un
  habillage, pas une dilatation du temps.
- **H** :
  - le moteur Chaos sait capturer la fenêtre du jeu et la réafficher par-dessus ([apps/chaos-engine](../../apps/chaos-engine/README.md)) ;
  - un effet « ralenti du jeu » serait possible, mais il ne ralentit ni la cam, ni les overlays, ni le son, et il
    **gêne le joueur** ;
  - à écarter pour Wasted.

## 5. Recommandation

**Principe.** Wasted = un **calque programme** temporaire, au-dessus de la scène en direct et sous les alertes, qui ne
coûte rien au repos. Studio le pilote en un seul lot, et le retour au direct est garanti à plusieurs niveaux.

### 5.1 Prototype (plugins déjà installés, aucune ligne de C)

1. **Préparation**, une fois, sur l'OBS de test puis en production avec GO :
   - scène « Wasted · calque » ;
   - source Source Clone « Wasted · direct », de type **Scène actuelle**, son **désactivé**, masquée au repos ;
   - filtres de cette source, dans l'ordre :
     1. Dynamic Delay « Wasted · ralenti » : `duration` 2,5 ; `easing` Sine ou Cubic ; `easing_duration` 0,4 ;
        `slow_forward` 33,3 ; `fast_forward` 250 ;
     2. « Correction colorimétrique » native « Wasted · teinte » : saturation −0,85, contraste +0,15, voile rouge sombre
        par `color_multiply` ; désactivée au repos ;
     3. en option, un écho shaderfilter (`previous_output`).
   - Place dans la pile :
     - soit tout en bas de la scène DSK existante « Alerte complète », **sous** le lecteur d'effets ;
     - soit dans un keyer dédié dont le canal est **inférieur** à celui des alertes.
   - Ne jamais mettre « Alerte complète » au programme : le clone s'y rendrait lui-même.
2. **Bannière et sting** : nouvelle animation « wasted » dans le **lecteur d'effets existant**. Pas de nouvelle source
   navigateur (R11).
3. **Déclenchement** : un lot obs-websocket `RequestBatch` avec `executionType` = `SerialFrame`.
   - Ce mode exécute les requêtes « in sync with the graphics thread », avec des pauses `Sleep` en **images** (DOC).
   - Le code montre qu'il passe par une fonction appelée à chaque tick d'OBS (`obs_add_tick_callback`) et qu'il garde la
     session en mémoire (CODE `RequestBatchHandler.cpp`).
   - **À tester** : le lot doit continuer si Studio se coupe en cours de route.
   - Mettre `haltOnFailure` à `false`, pour que le nettoyage s'exécute toujours.

   ```jsonc
   // RequestBatch (op 8), executionType 1 = SerialFrame — timings du scénario « standard »
   [
     {
       "requestType": "SetSourceFilterEnabled",
       "requestData": {
         "sourceName": "Wasted · direct",
         "filterName": "Wasted · ralenti",
         "filterEnabled": true,
       },
     },
     {
       "requestType": "SetSceneItemEnabled",
       "requestData": {
         "sceneName": "Wasted · calque",
         "sceneItemId": 1,
         "sceneItemEnabled": true,
       },
     },
     {
       "requestType": "SetSourceFilterEnabled",
       "requestData": {
         "sourceName": "Wasted · direct",
         "filterName": "Wasted · teinte",
         "filterEnabled": true,
       },
     },
     {
       "requestType": "TriggerHotkeyByName",
       "requestData": {
         "hotkeyName": "slow_forward",
         "contextName": "Wasted · direct",
       },
     },
     { "requestType": "Sleep", "requestData": { "sleepFrames": 204 } }, // 0,4 s de rampe + 3,0 s
     {
       "requestType": "TriggerHotkeyByName",
       "requestData": {
         "hotkeyName": "fast_forward",
         "contextName": "Wasted · direct",
       },
     },
     { "requestType": "Sleep", "requestData": { "sleepFrames": 108 } }, // ≈ 1,8 s de rattrapage
     {
       "requestType": "TriggerHotkeyByName",
       "requestData": {
         "hotkeyName": "skip_end",
         "contextName": "Wasted · direct",
       },
     },
     {
       "requestType": "SetSourceFilterEnabled",
       "requestData": {
         "sourceName": "Wasted · direct",
         "filterName": "Wasted · teinte",
         "filterEnabled": false,
       },
     },
     { "requestType": "Sleep", "requestData": { "sleepFrames": 2 } },
     {
       "requestType": "SetSceneItemEnabled",
       "requestData": {
         "sceneName": "Wasted · calque",
         "sceneItemId": 1,
         "sceneItemEnabled": false,
       },
     },
     {
       "requestType": "SetSourceFilterEnabled",
       "requestData": {
         "sourceName": "Wasted · direct",
         "filterName": "Wasted · ralenti",
         "filterEnabled": false,
       },
     },
   ]
   ```

   - Pendant ce temps, Studio lance la bannière et le sting, et prend un verrou de son (jeu coupé ou baissé).
   - Il relâche tout à la fin du lot, ou au plus tard après un délai de garde de 8 s.
   - À t0 et à la fin, le clone affiche exactement l'image du programme (retard 0). Les transitions d'entrée et de
     sortie du calque sont donc **invisibles** (CODE : l'image la plus récente est dessinée quand `time_diff` ≤ 0).

4. **Sécurité dans Studio** :
   - verrou global : un seul Wasted à la fois, file sans chevauchement ;
   - liste des scènes autorisées ;
   - contrôle préalable : filtre présent et de type `dynamic_delay_filter`, raccourci présent, OBS connecté ;
   - **remise à zéro** à chaque (re)connexion, à STOP ALL et au démarrage : `skip_end`, calque masqué, filtres
     désactivés, verrous de son relâchés ;
   - Studio n'écrit **jamais** `duration` (R2) ;
   - raccourci OBS manuel « Retour au direct », sur `skip_end` du clone.
5. **Mode dégradé automatique** : si le filtre est absent, l'OBS refuse, ou la mémoire est jugée insuffisante, on bascule
   sur l'architecture D (arrêt sur image + bannière + sting), toujours disponible.

### 5.2 Cible : plugin natif « Raptoru Time Warp » (à décider après le banc)

- **Forme** : un filtre (A) posé sur le clone. Plus tard, une source (B) sur son propre canal, pour supprimer Source
  Clone et le DSK.
- **Image** :
  - réserve de K = ⌈D max × i/s⌉ + 2 textures, **allouée à l'armement**, conscient de l'espace colorimétrique comme
    `gpu-delay.c` ;
  - option NV12 ou demi-définition ;
  - aucune allocation pendant l'effet ; si une allocation échoue, retour au direct ;
  - fondu optionnel entre deux images voisines, pour un ralenti plus doux.
- **Chronologie interne** :
  - paramètres : `{ralenti %, rampe ms, tenue ms, rattrapage %, rampe ms}`, avec saut au direct garanti en fin d'effet
    et durée maximale imposée ;
  - Studio envoie **une** commande, et l'effet se termine seul même si Studio tombe.
- **Contrôle** :
  - vendor obs-websocket « raptoru-time-warp » : `arm`, `start`, `abort`, `status` ;
  - événements `started`, `ended`, `aborted` ;
  - commandes passées au thread graphique par des atomiques, appliquées dans `video_tick` : pas de course comme R2/R3.
- **Son**, phase 2 : un filtre audio posé sur les sources choisies (jeu, micro), qui partage l'horloge de la chronologie.
  - Lecture du tampon à la vitesse v par rééchantillonnage : le son descend, comme au replay.
  - Coupure avec fondu pendant le rattrapage.
- **Construction** :
  - modèle `obs-plugintemplate` (GPL-2.0), compilé par GitHub Actions Windows : aucun compilateur sur le PC ;
  - installé dans le **nouvel** emplacement de plugins d'OBS 33. L'installation est faite par Antoni.
- **Licence** :
  - le plugin est lié à libobs, donc soumis à GPL v2 ou ultérieure ;
  - la politique du forum OBS l'écrit : « Any proper plugin that links with OBS Studio is subject to the GPL v2.0+ »
    (DOC, forum) ;
  - source publiée dans le dépôt (déjà public), dans un dossier avec son propre `LICENSE` ;
  - Studio reste un programme séparé qui parle par WebSocket : il n'est pas lié à OBS (INF, pas un avis juridique) ;
  - Dynamic Delay (GPL-2.0) ou `gpu-delay.c` (GPL-2.0+) peuvent servir de base, en gardant leur licence.
- **Effort estimé** (INF) : 3 à 6 jours pour le filtre vidéo, le vendor et la CI ; 3 à 5 jours pour le son ; plus le banc
  et l'endurance.
- **Tension avec Chaos V2** : « le moins de plugins OBS tiers possible »
  ([ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md) § 1). Le prototype n'ajoute aucun plugin. La cible remplace
  trois plugins tiers par un seul plugin maison, à recompiler à chaque version majeure d'OBS.

## 6. Chemin vers un prototype fiable, et GO nécessaires

| Étape                           | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | GO d'Antoni                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 0. Diagnostic de l'ancien effet | lecture seule : la scène « Slow Mo FAIL » (plugin, source, `duration`, définition) dans la collection active, et les journaux et rapports de plantage OBS de l'époque SAMMI                                                                                                                                                                                                                                                                                                                                                      | **oui** (la collection contient des URL avec clés : la lire sans jamais rien en recopier)                           |
| 1. Banc isolé                   | OBS 33.0.x **portable** (archive zip dans un dossier utilisateur, fichier `portable_mode.txt` ou option `--portable`, DOC KB), WebSocket sur un autre port (4456), configuration séparée ; scène de test en 1080p60 avec une vidéo 1440p60 en boucle comme « jeu », une cam et des overlays ; calque du § 5.1. Mesures : VRAM (référence, pic, retour), `GetStats`, saut de couleur à l'entrée et à la sortie du calque, cadence à 33 et 50 %, changement de scène pendant l'effet, Studio coupé au milieu du lot, filtre absent | **oui** : installation du portable (par Antoni) ; jamais pendant un stream ; pas de test visible pendant qu'il joue |
| 2. Module Studio (Lab)          | action typée « wasted », contrôle préalable, lot `SerialFrame`, remise à zéro, STOP ALL, verrous de son, mode dégradé D ; éditeur de bannière avec aperçu direct ; simulateur OBS pour les tests (règle du Lab : sans OBS ni Twitch)                                                                                                                                                                                                                                                                                             | non (développement local)                                                                                           |
| 3. Endurance                    | 3 à 4 h sur l'OBS portable avec un jeu lancé, critères de Q8                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **oui** : créneau, charge GPU pendant un jeu                                                                        |
| 4. Décision                     | Dynamic Delay tient → mise en production (sauvegarde intégrale d'OBS d'abord, [OBS_ENVIRONNEMENT.md](../OBS_ENVIRONNEMENT.md) § 5). Sinon, plugin natif (§ 5.2) puis retour à l'étape 1                                                                                                                                                                                                                                                                                                                                          | **oui** : toute modification de l'OBS de production ou de ses plugins                                               |
| 5. Twitch                       | la récompense « Wasted » existe sur Twitch, désactivée et classée « rien à recréer » ([RECOMPENSES_TWITCH.md](../RECOMPENSES_TWITCH.md) § B) : à reclasser si Antoni veut l'effet. Chaîne existante : Points de chaîne → Core → exécuteur d'effets de Studio, avec règlement des effets (`effectReport` / `settleEffects`, [EFFECTS_PLAYER.md](../EFFECTS_PLAYER.md)). Prix, délai de recharge, scènes autorisées                                                                                                                | **oui** : écriture d'une vraie récompense                                                                           |

Les mises à jour éventuelles (Replay Source 1.8.2, Source Clone 0.2.3, Freeze Filter 0.3.5) ne sont **pas nécessaires**
au prototype. Chacune demanderait un GO et une sauvegarde.

## 7. Direction artistique (aucun élément propriétaire de GTA)

**Chronologie par défaut** (scénario « standard », tout réglable)

| t             | Image                                                                                              | Son                                          |
| ------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0             | ralenti sur 0,4 s vers 33 % ; désaturation et voile sombre ; zoom lent de 100 à 104 % (option)     | jeu baissé en 150 ms ; impact grave du sting |
| 0,6 s         | bannière : échelle 1,25 → 1,0 et opacité 0 → 1 en 280 ms (sortie douce), une seule secousse légère | « coup » du titre                            |
| 0,6 à 3,2 s   | tenue ; écho de mouvement léger (option)                                                           | traîne du sting                              |
| 3,4 s         | sortie de la bannière (300 ms) ; rattrapage à 250 % ; la couleur revient                           | « rembobinage » ou souffle accéléré (option) |
| environ 5,1 s | retour au direct, calque masqué                                                                    | jeu rétabli en 300 ms                        |

**Bannière (réglable dans Studio)**

- **Texte** : « WASTED » par défaut, ou « ÉLIMINÉ », « K.O. », « RIP », « GG », ou un texte propre à la récompense.
  Sous-titre optionnel « offert par {viewer} ».
- **Couleurs** :
  - texte rouge profond (vers `#C8102E`) avec ombre portée sombre ;
  - bande horizontale noire à 55 % sur toute la largeur ;
  - palette et police issues de l'**identité du stream**, pas un pastiche de GTA.
- **Préférences d'Antoni** : il refuse les consoles et les tableaux de bord, il préfère l'identité réelle du stream et la
  manipulation directe. Le réglage se fait donc sur un **aperçu en direct**, pas dans un formulaire.
- **Transitions** : entrée en échelle et opacité, ou en glissement, au choix ; durées et courbes réglables.
- **Accessibilité** :
  - aucun clignotement au-delà de 3 par seconde (WCAG 2.3.1) ;
  - texte d'au moins 8 % de la hauteur, lisible sur mobile ;
  - hors des zones de l'interface du lecteur Twitch.
- **Son** : sting original (impact grave, souffle, « arrêt de bande »), créé ou libre de droits. Volume aligné sur les
  alertes (volume global du lecteur d'effets). Le sting est optionnel.

**Interdits** : la police Pricedown ou ses imitations, les sons et logos de Rockstar, la copie de l'écran de mort de GTA.

## 8. Ce qui reste à vérifier (questions ouvertes)

1. Plugin et réglages de « Slow Mo FAIL », et cause réelle des anciens plantages (étape 0).
2. Le lot `SerialFrame` se termine-t-il si Studio se coupe ? (le code le laisse penser ; à tester).
3. Délai réel d'exécution d'un raccourci déclenché par WebSocket.
4. Saut de couleur à l'entrée ou à la sortie du calque (R9).
5. VRAM libre pendant les jeux habituels d'Antoni, pour fixer `duration` et la vitesse.
6. Réglages hors mandat, non lus : le Replay Buffer démarre-t-il avec le stream, et quel est le débit vidéo réel ?
7. Ordre des canaux du DSK : la bannière doit rester au-dessus du clone.

## 9. Recouvrement avec l'étude replay

- **L'architecture C est la chaîne de [ETUDE_OBS_REPLAY.md](ETUDE_OBS_REPLAY.md)** : `SaveReplayBuffer` →
  `ReplayBufferSaved` → source média → `SetMediaInputCursor` → scène imbriquée.
  - Le « Wasted replay » n'y ajoute que `speed_percent` = 50, la bannière et la règle de son.
  - Il faut **une** infrastructure partagée, avec un seul réglage de durée du Replay Buffer pour les deux usages.
- **Le « Wasted live »** (ralenti et rattrapage) **ne dépend pas** du Replay Buffer.
- Les deux effets prennent le même **verrou global** : pas de Wasted pendant un replay, et inversement.
- **Précision pour l'étude replay** : son § 0.3 regroupe Replay Source et Dynamic Delay sous « la copie GPU → RAM tourne
  en permanence ». C'est vrai pour le filtre de Replay Source (CODE `replay-filter.c` : `gs_stage_texture`). C'est faux
  pour Dynamic Delay :
  - il garde des **textures GPU** sans relecture (CODE) ;
  - il ne tourne que si le filtre est activé et sa source affichée.

## 10. Sources (consultées le 24/11/2026)

**Code lu**

- Dynamic Delay 0.1.4 (GPL-2.0) : [dépôt](https://github.com/exeldro/obs-dynamic-delay), dont
  [`dynamic-delay.c`](https://github.com/exeldro/obs-dynamic-delay/blob/master/dynamic-delay.c) et
  [`dynamic-delay.h`](https://github.com/exeldro/obs-dynamic-delay/blob/master/dynamic-delay.h). Dernier commit de code
  le 29/11/2022 ; 8 issues ouvertes, dont [#2](https://github.com/exeldro/obs-dynamic-delay/issues/2) (mémoire et réponse
  de l'auteur) et [#5](https://github.com/exeldro/obs-dynamic-delay/issues/5) (pas d'enregistrement quand la source est
  invisible).
- Replay Source 1.8.2 (GPL-2.0) : [dépôt](https://github.com/exeldro/obs-replay-source), fichiers `replay-filter.c`,
  `replay-source.c` et `replay.h`. [Notes de version](https://github.com/exeldro/obs-replay-source/releases).
- Freeze Filter 0.3.5 (GPL-2.0) : [dépôt](https://github.com/exeldro/obs-freeze-filter),
  [PR #11 « Fix coloring on SRGB sources »](https://github.com/exeldro/obs-freeze-filter/pull/11).
- Source Clone 0.2.3 (GPL-2.0) : [dépôt](https://github.com/exeldro/obs-source-clone), `source-clone.c` au master et au
  tag 0.1.5. [Notes de version](https://github.com/exeldro/obs-source-clone/releases).
- Downstream Keyer 0.4.5 (GPL-2.0) : [dépôt](https://github.com/exeldro/obs-downstream-keyer),
  `downstream-keyer-dock.cpp` (canaux de sortie, requêtes vendor).
- obs-shaderfilter 2.6.1 (GPL-2.0) : [dépôt](https://github.com/exeldro/obs-shaderfilter), `previous_image` et
  `previous_output` vérifiés au tag 2.6.1.
- Move 3.2.2 : [dépôt](https://github.com/exeldro/obs-move-transition). Source Record 0.5.0 :
  [dépôt](https://github.com/exeldro/obs-source-record) (non lus en détail).
- OBS Studio (GPL v2 ou ultérieure, [README](https://github.com/obsproject/obs-studio)) :
  - [`gpu-delay.c`](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/gpu-delay.c) (0 à 500 ms) ;
  - [`async-delay-filter.c`](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/async-delay-filter.c)
    (0 à 20 000 ms) ;
  - [`color-correction-filter.c`](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/color-correction-filter.c) ;
  - [`obs-ffmpeg-source.c`](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-ffmpeg/obs-ffmpeg-source.c)
    (`speed_percent` de 1 à 200, redémarrage) ;
  - [`media.c`](https://github.com/obsproject/obs-studio/blob/master/shared/media-playback/media-playback/media.c)
    (`samples_per_sec × speed`).
- obs-websocket 5.x :
  - [`protocol.md`](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md) : `TriggerHotkeyByName`,
    `RequestBatch` / `SerialFrame` / `Sleep`, `SetSourceFilterEnabled`, `SaveReplayBuffer`, `ReplayBufferSaved`,
    `SetMediaInputCursor`, `TriggerMediaInputAction` ;
  - [`Obs_SearchHelper.cpp`](https://github.com/obsproject/obs-websocket/blob/master/src/utils/Obs_SearchHelper.cpp)
    (`contextName`) ;
  - [`RequestHandler_General.cpp`](https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestHandler_General.cpp) ;
  - [`RequestBatchHandler.cpp`](https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestBatchHandler.cpp) ;
  - [`obs-websocket-api.h`](https://github.com/obsproject/obs-websocket/blob/master/lib/obs-websocket-api.h) ;
  - `contextName` présent dans `protocol.md` à partir du tag 5.4.0.

**Documentation officielle**

- [Sources API](https://docs.obsproject.com/reference-sources) : `OBS_SOURCE_VIDEO`, `OBS_SOURCE_ASYNC_VIDEO`,
  `filter_audio`, `filter_video`.
- [Backend Design](https://docs.obsproject.com/backend-design) : threads, pipeline image et son.
- [Graphics API](https://docs.obsproject.com/reference-libobs-graphics-graphics) : `gs_stage_texture`, « best to give
  this a frame to process to prevent stalling ».
- Notes de version d'OBS [33.0.0](https://github.com/obsproject/obs-studio/releases/tag/33.0.0) (chargement des plugins,
  `gs_image_file`, signal de sauvegarde du Replay Buffer), [33.0.1](https://github.com/obsproject/obs-studio/releases/tag/33.0.1),
  [33.0.2](https://github.com/obsproject/obs-studio/releases/tag/33.0.2), [33.0.3](https://github.com/obsproject/obs-studio/releases/tag/33.0.3).
- KB : [Legacy plugin locations](https://obsproject.com/kb/legacy-plugin-locations),
  [Portable mode](https://obsproject.com/kb/portable-mode).
- [Forum Resource and IP Policy](https://obsproject.com/forum/threads/forum-resource-and-ip-policy.178569/) (GPL des
  plugins). [obs-plugintemplate](https://github.com/obsproject/obs-plugintemplate) (GPL-2.0).

**Témoignages**

- Dynamic Delay : [ressource](https://obsproject.com/forum/resources/dynamic-delay.1035/) (0.1.4, « requires OBS 28 or
  higher ») et [avis](https://obsproject.com/forum/resources/dynamic-delay.1035/reviews) :
  - son non retardé ;
  - 4,5 Go pour 5 s ;
  - plantages au-delà de 10 s.
- [Fil Dynamic Delay](https://obsproject.com/forum/threads/dynamic-delay.126068/latest) : RTX 3070 à 99 % de GPU, gel au
  démarrage sous OBS 29.0.2.
- [« Frames missed due to rendering lag »](https://obsproject.com/forum/threads/frames-missed-due-to-rendering-lag.142314/) :
  cause attribuée à Dynamic Delay.
- [« Ralentis en étant en live »](https://obsproject.com/forum/threads/ralentis-en-%C3%A9tant-en-live.160070/).
- Replay Source : [ressource et avis](https://obsproject.com/forum/resources/replay-source.686/) :
  - plantages sous OBS 31 et 32 ;
  - mémoire de 15 à 17 Go ;
  - l'auteur renvoie vers Source Record ou le « backtrack » d'Aitum pour de l'encodé.

**Relevés locaux** (lecture seule, 24/11)

- Versions des fichiers `obs64.exe` et des DLL de `obs-plugins\64bit`, dossiers `core\` et `C:\ProgramData\obs-studio\plugins`.
- `basic.ini` des deux profils : sections `[Output]`, `[SimpleOutput]`, `[AdvOut]` et `[Video]` seulement. Aucune clé ni
  URL de service lue.
- GPU, VRAM, RAM et processeur.
- Documents du projet : [OBS_ENVIRONNEMENT.md](../OBS_ENVIRONNEMENT.md), [EFFECTS_PLAYER.md](../EFFECTS_PLAYER.md),
  [ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md), [apps/chaos-engine/README.md](../../apps/chaos-engine/README.md).
- Code Studio : `apps/studio/server/src/bonk-lab/obs.ts`, `channel-points/obs-actions.ts`, `channel-points/mute-holds.ts`.
