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

**Statut : DÉVELOPPÉ / TESTS AUTOMATISÉS RÉUSSIS / NON VALIDÉ DANS OBS.**

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
