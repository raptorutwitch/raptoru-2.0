# Lecteur d'effets — sons et vidéos d'effet joués par Studio (P0.1, P0.2)

**Statut : LECTEUR D'EFFETS P0.1 — DÉVELOPPEMENT TERMINÉ / TESTS AUTOMATISÉS RÉUSSIS / VALIDATION FONCTIONNELLE OBS
RÉUSSIE / NON DÉPLOYÉ** (code `77039d7`). Validé manuellement par Antoni dans son vrai OBS le 17/10/2026 (source
navigateur ajoutée, tests Studio « Eren cri » → son d'effet joué dans OBS ; traces Lab : 2 tests exécutés à 23:14). Pas
encore de vraie récompense Twitch (automatisations OFF). SAMMI exécute toujours les récompenses de production.

Direction (audit du 17/10/2026) : OBS compose les effets, Studio les pilote, les interactions sont écrites dans le code.
Le lecteur d'effets est une **capacité native de Studio** (aujourd'hui : sons ; plus tard : vidéos, fondus, images),
pas un système construit autour des anciennes récompenses SAMMI.

## 1. Chaîne

Récompense Twitch → bot / adaptateur Lab → Core (`ChannelPointsService` : déduplication, interrupteur, règle) → job
Studio (le **même** circuit que les actions OBS des Points de chaîne : bail, 3 tentatives tant que non démarré, jamais
rejoué une fois démarré) → `EffectsPlayer` (`apps/studio/server/src/effects/player.ts`) → **une** source navigateur OBS
(`apps/studio/server/effects-player/`) → `started` → Core marque l'action « en cours de lecture » et termine le job tout
de suite (la récompense suivante peut se superposer) → fin rapportée (`POST …/jobs/<id>/effects`) → « exécutée ».

- Action de règle : `{ type: 'effect_sound', sound_id, volume }` (`packages/schemas/src/effects.ts`,
  `channel-points.ts`). Le catalogue des sons est **fixé dans le code** (`EFFECT_SOUNDS`), pas d'import depuis Studio.
- Hors Soundboard : ni file, ni pause, ni prix, ni cooldown, ni débit Wallet ; les sons d'effet ne sont **pas** dans la
  banque de l'extension. Superposition libre (8 effets simultanés au maximum, au-delà : refus lisible).
- « Commande envoyée » ≠ « lu » : l'action reste « en cours de lecture » jusqu'à la fin rapportée par la page ; sans fin
  dans les 2 min → « lecture non confirmée » (jamais rejouée).
- Jamais de rejeu : un effet est remis à **une seule** page (la première qui le demande) ; non pris en 2 s → « lecteur
  d'effets non ouvert » ; pris mais non démarré en 6 s → « lecture non démarrée » ; les remises vivent en mémoire (un
  redémarrage de Studio n'en garde aucune).
- Refus lisibles (historique Studio) : lecteur non ouvert, son bloqué, fichier non importé, trop d'effets, fichier
  illisible, erreur de lecture.

## 2. Sons importés (copie, originaux intacts)

Source : `Documents\Rendu Audacity` (fichiers joués par SAMMI). Import :
`npx tsx apps/studio/server/src/effects/import-cli.ts` → `apps/studio/server/.runtime/effects/media` (hors Git, nommé
par empreinte SHA-256, empreinte de la copie vérifiée). Les originaux sont seulement lus (empreinte, taille et date
identiques avant / après, vérifié le 17/10/2026).

| Son (id)            | Fichier original         | Volume SAMMI → défaut | Récompense SAMMI                 | Durée  |
| ------------------- | ------------------------ | --------------------- | -------------------------------- | ------ |
| `eren-scream`       | `ErenScream.ogg`         | 1 → 100 %             | Eren cri                         | 10,8 s |
| `tiens-bon`         | `Tiens bon !.ogg`        | 0,41 → 41 %           | Tiens bon !                      | 6,4 s  |
| `quoicoubaka-bibou` | `Quoicoubaka bibou.ogg`  | 0,85 → 85 %           | Seigneur Percé                   | 1,5 s  |
| `pas-mal-les-bzez`  | `Pas mal les bzez_1.ogg` | 0,84 → 84 %           | Bzez                             | 2,3 s  |
| `glory-holes`       | `Glory holes.ogg`        | 1 → 100 %             | Skyzz                            | 1,9 s  |
| `karma-arreteuh`    | `Karma Arreteuh.ogg`     | 1 → 100 %             | Arrêteuh (désactivée sur Twitch) | 2,9 s  |

Ogg Vorbis, joués tels quels (aucune conversion). Le volume est réglable par règle (défaut = volume SAMMI).

## 3. Source OBS (à ajouter par Antoni, une seule fois)

Studio → Points de chaîne → « Lecteur d'effets (source OBS) » : copier l'URL
(`http://127.0.0.1:4100/effects/player.html#<jeton>` ; le jeton est créé au premier démarrage dans
`.runtime/effects/player-token` et ne change plus).

Source navigateur, nom conseillé « Raptoru — Effets » :

- URL : celle de Studio ; largeur 300, hauteur 100 (rien n'est affiché) ;
- **« Contrôler l'audio via OBS » : décoché** — comme les autres overlays de la collection (alertes, TTS…) et comme
  SAMMI : le son sort sur la sortie Windows par défaut et le stream le capte par « Son du pc ». Cocher cette case
  ferait passer le son par le mixeur OBS (il faudrait alors régler son monitoring) : routage différent de SAMMI ;
- « Arrêter la source quand elle n'est pas visible » et « Actualiser quand la scène devient active » : décochés ;
- placement : dans une scène toujours chargée (ex. « Alerte complète », où se trouve déjà « Alertes (V2) ») ; essai
  d'abord dans une scène de test.

Dans OBS la page joue sans clic ; dans un navigateur normal elle affiche « Activer le son » et ne prend aucun effet tant
que le son n'est pas autorisé (Studio indique « son bloqué »).

## 4. Différences avec SAMMI (connues)

- Même fichier, même volume relatif ; sortie audio identique en principe (à vérifier à l'oreille, § 5).
- SAMMI : boutons « Eren cri » et « Tiens bon » `queueable` (une 2ᵉ pression attend la fin de la 1ʳᵉ, si le bouton reste
  actif pendant le son — non démontré). Raptoru : superposition immédiate de toutes les récompenses.
- Raptoru ne peut ni valider ni rembourser une récompense (règle Twitch, `CHANNEL_POINTS_V1.md` § 2) ; SAMMI ne le fait
  pas non plus pour ces sons.

## 5. Validation manuelle (Lab, avec accord d'Antoni)

1. Démarrer Studio (`npm run studio`) ; onglet Points de chaîne : « 6 / 6 son(s) importé(s) ».
2. Ajouter la source OBS (§ 3) dans une scène de test → la puce « Lecteur d'effets prêt » apparaît.
3. Récompense « Eren cri » → Son d'effet « Eren — cri », 100 % → Enregistrer → « Écouter » (joué dans Studio seulement).
4. « Tester » (automatisations OFF, aucune vraie récompense consommée) → entendu dans le casque **et** dans un
   enregistrement / l'aperçu du stream ; historique « en cours » puis « Exécutée ».
5. Deux « Tester » rapprochés (Eren puis Tiens bon) → les deux sons se superposent.
6. Soundboard en pause → l'effet joue quand même.
7. Fermer la source OBS → « Tester » → échec « lecteur d'effets non ouvert », rien ne se rejoue à la réouverture.
8. Comparer à l'oreille avec le bouton SAMMI (volume, sortie).
9. Vraie récompense : seulement avec accord, bouton SAMMI de cette récompense désactivé avant d'activer les
   automatisations (sinon double déclenchement).

## 6. Fichiers

`packages/schemas/src/effects.ts` · `apps/core-api/src/channel-points/service.ts` (`effectReport`, `settleEffects`) ·
`apps/core-api/src/http/channel-points-routes.ts` · `apps/studio/server/src/effects/{player,import-cli}.ts` ·
`apps/studio/server/effects-player/` · `apps/studio/server/src/channel-points/runtime.ts` ·
`apps/studio/web/src/channel-points{,-view}.ts` · tests : `apps/core-api/test/channel-points-effects.test.ts`,
`apps/studio/server/test/effects-player.test.ts`, `apps/studio/server/e2e/effects-player.e2e.ts`. Aucune migration de
base (les actions sont du JSON).

## 7. P0.2 — fiches de parité SAMMI (lecture seule du 17/10/2026)

Sources : `decks_data.json` (deck « Points de chaine »), `Alerte_system.html`, collection OBS active
(`Twitch_Dofus.codex-backup-20260919-144407.json`), doc officielle SAMMI. **C** = confirmé dans les fichiers, **H** =
hypothèse. SAMMI : les délais des commandes sont **absolus depuis le déclenchement** (« Command delays are absolute and
not related to each other », sammi.solutions/docs/commands/introduction) ; seule la commande Wait suspend le bouton.
« Alerte complète » est superposée à toutes les scènes par le plugin Downstream Keyer (DSK 1, sauf « Slow Mo FAIL ») :
la source du lecteur d'effets, placée dans cette scène, est visible partout (C).

### NTM (bouton `ID18`, récompense « ntm », 2000 pts, active)

- Déclencheur : récompense (C). Aucune condition, aucun remboursement, aucun message (C). Bouton non `queueable`,
  non `overlappable` ; il ne fait qu'émettre un événement (durée quasi nulle) → les redemptions rapprochées se
  superposent toutes (C pour l'overlay, H pour le bouton).
- Effet : `CallVendorRequest obs-browser emit_event pdc_fuck_you` → source « Alerte (Sammi) » (`Alerte_system.html`)
  → `jouerAlerteSuperposee` (C).
- Média : `Videos\Alertes Twitch Pour Claude\Version webm\Fuck You.webm` (1920×1080, VP9 avec transparence, 8,5 s, son
  intégré) (C).
- Volume : `0.2 × VOLUME_GLOBAL 0.5` = **0,1** (C). Ducking entre lectures simultanées : `max(0.0125, 0.1 − (n−1) ×
0.025)`, rampe 450 ms (cubique) ; seules les 4 plus anciennes sont audibles, les suivantes muettes mais affichées (C).
- Présentation : plein cadre `object-fit: contain` ; miroir horizontal si `Math.random() < 0.35` ; montée depuis
  +550 px en 2200 ms linéaire avec apparition 220 ms ; fondu de sortie 500 ms à (durée − 500 ms) ; retrait à la fin (C).
- Nombre de lectures simultanées : illimité dans l'overlay (C).
- Échec : rien (aucun retour vers SAMMI) (C).

### Creepy (bouton `ID28`, récompense « Creepy », 700 pts, active)

- Garde (commande « exit if », C sur les valeurs, H sur la combinaison ET / OU) : ne s'exécute que si la scène courante
  est « Scène Fullscreen », « Just Chatting », « Scène PS5 » ou « Scène Dessin », et jamais si elle est déjà « Creepy
  Effect ». Sinon : rien, aucun remboursement, aucun message.
- Chronologie (C, délais absolus) : t0 relance du média « Prowler Effect » + affichage de « Prowler Effect » dans
  « Alerte complète » ; t+500 ms son `Rendu Audacity\Prowler Effect.ogg` à 0,29 ; t+800 ms scène « Creepy Effect » ;
  t+4000 ms masquage de « Prowler Effect » ; t+5000 ms retour à la scène précédente (`previous_scene` suivie par SAMMI).
- OBS (C) : « Prowler Effect » = source média `Documents\Twitch\Effet de stream\Test delay.mov` (sans boucle,
  « redémarrer à l'activation » par défaut) ; scène « Creepy Effect » = Cam + Groupe + `creepy_overlay.html`, filtres
  Move « Move Source » (Groupe, 5000 ms, déclenché à l'activation) puis « Move Source 2 » ; **transition forcée
  « Coupure »** sur cette scène. Le retour utilise la transition normale de la scène de destination (H : stinger
  « Portail Eliotrope »).
- Simultanés : bouton `queueable` (durée 6000 ms) → une 2ᵉ redemption attend la fin de la 1ʳᵉ (C sur le réglage, H sur
  l'effet exact).
- Restauration : retour inconditionnel à la scène précédente, même si le streamer a changé de scène entre-temps (C).
- Compléments (18/10/2026, C) : « Prowler Effect » est une vidéo **sans piste audio** (QuickTime Animation, 5,5 s) — le
  seul son est `Prowler Effect.ogg` ; la sortie de « Creepy Effect » est aussi une coupure (plugin Transition Table :
  « Creepy Effect → Any : Coupure 50 », entrée « Any → Creepy Effect : Coupure 500 » + transition forcée de la scène) ;
  la garde SAMMI n'a que 4 conditions actives (le 5ᵉ champ « == Creepy Effect » est inactif) : même résultat, Creepy
  n'est jamais lancé depuis « Creepy Effect » puisque cette scène n'est pas dans la liste.

### BRB (bouton `ID48`, récompense « Be Right Back », 1500 pts, active)

- Garde (C) : seulement en « Scène Dessin », « Scène Fullscreen » ou « Scène PS5 » (pas Just Chatting) ; sinon
  remboursement Twitch (`CANCELED`), message « Pas la bonne scène pour ça ! », arrêt. **Raptoru ne peut pas
  rembourser** cette récompense (créée par SAMMI).
- Chronologie (C, avec Wait) : t0 capture PNG de la source « Écran » → `C:/OBSFreeze/wbrb_screen.png` ; t+600 ms capture
  de « overlay cam shushu » → `C:/OBSFreeze/wbrb_cam.png` ; t+1200 ms événement `pdc_wbrb` → `Alerte_system.html`
  (`jouerWbrb`), coupure de « Micro » et de « Musique Isolée » ; t+7200 ms rétablissement de « Musique Isolée » puis
  « Micro ».
- Overlay (C) : fond noir, capture d'écran (saturation 0,8, contraste 1,04, luminosité 0,78) + voile brun, capture de la
  caméra qui descend en 1000 ms après 1000 ms, vidéo `We'll be right back_3.webm` par-dessus ; à la fin de la vidéo,
  fondu 200 ms après 500 ms.
- **Correction (18/10/2026, C)** : « Musique Isolée » **existe** : c'est une source audio globale d'OBS (Paramètres → Audio,
  « Mic/Aux 2 » = `AuxAudioDevice2`, capture d'entrée), absente de la liste des sources de scène — l'audit du 17/10
  ne regardait que cette liste. La coupure SAMMI de « Micro » et de « Musique Isolée » fonctionne donc. « Écran » n'est
  pas dans « Scène PS5 » (la capture fonctionne quand même : la source existe).
- Vidéo (C) : `We'll be right back_3.webm`, 1920×1080, VP9 avec transparence + son Opus, 5,55 s, jouée au volume 1
  (jamais réglé dans l'overlay) ; elle apparaît 80 ms après le début (transition 0,3 s de l'overlay) ; la couche
  disparaît 700 ms après la fin de la vidéo (≈ t+7,45 s), indépendamment du rétablissement du son (t+7,2 s).
- Simultanés : bouton ni `queueable` ni `overlappable` → une 2ᵉ redemption pendant l'effet est ignorée (H).
- Restauration : micro rétabli par le bouton lui-même (aucune protection si SAMMI s'arrête pendant les 6 s) (C).

## 8. NTM dans Raptoru (P0.2 C1)

**Statut : NTM — DÉVELOPPEMENT TERMINÉ / TESTS AUTOMATISÉS RÉUSSIS / VALIDATION FONCTIONNELLE OBS RÉUSSIE / NON
DÉPLOYÉ** (code `e0fc606`). Validé manuellement par Antoni dans son vrai OBS le 17/10/2026 : rendu identique à SAMMI, y
compris l'animation de la vidéo. Pas encore de vraie récompense Twitch (automatisations OFF).

- Action de règle `{ type: 'effect_video', video_id: 'fuck-you', volume }` (catalogue `EFFECT_VIDEOS`, volume par
  défaut 10 % = la valeur effective de l'overlay). Même circuit que les sons d'effet (job Studio, « en cours de lecture »,
  fin rapportée).
- Le lecteur d'effets reprend exactement la présentation de `jouerAlerteSuperposee` (§ 7) : plein cadre, miroir 35 %,
  montée 2,2 s, fondu de sortie, ducking (4 audibles), son de la vidéo. Plus d'événement `pdc_fuck_you`, plus de
  dépendance à SAMMI ni à `Alerte_system.html`.
- Média importé par copie (`Fuck You.webm`, empreinte identique, original intact).
- **Écart assumé** : 8 effets simultanés au maximum (sons et vidéos confondus ; au-delà : refus lisible), là où
  l'overlay n'avait pas de limite.
- **Source OBS** : le lecteur doit couvrir le canevas : propriétés de la source du lecteur d'effets → largeur **1920**,
  hauteur **1080**, position (0, 0), taille 100 % (la source actuelle « Test son » fait 300 × 100).

Validation manuelle (avec accord) : passer la source en 1920×1080 ; NTM → « Vidéo d'effet » « NTM — Fuck You » 10 % →
Enregistrer → Tester (automatisations OFF) : vidéo plein cadre qui monte, son faible ; 2 à 5 « Tester » rapprochés :
superposition, miroirs aléatoires, volume qui baisse, 5ᵉ muette ; comparer avec l'ancienne alerte NTM (SAMMI).

## 9. Creepy dans Raptoru (P0.2 C2)

**Statut : CREEPY — DÉVELOPPEMENT TERMINÉ / TESTS AUTOMATISÉS RÉUSSIS / VALIDATION FONCTIONNELLE OBS RÉUSSIE / NON
DÉPLOYÉ** (code `ac48842`). Validé manuellement par Antoni dans son vrai OBS le 18/10/2026 : animations OBS existantes,
son et retour de scène conformes (traces Lab : 4 tests Studio « Creepy » exécutés, 00:19 – 00:20). Pas encore de vraie
récompense Twitch (automatisations OFF).

Interaction native **« Creepy »** (règle `{ type: 'interaction', interaction: 'creepy' }`, choisie dans Studio : «
Interaction native » → « Creepy » ; rien d'autre à régler). Code : `apps/studio/server/src/interactions/creepy.ts`.

- **OBS fait le rendu, Studio ne refait rien** : animations Move de « Groupe » (déclenchées à l'activation de la
  scène), overlay `creepy_overlay.html` (boucle continue), filtres, transitions d'entrée et de sortie (coupures) sont
  ceux d'OBS. Studio ne touche à aucun filtre, aucune transition, aucune animation.
- **Studio exécute exactement la chronologie SAMMI** (§ 7) : t0 relance du média « Prowler Effect » + affichage dans «
  Alerte complète » ; t+0,5 s son `Prowler Effect.ogg` à 29 % (lecteur d'effets) ; t+0,8 s scène « Creepy Effect » ;
  t+4 s masquage du média ; t+5 s retour à la scène de départ.
- **Scène temporaire** (nouvelle capacité du moteur OBS existant, réutilisable) : action `obs_scene` avec durée, et la
  même mécanique de retour que les sources / filtres temporaires (`obs-reverts.json`) : retour **seulement si le
  programme est encore sur « Creepy Effect »** (un changement manuel est conservé) ; une scène temporaire posée sur une
  autre revient à la scène d'origine ; Studio redémarré pendant l'effet → seul le retour dû est appliqué, rien n'est
  rejoué ; OBS déconnecté → le retour attend OBS (et vérifie la scène), abandonné après une heure. Correctif du même
  mécanisme : un retour ajouté pendant une vérification n'est plus perdu.
- **Condition de départ** : programme sur « Scène Fullscreen », « Just Chatting », « Scène PS5 » ou « Scène Dessin » ;
  sinon rien n'est fait (comme SAMMI) et l'historique l'indique (« Creepy ignoré : scène … non prévue »).
- **Déclenchements rapprochés** : comme le bouton SAMMI (file, 6 s) — les Creepy se suivent, chacun revient à sa scène
  de départ ; 1 en cours + 4 en attente au maximum (au-delà : refus lisible).
- **Lecteur d'effets absent** : l'effet visuel a lieu quand même (comme SAMMI), l'historique indique « Creepy exécuté
  sans son ».
- Son importé par copie (`Prowler Effect.ogg`, original intact) dans le catalogue des sons d'effet.

Écarts avec SAMMI : retour à la scène de départ **seulement** si l'on est encore sur « Creepy Effect » (SAMMI revenait
toujours, y compris après un changement manuel) ; refus au-delà de 4 Creepy en attente ; la commande SAMMI `137` (6000)
et la variable inutilisée `FiltreName` ne sont pas reprises (aucun effet visible, H).

Validation manuelle (avec accord) : Studio → Points de chaîne → « Creepy » → Interaction native « Creepy » → Enregistrer
→ depuis « Just Chatting » (ou Fullscreen / PS5 / Dessin) : Tester ; vérifier média Prowler, son, coupure vers « Creepy
Effect » avec ses animations, puis retour à la scène de départ à ~5 s ; depuis « Waiting screen » : rien (historique «
Creepy ignoré ») ; deux Tester rapprochés : enchaînés ; changer de scène à la main pendant l'effet : pas de retour forcé ;
comparer avec le bouton SAMMI.

## 10. BRB dans Raptoru (P0.2 C3)

**Statut : BRB — DÉVELOPPEMENT TERMINÉ / TESTS AUTOMATISÉS RÉUSSIS / VALIDATION FONCTIONNELLE OBS RÉUSSIE / NON
DÉPLOYÉ** (code `72062a3` + correctif `31d82ef`). Validé manuellement par Antoni dans son vrai OBS le 18/10/2026,
après actualisation de la source du lecteur d'effets : fonctionnel. Réserve non bloquante : **légère latence ressentie
au démarrage**, à examiner lors de l'audit global (interaction volontairement non modifiée). Pas encore de vraie
récompense Twitch (automatisations OFF).

Interaction native **« BRB »** (règle `{ type: 'interaction', interaction: 'brb' }` : « Interaction native » → « BRB »).
Code : `apps/studio/server/src/interactions/brb.ts`.

- Chronologie SAMMI (§ 7) : t0 capture de « Écran » ; t+0,6 s capture de « overlay cam shushu » ; t+1,2 s couche BRB
  sur le lecteur d'effets + coupure de « Micro » et « Musique Isolée » ; t+7,2 s rétablissement.
- **Capture instantanée** (capacité réutilisable du moteur OBS) : `GetSourceScreenshot` PNG pleine résolution, prise
  à l'instant demandé, gardée **en mémoire** (jamais de fichier, plus de `C:/OBSFreeze`), servie à la page du lecteur
  sous un identifiant non devinable pendant l'effet seulement, puis supprimée (fin, échec ou effet jamais démarré).
- **Rendu** : la couche « jouerWbrb » de `Alerte_system.html` reprise telle quelle dans le lecteur d'effets (mêmes CSS :
  fond capturé assombri + voile brun, caméra qui descend après 1 s, vidéo par-dessus à 80 ms, fondu 200 ms 500 ms
  après la fin, retrait à 700 ms). Plus aucune dépendance à `Alerte_system.html` ni à l'événement `pdc_wbrb`. Vidéo
  importée par copie (original intact).
- **Coupures audio** : même mécanisme de retour que les autres effets temporaires (`obs-reverts.json`) : rétablies à
  t+7,2 s, après une erreur, après un redémarrage de Studio, ou au retour d'OBS — seulement si encore coupées (un
  rétablissement manuel est conservé ; une entrée déjà coupée avant BRB reste coupée). Si la couche ne peut pas
  démarrer, les coupures sont annulées aussitôt.
- **Condition de départ** : « Scène Dessin », « Scène Fullscreen » ou « Scène PS5 » ; sinon rien (aucune capture, aucune
  coupure) et l'historique indique « BRB refusé : scène … non prévue (aucun remboursement possible : récompense créée
  par SAMMI) ».
- **Un seul BRB à la fois** (bouton SAMMI ni en file ni superposable) : un BRB demandé pendant un autre est refusé
  (« BRB déjà en cours »).
- **Lecteur d'effets absent** : rien n'est fait (pas de coupure sans l'animation), raison lisible.

Écarts avec SAMMI (provisoires, à décider) :

- **Remboursement et message chat** quand la scène n'est pas la bonne : impossibles tant que la récompense appartient à
  SAMMI (seule l'app qui l'a créée peut la rembourser). Le refus est enregistré avec sa raison ; le jour où Studio
  gérera ses propres récompenses (`channel:manage:redemptions`), ce refus deviendra un remboursement, et le message
  « Pas la bonne scène pour ça ! » passera par la sortie chat de Raptoru.
- Lecteur d'effets absent : SAMMI aurait quand même coupé le micro ; Raptoru ne coupe rien.
- Captures en mémoire au lieu de `C:/OBSFreeze/*.png` (les anciens fichiers ne sont plus écrits ni lus).

Validation manuelle (avec accord) : source du lecteur d'effets en 1920×1080 (déjà fait pour NTM) ; « Be Right Back » →
Interaction native « BRB » → Enregistrer ; depuis « Scène Fullscreen » (ou Dessin / PS5) : Tester → image figée de
l'écran, caméra qui descend, vidéo BRB, micro et « Musique Isolée » coupés ~6 s puis rétablis (mixeur OBS) ; depuis
« Just Chatting » : rien (historique « BRB refusé ») ; deux Tester rapprochés : le 2ᵉ refusé ; comparer avec le bouton
SAMMI (cadrage des captures, timing, son).

### Correctif du 18/10/2026 — `invalid_effect` au premier test réel de BRB

- **Cause racine (prouvée)** : la source OBS du lecteur d'effets exécutait encore le `player.js` chargé **avant** BRB
  (versions NTM / Creepy). Studio avait redémarré avec le nouveau code, mais une source navigateur OBS ne recharge pas sa
  page quand Studio redémarre : elle continuait d'interroger le nouveau serveur avec l'ancien script, qui ne connaît
  pas `kind: 'wbrb'` et répond `invalid_effect` avant toute lecture. Rejoué le 18/10 : même serveur, même payload BRB →
  ancienne page `invalid_effect`, page actuelle `started`. Le payload, le média et le serveur étaient corrects.
- **« 9 médias »** : c'est le bon compte (7 sons, la vidéo NTM, la vidéo BRB), tous présents et identiques aux
  originaux ; l'annonce « 10 / 10 » du compte rendu BRB était une erreur de calcul.
- **Correctif** (mécanisme des Alertes repris tel quel) : la page porte la version de ses fichiers (empreinte de
  `player.html` + `player.js`, injectée quand elle est servie) dans chaque appel ; Studio ne remet rien à une page d'une
  autre version, qui se recharge seule dès qu'elle n'a plus d'effet en cours (une seule fois par version, sinon elle
  garde son code) ; une page sans version (antérieure à ce correctif, comme celle chargée aujourd'hui dans OBS) est
  refusée avec « lecteur d'effets à recharger » au lieu de `invalid_effect`, et l'onglet affiche « Lecteur d'effets : à
  recharger ».
- **Manipulation unique** : actualiser une fois la source navigateur du lecteur d'effets dans OBS (clic droit ›
  Actualiser, ou Propriétés › « Actualiser le cache de la page actuelle »). Ensuite, chaque mise à jour de Studio est
  prise automatiquement.

## 11. FX Cam dans Raptoru (P0.2 C4)

**Statut : FX CAM — DÉVELOPPEMENT TERMINÉ / TESTS AUTOMATISÉS RÉUSSIS / VALIDATION FONCTIONNELLE OBS RÉUSSIE / NON
DÉPLOYÉ** (code `2957148`). Validé manuellement par Antoni le 18/10/2026 dans son vrai OBS, par « Tester » (`rage`
appliqué puis désactivé, `feu` refusé) **et par une vraie récompense Twitch « FX cam »** avec saisie textuelle. Traces
Lab : une première vraie redemption (« bighead », 09:19) reçue avec son texte mais **ignorée car les automatisations
étaient OFF** (`automations_off`, comportement attendu) ; après activation de l'interrupteur, vraie redemption
« drunk » (09:21) exécutée de bout en bout Twitch → bot → Core → Studio → OBS, sans SAMMI.

Interaction native **« FX Cam »** (règle `{ type: 'interaction', interaction: 'fx_cam' }` : « Interaction native » →
« FX Cam » ; rien d'autre à régler). Code : `packages/schemas/src/fx-cam.ts` (liste et lecture du texte),
`apps/core-api/src/channel-points/service.ts` (résolution à la réception), `apps/studio/server/src/interactions/fx-cam.ts`.

### Ce que fait SAMMI (lecture seule du 18/10/2026)

- Récompense Twitch **« FX cam »** (500 points, saisie obligatoire, invite « Effets dispo : prison, bighead, pixel,
  drunk, glitch, rage », id `8f0be3cc-d1be-4038-b8e6-851bf8b48b86`) → bouton **ID12 « FX CAM »** (deck « Points de
  chaine », en file). Le bouton « ID12ancien » a toutes ses commandes désactivées.
- Texte : variable `message` de la récompense → minuscules → espaces autour retirés → cherché tel quel dans
  `|prison|bighead|pixel|drunk|glitch|rage|`. Aucun alias.
- Scène : seulement « Scène Dessin » ou « Scène Fullscreen » ; sinon remboursement + « Y'a pas de cam là... ».
- Inconnu : remboursement + « Effet inconnu. Effets dispo : prison, bighead, pixel, drunk, glitch, rage ».
- Même effet déjà actif (son compteur > 0) : remboursement + « Cet effet est déjà actif, tes points t'ont été
  remboursés ! ». **Effets différents cumulables** (un compteur par effet).
- Sinon : compteur de l'effet à 100, filtre `<effet>` activé sur **« overlay cam shushu »** (une scène : ses filtres),
  récompense validée (FULFILLED). Pour `rage` seulement : `GET http://127.0.0.1:17371/shushu?expression=rage`.
- Fin : bouton **ID26 « FX JANITOR »** (minuteur 100 ms) décrémente chaque compteur et désactive le filtre quand il
  atteint 1 → **≈ 10 s** (100 × 100 ms ; un minuteur SAMMI peut être un peu plus lent). Aucun son, aucun overlay.
- **Bridge Shushu (port 17371)** : petit serveur (`shushu_bridge_server_v3.js`) qui ne fait que mettre des commandes en
  file pour une page qui viendrait les lire. La page réellement chargée dans OBS
  (`Overlay de Cam/shushu_overlay_obs_v3.html`) **ne l'interroge pas** (aucune requête réseau), et rien n'écoutait sur
  17371 le 18/10. Le seul effet de cet appel était donc nul : **non repris** (aucune dépendance réelle).
- Filtres OBS (obs-shaderfilter, code en ligne, tous désactivés au repos) et animation propre à chaque shader sur
  `elapsed_time_enable` (remis à 0 à chaque activation), entrée / maintien / sortie :

  | Effet   | Entrée | Maintien | Sortie | Fin    |
  | ------- | ------ | -------- | ------ | ------ |
  | prison  | 0,75 s | 8 s      | 0,6 s  | 9,35 s |
  | bighead | 0,45 s | 8 s      | 0,45 s | 8,9 s  |
  | pixel   | 0,35 s | 8 s      | 0,45 s | 8,8 s  |
  | drunk   | 0,45 s | 8 s      | 0,55 s | 9 s    |
  | glitch  | 0,18 s | 8 s      | 0,35 s | 8,53 s |
  | rage    | 0,25 s | 8 s      | 0,45 s | 8,7 s  |

  Après sa fin, chaque shader rend la caméra intacte. « mute », « Votekick Zoom », « Votekick Mute » (autres modules)
  ne font **pas** partie de FX Cam.

### Dans Raptoru

- **Parcours du texte** : EventSub `user_input` → bot (`channel-points-events.ts`, texte brut ≤ 500) → Core
  `receive` : la redemption (dédoublonnée par son id Twitch) garde le texte brut pour l'historique ; l'action est figée
  avec l'effet résolu (`resolveFxCam` : minuscules, **tous** les espaces retirés — « Big Head » = bighead) → job Studio
  avec **seulement l'identifiant** de l'effet (jamais le texte du viewer) → `FxCam` → `SetSourceFilterEnabled`.
  Chaque redemption a sa propre action figée : plusieurs demandes simultanées ne se mélangent pas.
- **Inconnu / vide / autre filtre** (« mute », « Votekick Zoom », « pixel|drunk »…) : refusé **par Core**, rien n'est envoyé
  à Studio (historique : « effet inconnu (effets : …) — aucun remboursement possible : récompense créée par SAMMI »).
  Seul un nom de la liste peut cibler un filtre ; aucun code ni nom de filtre ne vient du viewer.
- **Activation** : filtre activé `FX_CAM.durationMs` = **10 s** (comme SAMMI) par l'action temporaire `obs_filter`
  existante (mécanisme de retour `obs-reverts.json`) : désactivé à la fin **seulement s'il est encore actif** (une
  désactivation manuelle est conservée), après un redémarrage de Studio ou au retour d'OBS. Toutes les animations de
  sortie sont finies avant (≤ 9,35 s) : rien n'est coupé.
- **Concurrence** : comme SAMMI — même effet en cours refusé tout de suite (« FX « rage » déjà actif ») ; effet déjà
  actif dans OBS (allumé à la main, ou resté actif pendant un redémarrage de Studio) refusé sans le toucher ; effets
  différents cumulés, chacun s'arrête à sa propre fin.
- **Scène** : « Scène Dessin » ou « Scène Fullscreen » ; sinon rien (« FX Cam refusé : pas de caméra sur la scène … »).
- **Erreurs lisibles** : OBS non connecté, filtre introuvable (« le filtre « rage » de « overlay cam shushu » introuvable
  dans OBS »), OBS perdu pendant l'effet (« joué ; filtre désactivé au retour d'OBS »).
- **Ajouter un effet** : créer le filtre dans OBS sur « overlay cam shushu », puis ajouter son nom à `FX_CAM.effects`.

Écarts avec SAMMI :

- **Remboursements et messages chat** (inconnu, déjà actif, mauvaise scène) : impossibles tant que la récompense
  appartient à SAMMI — même règle que BRB (§ 10) ; refus enregistrés avec leur raison.
- Appel au bridge Shushu non repris (sans effet aujourd'hui, voir ci-dessus).
- Durée : 10 s exactes (SAMMI ≈ 10 s, selon la cadence de son minuteur).
- Espaces internes ignorés (SAMMI refusait « big head ») ; « pixel|drunk » refusé (SAMMI l'aurait accepté puis activé
  un filtre inexistant).

### Commande chat `!fx` (jetons) — non migrée

SAMMI bouton **ID19 « FX CAM (jetons) »** : `!fx` seul → « Pour jouer un effet cam : !fx [effet] pour 2500 jetons. FX :
… » ; `!fx <effet>` → même liste et mêmes compteurs que la récompense (mais **sans condition de scène** et sans le
bridge) ; déjà actif → « aucun jeton retiré » ; solde lu puis **2500 jetons débités via l'API points StreamElements**
(bouton « API_SE ») ; erreur → effet annulé. C'est l'économie historique : **non migrée** (aucun solde touché, aucun
paiement parallèle, aucun jeton consommé en test). Branchement prévu, sans nouvelle implémentation d'effet : la commande
(Commands V2 / Core) appellera `resolveFxCam`, débitera 2500 jetons par le Wallet Core (écriture idempotente, au
cutover économique), puis mettra en file **le même job Studio** `{ interaction: 'fx_cam', effect }` ; le refus
« déjà actif » devra alors rembourser le débit (ou vérifier avant de débiter). À décider à ce moment-là : garder ou
non l'absence de condition de scène de SAMMI.

### Validation manuelle (avec accord, Lab)

1. `npm run studio` ; OBS connecté dans Studio.
2. Onglet « Points de chaîne » → « FX cam » → « + Ajouter une action » → « Interaction native » → « FX Cam » →
   « Enregistrer ».
3. Sur « Scène Fullscreen » (ou Dessin) : champ « avec le texte » = `rage` → « Tester » → le shader rage sur la caméra
   (entrée, ~8 s, sortie), filtre « rage » désactivé ~10 s après dans les filtres de « overlay cam shushu » ;
   historique « Exécutée ✓ FX Cam « rage » ».
4. `RAGE` → même résultat ; `feu` → « effet inconnu », rien dans OBS ; `rage` deux fois rapprochées → la 2ᵉ
   « déjà actif » ; `rage` puis `pixel` → les deux cumulés.
5. Depuis « Just Chatting » : rien (« FX Cam refusé »).
6. Comparer avec la récompense SAMMI (durée, rendu).

## 12. Couleur Cam dans Raptoru (P0.2 C5)

**Statut : COULEUR CAM — DÉVELOPPEMENT TERMINÉ / TESTS AUTOMATISÉS RÉUSSIS / RENDU VALIDÉ DANS OBS / VRAIE RÉCOMPENSE
TWITCH À CONFIRMER / NON DÉPLOYÉ** (code `8e37c35`). Validé visuellement par Antoni le 18/10/2026 dans son vrai OBS
(par « Tester ») : couleurs testées correctes, transitions fluides ; filtre « Raptoru — Couleur Cam » créé sur
« Overlay Shushu » et **« Groupe 2 » retiré d'OBS** par Antoni. Base Lab au 18/10 : 10 tests Studio, **aucune** vraie
redemption « Couleur Cam ». Conséquence : le bouton SAMMI ID45 anime désormais un filtre absent (une redemption
servie par SAMMI en live ne fait plus rien) — décision dans `Raptoru-2.0-ETAT-PROJET.md` § 0.0.7.

Interaction native **« Couleur Cam »** (règle `{ type: 'interaction', interaction: 'color_cam' }`). Code :
`packages/schemas/src/color-cam.ts` (26 préréglages, lecture du texte), `apps/core-api/src/channel-points/service.ts`
(résolution à la réception, comme FX Cam), `apps/studio/server/src/interactions/color-cam.ts`.

### Ce que fait SAMMI (lecture seule du 18/10/2026)

- Récompense Twitch **« Couleur Cam »** (100 points, saisie obligatoire, id `61b64cc8-c6e4-4676-a4b2-7ab7798b8f5c`,
  invite « Couleur : saumon/bleu sombre/…/bleu ciel ») → bouton **ID45 « Couleur Shushu »** (Deck Principal ; durée
  2000 ms, ni en file ni superposable). « Couleur overlay Cam » (ID102, deck inactif, récompense désactivée) et
  « Couleur Shushu INI » (ID45_SYNCH : aucun déclencheur, appelé par rien) sont morts.
- **Cible SAMMI** : filtre natif « Correction des couleurs » du groupe **« Groupe 2 »**, qui ne contient que
  **« Overlay Shushu »** (la page du cadre et des yeux Shushu). **La caméra elle-même n'est pas recolorée.** Le filtre a
  un gamma fixe de 0,47 (jamais animé) ; sa valeur actuelle est « canard ».
- Déroulé : attente 200 ms ; scène « Scène Dessin » ou « Scène Fullscreen », sinon remboursement + « @x pas la bonne scène
  idiot, t'es refund ! » ; texte comparé **exactement** (sensible à la casse, sans nettoyage) à la liste ; `aléatoire`,
  `aleatoire`, `random` → une des 26 au hasard ; inconnu → remboursement + « @x couleur inconnue : … (points
  remboursés) » ; attente 500 ms ; lecture des valeurs actuelles du filtre ; puis 4 **« Motion: Filter Settings »**
  (teinte, contraste, luminosité, saturation) des valeurs actuelles vers le préréglage en **2000 ms, lissage In/Out**
  (doc SAMMI : un `SetSourceFilterSettings` par image SAMMI et par paramètre). Aucun son, aucune validation
  FULFILLED. **La couleur reste** jusqu'à la suivante (aucun retour au neutre).
- Deux demandes rapprochées : bouton non mis en file et non superposable → une demande arrivée pendant les 2 s du
  bouton est **ignorée** (redemption perdue, ni remboursée ni exécutée) ; une demande juste après peut lancer ses
  animations pendant la fin des précédentes (les deux se battent sur les mêmes paramètres).
- **Pas de variante commande chat en jetons** (aucun déclencheur chat lié à la couleur dans les decks).
- Les 26 préréglages (valeurs SAMMI exactes, gamma 0,47 commun) :

  | Couleur     | Teinte  | Contraste | Luminosité | Saturation |
  | ----------- | ------- | --------- | ---------- | ---------- |
  | saumon      | 2.09    | 2.4       | -0.1163    | -0.53      |
  | fuschia     | 31      | 1.08      | -0.0233    | -0.28      |
  | magenta     | 55      | 0.38      | -0.0233    | 0          |
  | violet      | 80      | -0.58     | -0.0233    | 1.97       |
  | myrtille    | 100.47  | -0.58     | 0.0465     | 1.06       |
  | bleu sombre | 100.47  | -0.17     | -0.1279    | 0.63       |
  | bleu        | 144.42  | -0.21     | -0.0349    | 3.19       |
  | cyan        | 163.26  | -0.21     | -0.0349    | 3.19       |
  | turquoise   | 180     | 0         | -0.0116    | 2.22       |
  | orange      | -18.84  | 0.08      | 0.0233     | 1.5        |
  | gold        | -29.3   | 0.38      | 0.0233     | 5          |
  | jaune       | -49     | -0.08     | 0.0233     | 3.59       |
  | lime        | -73     | -0.08     | 0.0233     | 1.97       |
  | vert pomme  | -89     | -0.37     | -0.0581    | 2.91       |
  | vert        | -108.84 | 0.04      | -0.2209    | 1.38       |
  | emeraude    | -144.42 | -0.42     | 0          | 2.28       |
  | rouge       | 0       | -0.42     | 0          | 1.97       |
  | ivoire      | 0       | 2.83      | 0.0465     | -1         |
  | gris        | 0       | 0         | -0.0233    | -1         |
  | canard      | -180    | 0         | -0.0233    | -0.53      |
  | marron      | -23.02  | -0.67     | -0.0233    | -0.47      |
  | givre       | 173.72  | 3         | -0.0233    | -0.78      |
  | rose        | 52.33   | 1.96      | -0.0233    | -0.72      |
  | beige       | -8.37   | 1.96      | -0.0233    | -0.72      |
  | bleu ciel   | -180    | 1.96      | -0.0233    | -0.72      |
  | noir        | 100     | -0.67     | -0.1279    | -1         |

### Dans Raptoru

- **Cible (décision d'Antoni du 18/10/2026)** : le cadre Shushu, comme SAMMI, mais par un filtre dédié posé sur la source
  **« Overlay Shushu »** : **« Raptoru — Couleur Cam »** (filtre natif « Correction des couleurs », réglages par défaut =
  image intacte). « Groupe 2 » n'est plus utilisé. Les shaders FX Cam restent sur la scène « overlay cam shushu » :
  filtres différents, aucun conflit d'ordre (le cadre est recoloré avant que la scène soit composée).
- **Texte** : même circuit que FX Cam (Core fige la couleur résolue ; seul le nom du préréglage va à Studio). Majuscules,
  accents et espaces en trop ignorés (« Bleu Ciel », « Émeraude ») ; `aléatoire` / `aleatoire` / `random` tirés **par
  Core** (l'historique affiche la couleur réellement appliquée) ; tout le reste refusé dans Core (« couleur inconnue »).
  Aucune valeur OBS ne vient du viewer.
- **Animation** : Studio lit les valeurs actuelles du filtre (un réglage manuel est le point de départ), puis envoie
  ~30 fois par seconde **une** requête `SetSourceFilterSettings` (5 valeurs, `overlay`) en 2 s, lissage In/Out
  (sinusoïdal : la courbe exacte de SAMMI n'est pas documentée), chaque pas attendant la réponse d'OBS (jamais
  d'accumulation), dernier pas = préréglage exact. Pourquoi pas une animation locale d'OBS : le plugin Move (installé)
  pourrait animer via un filtre « Move Value », mais il faudrait en créer et régler un de plus dans OBS (réglages propres
  à la version du plugin, non vérifiables sans toucher ton OBS) pour un gain faible ; SAMMI faisait déjà ~4 requêtes par
  image ; ici ~60 requêtes en 2 s, négligeable pour OBS en local.
- **Persistance** : la couleur reste (comme SAMMI). Rien n'est sauvegardé : redémarrage de Studio ou coupure d'OBS
  pendant une transition → la couleur atteinte reste, la suivante part d'elle.
- **Concurrence (écart volontaire, meilleur)** : la plus récente gagne. Une couleur demandée pendant une transition la
  reprend depuis les valeurs atteintes ; l'ancienne s'arrête avant son pas suivant et ne peut plus rien écrire. SAMMI
  perdait la demande (ni exécutée ni remboursée).
- **Erreurs lisibles** : scène sans caméra, filtre absent, filtre désactivé dans OBS, OBS non connecté, OBS perdu
  pendant la transition (« interrompue … couleur atteinte conservée »).

Écarts avec SAMMI : remboursements et messages chat impossibles (récompense créée par SAMMI, comme FX Cam / BRB) ;
normalisation plus tolérante (SAMMI refusait « Rouge ») ; demande pendant une transition reprise au lieu d'être perdue ;
filtre dédié sur « Overlay Shushu » au lieu de « Groupe 2 ».

### Préparer OBS (manipulation manuelle d'Antoni, une seule fois)

1. Source **« Overlay Shushu »** (dans « overlay cam shushu » › Groupe 2) → clic droit › Filtres → **+** › « Correction
   des couleurs » → nom exact **`Raptoru — Couleur Cam`** (tiret long « — »), réglages par défaut, laisser activé.
2. Sur le groupe **« Groupe 2 »** : **masquer (œil)** son filtre « Correction des couleurs » (ne pas le supprimer) — sinon
   l'ancien filtre SAMMI (actuellement « canard ») s'ajoute au nouveau. Retour arrière : réafficher l'œil.
3. Tant que SAMMI tourne, une vraie redemption « Couleur Cam » est aussi traitée par SAMMI (il anime alors le filtre
   masqué de Groupe 2 : sans effet visible). Au cutover : désactiver le bouton SAMMI ID45.

### Tester (Lab, avec accord)

1. `npm run studio`, OBS connecté ; Points de chaîne → « Couleur Cam » → Interaction native → **Couleur Cam** →
   Enregistrer.
2. Scène Fullscreen ou Dessin : « avec le texte » `rouge` → Tester → le cadre passe au rouge en 2 s et le reste ;
   `Bleu Ciel` → transition depuis le rouge ; deux Tester rapprochés → la 2ᵉ couleur reprend la transition ; `pourpre` →
   « couleur inconnue », rien dans OBS ; `aléatoire` → l'historique nomme la couleur tirée ; depuis Just Chatting →
   refus.
3. FX Cam `rage` pendant une couleur : les deux visibles ensemble.
4. Vraie récompense : automatisations **ON** (bouton en haut de l'onglet), un viewer (ou LeCroupier_) prend « Couleur
   Cam » avec `rouge` → historique « Couleur Cam « rouge » » ; remettre OFF après le test.
