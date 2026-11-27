# Replay instantané dans OBS : étude de faisabilité (24/11/2026)

Demande : un moment drôle arrive, Antoni appuie sur un bouton de Raptoru Studio, une courte transition passe, les
dernières secondes (3 s, 5 s, 10 s ou durée libre) sont rejouées à l'écran avec un indicateur « Replay », puis le stream
revient proprement au direct. Plus tard, les viewers pourraient le déclencher. La sécurité passe avant tout : l'ancien
système SAMMI faisait planter OBS, une solution moins ambitieuse mais fiable est préférée.

Recherche seulement. Rien n'est construit, aucun commit. OBS n'a été ni lancé, ni connecté (aucune connexion
obs-websocket), ni modifié. Relevés locaux en lecture seule : version d'`obs64.exe`, noms et versions des plugins, clés
`[Output]`, `[SimpleOutput]`, `[AdvOut]` et `[Video]` des `basic.ini` (les lignes contenant un chemin, une URL ou une
clé ont été filtrées). `service.json`, `streamEncoder.json` et la collection de scènes n'ont pas été ouverts.

Niveaux de preuve (ceux du dossier, voir [AUDIT_CHAOS_V1.md](AUDIT_CHAOS_V1.md)) : **PROUVÉ** (relevé sur le PC ou dans
le dépôt), **DOC** (code source ou documentation officielle lus), **EXTERNE** (forum, issue, avis), **HYPOTHÈSE**
(raisonnement ou estimation à mesurer), **INCONNU**. Quand le code a été lu par extraits plutôt qu'en entier, c'est
précisé (« DOC, lecture partielle »).

## 0. Verdict

1. **Faisable proprement avec ce qu'OBS sait déjà faire.** La chaîne recommandée est la suivante :
   - le Replay Buffer d'OBS garde en mémoire les dernières secondes déjà encodées ;
   - Studio demande `SaveReplayBuffer` et attend l'événement `ReplayBufferSaved` (chemin du fichier) ;
   - Studio charge ce fichier dans **une** source média et va au début des N dernières secondes ;
   - Studio affiche une **scène imbriquée** « Raptoru · Replay » (vidéo + bannière) posée dans la scène de jeu, avec la
     transition d'apparition d'OBS ;
   - à la fin du fichier, Studio masque cette scène et le direct revient.
2. **Délai bouton → première image du replay : environ 0,5 à 1 s** (HYPOTHÈSE à mesurer).
   - Le seul chiffre trouvé est EXTERNE : 0,39 s entre l'appui et l'écriture du fichier dans un cas normal.
   - Pendant ce temps, les viewers voient le direct normal. Rien n'apparaît tant que le replay n'est pas prêt.
   - Des cas aberrants de 15 s à 3 min existent (cause non élucidée, antivirus soupçonné). Studio abandonne donc sans
     rien afficher au bout de 3 s.
3. **Un replay « sans fichier » n'est possible qu'avec un plugin qui stocke des images brutes** (Replay Source,
   Dynamic Delay). Ce n'est pas recommandé :
   - 5 s en 1080p60 coûtent environ 2,5 Go, contre environ 4 Mo encodés ;
   - Replay Source copie les images GPU → RAM en permanence, pendant tout le stream ; Dynamic Delay garde des
     textures GPU (VRAM), seulement tant que son filtre est actif et visible (correction après relecture de son code,
     voir ETUDE_OBS_WASTED.md) ;
   - des plantages sont signalés sur OBS 31 et 32 ;
   - **la version installée sur le PC (Replay Source 1.8.0) est antérieure aux deux correctifs de plantage**.
4. **Ne pas construire de 2ᵉ architecture.** OBS donne un résultat propre avec des fonctions standard, sans code natif
   dans OBS, ce qui est la leçon de SAMMI. Le seul vrai manque est un replay en moins de 100 ms, qui n'est pas
   nécessaire ici.
5. **Retour au direct garanti à plusieurs niveaux :**
   - fin du média ;
   - minuteur de Studio ;
   - retour persistant déjà utilisé par les Points de chaîne, qui survit à un redémarrage de Studio ;
   - la source média s'efface d'elle-même à la fin ;
   - raccourci manuel d'OBS.

## 1. L'existant (relevé local, lecture seule)

### 1.1 OBS et réglages de sortie (PROUVÉ, sauf mention)

| Élément                | Valeur relevée                                                                                             | Conséquence pour le replay                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OBS                    | `obs64.exe` 33.0.1 ; obs-websocket livré dans `core\obs-websocket\`                                        | API v5 complète pour le Replay Buffer et les médias                                                                                                                 |
| Profil `Profil_Twitch` | sortie **Avancée**, `RecRB=true`, `RecRBTime=20`, `RecRBSize=512`                                          | le Replay Buffer est **déjà configuré** : 20 s, plafond 512 Mo                                                                                                      |
| Encodeur               | `Encoder=obs_nvenc_h264_tex`, `RecEncoder=none`                                                            | le tampon **réutilise l'encodeur du stream** (NVENC H.264) : aucun encodage en plus (DOC/HYPOTHÈSE forte)                                                           |
| Format                 | `RecFormat2=mkv`                                                                                           | fichiers de replay en MKV (HYPOTHÈSE forte : le tampon suit le format d'enregistrement)                                                                             |
| Pistes audio           | `RecTracks=32`, soit le masque binaire de la **piste 6 seule** ; `VodTrackIndex=6`, `VodTrackEnabled=true` | le replay ne contiendra **que le mixage de la piste 6** (piste VOD, souvent sans musique). **À vérifier par Antoni** : le micro et le jeu sont-ils sur la piste 6 ? |
| Vidéo                  | base et sortie en 1920×1080, 60 i/s (`FPSCommon=60`)                                                       | le replay est en **1080p60**. La capture 2560×1440 est réduite dans le canevas.                                                                                     |
| Service                | `ApplyServiceSettings=true` ; règles Twitch d'OBS : `keyint: 2`, `max video bitrate: 6000` (DOC)           | une image clé toutes les **2 s**, au plus 6 Mbit/s : environ **0,77 Mo/s** encodés                                                                                  |
| Autre profil           | `Profil_partage_discord` : sortie Simple, Replay Buffer coupé                                              | sans objet                                                                                                                                                          |

**Non vérifié** (hors périmètre autorisé) :

- le démarrage automatique du tampon avec le stream (réglage hors `basic.ini`) ;
- le débit et l'intervalle d'images clés réels (`streamEncoder.json`) ;
- le dossier des replays ;
- le contenu de la piste 6 ;
- l'utilisation de Replay Source dans une scène.

Studio pourra lire l'état du tampon sans rien changer (`GetReplayBufferStatus`).

### 1.2 Plugins tiers installés (PROUVÉ)

Tous les plugins tiers sont dans `C:\Program Files\obs-studio\obs-plugins\64bit`. Les notes d'OBS 33.0 (DOC) disent
que les plugins tiers **continueront de charger depuis ces emplacements historiques jusqu'à OBS 34.0**.

| Plugin                          | Version installée (date du fichier)  | Intérêt pour le replay                                                                                                                                                           |
| ------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replay-source` (Exeldro)       | **1.8.0** (03/08/2024)               | replay en mémoire brute. **Dernière version 1.8.2 (02/11/2026)** : 1.8.1 « Fix crash with OBS 31 », 1.8.2 « Fix crash with internal frames for OBS 32+ » (DOC, notes de version) |
| `dynamic-delay` (Exeldro)       | 0.1.4 (29/11/2022, dernière version) | retard, ralenti et rattrapage du direct, vidéo seule, en mémoire GPU                                                                                                             |
| `source-clone`                  | 0.1.5                                | sans objet                                                                                                                                                                       |
| `freeze-filter`                 | 0.3.3                                | sans objet                                                                                                                                                                       |
| `move-transition`               | 3.2.1                                | transitions animées possibles pour l'apparition                                                                                                                                  |
| `downstream-keyer`              | 0.4.1                                | variante : un calque au-dessus de toutes les scènes                                                                                                                              |
| `transition-table`              | 0.2.7                                | sans objet                                                                                                                                                                       |
| un plugin hérité de l'ère SAMMI | 2022                                 | à vérifier par Antoni (détail dans le rapport de livraison, hors dépôt public)                                                                                                   |

Plugins bundlés d'OBS 33 (dans `core\`) : `obs-ffmpeg` (Replay Buffer et source média), `vlc-video`, `obs-websocket`,
`frontend-tools`. **Aucun script Lua « instant replay » n'est livré avec 33.0.1** (PROUVÉ : `frontend-tools\scripts` ne
contient que `clock-source`). Historiquement, OBS livrait `instant-replay.lua`, signé « Lain and Exeldro ».

### 1.3 Comment Studio parle déjà à OBS (PROUVÉ, code de `feat/chaos-studio`)

- **Une seule connexion** obs-websocket v5, client minimal maison :
  - fichier `apps/studio/server/src/bonk-lab/obs.ts` (`LabObs`) ;
  - reconnexion à 1, 2, 5 puis 10 s ;
  - **délai de 3 s par requête** (`obs_request_timeout`) ;
  - le mot de passe reste en mémoire seulement.
- **Liste fermée d'actions** dans `apps/studio/server/src/channel-points/obs-actions.ts` (`ObsActions`) :
  - visibilité d'une source de scène, activation d'un filtre, scène programme ;
  - redémarrage d'un média (`TriggerMediaInputAction` RESTART), capture d'écran en mémoire ;
  - muet partagé : `MuteHolds`, commun avec Votekick et Random Ban.
- **Retours temporaires persistants.** Un « revert » n'est appliqué que si l'élément est **toujours** dans l'état posé
  par l'action. Il est retenté toutes les 250 ms si OBS ne répond pas. Il est enregistré sur disque et rejoué après un
  redémarrage de Studio, puis abandonné au bout d'une heure. Une scène temporaire ne revient que si le programme est
  toujours dessus.
- **Abonnements aux événements** (`AUTO_EVENTS`) : Config, Scenes, Inputs, SceneItems, SceneItemTransformChanged.
  **Ni `Outputs` (1 << 6, porte `ReplayBufferSaved`), ni `MediaInputs` (1 << 8, porte `MediaInputPlaybackStarted` et
  `MediaInputPlaybackEnded`).** Il faudra les ajouter : faible volume d'événements.
- Simulateur d'OBS pour les tests (`votekick/sim-obs.ts`) : même principe à reprendre pour le Lab.

**Conséquence.** L'architecture recommandée n'ajoute que des requêtes du même type que celles déjà utilisées, plus
`SaveReplayBuffer`, `SetInputSettings` sur **une** source dédiée et `SetMediaInputCursor`. Studio ne touche à **aucun**
contrôle de stream ni d'enregistrement, et ne démarre pas le tampon lui-même.

## 2. Les briques, telles qu'elles fonctionnent vraiment

### 2.1 Replay Buffer d'OBS (DOC : `plugins/obs-ffmpeg/obs-ffmpeg-mux.c`)

- **Stockage.** Les paquets **déjà encodés** (vidéo et audio) sont gardés en RAM dans une file (`deque`), avec un
  compteur d'images clés. Aucune image brute n'est conservée.
- **Purge.**
  - Par taille (`max_size_mb`) et par durée (`max_time_sec`, calculée sur le DTS).
  - Elle enlève toujours jusqu'à la prochaine image clé, et **jamais en dessous de 2 images clés**.
  - Le fichier fait donc de `max_time` à `max_time` + 1 GOP : ici **20 à 22 s**.
- **Sauvegarde, en deux temps et asynchrone.**
  - `save` note l'heure demandée (`save_ts`).
  - Dès qu'un paquet **postérieur** à cette heure arrive, le tampon entier est copié, puis un **fil séparé lance le
    processus `obs-ffmpeg-mux`** et lui envoie les paquets par un tube.
  - Le signal `saved` part à la fin de l'écriture.
  - Pendant l'écriture (`muxing`), une nouvelle demande attend la fin de la précédente. **Les sauvegardes sont donc
    sérialisées.**
  - `get_last_replay` ne rend le chemin que lorsque l'écriture est finie.
- **Pas de « N dernières secondes ».** Il n'existe aucun paramètre pour sauver une fenêtre plus courte : on sauve
  toujours tout le tampon.
- **Contenu.** C'est la **sortie programme** : overlays, alertes et chat compris, sur les pistes audio d'enregistrement.
- **obs-websocket** (DOC : `protocol.md` et `RequestHandler_Outputs.cpp`).
  - `SaveReplayBuffer` répond **tout de suite** : le fichier n'existe pas encore. Erreur `OutputNotRunning` si le
    tampon n'est pas démarré.
  - `ReplayBufferSaved { savedReplayPath }` (abonnement `Outputs`) signale le fichier prêt.
  - `GetLastReplayBufferReplay` relit le dernier chemin.
  - OBS 33.0 ajoute un signal `saving` (« Added frontend event and output signal for replay buffer saving »). Il n'est
    pas exposé par obs-websocket d'après le protocole lu.
- **Mesures publiques** (EXTERNE, forum OBS, OBS 30.2.3).
  - Entre l'appui sur le raccourci et la ligne « Wrote replay buffer » : **0,39 s** dans un cas normal.
  - Le même utilisateur a eu des écarts de 14 s, 20 s, 2 min et jusqu'à 3 min. Ils n'ont pas été expliqués :
    antivirus soupçonné, puis disparus après réinstallation d'OBS.
  - **Conséquence : délai d'abandon obligatoire.**
- **Noms de fichiers.** Avant OBS 31, deux replays sauvés dans la même seconde pouvaient s'écraser (EXTERNE). Le format
  local se termine par les secondes (`%hh-%mm-%ss`). Studio ne déclenchera jamais deux sauvegardes à moins d'une seconde
  d'écart (§ 6.6).

### 2.2 Source média `ffmpeg_source` (DOC : `obs-ffmpeg-source.c`, `media-playback/media.c`, `decode.c`)

**Réglages** (défaut ; bornes) :

- `local_file` ;
- `looping` (non) ;
- `restart_on_activate` (oui) ;
- `close_when_inactive` (non) ;
- `clear_on_media_end` (oui) ;
- `speed_percent` (100 ; **1 à 200**, hors bornes ramené à 100) ;
- `hw_decode` (non) ;
- `seekable` (non) ;
- `buffering_mb` (2).

Aucun réglage d'heure de départ : la lecture commence toujours au début.

- **Mise à jour des réglages.**
  - Un nouveau `local_file`, un changement de `hw_decode` ou de **`speed_percent`** **redémarre le média**. La vitesse
    ne change donc **pas** en cours de lecture.
  - Si la source est inactive et que `restart_on_activate=true`, rien ne joue. Le fichier est seulement ouvert, sauf
    avec `close_when_inactive`.
- **Activation.** Avec `restart_on_activate`, l'apparition dans le programme relance le média depuis le début. La
  disparition l'arrête, et l'efface si `clear_on_media_end`.
- **Fin.** Avec `clear_on_media_end`, la source **s'efface d'elle-même** (`obs_source_output_video(NULL)`) et signale
  la fin, ce qui donne l'événement `MediaInputPlaybackEnded`.
- **Recherche de position** (`SetMediaInputCursor`, sans contrôle de bornes d'après le protocole).
  - Le code saute **en arrière jusqu'à l'image clé** qui précède la cible (`AVSEEK_FLAG_BACKWARD`).
  - Aucune élimination des images antérieures à la cible n'a été trouvée (DOC, lecture partielle).
  - Avec une image clé toutes les 2 s, un replay « 5 s » durerait donc **5 à 7 s**. **À mesurer.**
- **Vitesse.**
  - Le son n'est pas rééchantillonné à hauteur constante : la fréquence annoncée est multipliée par la vitesse.
  - **À 50 %, la voix descend d'une octave** (DOC, lecture partielle ; à écouter).
- **Décodage matériel.** Ordre d'essai CUDA, D3D11VA, DXVA2… ; retour silencieux au décodage logiciel si l'appareil ne
  s'ouvre pas.

### 2.3 Scènes imbriquées et transitions d'affichage (DOC)

- Depuis OBS 27, chaque élément de scène peut avoir une **transition d'apparition et de disparition** : fondu, glissé,
  stinger… (contribution d'Exeldro, notes de version d'OBS 27).
- Masquer ou afficher une **scène imbriquée** dans la scène de jeu garde la scène de jeu au programme. Les sources
  navigateur (alertes, TTS, Bonk, chatbox) **ne sont ni coupées ni rechargées**, et le micro et le jeu continuent.
- Changer de scène programme, au contraire, désactive tout ce qui n'est pas dans la nouvelle scène : risque de
  rechargement des pages, de coupure d'un TTS, et les chatbox réglées « arrêt si masquée » depuis l'incident du 22/11.

### 2.4 Solutions existantes : état, compatibilité, fiabilité

| Solution                                                                                                                  | Principe vérifié                                                                                                                                                                              | Mémoire                                                                                                                           | Audio                                                                                                   | Délai                                          | Maintenance et compatibilité OBS 33                                                                                                                                                        | Licence          |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| **Replay Buffer + source média** (natif)                                                                                  | paquets encodés en RAM, fichier à chaque sauvegarde (DOC)                                                                                                                                     | ≈ 16 Mo pour 20 s à 6 Mbit/s                                                                                                      | oui, pistes d'enregistrement (ici piste 6)                                                              | ≈ 0,4 s d'écriture (EXTERNE) + chargement      | cœur d'OBS, maintenu, déjà configuré                                                                                                                                                       | GPL-2.0-or-later |
| **Replay Source** (Exeldro)                                                                                               | filtre : rendu GPU → surface de transfert → **RAM en BGRA, 4 octets par pixel**, une allocation par image ; la source rejoue de la RAM, à vitesse variable, en arrière, image par image (DOC) | **énorme** : § 3 ; avis de 15 Go pour 15 s, 17 Go pour 10 s, « 32 Go pas assez » (EXTERNE)                                        | filtre « async » seulement (vidéo + son) ; **pas de son en lecture arrière** (`//TODO audio backwards`) | ~1 image (HYPOTHÈSE)                           | 1.8.2 du 02/11/2026 ; plantages OBS 31 et 32 corrigés **après** la 1.8.0 installée ; issues ouvertes : #69 capture de jeu vide sur OBS 31.0.2, #74 plantage sur macOS ; 49 issues ouvertes | GPL-2.0          |
| **Dynamic Delay** (Exeldro)                                                                                               | filtre qui retarde une source ; images gardées en **textures GPU RGBA** ; ralenti, avance rapide, rattrapage avec lissage (DOC)                                                               | VRAM : environ 2,5 Go pour 5 s en 1080p60, 4,4 Go en 1440p (calcul) ; avis : 4,5 Go pour 5 s, plantages au-delà de 10 s (EXTERNE) | **aucun** (vidéo seule, DOC + avis)                                                                     | immédiat                                       | 0.1.4 de 2022, plus mis à jour                                                                                                                                                             | GPL-2.0          |
| **Source Record** (Exeldro)                                                                                               | filtre avec **son propre encodeur** et sa propre vue de rendu, sortie `replay_buffer` par source, fichier à la sauvegarde, événement vendor `replay_buffer_saved` (DOC)                       | encodé, faible                                                                                                                    | oui (crépitements signalés)                                                                             | comme le natif                                 | 0.5.0 (« save replay hotkey for OBS 33 ») ; **non installé** ; un encodage NVENC de plus en permanence                                                                                     | GPL-2.0          |
| **Aitum Stream Suite, Backtrack**                                                                                         | « fonctionne comme le Replay Buffer », compte comme une session d'encodage (EXTERNE, non vérifié à la source)                                                                                 | encodé                                                                                                                            | oui                                                                                                     | comme le natif                                 | non installé, produit tiers                                                                                                                                                                | INCONNU          |
| **Scripts Lua « Instant Replay »** (version historique OBS de Lain et Exeldro ; fork tomaae 2019 ; `obs_reactive_replay`) | `save`, puis **interrogation toutes les 1 à 2 s** de `get_last_replay`, puis `local_file` mis à jour ; affichage par visibilité d'éléments et fin par minuteur (DOC)                          | encodé                                                                                                                            | oui                                                                                                     | **1 à 2 s de plus** à cause de l'interrogation | scripts anciens (tomaae : 2019, GPL-3.0) ; le script officiel n'est plus livré                                                                                                             | variable         |

**Lecture.** Les plugins « instantanés » existent et sont maintenus par un auteur sérieux, mais :

- ils paient l'instantané en RAM ou VRAM et en bande passante, **en permanence** ;
- leurs avis récents parlent de plantages sur les OBS récents ;
- la copie installée de Replay Source n'a pas les correctifs.

Le schéma natif, sauvegarde puis média, est celui des scripts de référence. Avec les événements d'obs-websocket v5, on
supprime leur seul défaut, l'interrogation lente.

## 3. Garder 5 s en mémoire : brut ou encodé (calcul, 60 i/s)

| Stockage                                                      | Par image | Par seconde | 3 s     | 5 s         | 10 s    |
| ------------------------------------------------------------- | --------- | ----------- | ------- | ----------- | ------- |
| Brut BGRA 1080p (Replay Source, Dynamic Delay en RGBA)        | 8,29 Mo   | 498 Mo      | 1,49 Go | **2,49 Go** | 4,98 Go |
| Brut BGRA 1440p (filtre posé sur la capture 2560×1440)        | 14,75 Mo  | 885 Mo      | 2,65 Go | **4,42 Go** | 8,85 Go |
| Brut NV12 1080p (1,5 octet par pixel)                         | 3,11 Mo   | 187 Mo      | 0,56 Go | 0,93 Go     | 1,87 Go |
| Brut NV12 1440p                                               | 5,53 Mo   | 332 Mo      | 1,00 Go | 1,66 Go     | 3,32 Go |
| **Encodé**, 6 Mbit/s vidéo + 160 kbit/s audio (Replay Buffer) | —         | 0,77 Mo     | 2,3 Mo  | **3,9 Mo**  | 7,7 Mo  |

- **Écart : environ 650 fois** (5 s en 1080p). Les avis de Replay Source (15 à 17 Go) correspondent à un filtre posé
  sur une source haute définition, plus une copie chargée pour la lecture.
- **Replay Source** ajoute une lecture GPU → CPU et deux copies mémoire par image : ≈ 1 Go/s en 1080p60, ≈ 1,8 Go/s en
  1440p60 (HYPOTHÈSE déduite du code).
- **Dynamic Delay** prendrait ces Go **dans les 8 Go de la RTX 3070**, que le jeu utilise déjà.
- **Replay Buffer.** Le tampon actuel de 20 s occupe environ 16 Mo et ne coûte aucun encodage de plus, puisqu'il
  partage l'encodeur du stream.

## 4. Les architectures comparées

### 4.1 Architecture A : mécanismes natifs (recommandée)

```
Bouton Studio ──SaveReplayBuffer──▶ OBS : marque l'heure, attend 1 paquet, écrit le MKV (processus obs-ffmpeg-mux)
                ◀─ReplayBufferSaved(chemin)──
              ──SetInputSettings(local_file, speed_percent)──▶ source média « Raptoru · Replay média » (cachée)
              ──SetSceneItemEnabled(scène de jeu, « Raptoru · Replay », vrai)──▶ transition d'apparition
                ◀─MediaInputPlaybackStarted──
              ──SetMediaInputCursor(durée − N s)──▶ lecture des N dernières secondes (+ ≤ 2 s, image clé)
                ◀─MediaInputPlaybackEnded── (ou minuteur de secours)
              ──SetSceneItemEnabled(…, faux)──▶ transition de disparition → direct
```

**Budget de délai, du bouton à l'image** (HYPOTHÈSE sauf mention) :

| Étape                                                                        | Estimation                                                                  | Base                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| Requête `SaveReplayBuffer` en local                                          | < 10 ms                                                                     | WebSocket local                                 |
| Attente du paquet suivant (`save_ts`)                                        | 20 à 70 ms                                                                  | 1 image + latence NVENC (DOC pour le mécanisme) |
| Lancement d'`obs-ffmpeg-mux` + écriture d'environ 16 Mo + fermeture du MKV   | 100 à 400 ms                                                                | **0,39 s mesuré de bout en bout** (EXTERNE)     |
| `ReplayBufferSaved` → Studio                                                 | < 10 ms                                                                     |                                                 |
| `SetInputSettings` + `SetSceneItemEnabled`, ouverture du MKV, première image | 30 à 100 ms                                                                 |                                                 |
| Saut à l'image clé + premières images                                        | 20 à 60 ms                                                                  |                                                 |
| **Total jusqu'à la première image**                                          | **≈ 0,3 à 0,7 s**, plus la transition (0,3 à 0,5 s) : **≈ 0,5 à 1 s** perçu |                                                 |

- **Fiabilité.** Uniquement des fonctions centrales d'OBS, utilisées par des milliers de streamers. Aucun code natif
  ajouté dans OBS. Environ 7 requêtes par replay. Les échecs avant l'apparition sont **invisibles** pour les viewers.
- **Coût.** Rien en permanence. À chaque replay : une courte rafale CPU (processus de mux) et le décodage de 5 à 10 s
  de H.264 1080p60. Écriture d'environ 16 Mo sur disque par replay : 30 replays font environ 0,5 Go.
- **Limites.**
  - Un fichier est écrit à chaque fois.
  - Le départ est calé sur une image clé (+0 à 2 s).
  - La vitesse est fixe pendant un replay.
  - On ne peut pas descendre sous ≈ 0,3 s.

### 4.2 Architecture B : tampon mémoire dédié

- **B1, Replay Source** (déjà installé, en 1.8.0).
  - Fonctionnement : un filtre sur la source à rejouer (scène de jeu ou capture), une source « Replay ».
  - Déclenchement depuis Studio par `TriggerHotkeyByName` (`ReplaySource.Replay`, avec `contextName` = nom de la
    source). obs-websocket qualifie les raccourcis de « provided as-is ».
  - Aucune requête vendor n'a été trouvée (DOC, lecture partielle).
  - **Avantages :** pas de fichier, apparition en environ 1 image, vitesse modifiable en cours de lecture
    (`Faster`, `NormalOrFaster`…), marche arrière, image par image.
  - **Coûts :** 2,5 à 4,4 Go de RAM pour 5 s ; le chargement **vide** le tampon du filtre (DOC, lecture partielle), qui
    doit se remplir à nouveau ; lecture GPU → CPU à chaque image du stream, même sans replay ; plantages signalés sur
    OBS 31 et 32 ; plus de mise à jour automatique avec OBS 34 (emplacement historique).
  - **Pour l'utiliser proprement**, il faudrait installer la 1.8.2, ce qui demande un GO d'installation, puis la tester
    en charge sur OBS 33.
- **B2, Dynamic Delay.** Il fait du « direct retardé » plutôt qu'un replay : vidéo sans son, VRAM, version de 2022.
  C'est le terrain de l'étude parallèle « ralenti + rattrapage / Wasted ». À écarter pour le replay.
- **B3, notre propre plugin ou processus externe.**
  - Un plugin C/C++ dans OBS pourrait garder les paquets encodés et les décoder depuis la mémoire, sans fichier.
  - **Gain : 0,1 à 0,4 s.**
  - **Prix :** du code natif dans le processus d'OBS (le risque même de SAMMI), aucun compilateur sur le PC, une
    compatibilité à suivre à chaque version (OBS 34 change le chargement des plugins), des tests seulement dans un vrai
    OBS.
  - Un processus externe (seconde sortie SRT/UDP vers un tampon, relu par une source média réseau) ajoute un encodage,
    de la latence et des pièces mobiles.
  - Un disque RAM pour les fichiers est inutile : le cache de Windows absorbe déjà 16 Mo, et il faudrait installer un
    outil.
  - **Non justifié.**

### 4.3 Comparaison

| Critère                                | A (natif)                        | B1 (Replay Source)                                            | B3 (maison)                 |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------- | --------------------------- |
| Risque de planter OBS                  | **faible** : fonctions centrales | moyen à élevé : historique, version installée sans correctifs | élevé : code natif nouveau  |
| Mémoire en permanence                  | ≈ 16 Mo                          | 2,5 à 4,4 Go pour 5 s                                         | faible                      |
| GPU et CPU en permanence               | aucun en plus                    | lecture GPU → CPU et copies à chaque image                    | faible                      |
| Délai jusqu'à l'image                  | ≈ 0,3 à 0,7 s (+ transition)     | ≈ 1 image                                                     | ≈ 0,1 s                     |
| Fichier par replay                     | oui (≈ 16 Mo)                    | non                                                           | non                         |
| Son                                    | oui (piste 6)                    | oui (async), pas en arrière                                   | à construire                |
| Vitesse modifiable en cours de lecture | non (redémarrage)                | oui                                                           | à construire                |
| Testable dans le Lab sans OBS          | oui : simulateur d'événements    | partiel                                                       | non                         |
| Installation nécessaire                | **aucune**                       | mise à jour en 1.8.2                                          | compilation et installation |

**Verdict : A.** B1 reste une piste d'étude séparée, et seulement si Antoni veut un jour du replay image par image à
vitesse variable, sur un profil de test, après mise à jour.

## 5. Réponses aux questions obligatoires

1. **Rejouer sans écrire de fichier à chaque fois ?**
   - Avec OBS seul, **non** : la seule sortie du Replay Buffer est un fichier, environ 16 Mo par sauvegarde avec les
     réglages actuels (DOC).
   - Sans fichier, il faut un plugin à images brutes (Replay Source, Dynamic Delay) ou un plugin maison. C'est
     déconseillé (§ 4.2).
   - L'écriture elle-même n'est pas le problème : environ 0,4 s, et le cache disque de Windows l'absorbe.
2. **Garder les 5 dernières secondes en mémoire ?**
   - **Oui, OBS le fait déjà**, encodé : environ 4 Mo pour 5 s, 16 Mo pour les 20 s configurées.
   - En brut : 0,9 à 2,5 Go en 1080p60, 1,7 à 4,4 Go en 1440p60 (§ 3).
3. **Lecture immédiate ? Délai commande → replay ?**
   - Pas immédiate. **Environ 0,3 à 0,7 s jusqu'à la première image, environ 0,5 à 1 s avec la transition**
     (HYPOTHÈSE).
   - La partie la plus longue est documentée par une mesure EXTERNE de 0,39 s.
   - Studio abandonne sans rien montrer si le fichier n'est pas prêt en 3 s. Le prototype mesurera les vrais chiffres
     (§ 9).
4. **Que voient les viewers pendant la préparation ?**
   - **Le direct, inchangé.** Rien n'apparaît avant que le fichier soit écrit et chargé, donc un échec ne laisse aucune
     trace à l'écran.
   - Une annonce immédiate (« REPLAY… ») est possible, mais déconseillée : elle s'afficherait pour rien en cas d'échec.
   - Côté viewers, Twitch ajoute plusieurs secondes de latence : le délai de 0,5 à 1 s ne se perçoit pas comme un
     temps mort.
5. **Accélérer la fin pour rejoindre le direct ?**
   - Avec A, le direct n'est **jamais retardé** : le replay est un insert, et le retour est une coupe ou une transition
     vers le temps réel. Les secondes du direct passées pendant le replay sont perdues, comme à la télévision.
   - La vitesse d'un replay est fixe (1 à 200 %), choisie au lancement ; la changer en cours **redémarre** le média
     (DOC).
   - Un vrai « rattrapage » demande un direct retardé (mécanisme Dynamic Delay : vidéo seule, VRAM). **Recouvrement
     avec l'étude « ralenti + rattrapage / Wasted »**, qui doit trancher ce mécanisme.
   - Variante possible plus tard : la fin du replay en accéléré par une 2ᵉ source média enchaînée. Hors V1.
6. **Répéter souvent, plusieurs demandes à la suite ?**
   - **Oui** : sauvegardes illimitées, sérialisées par OBS lui-même (DOC).
   - Studio ajoute :
     - **une seule demande à la fois** : un appui pendant la préparation ou la lecture est ignoré pour Antoni, refusé
       et remboursé pour un viewer ;
     - **au plus une demande en attente** si Antoni le souhaite ;
     - un **garde-fou anti « replay du replay »** (§ 6.6) ;
     - aucune sauvegarde à moins d'une seconde de la précédente.
   - L'endurance (200 cycles, mémoire d'OBS stable) fait partie du prototype.
7. **Éviter les conflits avec les autres scènes et effets ?**
   - **Pas de changement de scène** : une scène imbriquée est affichée puis masquée dans la scène de jeu (§ 2.3), avec
     le mécanisme « retour seulement si toujours dans mon état » déjà utilisé par les Points de chaîne.
   - Studio refuse un replay si :
     - la scène programme ne contient pas l'élément « Raptoru · Replay » ;
     - une scène temporaire (BRB, Creepy…) est en cours ;
     - un replay est déjà en cours.
   - Si Antoni change de scène pendant un replay, l'élément devient inactif, le média s'arrête, et Studio le masque dans
     la scène où il l'avait affiché.
8. **OBS refuse une commande ou une source échoue ?**
   - **Avant l'apparition**, tout échec abandonne sans rien afficher. Cas couverts : `OutputNotRunning`, source
     introuvable (600), pas de `ReplayBufferSaved` en 3 s, requête sans réponse en 3 s.
   - **Après l'apparition**, tous les chemins mènent au masquage :
     - `MediaInputPlaybackEnded` ;
     - à défaut, minuteur « durée ÷ vitesse + 1,5 s » ;
     - à défaut, retour persistant retenté toutes les 250 ms et rejoué après un redémarrage de Studio ;
     - à défaut, la source média s'efface seule à la fin du fichier (`clear_on_media_end`, sans boucle) ;
     - à défaut, raccourci OBS « masquer Raptoru · Replay » et arrêt d'urgence de Studio.
   - Message lisible côté Studio, par exemple « Le tampon de relecture d'OBS n'est pas démarré ».
9. **Combinaisons.**
   - **Replay normal.**
   - **Ralenti** : `speed_percent` 50, son coupé par défaut (voix plus grave d'une octave).
   - **Replay + « Wasted »** : ralenti, filtre de désaturation sur la source média activé par la requête déjà autorisée
     `SetSourceFilterEnabled`, image « WASTED » et son. Recouvre l'autre étude : partager la même source média et la
     même bannière.
   - **Replay accéléré** : vitesse fixe de 125 à 200 % pour un récapitulatif.
   - **Habillage** :
     - bannière « REPLAY » dans la scène imbriquée (image PNG ou WebM avec transparence choisie par Antoni) ;
     - transition d'apparition OBS (fondu, glissé, stinger) ;
     - option : cadre réduit « écran dans l'écran » pour éviter le doublon d'overlays (§ 6.7).

## 6. Conception recommandée (architecture A)

### 6.1 Mise en place dans OBS (une fois, par Antoni ou avec son GO)

- **Scène imbriquée « Raptoru · Replay »**, contenant :
  - **la source média « Raptoru · Replay média »**, plein cadre 1920×1080, avec `looping=false`,
    `restart_on_activate=true`, `clear_on_media_end=true`, `close_when_inactive=true` (aucun fichier verrouillé entre
    deux replays, à comparer dans le prototype), `hw_decode=false` au départ (moins de pièces mobiles ; à mesurer) ;
  - **la bannière** : image ou WebM, avec un texte facultatif.
- **Placement.** La scène imbriquée est ajoutée **au-dessus** dans chaque scène de jeu où le replay est permis, et
  masquée par défaut. Transitions d'apparition et de disparition réglées sur l'élément : fondu de 300 ms ou stinger
  « REPLAY ».
- **Tampon.** Démarrage automatique du Replay Buffer avec le stream (réglage d'OBS). Studio ne démarre pas le tampon :
  il le lit et prévient s'il est arrêté.
- **Audio à vérifier.** Ce qui part sur la piste 6 (micro ? jeu ? musique ?), et les pistes de sortie de la source
  média (par défaut 1 à 6).
- **Secours.** Un raccourci OBS « masquer Raptoru · Replay » (fonction standard, Stream Deck possible).
- **Variante.** Le plugin Downstream Keyer, déjà installé, poserait le calque au-dessus de toutes les scènes sans
  toucher chacune. Mais c'est une dépendance tierce de plus, pilotée par des requêtes vendor. Pas en V1.

### 6.2 Machine d'états de Studio

`prêt` → `sauvegarde` → `chargement` → `affichage` → `lecture` → `retour` → `délai anti-replay` → `prêt`.

- **Délais par état :**
  - sauvegarde 3 s ;
  - de l'apparition à `PlaybackStarted` 1,5 s ;
  - lecture : durée ÷ vitesse + 1,5 s.
- **Corrélation.** Seul le premier `ReplayBufferSaved` reçu **pendant** l'état `sauvegarde` est retenu. Un événement
  tardif, ou une sauvegarde manuelle d'Antoni hors de cet état, est ignoré.
- **Le retour est enregistré avant l'apparition.** On réutilise la file de retours persistants d'`ObsActions`, avec un
  type de retour « élément de scène », qui existe déjà.
- **Fichiers séparés.** Un module à part (`apps/studio/server/src/replay/…`) ; les fichiers centraux ne font que le
  brancher (règle des fichiers centraux du projet).

### 6.3 Séquence obs-websocket (environ 7 requêtes)

1. **Pré-contrôles** (lectures, en cache) : `GetReplayBufferStatus.outputActive`, `GetCurrentProgramScene`,
   `GetSceneItemId` de « Raptoru · Replay » dans cette scène.
2. `SaveReplayBuffer`.
3. Attente de `ReplayBufferSaved { savedReplayPath }`.
4. `SetInputSettings { local_file, speed_percent }` (`overlay: true`) sur la source cachée : rien ne joue.
5. Optionnel : `SetSourceFilterEnabled` pour un filtre ralenti ou Wasted, avec retour persistant.
6. `SetSceneItemEnabled(true)`. À `MediaInputPlaybackStarted` : `GetMediaInputStatus` (durée D), puis
   `SetMediaInputCursor(max(0, D − N·1000))`.
7. À `MediaInputPlaybackEnded` (ou au minuteur) : `SetSceneItemEnabled(false)`, puis levée des muets éventuels.

**Point ouvert : un éclair de début de fichier.**

- Entre l'apparition et le saut, 1 à 3 images du **début** du fichier, de 20 s plus tôt, peuvent s'afficher, sous la
  transition d'apparition.
- Un stinger opaque les masque. Un fondu de 300 ms les rend à peine visibles (HYPOTHÈSE).
- Variante sans éclair, à mesurer : `restart_on_activate=false`, lecture cachée, pause, saut, affichage puis lecture.
  Elle demande plus d'étapes, et il faut vérifier qu'aucun son ne sort pendant la préparation cachée (INCONNU : le
  mixage audio d'une source inactive).
- Le prototype compare les deux. La plus simple est gardée si l'éclair est invisible.

### 6.4 Audio

- **Le replay contient le mixage de la piste 6** (§ 1.1). Si la musique en est exclue, c'est un avantage : pas de
  musique sous droits rejouée.
- **Par défaut :**
  - son du replay **activé** ;
  - **micro en direct conservé**, Antoni commente ;
  - **son du jeu en direct coupé** pendant le replay, en option, par un `MuteHold`. Le mécanisme existe et il est
    partagé, sans conflit avec Votekick et Random Ban, qui tiennent le micro.
- **Ralenti** : son du replay coupé par défaut, à cause du changement de hauteur.
- **Retour d'écoute** de la source média coupé par défaut : Antoni n'entend pas le replay dans son casque. Option
  « l'entendre ».

### 6.5 Durées

- **3, 5 et 10 s, plus une durée libre de 1 à 15 s.** Le tampon de 20 s laisse de la marge pour le décalage des viewers
  (§ 6.8).
- Le départ réel est calé sur l'image clé précédente : jusqu'à 2 s de plus. À afficher honnêtement dans Studio
  (« ≈ 5 à 7 s »), ou à corriger si le prototype montre une recherche précise.

### 6.6 Répétition et « replay du replay »

- Le tampon enregistre la **sortie programme** : un replay déclenché juste après un autre contiendrait le premier.
- **Règle :** le début du segment ne peut pas précéder la fin du dernier replay. On calcule
  `départ = max(D − N, D − (maintenant − fin du dernier replay))`. Si le segment restant fait moins de 2 s, la demande
  est refusée (« trop tôt »).
- Ce délai découle de la règle et ne demande pas de réglage à part. Il empêche aussi deux sauvegardes dans la même
  seconde.

### 6.7 Conflits et ordre des calques

- **Doublons d'overlays.** Le replay plein cadre contient déjà le chat et les alertes d'il y a 5 s. Posé au-dessus de
  tout, il **cache les alertes en direct** pendant 5 à 10 s. Posé sous les overlays, chat et alertes apparaissent en
  double.
- **Choix proposé :** au-dessus de tout, sauf la bannière. Studio **retient ses propres alertes** pendant le replay, si
  la file d'alertes de Studio le permet (à vérifier au développement). Variante : le cadre réduit « écran dans
  l'écran ». **Décision d'Antoni.**
- **Chaos (KO Overlay).** Ses effets visibles dans le programme sont rejoués tels quels, sans conflit technique.
- **Scènes temporaires** (BRB, Creepy) : refus pendant un replay, et inversement.
- **Connexions des sources navigateur** (plafond de 6 de l'incident du 22/11) : l'architecture A n'ajoute **aucune
  source navigateur**.

### 6.8 Déclenchement par les viewers (plus tard)

- **Même circuit que les Points de chaîne** (`EFFECTS_PLAYER.md` § 1) : Core, puis un job Studio avec bail, jamais
  rejoué une fois démarré.
- Studio refuse si l'état n'est pas `prêt`. Le Core rembourse, avec des tests d'idempotence et de concurrence si des
  Jetons sont en jeu (règle du projet).
- **Décalage.** Un viewer voit le stream avec quelques secondes de retard et réagit ensuite. Son « 5 dernières
  secondes » est donc plutôt la fenêtre `[D − N − k, D − k]`, avec k ≈ 3 à 8 s à régler (HYPOTHÈSE). La fin du segment
  se fait alors au minuteur, pas à la fin du fichier.
- **Décisions d'Antoni :** prix, délai par viewer et global, droit de veto, modération.

## 7. Risques

| Risque                                            | Probabilité                 | Impact                                              | Parade                                                                                                                                            |
| ------------------------------------------------- | --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Écriture du replay très lente (antivirus, disque) | faible à moyenne (EXTERNE)  | replay manqué                                       | abandon invisible à 3 s ; mesure dans le prototype ; exclusion antivirus du dossier si besoin (décision d'Antoni)                                 |
| Tampon non démarré pendant le stream              | moyenne                     | replay indisponible                                 | démarrage automatique OBS ; état affiché dans Studio                                                                                              |
| Piste 6 sans micro ou sans jeu                    | INCONNU                     | replay muet ou incomplet                            | vérification par Antoni (§ 6.1)                                                                                                                   |
| Éclair du début du fichier                        | moyenne                     | 1 à 3 images parasites                              | stinger ou variante pause-saut (§ 6.3)                                                                                                            |
| Départ décalé d'une image clé                     | certaine                    | replay 0 à 2 s plus long                            | annoncé ; mesuré                                                                                                                                  |
| Fichiers qui s'accumulent                         | certaine                    | ≈ 16 Mo par replay                                  | pas d'effacement automatique en V1 (ils servent de clips) ; taille affichée ; effacement seulement des chemins reçus par Studio, jamais par motif |
| Alertes cachées ou en double pendant le replay    | certaine selon le placement | confusion                                           | § 6.7, décision d'Antoni                                                                                                                          |
| Studio planté pendant un replay                   | faible                      | la bannière reste                                   | retour persistant au redémarrage ; média qui s'efface seul ; raccourci OBS                                                                        |
| Replay Source 1.8.0 utilisé dans une scène        | INCONNU                     | **plantages connus sur OBS 31 et 32+**              | vérifier ; retirer le filtre ou mettre à jour en 1.8.2 (GO d'Antoni)                                                                              |
| plugin hérité de l'ère SAMMI encore chargé        | INCONNU                     | voir le rapport de livraison (hors dépôt public)    | vérifier dans OBS (GO d'Antoni)                                                                                                                   |
| Plugins tiers au mauvais emplacement à OBS 34     | certaine à OBS 34           | Replay Source et Dynamic Delay ne chargeraient plus | l'architecture A n'en dépend pas                                                                                                                  |

## 8. Stratégie de développement

1. **Lot 0, décisions d'Antoni** (§ 10).
2. **Lot 1, Studio sans OBS.**
   - Module `replay` : machine d'états, délais, corrélation, règle anti « replay du replay », retours persistants.
   - Simulateur d'OBS : `ReplayBufferSaved`, `MediaInputPlaybackStarted` et `Ended`, refus, retards, coupure.
   - Tests ciblés : double appui, événement tardif, OBS muet, changement de scène, redémarrage de Studio.
   - Bouton et réglages dans le Lab.
3. **Lot 2, prototype mesuré sur un OBS isolé** (§ 9) : délais réels, éclair, précision du saut, endurance de 200
   cycles, son, décodage matériel ou logiciel.
4. **Lot 3, intégration Studio.**
   - Vérification de configuration en lecture seule, comme la vérification de compatibilité de Chaos : tampon,
     élément, réglages de la source.
   - Abonnements `Outputs | MediaInputs`.
   - Variantes ralenti et Wasted, partagées avec l'autre étude.
5. **Lot 4, mise en service avec Antoni.** Réglages OBS du § 6.1, essai hors stream, puis en stream. Validation
   manuelle par Antoni.
6. **Lot 5, plus tard.** Déclenchement par les viewers (§ 6.8).

## 9. Prototype sûr : périmètre et autorisations

**Ce qu'Antoni devrait autoriser explicitement :**

1. Télécharger l'archive **portable** officielle d'OBS 33.0.1 (zip GitHub) dans `Raptoru 2.0 - Worktrees`. Rien
   d'installé.
2. La lancer en mode `--portable --multi`, avec son **propre** profil et sa propre collection de scènes :
   - obs-websocket sur un **autre port** que celui de la production ;
   - aucun service de diffusion configuré ;
   - Replay Buffer de 20 s dans un dossier de test.
   - **Uniquement quand Antoni ne joue pas et n'est pas en live** (garde `--game-check` existante).
3. Utiliser comme image une **vidéo de test** en boucle avec un compteur d'images incrusté, et non la capture de
   l'écran ou du jeu. Les mesures se font par `GetSourceScreenshot` (compteur lu sur l'image), par les horodatages des
   événements, et par la mémoire du processus OBS de test.
4. Laisser Studio, ou un script du Lab, se connecter **uniquement** à cet OBS de test. Jamais au port de production.
5. **Pour la production, plus tard et séparément** : créer la scène imbriquée et la source média, régler le démarrage
   automatique du tampon, vérifier la piste 6. Soit Antoni le fait, soit il donne un GO pour que Studio crée les
   éléments (`CreateInput`).

**Mesures attendues :**

- délai entre l'appui et `ReplayBufferSaved`, puis jusqu'à la première image (médiane et pire cas sur 50 essais) ;
- présence de l'éclair dans les deux variantes ;
- écart du saut par rapport à la cible ;
- mémoire d'OBS après 200 cycles ;
- son à 100 % et 50 % ;
- comportement si le fichier est supprimé ou si Studio est tué en pleine lecture.

**Hors prototype :** Replay Source et Dynamic Delay. Ils ne seraient testés que sur demande, après mise à jour, dans
ce même OBS isolé.

## 10. Questions pour Antoni

1. Placement : replay au-dessus des alertes et du chat (alertes retenues), ou cadre réduit ?
2. Son pendant le replay : couper le jeu en direct ? Entendre le replay dans le casque ?
3. Que contient la piste 6 (micro, jeu, musique) ?
4. Le tampon démarre-t-il automatiquement avec le stream ? Peut-il rester à 20 s ?
5. Replay Source est-il utilisé dans une scène ? Le plugin hérité signalé dans le rapport de livraison sert-il encore ?
6. Garder les fichiers de replay comme clips (taille affichée, pas d'effacement automatique) ?
7. Pour plus tard : déclenchement par les viewers, avec quel prix et quels délais ?

## 11. Sources (consultées le 24/11/2026)

**Relevé local (PROUVÉ) :**

- `C:\Program Files\obs-studio\bin\64bit\obs64.exe` (33.0.1) ;
- `obs-plugins\64bit\*.dll` (versions de fichier) ;
- `core\` (plugins bundlés) ;
- `data\obs-plugins\frontend-tools\scripts` ;
- `%APPDATA%\obs-studio\basic\profiles\*\basic.ini` (sections autorisées seulement) ;
- dépôt `feat/chaos-studio` : `apps/studio/server/src/bonk-lab/obs.ts`, `bonk-lab/obs-auto.ts`,
  `channel-points/obs-actions.ts`, `votekick/sim-obs.ts`, `docs/EFFECTS_PLAYER.md`, `docs/chaos/RECHERCHE_CHAOS_V2.md`
  (RTX 3070 8 Go, i7-12700).

**Code source lu** (DOC, branche `master` au 24/11/2026). OBS Studio est sous GPL-2.0-or-later, obs-websocket sous
GPL-2.0.

- Replay Buffer : <https://github.com/obsproject/obs-studio/blob/master/plugins/obs-ffmpeg/obs-ffmpeg-mux.c>
- Source média : <https://github.com/obsproject/obs-studio/blob/master/plugins/obs-ffmpeg/obs-ffmpeg-source.c>
- Lecture des médias (lecture partielle) :
  - <https://github.com/obsproject/obs-studio/blob/master/shared/media-playback/media-playback/media.c>
  - <https://github.com/obsproject/obs-studio/blob/master/shared/media-playback/media-playback/decode.c>
- API frontend : <https://github.com/obsproject/obs-studio/blob/master/frontend/api/obs-frontend-api.cpp>
- Règles Twitch :
  - <https://github.com/obsproject/obs-studio/blob/master/plugins/rtmp-services/data/services.json> (`keyint: 2`,
    `max video bitrate: 6000`)
  - <https://github.com/obsproject/obs-studio/blob/master/plugins/rtmp-services/rtmp-common.c> (`keyint_sec` imposé)
- Protocole obs-websocket v5 (RPC 1) : <https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md>
  - `SaveReplayBuffer`, `GetLastReplayBufferReplay`, `ReplayBufferSaved`, `MediaInputPlaybackStarted` et `Ended`,
    `SetMediaInputCursor` (sans contrôle de bornes), `TriggerHotkeyByName` (« provided as-is ») ;
  - lots `SerialRealtime` et `SerialFrame`.
- Implémentation des requêtes de sortie :
  <https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestHandler_Outputs.cpp>
- Replay Source (GPL-2.0, dernier push le 18/11/2026, 178 étoiles, 49 issues ouvertes) :
  - <https://github.com/exeldro/obs-replay-source> : `replay-filter.c`, `replay.c`, `replay-source.c` (lecture
    partielle), README ;
  - versions : <https://api.github.com/repos/exeldro/obs-replay-source/releases> (1.8.0 du 03/08/2024, 1.8.1 du
    21/03/2025, 1.8.2 du 02/11/2026).
- Dynamic Delay (GPL-2.0, dernier push le 31/12/2022) :
  <https://github.com/exeldro/obs-dynamic-delay/blob/master/dynamic-delay.c>
- Source Record (GPL-2.0) : <https://github.com/exeldro/obs-source-record/blob/master/source-record.c> (lecture
  partielle).
- Script Instant Replay :
  - fork tomaae (GPL-3.0, 2019) : <https://github.com/tomaae/obs-instant-replay/blob/master/obs-instant-replay.lua>
  - copie de la version OBS « Lain and Exeldro » (sans licence dans le fichier) :
    <https://github.com/Logitech/ghub-obs-plugin/blob/master/other/obs-studio/UI/frontend-plugins/frontend-tools/data/scripts/instant-replay.lua>

**Notes de version** (DOC) :

- OBS 33.0.0 (23/10/2026) : <https://github.com/obsproject/obs-studio/releases/tag/33.0.0> (signal `saving`, refonte du
  chargement des plugins, emplacements historiques jusqu'à 34.0) ;
- OBS 33.0.1 (29/10/2026) : <https://github.com/obsproject/obs-studio/releases/tag/33.0.1> ;
- OBS 27, transitions de visibilité des sources : <https://obsproject.com/blog/obs-studio-27-release-notes>.

**Forum et avis** (EXTERNE) :

- Replay Source : <https://obsproject.com/forum/resources/replay-source.686/>, `/updates` et `/reviews`. Avis sur la
  RAM (15 Go pour 15 s, « 32 Go pas assez »), plantages sur OBS 31. Réponse de l'auteur : « stores it raw in memory »,
  avec Source Record ou Aitum Backtrack proposés comme alternatives encodées.
- Issues de Replay Source (#3, #45, #51, #64, #69, #74) :
  <https://github.com/exeldro/obs-replay-source/issues?q=crash>
- Dynamic Delay (0.1.4, 2022 ; avis RAM et VRAM, pas de son) : <https://obsproject.com/forum/resources/dynamic-delay.1035/>
- Source Record (0.5.0) : <https://obsproject.com/forum/resources/source-record.1285/>
- Délai d'écriture du Replay Buffer (0,39 s, jusqu'à 3 min) :
  <https://obsproject.com/forum/threads/long-delay-from-when-i-press-to-save-a-replay-and-when-it-actually-saves-it-even-tho-the-clip-is-correct-it-just-saves-it-after-a-while.182683/>
  (et `/page-2`)
- Aitum Backtrack : <https://aitum.notion.site/Backtrack-Settings-74cc4bd3462142cf9f117517afe41571> (page non lisible
  automatiquement, contenu connu seulement par extraits de recherche, donc INCONNU).
- Script `obs_reactive_replay` : <https://codeberg.org/cmdr/obs_reactive_replay> (non lu, licence non vérifiée).

**Déductions** (HYPOTHÈSE) : tous les délais du § 4.1 sauf le 0,39 s, le coût de bande passante de Replay Source, le
décalage des viewers, l'invisibilité de l'éclair sous une transition, et le choix de l'encodeur du stream par le tampon
quand `RecEncoder=none`.
