# Journal de reprise 21/10 → 24/10/2026 (archive)

> **ARCHIVE** — copie intégrale, à l'identique (exclue de Prettier), de `docs/REPRISE.md` tel qu'il était le
> 24/10/2026 vers 12:05, avant sa réécriture courte. Journal de travail daté (débogage Votekick / OBS, livraisons
> du 22 au 24/10, chantier Roue du Sub V2, bilan du live du 21/10). L'état courant est dans
> [../REPRISE.md](../REPRISE.md), la roadmap dans [../ROADMAP.md](../ROADMAP.md). Les SHA et états ci-dessous sont
> ceux de leur date.

---

# Reprise — état de travail court

Mis à jour : **24/10/2026 12:00** (Votekick : réglages Studio, sup.8, Core 0f753c1 déployé). Lire d'abord la section CHECKPOINT ci-dessous et `git status`.
Tout ce qui suit la ligne « HISTORIQUE » est antérieur et peut être périmé (Roue V2 : `docs/SUB_WHEEL_V2_PLAN.md`).

## CHECKPOINT — 23/10/2026 19:50, avant le stream (relevé réel : Git, worktrees, Coolify, Studio)

### 24/10 12:00 — Core `0f753c1` DÉPLOYÉ en Production (GO Antoni) avec la migration votekick_settings
- Sauvegarde base « Backup now » 09:56:23 UTC réussie (2 058 761 octets, cohérente avec 04:00). Plan : PRÊT. Avant :
  pas de live, aucun vote ni mute. Déploiement `wi0aeakzk1itge8odnswyp5t` (101 s), `applied:
  20261107130000_votekick_settings.sql`. Core `running:healthy` @ `0f753c1` ; bot inchangé `b8bc025` healthy.
- Vérifié : supervision verte, 0 incident ; Studio `/api/votekick/settings` → `available: true`, 60 s ; enregistrement
  de 60 s (valeur identique) → OK, relu ; 10 s → 400 ; exécuteur Votekick prêt (timeout OK), aucun vote ouvert ;
  Caution prête (seule « à vérifier » : l'incident connu du 23/10 16:52 UTC, accepté). **Aucun vote réel lancé.**
- Retour si besoin : `node scripts/coolify-deploy.mjs deploy core 53d6c71f5913fbeb9b433f42eef65af721dcc9b9 --rollback
  --go` (raptoru-release).

### 24/10 11:50 — Votekick V2 : durée réglable + son de lancement — POUSSÉ, Studio sup.8 INSTALLÉ, Core NON déployé
- `origin/main` = **`0f753c1`** (poussé, fast-forward depuis `53d6c71`) : `bad9f14` `8df149e` `9563e20` (mute au
  repos, zoom décimal, bandeau sans minuterie) + `0612b9f` (compte à rebours 63 → 60) + `56eba35` (Core : table
  `votekick_settings`, durée lue à l'ouverture, routes `GET|POST …/votekick/{ch}/settings`) + `0f753c1` (Studio :
  section « Votekick » dans Points de chaîne, son de lancement, import de sons, `/v1/lab/votekick/` autorisé en Lab).
  Détail : `docs/VOTEKICK_V2.md` § 9. Branche locale `vk-wt` `feat/votekick-config`.
- **Production inchangée** : Core `53d6c71`, bot `b8bc025` (Coolify : auto-deploy OFF, vérifié). Studio installé
  **0.1.7-sup.8** (build-info `0f753c1`, = sup.7 + config ; installateur
  `C:\Users\Antoni\Documents\rs-vk\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.8.exe`, SHA-256
  `9d01aca621e6dfab223e2f3a069a3cbaf8f81ae5c879cfb97797facc359f414c`). Sauvegardes :
  `Documents\studio-backup-2026-10-24-avant-sup8\` (seul `Network/Cookies` verrouillé non copié). `rs-vk` : patch sup-wt réappliqué sur `0f753c1` (stash
  de secours `sup-wt patch (sup.7 build) on 9563e20` ; copie `jobs/01d783c9/tmp/rsvk/sup-patch-on-9563e20.diff`).
- Vérifié après installation (sans vote, sans sanction) : supervision toute verte, bot Actif, effets connectés/audio/à
  jour, overlay servi avec `dur`, pré-écoute servie (200), OBS au repos identique (Micro non muté, drive off 0,8, zoom
  1,000001, `zoom_max` 1,101, `mute_duration` 110, drive obsolète off). `/api/votekick/settings` → `core_outdated` :
  champ durée verrouillé à 60 s (attendu tant que le Core n'est pas déployé) ; son de lancement OFF, aucun son.
- Tests : Core 1 001/1 001 (random-ban : délai sous charge, 12/12 seul) ; PostgreSQL 17 réel (Docker jetable) votekick
  + caution + migrations 14/14 (dont sauvegardes simultanées = 1 ligne, vote ouvert garde sa durée) ; Studio 614/614 ;
  typage, eslint, prettier.
- **Prochaine action (GO spécifique Antoni requis)** : déployer le Core `0f753c1` avec la migration
  `20261107130000_votekick_settings.sql` (plan fait : BLOQUÉ en attente d'autorisation ; bot non concerné) :
  sauvegarde base < 60 min, puis `node scripts/coolify-deploy.mjs deploy core 0f753c13ad83f2bd6b04c6e1e29730fb36faa909
  --migrations-approved --go` (raptoru-release). Retour : `deploy core 53d6c71f5913fbeb9b433f42eef65af721dcc9b9
  --rollback --go` (la table reste, sans effet sur l'ancien Core).
- Non validé par Antoni : la section Votekick dans Studio (rendu réel), le son de lancement sur un vrai vote, une durée
  ≠ 60 s (après déploiement du Core). Votekick réel sur raptoru_ préparé, NON lancé (GO requis).

### Bilan du live 23/10 (20:03 → 00:18, stream 318103323748) — relevé 24/10 00:30, lecture seule
- Aucune déconnexion Twitch/EventSub, une seule instance de bot, jetons rafraîchis seuls, Core sans redémarrage,
  0 erreur Core/bot, 597 messages chat envoyés sans échec.
- Caution : 2 libérations réelles (raptoru_ → jongdaess 10 000 ; cilouic → danaen_ 21 000), 1 annulée, 1 refusée
  (« danaen » sans timeout) ; aucune nouvelle « à vérifier ».
- Votekick : 4 votes ; coinflip → jongdaess 6 min ; backfire → danaen_ 22 min ; no_timeout ; raptoru_ condamné →
  **mute streamer réel 55 s puis rétabli (expired, sans « not restored »)**. Timeouts confirmés par Twitch.
- Tombola : 10 tirages sur `d12429f`, 10 messages groupés (5 à plusieurs gagnants, jusqu'à 4), pseudos et montants =
  gains payés, 1 message par tirage → **annonce groupée validée en réel**.
- Random Ban (points de chaîne) : 1 confirmé.

### 24/10 10:55 — Horloge Windows : W32Time corrigé (GO Antoni)
- Cause de la dérive : W32Time arrêté, démarrage « Manuel » (déclencheurs domaine/réseau) → synchro seulement
  ponctuelle (manuelle ou tâche hebdomadaire) ; l'horloge du PC dérive d'environ 0,15 s/h.
- Appliqué (sauvegarde `Documents\backup-2026-10-24-w32time\w32time-before.reg` / `after.reg`) : démarrage
  automatique différé + service démarré ; `SpecialPollInterval` 32768 → 3600 s (le serveur `time.windows.com,0x9`
  utilise bien cet intervalle grâce au drapeau 0x1). Rien d'autre changé (diff du registre : Start, DelayedAutostart,
  SpecialPollInterval, et l'état interne mis à jour par le service).
- Vérifié : synchronisé à 10:50:54 sur time.windows.com (51.145.123.29), couche 5 ; écart avec core.raptoru.fr ≈ 0,01 s.
  Régularité à confirmer : la « dernière synchronisation réussie » doit avancer d'environ 1 h (`w32tm /query /status`).

### 24/10 10:50 — Votekick : timer 63 s au lieu de 60 — diagnostic + correctif préparé (NON commité, NON construit)
- Vrai Votekick hors live (24/10 08:38, chechay → raptoru_, 3/0, Perfect, mute 60 s) : concluant (mute, zoom, bandeau,
  restauration). Core : scrutin de 60 s exactes (ouverture 08:38:05.858, verdict +60,18 s = tour de 500 ms), votes
  refusés dès `ends_at` (horloge Core) — inchangé.
- Cause du 63 : l'overlay legacy compte `ceil((ends du Core − horloge du PC)/1000)` ; le PC retarde de ~2,2 s
  (« Temps Windows » non synchronisé en continu) → 62–63 à l'ouverture.
- Correctif (`vk-wt` `fix/votekick-mute-rest`, fichiers modifiés non commités) : `legacy/votekick-overlay.html` →
  `localEnds()` = maintenant + min(ends − maintenant, durée du vote), ancré une fois par vote ; test
  `apps/studio/server/test/votekick-legacy-overlay.test.js` (5/5, échoue sur l'ancienne page). Votekick Studio 38/38,
  Core votekick + chaîne OK. Contrôle navigateur réel (horloge décalée de 3 s) : départ à 60 (58 après ~2 s).
- Mise en service (sur GO) : commit, build sup.8, installation (page servie par Studio, rien côté Core/bot).
  Recommandé en plus : remettre « Temps Windows » en démarrage automatique (le PC dérive de ~0,2 s/h).

### 24/10 10:35 — Studio 0.1.7-sup.7 INSTALLÉ et VALIDÉ en test local (25 s, contrôleur sup.7 sur OBS réel, sans
Core ni Twitch) — prochaine étape décidée par Antoni : un vrai Votekick hors live
- Sauvegardes : `Documents\backup-2026-10-24-avant-sup7\` ; OBS identique avant/après installation (Voicemod, facteur
  0,8, `zoom_max` 1,101, `mute_duration` 110, filtres au repos) ; supervision entièrement verte.
- Mesures : 230 relevés, 157 valeurs, silences ≈ 1,000001 (98 < 1,005), voix jusqu'à 1,232 (90 > 1,02) ; « Micro »
  coupé et bandeau actif avec `mute_duration` 0 à chaque contrôle ; fin à t = 25 030–25 031 ms : drive off → zoom
  1,000001 → zoom off → bandeau off (même milliseconde) → `mute_duration` 110 → « Micro » rétabli en dernier ; rapport
  « ok », état final identique à la sauvegarde.
- Git local non poussé : `vk-wt` `fix/votekick-mute-rest` = `53d6c71` + `bad9f14` + `8df149e` + `9563e20`.

### 24/10 10:25 — Studio 0.1.7-sup.7 CONSTRUIT (bandeau synchronisé avec le zoom) — historique
- Cause : le shader du bandeau s'efface seul à `mute_duration` (Studio y écrivait la durée du mute) alors que le zoom
  dure jusqu'à ce que la fin du Core atteigne Studio (latence du « started » + tour Core 500 ms + lecture Studio 400 ms)
  → 0,3 à 1,2 s de zoom sans bandeau (≈ 0,1–0,3 s dans le test local).
- Commit local **`9563e20`** (`vk-wt` `fix/votekick-mute-rest`, après `8df149e`, NON poussé) : `mute_duration = 0`
  (« illimité » pour le shader) pendant tout le mute, jamais réécrit lors d'une prolongation ; fin inchangée (drive off,
  zoom au repos, zoom + bandeau off ensemble, `mute_duration` d'origine (110) restauré, micro en dernier). Zoom,
  REST_ZOOM, Audio Move, Voicemod : intouchés.
- Tests : votekick Studio 24/24 (fin normale, prolongation, caution anticipée, retour à l'état initial ; les nouveaux
  échouent avec sup.6) ; suite Studio séquentielle 618/619 (seul échec `sub-wheel` « bad port », 4/4 relancé seul deux
  fois, fichier non touché) ; typage, lint, prettier.
- Installateur : `C:\Users\Antoni\Documents\rs-vk\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.7.exe`,
  SHA-256 `0ab41c7891c10162009203a1c8c7a038d049fe40d2ae8330845efae29e0888bc`, build-info sha 9563e20 ; = sup.6 + 9563e20.

### 24/10 10:10 — Studio 0.1.7-sup.6 INSTALLÉ et VALIDÉ en test local (contrôleur sup.6 sur OBS réel, sans vote)
- Sauvegardes avant : `Documents\backup-2026-10-24-avant-sup6\`. Supervision entièrement verte, bot Actif, overlay
  legacy, Votekick/Caution/Tombola OK ; OBS : Voicemod sur « Micro », facteur 0,8, `zoom_max` 1,101, filtres au repos.
- Test A sup.6 (25 s, aucun rafraîchissement, `zoom` entier au départ) : 1er relevé 1,000001, 148 valeurs distinctes,
  silences ≈ 1,000001 (105 relevés < 1,005), voix jusqu'à 1,283 (102 relevés > 1,02) ; « Micro » coupé et bandeau
  visible pendant tout le mute ; fin « ok », drive/zoom/bandeau off, zoom 1,000001, « Micro » rétabli, identique à la
  sauvegarde. **Zoom réactif automatisé : OK.** Reste : un vote réel hors live (`!votekick raptoru_`), sur GO.

### 24/10 10:00 — Studio 0.1.7-sup.6 CONSTRUIT (correctif zoom décimal) — historique
- Commit local **`8df149e`** (`vk-wt` branche `fix/votekick-mute-rest`, après `bad9f14`, NON poussé) :
  `mute-controller.ts` écrit le zoom de repos en DÉCIMAL `REST_ZOOM = 1.000001` (début, fin, nouvelle tentative) et
  relit avec ± 0,001 ; `sim-obs.ts` reproduit obs-websocket (JSON entier → int, décimal → double) et la troncature
  d'Audio Move. Mécanisme confirmé dans les sources : obs-websocket `src/utils/Json.cpp` l. 72-75, Move `audio-move.c`
  l. 798-807 (`(long long)val` si entier).
- Tests : votekick Studio 21/21 (dont la panne du 23/10 reproduite ; les nouveaux tests échouent avec le contrôleur
  sup.5 et passent avec sup.6) ; suite Studio complète séquentielle 616/616 ; typage, lint, prettier.
- Installateur : `C:\Users\Antoni\Documents\rs-vk\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.6.exe`,
  SHA-256 `e830912ad21f576a221c897e4d9fc0ec14c69dfdbd52476cd78500f0a5be2a83`, build-info sha 8df149e ; = sup.5 + 8df149e.
- Après installation (sur GO) : refaire le test local A (contrôleur sup.6, sans rafraîchissement) → le zoom doit varier.

### 24/10 09:30 — CAUSE RACINE du zoom figé TROUVÉE (tests A/B locaux, contrôleur sup.5 sur OBS réel, sans Core/Twitch)
- Studio écrit `{"zoom": 1}` → JSON entier → OBS stocke `zoom` en ENTIER → Audio Move (Move 3.2.1, branche
  OBS_DATA_NUM_INT) écrit `(long long)(1 + factor × niveau)` = 1 → drive figé. SAMMI écrivait `{"zoom":1.0}` (décimal).
  Explique aussi le live du 23/10 (sup.3 écrivait déjà `zoom: 1`) et le « 1 → 1,01 » manuel d'Antoni.
- Test A (sup.5 inchangé) : 230 relevés, zoom = 1,000000 partout. Test B (même cycle + `zoom = 1,01` écrit une fois
  après le démarrage) : 144 valeurs distinctes, silences ≈ 1,0002 (111 relevés < 1,005), voix jusqu'à 1,234 (98 relevés
  > 1,02), **« Micro » coupé pendant tout le mute** → la mesure fonctionne micro coupé. Fin au repos, identique à la
  sauvegarde, dans les deux tests (`Documents\obs-backup-2026-10-24-mute-testA|B\`).
- Correctif proposé (pas codé) : Studio n'écrit jamais `zoom` entier — valeur de repos décimale (1,000001, invisible) au
  début et à la fin ; vérification avec tolérance. Réglages Antoni actuels : drive factor 0,8, `zoom_max` 1,101.

### 24/10 02:55 — Studio 0.1.7-sup.5 INSTALLÉ (GO Antoni) — test de mute hors live en attente d'accord
- Commit local **`bad9f14`** (`vk-wt` branche `fix/votekick-mute-rest`, depuis `53d6c71`, NON poussé) : mute-controller
  (réglages du drive jamais écrits ; zoom + bandeau coupés ensemble ; fin toujours au repos, micro en dernier).
- Installateur : `C:\Users\Antoni\Documents\rs-vk\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.5.exe`,
  SHA-256 `d8d527f734a32c86418823d25d0cb5ce5e6a99ff6d638c9503486e91ff156b7f`, build-info sha bad9f14 ; = sup.4 (sup-wt +
  overlay legacy servi par le code + avatars côté Core) + bad9f14. Tests : votekick Studio 18/18 ; suite Studio
  séquentielle 612/613 (seul échec `bonk-lab`, 14/14 relancé seul : aléa connu).
- Sauvegardes avant installation : `Documents\backup-2026-10-24-avant-sup5\` (données Studio Roaming + collection OBS +
  `obs/filters-reference.json`). Après installation : supervision verte (Soundboard « Lecteur absent » = onglet Studio
  non ouvert, connu), bot Actif, comptes valides, overlay legacy aux 2 URLs, Votekick/Caution/Tombola OK, **OBS
  inchangé** par Studio (relu).
- OBS de référence (Antoni) : « Micro » = **Voicemod** (rétabli), drive « Micro » factor 0,5, `zoom_max` 1,08. Réserve :
  drive « Micro » et « Votekick Zoom » sont ACTIVÉS au repos → la caméra zoome hors Votekick ; le 1er mute les laissera
  désactivés (nouveau comportement voulu).
- Production inchangée : Core `53d6c71`, bot `b8bc025`, flags Caution/Votekick ON.

### 24/10 02:30 — Zoom Votekick FONCTIONNEL avec Audio Move (réglé par Antoni) — décision : on garde Audio Move,
le zoom piloté par Studio (sup.5 « vu-mètres ») est ABANDONNÉ
- Ce qui l'a débloqué (journal OBS 02:09) : périphérique de « Micro » passé de « Microphone (Voicemod) » à « Chat Mic
  (GoXLR Mini) », puis `zoom_max` remonté (1,0114 → 1,08) par Antoni. Antoni : le zoom réagit aussi micro coupé.
- Référence OBS fonctionnelle sauvegardée : `Documents\obs-backup-2026-10-24-zoom-reference\` (collection + filtres).
  Drive « Micro » : factor 0,5, meter_type 0, easing 0, threshold 0 → « Votekick Zoom » `zoom` ; `zoom_max` 1,08 ;
  drive « Micro (Obsolète) » désactivé (factor 0,75). À 02:19, drive « Micro » ET « Votekick Zoom » étaient ACTIVÉS
  (état de réglage) : à remettre au repos (désactivés) par Antoni avant le live.
- Correctif Studio préparé, NON commité : `vk-wt` branche `fix/votekick-mute-rest` (depuis `53d6c71`),
  `mute-controller.ts` : (1) plus aucune écriture des réglages du drive (retrait du « réarmement » de sup.4, inutile) ;
  (2) fin : zoom et bandeau désactivés ensemble, sans animation de sortie ; (3) après un mute, toujours l'état de repos
  (drive, zoom, bandeau off, zoom 1, durée du bandeau restaurée), micro rendu à son état d'avant, rétabli en dernier.
  Tests votekick Studio 18/18, typage, lint, prettier. Nécessite un build Studio (sup.5) sur GO.
- Note : la diffusion passe maintenant par le GoXLR en direct (Voicemod n'est plus sur « Micro »).

### 24/10 ~02:00 — Zoom Votekick : toujours KO, diagnostic en cours (historique)
- Fait (GO) : « Votekick Zoom Drive » sur « Micro (Obsolète) » DÉSACTIVÉ (permanent). Drive « Micro » désactivé au repos,
  « Votekick Zoom » off / zoom 1, « Votekick Mute » inchangé. Sauvegardes : `Documents\obs-backup-2026-10-24-zoom\`.
- 3 tests de 45 s (dont 1 après redémarrage d'OBS à 01:51) : zoom figé à 1 (max 1,000012) alors que les vu-mètres
  OBS voient la voix sur « Micro » (−15/−20 dB, 2 canaux égaux) → l'Audio Move ne reçoit aucun niveau. Aucun autre
  filtre n'écrit dans `zoom`. Le renvoi des réglages (sup.4) et le redémarrage d'OBS n'y changent rien.
- Piste principale : plugin Move Transition **3.1.1 (DLL du 23/10/2024)** sur **OBS 32.2.2 (installé le 18/08/2026)** ;
  version actuelle 3.2.1 (« requires OBS 31.1+ »). SAMMI faisait la même chose (mute de « Micro (Obsolète) » puis drive
  activé sur la même source) : à confirmer par Antoni si le zoom marchait encore après le 18/08.
- 02:00 (GO) : Move Transition mis à jour en **3.2.1** (zip officiel GitHub, digest `cc74ddba…e154c`, DLL copiée dans
  Program Files ; sauvegarde 3.1.1 + config OBS : `Documents\obs-backup-2026-10-24-move-3.1.1\`). OBS relancé : « loaded
  version 3.2.1 », filtres Votekick et Creepy intacts, aucune erreur nouvelle. **Test 45 s : zoom toujours figé à 1** →
  la version du plugin n'est pas la cause. Filtres au repos (relu).
- 02:20 : historique retrouvé — « Micro (Obsolète) » = ancien « Micro » (coupé en permanence, mesure brute), « Micro »
  = ancien « Micro (VM) » (diffusion) ; réglages Audio Move identiques partout. Test 15 s du drive HISTORIQUE (sur
  l'entrée coupée, GO) : zoom figé à 1 aussi → Audio Move ne fonctionne sur aucune source dans cet OBS 32.2.2. État
  final identique à la sauvegarde (`filters-before5/after5.json`).
- Décision attendue : zoom piloté par Studio (crête d'entrée brute « inputPeak » des vu-mètres OBS, lisible sur une
  entrée coupée), design prêt, pas de code.
- Piste suivante (décision Antoni) : faire piloter le zoom par Studio pendant le mute à partir des vu-mètres OBS
  (InputVolumeMeters de « Micro », prouvés fonctionnels) au lieu du filtre Audio Move → nouveau build Studio.

### 24/10 01:25 — MIS EN SERVICE (GO Antoni) : `origin/main` = **`53d6c71`**, Core déployé sur `53d6c71`
(déploiement `c1i7acnh7er8oc9j5rhyagfa`, sans migration, health/ready 200, 0 erreur, bot `b8bc025` inchangé, flags
Caution/Votekick inchangés), **Studio 0.1.7-sup.4 INSTALLÉ** (données Roaming préservées, sauvegarde
`Documents\studio-backup-2026-10-24-avant-sup4`) : supervision verte, overlay legacy servi par le code aux deux URLs
(`/votekick/overlay.html?studio` et l'alias OBS `…/variants/variants.html?v=D&studio`), variante D plus servie.
Avatars : câblage déployé (lookup Helix app token actif : « Twitch names ON ») — preuve réelle au 1er vote.
Supervision après lancement : « Soundboard : Lecteur absent » — pas une régression : le lecteur est l'iframe du
panneau Soundboard de l'onglet « Studio runtime », chargée seulement quand cet onglet est visible (`sound-lab.ts`
setVisible) et Studio a rouvert sur l'onglet mémorisé « tombola ». Ouvrir l'onglet Studio → « Prêt ». À améliorer
(P3) : charger le lecteur quel que soit l'onglet ; le texte d'aide parle à tort d'une source OBS.
**Reste sur GO** : OBS — désactiver « Votekick Zoom Drive » sur « Micro (Obsolète) », contrôle du zoom à la voix sur
« Micro », puis test réel du mute (`!votekick raptoru_` consenti, hors live). Rollback Core : `deploy core d12429f… --rollback --go`.
Le paragraphe suivant décrit la préparation (historique).

### 24/10 01:20 — Visuels Votekick : COMMITÉS localement, sup.4 CONSTRUIT (historique)
- `vk-wt` branche `fix/votekick-visuals` = `d12429f` + **`abf20a7`** (Core : avatar de la cible via le cache Tombola)
  + **`53d6c71`** (Studio : drive réarmé avant le mute ; overlay legacy servi durablement). **Pas poussés** (origin/main
  = d12429f). Push = avance rapide, 10 fichiers, 0 migration / schéma / bot.
- Production réelle : Core `d12429f`, bot `b8bc025` (Coolify, relu 01:10). Rien déployé depuis.
- **Studio 0.1.7-sup.4** : `C:\Users\Antoni\Documents\rs-vk\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.4.exe`,
  SHA-256 `0844ce91af7326b7b8af80b748f15cde857fbb759e4b393df8b819e01657c5bf`, build-info sha 53d6c71 ; contenu = sup.3
  (sup-wt : supervision, OAuth, Soundboard) + 53d6c71. Suite Studio serveur sur l'arbre combiné : 563/612 en parallèle,
  les 22 fichiers en échec repassent tous en séquentiel (205/205) → flakes de charge connus. NON installé.
  Après installation : `/votekick/overlay.html?studio` et l'alias `/votekick/variants/variants.html?v=D&studio` (URL
  OBS actuelle) servent la page legacy depuis le code ; plus besoin de la recopie à chaud ; la variante D n'est plus servie.
- Mise en service (sur GO) : push → `deploy core 53d6c71…` ; installer sup.4 (données dans %APPDATA%\Raptoru Studio,
  non touchées par l'installateur NSIS) ; OBS : désactiver le drive de « Micro (Obsolète) » ; test réel du mute.

### 24/10 ~01:00 — Visuels Votekick après le live : diagnostic (correctifs ci-dessus)
- **Zoom absent** : Studio a bien tout commandé (snapshot OK, 0 « not restored »). Cause : le plugin Move Transition
  3.1.1 n'attache le vu-mètre d'un filtre « Audio Move » que dans `update`/`load` (pas de `filter_add`) → le
  « Votekick Zoom Drive » **collé à chaud sur « Micro » le 23/10 ~18:40** ne lisait aucun audio jusqu'au redémarrage
  d'OBS (fait à 00:17) → `zoom` resté à 1. Preuves : source du plugin, `zoom` = 1 exact dans la collection sauvegardée.
  2e cause à venir : l'ancien drive sur « Micro (Obsolète) » est **toujours activé** (il réécrit `zoom = 1` à chaque
  image dès qu'un autre drive le change) → à désactiver/supprimer dans OBS (manuel, sur GO).
  Correctif Studio : `mute-controller.ts` renvoie les réglages du drive (SetSourceFilterSettings, inchangés) juste avant
  de l'activer → l'`update` du plugin réattache le vu-mètre. Test `votekick-mute.test.ts`.
- **Avatars absents** : le Core envoyait `avatar: ''` (service.ts overlay()). Le bot ne remonte pas d'URL ; la base n'en
  stocke pas pour Votekick. Correctif Core (sans migration, sans bot) : réutilise le cache Tombola `lab_viewer_avatars`
  + lookup Helix app token (`AvatarCache.ensure(ids)` nouveau) ; `VotekickService.attachAvatars()` branché dans
  `public-frontier.ts` (prod) et `local-server.ts` (Lab) ; à l'ouverture d'un vote réel, fetch en arrière-plan ;
  `overlay()` lit l'URL (live + verdict), '' sinon (fallback initiales de la page legacy). Test `votekick-service.test.ts`.
- Tests : Core votekick/chain/raffle 75/75, typecheck, lint ; Studio votekick 17/17, typecheck. Non testé : vrai OBS.
- Mise en service (sur GO) : commit → push `main` → `deploy core` (avatars) ; Studio : nouveau build/installateur
  (sup.4) + réinstaller + recopier l'overlay legacy ; OBS : désactiver le drive de « Micro (Obsolète) », vérifier le
  zoom à la voix (Filtres de « Micro » → drive activé → parler → `zoom` bouge dans « Votekick Zoom »).

### Production
- **19:59 — Core déployé sur `d12429f`** (GO Antoni ; déploiement `7k0ui0vmbly5mdc1rckztsjj`, sans migration) :
  `origin/main` = `d12429f` (b8bc025 + `cf21c4b` + `467185c` + `d12429f`). Bot **resté sur `b8bc025`** (non redéployé).
  `/health` `/ready` 200, 0 erreur, Studio connecté, flags Caution/Votekick inchangés. Annonce groupée Tombola EN
  PRODUCTION : validée par tests auto seulement — **à valider en réel** (Tombola à plusieurs gagnants). Rollback :
  `deploy core b8bc025668ebd075e94beef5bbeed1a51723626c --rollback --go`.
- `origin/main` = **`b8bc025`** (Caution + Votekick V2, Node 22.23.4). **Core et bot déployés sur `b8bc025`**, `running:healthy`,
  `/health` `/ready` 200, 0 erreur dans les journaux. Déployés par `scripts/coolify-deploy.mjs` (raptoru-release) le 23/10
  18:20 (Core `nflc7frycbcspcl08hozzvgl`, bot `rwbwtxkmclpbhc2cfefcilhl`) ; sauvegarde base 18:18 (jkg2qa9izsl5zlpuhef6bnpp).
- Migrations `20261105130000_caution.sql` + `20261106130000_votekick.sql` : appliquées à la main par Antoni, puis vérifiées
  conformes et enregistrées dans `schema_migrations` par `--migrations-preapplied`.
- Variables Coolify (en plus de l'existant) — Core : `CAUTION_CHAT=true`, `VOTEKICK_CHAT=true` · bot : `CAUTION=true`,
  `VOTEKICK=true`, `CAUTION_JOURNAL_FILE=/data/.caution-journal.json`, `VOTEKICK_JOURNAL_FILE=/data/.votekick-journal.json`
  (copies « preview » créées par Coolify, alignées, sans effet). `/data` = volume persistant `raptoru-bot-data`.
- Couper une fonction : ses deux flags à `false` puis restart Core et bot (Coolify, ~2 min chacun, bot ~75 s sans Twitch).
  Rollback code : `node scripts/coolify-deploy.mjs deploy core|bot 2d80c2aa548a1999fd1b3bfa5d44ea13104662e5 --rollback --go`.
- Jeton Coolify : `~/.raptoru/coolify-token.txt` (`raptoru-deploy-automation`, read + read:sensitive + write + deploy).

### Fonctions
| Fonction | État | Validé en réel (Antoni) |
| --- | --- | --- |
| Caution | ACTIVE | **Oui**, 19:19 : `22477dc3-…` released, un seul débit 10 000 (raptoru_ 475 046 → 465 046) |
| Votekick V2 | ACTIVE (moteur) | **Partiel** : votes ouverts et clos en réel (2 × `no_quorum`) ; **reste à tester** : timeout d'un viewer (3 votants, Perfect 12 min) et mute du streamer (« Micro » coupé puis rétabli en dernier) |
| Overlay Votekick | design **legacy SAMMI** (rollback visuel, voir correctifs temporaires) | affiché correctement dans OBS (Antoni) |
| Studio | **0.1.7-sup.3** installé (sup.2 + mute Votekick) ; données sauvegardées avant : `Documents\studio-backup-2026-10-23-avant-sup3` | supervision verte |
| OBS | source « Votekick (V2) » dans « Alerte complète », 1920×1080 en (0,0) ; « Votekick Zoom Drive » copié sur « Micro » ; routage micro corrigé par Antoni | — |

- Incident Caution 18:52 (clos) : demande `53949be1-de82-459f-acea-d25e35354dda` = `uncertain`/`to_verify`, 10 000 Jetons de
  raptoru_ débités, timeout jamais levé (bot sans droit d'écriture sur son journal → corrigé par les variables ci-dessus).
  **Perte acceptée par Antoni, aucun remboursement.** Lecture SQL : `rs-vk\GO\caution_incident_53949be1_lecture.sql`.
- Horloge du PC : **~7,7 s de retard** sur le serveur (service « Temps Windows » arrêté) → le compte à rebours de l'overlay
  affiche ~67 s (le Core, lui, compte 60 s exactes). À corriger par Antoni : Paramètres → Heure → Synchroniser maintenant.

### Correctifs temporaires (risque de régression)
1. **Overlay legacy installé à chaud** : `C:\Users\Antoni\AppData\Local\Programs\Raptoru Studio\resources\app\apps\studio\server\votekick-overlay\variants\variants.html`
   contient la page legacy (original : `variants.D-original.html.bak` à côté). **Toute réinstallation / mise à jour de
   Studio remet la variante D** → recopier `vk-wt/apps/studio/server/votekick-overlay/legacy/votekick-overlay.html` au
   même endroit, ou (durable) servir `legacy/votekick-overlay.html?studio` (regex de `votekick/runtime.ts`) + URL OBS.
2. Chemins des journaux du bot : posés par variables Coolify ; le correctif d'image (`cf21c4b`) n'est pas poussé.

### Git — à préserver (rien n'est poussé au-delà de `b8bc025`)
| Où | Branche @ SHA | Contenu |
| --- | --- | --- |
| `scratchpad/vk-wt` | `feat/votekick-v2` @ `d12429f` = `origin/main` | `cf21c4b`, `467185c`, `d12429f` **poussés** (Core déployé ; bot et Studio : pas reconstruits) |
| `Documents/raptoru-release` | `chore/coolify-deploy` @ `80f3525` (pas sur main) | automatisation Coolify `--migrations-preapplied`, tests 12 + 8 — **non poussé** |
| `Documents/rs-vk` | copie de build de sup.3 + `GO/` (runbook, SQL) | ne pas supprimer |
| checkout principal | `main` @ 11ffe3f, ~76 modifs **Roue V2** + ce fichier | non commité, ne pas toucher |
| `scratchpad/sup-wt` | `fix/supervision` @ 2d80c2a, 36 modifs | Supervision/OAuth/Soundboard (dans sup.2/sup.3) — **non commité** |
| `scratchpad/node-wt`, `chat-wt`, `wg-wt`, `solde-wt` | copies d'origine (déjà intégrées) | conserver |
(`scratchpad` = `C:\Users\Antoni\AppData\Local\Temp\claude\C--Users-Antoni-Documents-Raptoru-2-0\c435dbde-5dd7-4b54-8561-68eabf04712a\scratchpad`)

### Décisions acquises
- Design Votekick : **legacy SAMMI pour l'instant** ; la variante D ne doit pas revenir ; design V2 final à décider plus tard.
- Micro du streamer = « Micro », jamais « Micro (Obsolète) ».
- 10 000 Jetons de l'incident : pas de remboursement.
- « LeCroupier_ peut voter » : comportement laissé tel quel.

### Tombola groupée — poussé et déployé (Core) le 23/10 19:59, voir Production
- **`d12429f`** Tombola, annonce groupée des gagnants : `vk-wt` `apps/core-api/src/raffle-lab/raffle-lab-service.ts`
  (`raffleWinnersMessages` + `announceWinners`) + tests `win-announcements(.integration).test.ts`. Core seul, sans
  migration. Tests : 65/65 unitaires Tombola (dont découpage de 40 gagnants ≤ 500 caractères), 7/7 intégration
  PostgreSQL 17 (deux Cores, un seul message), typecheck et lint OK. Mise en service (sur GO, après le live) : push
  `feat/votekick-v2:main` (avance rapide, emporte aussi `cf21c4b` + `467185c`) → `deploy core d12429f… --go` (~2 min
  sans Core) → Tombola réelle à plusieurs gagnants. Rollback : `deploy core b8bc025… --rollback --go`.

### Reporté après le live
- Son configurable à l'ouverture d'un Votekick (déclencheur dans `VotekickRuntime` + Soundboard/sound-lab, nouveau build Studio).
- Design final Votekick V2 ; rendre l'overlay legacy durable (voir correctifs temporaires).
- Pousser / commiter : `80f3525` (raptoru-release), `sup-wt`. Redéployer un jour le bot sur ≥ `cf21c4b` (chemins /data dans l'image).

### Ordre de reprise après le stream
1. Bilan du live (journaux bot/Core, `!votekick`, `!caution`, « à vérifier »).
2. Tests réels Votekick restants : A (timeout viewer) puis B (mute streamer), comptes consentants.
3. Synchroniser l'horloge Windows si pas fait.
4. Pérenniser : pousser `cf21c4b` + `467185c` (sur GO), overlay legacy servi durablement, commit de `sup-wt` (sur GO).
5. Son Votekick, puis design V2 final. Reprendre Roue V2 ensuite.

### Autorisations
- Déjà accordé (23/10) : déploiement Core + bot sur `b8bc025` (fait), activation Caution et Votekick (faite).
- **Nouveau GO requis** : tout push, déploiement, redémarrage ou changement de flags/variables Production, migration,
  installation Studio, modification OBS, remboursement / ajustement Wallet, sanction Twitch hors tests consentis.

---

## HISTORIQUE (23/10 et avant — peut être périmé, voir CHECKPOINT ci-dessus)

> **23/10 18:23 — DÉPLOYÉ : Core et bot sur `b8bc025`** via `coolify-deploy.mjs` (jeton corrigé). Sauvegarde 18:18
> (jkg2qa9izsl5zlpuhef6bnpp, 1,83 Mo). Core (nflc7frycbcspcl08hozzvgl) : vérificateur OK — caution + votekick conformes
> sur `raptoru_prod`, enregistrés dans `schema_migrations` ; health/ready 200 ; Node 22.23.4 ; commande post-déploiement
> rétablie. Bot (rwbwtxkmclpbhc2cfefcilhl) : bail repris, EventSub créé, version b8bc025668eb, aucun exécuteur
> Caution/Votekick (flags OFF). Rollback : `deploy core|bot 2d80c2aa548a1999fd1b3bfa5d44ea13104662e5 --rollback --go`.
> 18:32 — Studio 0.1.7-sup.3 INSTALLÉ (sauvegarde des données : `Documents\studio-backup-2026-10-23-avant-sup3`) :
> supervision verte, Core connecté, Soundboard prête, overlay `/votekick/variants/variants.html?v=D&studio` 200 (clear).
> OBS (lu via Studio) : « Votekick Zoom Drive » est sur « Micro (Obsolète) », PAS sur « Micro » (aucun filtre) → mute
> streamer refusé avant toute modification tant qu'Antoni ne copie pas le filtre sur « Micro » ; source « Votekick (V2) »
> absente de « Alerte complète » (à ajouter à la main : mot de passe OBS chiffré par Studio).
> 18:51 — CAUTION ACTIVÉE en Production (GO Antoni) : `CAUTION_CHAT=true` (Core) et `CAUTION=true` (bot) via l'API
> Coolify (+ copies « preview » créées par Coolify, sans effet), les deux redémarrés (restart, même SHA). Bot :
> `[caution] exécuteur prêt — lecture : oui, levée : oui`. Votekick OFF. Désactiver : mêmes variables à `false` +
> restart. 18:52 — INCIDENT au 1er test réel : demande `53949be1-de82-459f-acea-d25e35354dda` (raptoru_ paie 10 000
> pour viewerumobilu, timeout jusqu'à 19:02:41) = `releasing`, money `debited`, JAMAIS levée : le bot écrit son journal
> dans `/app` (non inscriptible, `EACCES .caution-journal.json.tmp`) AVANT l'unban → unban jamais envoyé, exécuteur
> bloqué (boucle « tick failed »), Core « indisponible » (aucun autre débit). Cause : Dockerfile du bot sans
> `CAUTION_JOURNAL_FILE` / `VOTEKICK_JOURNAL_FILE` sur `/data` (Votekick aurait eu la même panne). Correctif local NON
> commité dans `vk-wt` : Dockerfile + `apps/twitch-bot/test/dockerfile-data-paths.test.ts` (échoue sans, passe avec).
> Les 10 000 Jetons : à décider par Antoni (pas de remboursement automatique).
> **19:19 — CAUTION VALIDÉE EN RÉEL** (flags ON depuis 19:12) : demande `22477dc3-daf4-4f58-9802-0608252eea5b`, raptoru_
> → viewerumobilu, 10 000, `released`/`debited`, un seul débit (solde 475 046 → 465 046, refunds 0), bot
> `[caution] viewerumobilu: released`, journal sur `/data`, 0 EACCES. Ancienne demande 53949be1 = `uncertain`/`to_verify`
> (perte acceptée par Antoni, pas de remboursement).
> **19:26 — VOTEKICK ACTIVÉ** (GO Antoni) : `VOTEKICK_CHAT=true` (Core), `VOTEKICK=true` (bot), Caution conservée ;
> redémarrés, `[votekick] exécuteur prêt — lecture : oui, timeout : oui`, 0 EACCES, overlay clear, « Votekick Zoom
> Drive » sur « Micro ». Tests réels A (viewer) et B (mute streamer) : en attente. Désactiver : les deux flags à
> `false` + restart Core et bot.
> **19:35 — ROLLBACK VISUEL VOTEKICK (local, sans déploiement)** : la variante D (exploration) est remplacée par l'ancien
> design SAMMI. Source : `vk-wt/apps/studio/server/votekick-overlay/legacy/votekick-overlay.html` + mode `?studio`
> (pas de mode test, lit `/votekick/event` toutes les 300 ms) — NON commité. Installé à chaud dans Studio sup.3 à la
> place de `…/Raptoru Studio/resources/app/apps/studio/server/votekick-overlay/variants/variants.html` (original gardé :
> `variants.D-original.html.bak`) → URL OBS inchangée. Moteur, Core, bot, flags, runtime Studio : inchangés. Une
> réinstallation de Studio remet la variante D. Durable (plus tard, sur décision) : servir `legacy/…?studio` (regex de
> `votekick/runtime.ts`) et changer l'URL OBS, ou trancher le design final.
> 19:45 — Timer : Core = 60 s exacts (`VOTEKICK.voteMs`, ballots refusés dès `ends_at`, vu en réel 17:27:58.628 →
> 17:28:58.628). L'overlay compte à rebours sur `ends` (heure serveur) − horloge du PC : le PC retarde de ~7,5 s
> (service « Temps Windows » arrêté) → affichage ~67 s. Correctif = synchroniser l'horloge Windows (pas de code).
> Son à l'ouverture du vote : n'existe pas (ni Studio ni overlay) → après le live (déclencheur dans VotekickRuntime
> + Soundboard/sound-lab, nouveau build Studio).
> 19:04 — SÉCURISÉ : `CAUTION_CHAT=false` (Core), `CAUTION=false` + `CAUTION_JOURNAL_FILE=/data/.caution-journal.json`
> + `VOTEKICK_JOURNAL_FILE=/data/.votekick-journal.json` (bot, copies preview alignées), Core puis bot redémarrés : bot
> actif, chat/EventSub OK, 0 EACCES. `/data` = volume persistant `raptoru-bot-data`. La demande 53949be1 reste
> `releasing`/`debited` ; elle ne peut plus être levée (un « releasing » n'est jamais reproposé ; journal jamais écrit),
> elle passera « à vérifier » au premier claim après réactivation. Wallet raptoru_ (public) : 475 046, refunds 0 ;
> ligne exacte : `rs-vk\GO\caution_incident_53949be1_lecture.sql` (lecture seule, à lancer par Antoni).
> Reste (chacun sur GO) : source OBS, flags Caution puis Votekick + tests réels. Le tableau ci-dessous
> date d'avant ce déploiement (lignes « Déployé » : lire oui pour Caution/Votekick et Node).
>
> ## CHECKPOINT GLOBAL — 23/10/2026 17:55 (Paris), relevé sur Git, worktrees et Coolify
>
> **Production** : Core et bot `running:healthy` sur **`2d80c2a`** (pas `b8bc025`). `origin/main` = **`b8bc025`**
> (Caution + Votekick, Node 22.23.4 épinglé), poussé, PAS déployé. Base `raptoru_prod` : sauvegarde 15:16Z (17:16 Paris),
> puis migrations `20261105130000_caution.sql` + `20261106130000_votekick.sql` appliquées À LA MAIN par Antoni (5 tables) —
> **absentes de `schema_migrations`** : le déploiement du Core doit passer par `--migrations-preapplied`. Flags
> Caution/Votekick : OFF (Core et bot). Studio installé : 0.1.7-sup.2 ; sup.3 construit, NON installé. OBS : rien changé.
>
> **Déploiement bloqué** : 18:15 — le jeton `raptoru-deploy-automation` est bien à `~/.raptoru/coolify-token.txt`, mais
> Coolify répond 403 « Missing required permissions: read » (et `read:sensitive` sur les journaux) : il faut lui cocher
> read + read:sensitive + write + deploy. Puis : sauvegarde < 60 min (Backup now), `deploy core b8bc025… --migrations-preapplied --go`, contrôles,
> `deploy bot b8bc025… --go`, contrôles (Centre de contrôle : version, EventSub, flags CAUTION/VOTEKICK non).
>
> | Travail | Où | Développé | Testé (auto) | Commité | Poussé | Déployé | Installé / activé |
> | --- | --- | --- | --- | --- | --- | --- | --- |
> | Caution + Votekick V2 | `vk-wt` `feat/votekick-v2` = `b8bc025` | oui | oui | oui | oui (`origin/main`) | non | flags OFF ; tests réels non faits |
> | Node 22.23.4 | inclus dans `b8bc025` (`node-wt` : copie d'origine, 3 modifs, superflue) | oui | oui | oui (b8bc025) | oui | non | — |
> | Supervision + OAuth + Soundboard Ctrl+R | `sup-wt` `fix/supervision` @ 2d80c2a, 36 modifs | oui | oui | **non** | non | — | dans sup.2 (installé) et sup.3 (non installé) |
> | Studio sup.3 (sup.2 + mute Votekick) | build `rs-vk` (copie), installateur `0.1.7-sup.3.exe` | oui | oui | non (copie de build) | non | — | non |
> | Automatisation Coolify (`--migrations-preapplied`, bot après Core) | `raptoru-release` `chore/coolify-deploy` @ ef79a37 + 4 fichiers non commités | oui | 12/12 + 8/8 (PG 17 Docker) | **non** | non | — | — |
> | Roue du Sub V2 | checkout principal `main` @ 11ffe3f (derrière `origin/main`), 76 modifs | en cours | partiel | **non** | non | non | V1 OFF en prod |
> | Chat / mots / !solde | `chat-wt`, `wg-wt`, `solde-wt` (31 / 15 / 7 modifs) | oui | oui | intégrés dans `2d80c2a` (via `deliv-wt`) | oui | oui (2d80c2a) | — ; copies d'origine conservées |
>
> Rien n'est à supprimer : chaque worktree avec modifications est conservé tel quel.
>
> **23/10 16:50 — Caution + Votekick V2 PRÊTS À DÉPLOYER (non poussés, flags OFF)** : `vk-wt` branche
> `feat/votekick-v2` @ `b8bc025` (commits locaux), procédure `vk-wt/docs/LIVE_2026-10-23_VOTEKICK_CAUTION.md`, Studio
> combiné `rs-vk\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.3.exe` (sup.2 + Votekick, SHA-256 1ff1ae39…).
> Le paragraphe ci-dessous (« interrompue ») est périmé.
>
> **23/10 soir — reprise Votekick/Caution dans `vk-wt` (INTERROMPUE, limite d'usage).** Caution : complète et testée,
> non validée en Lab. Votekick : commencé, NON commité. Faits : `packages/schemas/src/votekick-exec.ts` (+ export
> index), migrations `20261106120000_votekick_lab.sql` / `20261106130000_votekick.sql` (enregistrées dans
> migration-scopes, local-runtime, bonk-lab.mjs, stage.mjs), `apps/core-api/src/votekick/service.ts` (VotekickService
> sur base de données, typecheck OK, AUCUN test). Reste : câblage Core (app.ts : service + CautionMutes pour Caution +
> module chat `VOTEKICK_CHAT` OFF ; routes lab/studio/bot ; ticks dans public-frontier + local-server), exécuteur bot
> (`VOTEKICK` OFF), Studio (MuteController + overlay alimenté par `/studio`), tests (PGlite, PostgreSQL réel, chaîne),
> MAJ des compteurs de migrations dans les tests, doc.
>
> **23/10 — PRIORITÉ IMMÉDIATE : sécurité Node.js (alerte 21/10).** Audit + correctif prêts, non commités :
> worktree `…\scratchpad\node-wt` (branche `fix/node-22.23.4`, base 2d80c2a), rapport `node-wt/docs/NODE_SECURITY_2026-10-23.md`.
> Version Node réellement exécutée en Production non vérifiable par API → `node -v` dans les terminaux Coolify (Antoni).
> Studio sup.2 / Caution / Votekick suspendus.
>
> **23/10 — priorité P1 en cours : incident Twitch du 22/10.** Phase A (lecture seule) faite :
> `docs/TWITCH_CONNECTION_INCIDENT_2026-10-22.md`. Réorientée le 23/10 : la panne touchait l'extension (TTS,
> Soundboard, Bonk) ; chaîne extension → Core → Studio/OBS, pas le bot. SQL Production du 23/10 : tout `completed`
> pendant le live (aucun accepté-non-exécuté) ; `extension_lab` / `test_mode = true` = étiquettes en dur, paiement
> réel au Wallet canonique. Cause non déterminée (refus avant insertion invisibles) ; prochaine preuve = § 9.2 bis
> (viewers des 5 Soundboard de 20:54, plus longs trous). TTS de 20:47:53 jouée 1,4 s après (prouvé) : Core, Studio,
> liaison et lecteur TTS sains avant la réautorisation ; piste restante = Soundboard / Bonk localisés ou intermittents.
> **Plan de supervision (lots 1–4) : `docs/PLAN_SUPERVISION_2026-10-23.md`. Arbitrages rendus le 23/10 (A1 masquer
> en Production, notification même au premier plan, jetons PC conservés, étiquettes inchangées, lot 3 = historique
> persistant en base, pas commencé). Lots 1+2 DÉVELOPPÉS dans le worktree `…\scratchpad\sup-wt` (branche
> `fix/supervision`, base 2d80c2a), NON commités, NON validés : voir `sup-wt/docs/SUPERVISION_LOTS_1_2.md`.**
> Suite Studio serveur finale 574/574 (exit 0). Installateur de test construit, NON installé, NON publié :
> `C:\Users\Antoni\Documents\rs-sup\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.1.exe` (SHA-256 90c5c692…);
> retour arrière = désinstaller puis réinstaller `rs017\…\Raptoru Studio Setup 0.1.7.exe`. Antoni a installé 0.1.7-sup.1 (tests
> manuels concluants). **23/10 après-midi : 0.1.7-sup.2 construit (OAuth PC renouvelable via « Vérifier », Soundboard Ctrl+R,
> supervision consolidée, libellés paiement réel, updater désactivé pour les versions de test) :
> `rs-sup\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.2.exe` SHA-256 57391245…ccb7, NON installé. Tout reste
> non commité dans `sup-wt` ; procédure de validation unique : `sup-wt/docs/SUPERVISION_LOTS_1_2.md` § 6.**
> État post-migration : `docs/RAPTORU_POST_MIGRATION_TRUTH_2026-10-23.md`.

## Chantier : Roue du Sub V2 — testable de bout en bout dans le Lab

- **État** : R1–R3 validés en local par Antoni. R4 (Studio), Lab de bout en bout, R7, R8, R9 implémentés et testés
  en local le 22/10, **en attente de validation**. Rien n'est commité. Aucune migration appliquée en Production.
- **Non commencés (interdits pour l'instant)** : R3b (débits de récupération), R5 (compensation Wenuyr).
- **Production** : mode `v1` (inchangé). `!roue`, invitations, module extension : silencieux / masqués en `v1`.

## Décisions clés

- Modes `v1` / `v2_acquire` / `v2` (diffuseur seul) ; retour à `v1` / `v2_acquire` toujours possible, sans perte.
- Un seul chemin de tirage et de crédit : `drawLocked()` (clé `move:sub_wheel:<spin_id>`) ; refuse tout tour non
  `owed`/`requested` et tout tour sous revue `open`/`unresolved`.
- Mois certain = `cumulative_months` ; sinon estimé (dernier mois certain antérieur en heure Twitch + 1).
- « À vérifier » : même mois, au moins un estimé ; décisions `distinct` / `merge` / `unresolved` (`subWheelGrant`).
- **Départ métier 21/10/2026 (décision du 22/10)** : aucune reconstruction des mois passés. **R7 = détection
  seulement** : un abonnement actif sans événement reçu devient une preuve orpheline (`reconcile`) affichée dans
  Studio, **jamais un tour** ; le diffuseur peut « Accorder un tour » à la main.
- Demande venue du viewer (`!roue oui`, réponse à l'invitation, bouton extension) : `requested`, tirée seulement en
  live, viewer présent. Diffuseur / modérateur (`subWheelDraw`) : sans condition de présence.
- Invitations (R9) : désactivées par défaut (diffuseur), 1 par viewer et par live, fenêtre 3 min, listes de mots
  fermées (`src/sub-wheel/chat.ts`, `ANSWER_WORDS_VERSION`), une seule relance si ambigu, jamais de crédit.
- Lab : simulateurs explicites (présence `lab_sw_presence*`, événements `/lab/simulate`, live = session Lab) dans la
  base Lab seulement ; les gains créditent le wallet de test Lab (Core Lab seulement, `labCredits`, une ligne par tour).

## Fichiers

- Core : `apps/core-api/src/sub-wheel/{service,rights,review,draws,chat}.ts`, `src/http/{sub-wheel,loyalty}-routes.ts`,
  `src/ext/{sub-wheel-ext,ext-facade,public-frontier}.ts`, `src/lab-chat/games.ts`, `src/loyalty/{tiers,engine}.ts`,
  `src/bonk-lab/lab-core.ts`, `src/app.ts`, `src/commands/steps.ts`, `src/lab-moderation/store.ts`.
- Migrations (non appliquées en Production) : `supabase/migrations/2026110{1,2,3}*_sub_wheel*.sql` (Prod + jumeaux Lab,
  et `20261103110000_sub_wheel_lab_sim.sql` Lab seulement).
- Studio : `apps/studio/web/src/sub-wheel{,-view}.ts`, `sub-wheel.css`, `apps/studio/server/src/sub-wheel/runtime.ts`,
  `src/extension-lab/{sub-wheel-facade,lab-ebs}.ts`, listes de migrations Lab.
- Extension : `extension/shared/{sub-wheel-ext,api,ui,moderation-v2}.js`. Bot (source) : `src/loyalty-events.ts`.
- Tests : `apps/core-api/test/sub-wheel-{v2,r2,r3,viewers}.test.ts`, `sub-wheel-{v2,r2,r3,r9}.integration.test.ts`,
  `sw-race.ts`, `apps/studio/server/test/sub-wheel-v2-studio.test.ts`.

## Tests faits (22/10, fin de mission)

- Core 922/922 (131 ignorés = intégration), intégration PostgreSQL réel 132/132, Studio 539/540 (`lot9-main-core`
  intermittent sous charge, 2/2 seul), extension 50/50, bot 230/230, e2e Playwright 30/30, lint, typecheck, build.
- Intermittent observé une fois : P4 R1 pendant un plantage du worker (0xC0000409) ; non reproduit en 12 passages.
- Interface réelle (Chromium, banc d'essai hors dépôt) : Studio (réglages, mode V2, invitations, simulateur live /
  présence / événements, file auto absent → présent, historique crédité) + extension viewer (« Lancer mes tours ») +
  invitation chat (« ouais vas-y ») + extension modérateur (refus sans permission, « Tirer » avec `subWheelDraw`).

## Correctif du 22/10 (« Roue du Sub indisponible : not_found »)

- Cause : Studio était en **profil Production** → l'onglet interrogeait le Core Production (ancien code, sans les
  routes V2) ; le runtime Studio exigeait les lectures V2 → toute la section tombait.
- Correction : `apps/studio/server/src/sub-wheel/runtime.ts` tolère seulement un 404 sur les lectures V2
  (`v2_unavailable`) : la V1 reste utilisable et Studio l'indique ; toute autre erreur reste une erreur. Test :
  `apps/studio/server/test/sub-wheel-v2-studio.test.ts` (« Core without the V2 yet »).
- Vérifié sur le vrai serveur Studio en profil Lab (seconde instance, port 4110) : Simulateur Lab → abonnement → tour
  dans « En attente ». Observé une fois : arrêt natif du Core Lab (0xC0000409), relancé seul en 2 s.

## Annonces des gagnants — COMMITÉ et POUSSÉ (22/10), PAS ENCORE DÉPLOYÉ

- Commit `530950b31fe3e9cdb3b74f92558644967f4ffcb0` sur `origin/main` (avance rapide depuis 2e8bfcb, sur GO d'Antoni),
  depuis le worktree isolé ; `main` local inchangé (11ffe3f + V2 non commitée). Ajout depuis le patch : annonce
  écrite dans un savepoint (`insertAnnouncement`) → Core déployé AVANT sa migration = annonces sautées et journalisées
  (`[raffle] / [sub_wheel] announcement skipped`), jamais le tirage, le paiement ou l'animation (testé PostgreSQL réel).
- Image construite depuis `git archive 530950b` : annonces + correctif Random Ban présents, aucun code ni migration V2 ;
  son migrateur sur une base à l'état Production (39) → applique ce seul fichier, puis « already up to date ».
  Tests finaux : Core 862/862, intégration PostgreSQL réel 57/57, lint, build OK.
- Déploiement (accord séparé d'Antoni) : hors live, Redeploy `raptoru-core` au commit 530950b, puis aussitôt dans son
  Terminal `node apps/core-api/dist/scripts/migrate.js`. Rollback : redéployer 2e8bfcb, sans retour de migration
  (contrainte seulement élargie, compatible avec l'ancien Core).

- **Ajustement Tombola (22/10)** : annonce à `reveal_end_at` + 6 s (`RAFFLE_ANNOUNCE_DELAY_MS`, fin de l'animation de
  révélation calculée par le Core au tirage, suivie par l'overlay) au lieu de `viewer_result_at`. Commit LOCAL
  `efadea9e93613fa2d06fe60b03c79646fbc9c5b1`, **poussé sur `origin/main` le 22/10** (avance rapide depuis 530950b,
  2 fichiers). Commit SHA Coolify à déployer : `efadea9…` ; même migration, même procédure. Pas encore déployé.

## Annonces des gagnants (22/10 — détail de l'implémentation)

- Où : worktree `scratchpad/rb-wt`, branche locale `feat/win-announcements` sur `origin/main` 2e8bfcb (V2 du dépôt
  principal intacte). Patch : `win-announcements-2e8bfcb.patch` (sha256 `7165c667ef91d4ed…`, 14 fichiers).
- Roue V1 (`sub-wheel/service.ts`) : à la fin d'animation (`reportAnimation` → `shown`), dans la même transaction,
  « 🎡 Roue du Sub : @Pseudo gagne X Jetons ! » mis en file pour fin + 8 s (`SW_ANNOUNCE_DELAY_MS`). Seulement source
  `twitch`, gain `awarded` > 0. Rien pour test / simulation / animation échouée / gain non crédité ; un gain payé plus
  tard par `award()` d'une roue déjà montrée est annoncé tout de suite. Clé `sub_wheel:win:<spin>` = jamais deux fois.
- Tombola (`raffle-lab-service.ts`) : au tirage, « 🎉 Tombola : @Pseudo gagne X <devise> ! » par gagnant **payé** (montant
  réel), envoyé à `viewer_result_at` (révélation côté viewers, jamais avant le stream) ; versement échoué = rien, puis
  annoncé quand `retry_payout` le paie. Clé `raffle:win:<raffle>:<viewer>`.
- File `cmd_steps` : origines `raffle` / `sub_wheel` ; une annonce pas encore due ne bloque plus la file
  (`SCHEDULED_ORIGINS`), l'ordre strict des autres origines est inchangé. Réglage « Sortie chat réelle » respecté.
- Migration : `20261031140000_cmd_steps_win_announcements_lab.sql` (élargit seulement la contrainte d'origine),
  `LAB_MIGRATIONS` + `MAIN_CORE_LAB_MIGRATIONS` + 3 listes Studio. Base à l'état Production (39) → ce seul fichier.
- Tests : unitaires 5/5, PostgreSQL réel 3/3 ×3 (migration ; fin d'animation rapportée 3× par 2 Cores → 1 annonce ;
  Tombola tirée par 2 Cores en parallèle → 1 annonce par gagnant payé) ; Core 861/862 (`http.test` sensible à la
  charge, 8/8 seul) ; intégration 56/56 ; Studio `local-runtime` 11/11 ; lint, tsc Core / Studio, build OK.
  Non testé : vrai Studio, vrai bot, vrai chat Twitch.
- Déploiement (à valider) : migration + Core ; bot inchangé ; Studio seulement pour le Lab (libellés, listes).
- ⚠ Rebase V2 : ses migrations `20261103120000/130000_sub_wheel_v2_viewers(_lab).sql` redéfinissent
  `cmd_steps_origin_check` SANS `raffle` → y ajouter `raffle` ; fusionner `StepOrigin` (`steps.ts`).

## Déploiement assisté (Coolify API) — en place le 22/10

- Où : worktree permanent `C:\Users\Antoni\Documents\raptoru-release` (branche `chore/coolify-deploy`, commit local
  `ef79a37` = origin/main + le script, non poussé), script `scripts/coolify-deploy.mjs` (Node seul, aucune dépendance,
  pas de `node_modules` dans ce worktree). Jeton : `~/.raptoru/coolify-token.txt`, sinon `coolify-staging-token.txt`
  (jamais affiché). Journal : `~/.raptoru/deploy-journal.log`.
- Coolify 4.4.7 (`http://62.84.187.170:8000`) : `raptoru-core` `3m7cputub9wt7nwx2k78cme3`, `raptoru-bot`
  `hdbljqmwoq5364w0ypqmz46p`, `raptoru-core-staging` `leadrn7q8x0efkc9u6nxtdic`, base `raptoru-prod-postgres`
  `4jaqdyvzlelgwkyvuxhjy4mr` (sauvegarde quotidienne 04:00). Déploiement = `PATCH git_commit_sha` + `POST /deploy`
  (le GET est refusé en 4.4.7). Auto Deploy : désactivé (aucun déploiement par webhook dans l'historique).
- Procédure (« GO Production ») : `cd C:\Users\Antoni\Documents\raptoru-release` puis
  1. `node scripts/coolify-deploy.mjs plan core <sha40>` (lecture seule : SHA sur origin/main, commit déployé, fichiers,
     migrations sélectionnées en Production, fichiers du bot, sauvegarde) ;
  2. `… deploy core <sha40>` = DRY-RUN (appels prévus) ; 3. après GO : `… deploy core <sha40> --go` → suit le
     déploiement, vérifie commit, `running:healthy`, `/health`, `/ready` → DÉPLOYÉ / ÉCHEC / BLOQUÉ + commande retour ;
  4. retour : `… deploy core <sha précédent> --rollback --go` (migrations jamais annulées, signalées).
- Migrations : `--migrations-approved` + sauvegarde < 60 min + jeton capable de lire les journaux de déploiement,
  sinon BLOQUÉ avec la commande Terminal (Coolify marque « finished » même si la commande post-déploiement échoue :
  vérifié sur le staging). Avec le jeton actuel (journaux illisibles) : migration = 1 commande Terminal manuelle.
- Testé : 10 scénarios sur un faux Coolify, dry-runs réels, 2 redéploiements réels du staging au même commit
  (`6pw4mmvvuwkobhbnee8grmvr`, `hebkapxfeinipesonrhxt3pt`), staging remis à `HEAD` sans commande post-déploiement.
- ⚠ Migration des annonces `20261031140000` : non vérifiable par l'API ; à confirmer qu'elle a été lancée après le
  déploiement d'efadea9 (sinon les annonces sont sautées, sans autre effet).

## Prochaine action (priorités décidées le 22/10)

1. Annonces : validation d'Antoni (Lab / patch), puis accord commit + déploiement (migration + Core).
2. **Roue V2** : validation d'Antoni dans le Lab réel (`npm run studio` › Points de chaîne › Roue du Sub › Simulateur
   Lab), puis la suite du plan.
- Avant toute Production de la V2 : **correctif transverse 409 `not_lease_holder`** (prioritaire, voir ci-dessous).
- `main` local à 11ffe3f + V2 non commitée, `origin/main` à 2e8bfcb : rebaser le local avec précaution (les 3 fichiers
  du correctif Random Ban y sont déjà modifiés à l'identique).

## Correctif transverse séparé (non traité, prioritaire avant déploiement)

- 409 `not_lease_holder` : le bot traite tout statut < 500 comme définitif → événements de fidélité (et preuves de
  roue) perdus pendant une perte de bail.

## Soundboard compacte (signalement Wenuyr, 22/10) — LOCAL, non commité, non validé

- Worktree isolé `scratchpad/sb-wt`, branche `fix/soundboard-compact` depuis `origin/main` (efadea9). 2 fichiers :
  `extension/soundboard.css`, `extension/shared/ui.js` (texte d'instruction + carte choisie gardée visible). V2 intacte.
- Cause démontrée : profil compact seulement si largeur ≥ 521 px ET hauteur 321–400 px (CSS px), sinon taille pleine
  (en-tête 75 px, barre de paiement 56 px, ou 99 px sur 2 lignes sous 460 px, même sans son choisi). Le Video
  Component est un % du lecteur Twitch en CSS px → zoom navigateur / mise à l'échelle Windows / petit lecteur
  (portable, chat + barre latérale) le rapetissent. Mesuré (composant 600×432) : zoom 100 % → 12 cartes, 110 % → 12
  (profil compact), **125 % → 3**, **150 % → 0 (liste 28 px)**. Panel 318×496 non concerné par le zoom (largeur fixe).
  Version / cache : non impliqués (même CSS pour tous).
- Correctif : barre vide = 1 ligne discrète (29 px), monnaie/prix/Envoyer dès qu'un son est choisi ; profil compact
  appliqué à toute hauteur ≤ 400 px quelle que soit la largeur (barre choisie sur 1 ligne, monnaie réduite à sa pièce
  sous 460 px) ; ≤ 320 px : recherche + filtres sur une ligne. Économie, cooldowns, envoi : inchangés.
- Après : zoom 125 % → 9 cartes, 150 % → 6 (4 avec un son choisi), panel vide 6 au lieu de 4.
- Tests : banc Playwright démo (captures `scratchpad/sb-shots/compare.png`), parcours carte du bas / envoi / dernier son
  / recherche / favoris / récents / tri / aucun débordement à 420×300, 360×260, 318×496, 600×432 ; extension
  50/50 tests, ESLint, Prettier, build OK. **Pas testé dans Twitch réel** ; captures de Wenuyr non reçues (dimensions
  supposées).
- Limites : en dessous d'environ 300×200 (portable + zoom 150 %), l'en-tête commun du module (hors Soundboard) laisse
  trop peu de place ; panel 318×496 avec un son choisi garde la barre sur 2 lignes (4 cartes visibles).
- Grille compacte (complément 22/10) : en vue ≤ 400 px de haut, cartes 108 px mini → 3 colonnes dès ~350 px de
  large, 4 au-delà de ~460 ; ≤ 320 px de haut : rangées 40 px. Zoom 150 % (400×288) : **9 cartes (3×3), aussi avec un
  son choisi** ; 125 % : 12 (4×3) ; 396×264 : 6 (3×2, la hauteur limite) ; 317×211 : 2 colonnes gardées (3 = cartes
  de ~90 px, trop étroites). Grille normale (600×432 à 100 %, panel 318×496) inchangée.
- Noms longs (vue compacte) : « … » porté par `.sbx-card__label` ; survol / focus = un seul aller en `transform`
  (0,3 s d'attente, ~70 px/s), retour en douceur, aucune animation continue (l'ancienne boucle `text-indent`
  infinie est retirée pour la Soundboard ; Tombola inchangée). Rien si le nom tient. Tactile : la carte choisie
  déroule son nom + nom complet dans la barre ; `title` = nom complet ; mouvement réduit = aucun défilement.
  `hover-marquee.js` : paramètre facultatif `inner` (+ variable `--mq-s`), appel Tombola inchangé.
- Tests du complément : banc défilement (attente, aller, arrêt, retour, nom court, focus clavier, tactile, mouvement
  réduit), matrice zoom, parcours, extension 50/50, ESLint, Prettier, build. Planche `scratchpad/sb-shots/compare-grid.png`.
- Suite : validation par Antoni, puis accord commit et paquet extension.

## Votekick V2 + Caution (22/10, pendant le live) — développé en isolation, NON raccordé, NON validé

- Worktree `…\scratchpad\vk-wt`, branche locale `feat/votekick-v2` (base origin/main 2d80c2a), 5 commits locaux
  (7cef411 → 3a5bed1), rien poussé. Référence complète : `docs/VOTEKICK_V2.md` (dans la branche).
- Fait : règles SAMMI exactes (`packages/schemas/src/votekick.ts`) ; moteur Votekick + Caution sur ports + simulateurs
  (`apps/core-api/src/votekick/`) ; MuteController OBS déterministe (`apps/studio/server/src/votekick/`) ; overlay V2
  + originaux conservés + aperçu avant / après (`apps/studio/server/votekick-overlay/`, `node …/preview-server.mjs`).
  Tests : Core 31/31, Studio 17/17, typecheck / lint / prettier OK, aperçu vérifié en navigateur headless.
- Cause MUTED : SAMMI rétablit le micro avant de couper le drive audio / zoom / bandeau, le bandeau finit sur
  l'horloge du shader et le micro sur la boucle SAMMI (dérive), aucune restauration au redémarrage de SAMMI.
- **À vérifier en priorité** : SAMMI coupe « Micro (Obsolète) » (masqué partout) alors que le micro des scènes est
  « Micro ».
- Reste : persistance + routes Core, routeur chat, adaptateur Wallet (tests PG), exécuteur Twitch du bot, intégration
  Studio (mute + overlay), validations § 8 du doc.

## Studio 0.1.7 candidat (22/10) — construit, NON publié ; installé par Antoni (Studio en service : 0.1.7 / 2d80c2a)

- Clone isolé `C:\Users\Antoni\Documents\rs017` (main locale = 2d80c2a, push désactivé, LF). `studio:release --dry-run`
  OK (check vert, package, vérif artefacts) ; bump annulé (package.json reste 0.1.6).
- Installateur `C:\Users\Antoni\Documents\rs017\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7.exe`,
  SHA-256 ac3f66c93bf67ab294a1b709394d7ba014c367894ea2fa71b6449d2bea5ba591.
- Rien sur GitHub (pas de mise à jour auto). Publier = `npm run studio:release` sur demande d'Antoni seulement.
- Piège : chemin long (scratchpad) → makensis échoue (MAX_PATH, assets TTS). Cloner dans un chemin court.

## Livraison Production — préflight 22/10 16:10 UTC (Core toujours efadea9, bot 49c1870)

- CHAT_GAMES / CHAT_GAMES_OUTPUT = ON : prouvé par le bail du bot (Centre de contrôle Studio « jeux chat, réponses
  chat », version 49c1870). « Sortie chat réelle » = true (GET Core via Studio /api/commands/steps → output). live=false.
  Rien en cours : cp jobs_waiting 0, TTS queue vide, effets playing 0, derniers RB/CP 21/10 17:58 UTC.
- Sauvegarde déclenchée par API (PATCH backups/ha3t1pu8q83re2gjvg5wetbu backup_now) : exécution
  ihcsmwrbheboooopbyiolsxf success 16:10:04→16:10:06 UTC, 1 265 218 o (raptoru_prod).
- 22/10 16:15 UTC : Core 2d80c2a DÉPLOYÉ par Antoni (Coolify UI, déploiement 29xtr9ggcijda8ekoqddlrst, running:healthy,
  /health + /ready 200) ; migration appliquée par Antoni au Terminal (« applied: 20261104120000_… »).
- Bot : `deploy bot` BLOQUÉ par un défaut du script (il exige des migrations sur une app sans base, plage 49c1870..2d80c2a)
  ; correctif du script refusé par le garde-fou auto. Reste : bot 2d80c2a via Coolify UI, puis contrôles.
- (historique) BLOQUÉ : `deploy core … --migrations-approved` refuse (journal de déploiement illisible avec ce jeton → migration
  non vérifiable). Vérif par tâche planifiée Coolify refusée par le garde-fou auto. Reste : Antoni (Terminal ou jeton
  lecture journaux), puis bot.

## Livraison Production (22/10) — POUSSÉE (origin/main = 2d80c2a), NON déployée : préflight bloqué

- Push en avance rapide `efadea9..2d80c2a` (aucun force) ; Coolify n'a rien déclenché (Core figé sur efadea9, bot
  sur 49c1870, tous deux running:healthy ; /health et /ready OK).
- STOP avant sauvegarde / migration / déploiement : prérequis invérifiables avec le jeton actuel — valeurs bot
  `CHAT_GAMES`, `CHAT_GAMES_OUTPUT` (clés présentes, valeurs masquées), « Sortie chat réelle » du Core (base / Studio
  seulement), état du live ; migration non exécutable d'ici (Terminal Coolify) ; dernière sauvegarde 04:00 UTC (> 60
  min). `plan core 2d80c2a` : BLOQUÉ pour les mêmes raisons ; migration attendue `20261104120000` seule.
- Reprise : Antoni confirme les 3 réglages + hors live + automatisations Points de chaîne OFF, lance « Backup now » ;
  déploiement Core 2d80c2a puis migration manuelle dans le Terminal (`node apps/core-api/dist/scripts/migrate.js`),
  puis bot 2d80c2a, puis contrôles chat par Antoni (`!solde`, `!solde @x`, `!tts`, `!fxcam` seuls).

## Livraison groupée COMMITÉE localement (22/10) — `release/chat-wordgame-solde`, poussée ensuite

- Branche (worktree `scratchpad/deliv-wt`) : `efadea9` (origin/main) → `0bf7907` extension UX (avance rapide, SHA
  inchangé = ZIP publié) → `ed29d23` !solde + !tts / !rb / !fxcam + migration `20261104120000` (33 fichiers) →
  `2d80c2a` Jeu des mots + volume Studio (15 fichiers). 57 fichiers au total ; contenu de chaque commit identique à
  `chat-wt` / `wg-wt` ; aucun fichier Roue V2. Intégration prévue : push = avance rapide de `origin/main` jusqu'à
  `2d80c2a` (aucune réécriture).
- Avant le nouveau Core : appliquer `20261104120000_cp_redemptions_chat_source_lab.sql` (dans le Terminal, juste
  après le déploiement, hors live avec automatisations Points de chaîne OFF). Vérifier bot `CHAT_GAMES` /
  `CHAT_GAMES_OUTPUT` et « Sortie chat réelle » du Core.

## Livraison groupée préparée (22/10) — `scratchpad/deliv-wt`, branche `release/chat-wordgame-solde`, NON commitée

- Base `origin/main` efadea9 + diff de `chat-wt` (contient `!solde`, identique fichier à fichier à `solde-wt` : non
  réappliqué) + diff de `wg-wt` (aucun fichier commun). Aucun conflit, aucun changement ajouté. 46 entrées / 36 fichiers.
  Worktrees d'origine intacts (7 / 15 / 31), dépôt principal intact (11ffe3f, V2 71 modifs).
- Tests sur la version combinée : Core 896/896 (`--maxWorkers=3`) ; PostgreSQL réel 65/65 (base jetable
  `raptoru_test`) ; bot 242/242 ; Studio serveur 549/551 puis les 2 échecs (`alerts-twitch-chain`, `control-center`)
  verts seuls ×2 ; typecheck schemas / Core / bot / Studio serveur / web ; builds Core, bot, Studio serveur, web OK ;
  ESLint propre ; Prettier propre une fois les fins de ligne normalisées (le worktree est en CRLF via autocrlf).
- Compatibilité : Studio installé (0.1.6) — aucun contrat Core ↔ Studio changé (rédemptions / jobs / Random Ban /
  TTS de source chat affichés et exécutés tels quels ; le volume du Jeu des mots n'existe que dans le prochain Studio,
  ignoré sinon). Bot Production 49c1870 — `!tts` / `!rb` / `!fxcam` passent par `/v1/bot/chat` (aucun changement
  bot) ; `!solde @Pseudo` demande le nouveau bot ; nouveau bot + ancien Core = bonne cible, ancienne tournure.
- Pré-requis Production à vérifier (non lisibles d'ici) : bot `CHAT_GAMES=true` et `CHAT_GAMES_OUTPUT=true` ; Core
  « Sortie chat réelle » ON (sinon un achat chat est débité sans réponse dans le chat) ; migration `20261031140000`
  appliquée ou non (le migrateur appliquera ce qui manque).
- Plan (chaque étape sur accord) : 1) commits sur la branche (`!solde` / interactions chat + migration / Jeu des mots),
  push `main` ; 2) hors live (automatisations Points de chaîne OFF : `!fxcam` refusé avant toute écriture), sauvegarde
  < 60 min, déploiement Core (`scripts/coolify-deploy.mjs deploy core <sha> --migrations-approved`) puis, le jeton ne
  lisant pas les journaux, `node apps/core-api/dist/scripts/migrate.js` dans le Terminal Coolify → attendu :
  `20261104120000_cp_redemptions_chat_source_lab.sql` (+ `20261031140000` s'il manquait) ; vérifier /health, /ready ;
  3) déploiement bot (même SHA) pour `!solde` ; 4) contrôles chat : `!solde`, `!solde @x`, `!tts` / `!fxcam` seuls
  (aides gratuites) ; 5) plus tard : release Studio (volume du Jeu des mots + listes de migrations Lab).
  Retour arrière : Core efadea9 / bot 49c1870 ; la migration reste (additive, ignorée de l'ancien code).
- À part : le commit extension `0bf7907` (publié sur Twitch) n'est pas sur `origin/main` → à pousser pour que `main`
  reflète ce qui tourne.

## Interactions payantes depuis le chat : !tts (fait), !rb et !fxcam (bloqués) (22/10) — LOCAL, non commité

- Worktree `scratchpad/chat-wt`, branche `feat/chat-interactions` depuis `origin/main` (efadea9) **+ le correctif
  !solde appliqué dessus** (copie du diff de `solde-wt`, resté intact) : à livrer ensemble ou après !solde.
- `!tts` (Core seul, aucun changement bot ni migration) : module `tts` du routeur chat du Core
  (`apps/core-api/src/tts-lab/chat.ts`, branché dans `lab-chat/games.ts`, Core principal et Lab Core). Achat =
  `TtsLabService.admit` de l'extension (paliers, contrôles, modération, cooldowns, personnage tiré par le Core,
  remboursements), payé par l'auteur (identité EventSub), clé `chat:<message_id>` (rejeu = même TTS, jamais 2ᵉ
  débit), réponse unique `tts:msg:<message_id>` dans `cmd_steps` (origine `mini_game` faute d'origine `tts` sans
  migration). `!tts` seul = aide gratuite (prix du 1er palier, 1×/30 s/viewer). Solde insuffisant : « Il te faut X
  Jetons pour utiliser TTS. Solde : Y Jetons (il te manque Z). » `tts` réservé dans Commands V2.
- Prix : défaut du code et capture Production du 13/10 = 7 500 (palier 1–80) = l'aide demandée. Valeur réelle
  actuelle de Production non lisible d'ici (réglable dans Studio) : l'aide affiche toujours le vrai palier.
- MISE À JOUR (22/10, GO tarifs : `!rb` 25 000, `!fxcam` 1 500) :
  - `!rb` EN PLACE (`apps/core-api/src/chat-interactions/random-ban-chat.ts`, tarifs centralisés
    `chat-interactions/prices.ts` / `ChatPrices`) : second moyen de paiement du Random Ban existant (rb_requests
    source `chat` déjà autorisée en base : aucune migration). Refus avant débit si exécuteur absent (pas signalé
    depuis 15 s / droits manquants) ou pause globale ; demande + débit dans une transaction (`requestIfNew` :
    exactement un créateur par message, même en course) ; « en file » seulement ; remboursement Jetons une fois si
    `refund = needed` (puis `refund = none`), jamais pour `uncertain`. `random-ban/service.ts` : les fins de
    parcours du sweep / refus de claim préviennent désormais aussi les abonnés (`tellEnded`, utile aussi aux
    Points de chaîne). `rb` réservé dans Commands V2.
  - MISE À JOUR (22/10, GO `!fxcam` + migration créée NON appliquée) : `!fxcam` EN PLACE
    (`chat-interactions/fx-cam-chat.ts`). Migration `supabase/migrations/20261104120000_cp_redemptions_chat_source_lab.sql`
    (cp_redemptions.source + `chat`, additive) déclarée Lab + Core principal (scopes, 3 lanceurs Studio, comptes de
    migration 40 → 41) ; **à appliquer avant de livrer** (Lab, Production : accord d'Antoni). `ChannelPointsService` :
    `studioReady`, `admitChatFxCam` (rédemption source `chat` + job dans la transaction du débit), `onChanged` (après
    claim / ack / fin d'effet). Remboursement une fois si résultat `failed` certain ; `unknown` → `jetons_to_verify`.
    `fxcam` réservé. Cooldowns : ceux des récompenses vivent sur Twitch, non transmis au Core ; proposition (non faite)
    dans `docs/CHAT_COMMANDS.md`. Tests : Core complet 894/894 (`--maxWorkers=3` ; les passages pleine charge ont
    des expirations de délai, fichiers verts seuls), `fx-cam-chat.test.ts` 9/9, PostgreSQL réel 65/65 dont
    `fx-cam-chat.integration.test.ts` 4/4 ×3.
  - (ancien) `!fxcam` BLOQUÉ (non codé) : son job Studio relit obligatoirement une ligne `cp_redemptions`, dont
    `source` n'accepte que `twitch` / `simulation` → migration nécessaire (ajouter `chat`), plan détaillé dans
    `docs/CHAT_COMMANDS.md`. Attend l'accord d'Antoni.
  - Tests : Core complet 885/885 ; `random-ban-chat.test.ts` 12/12 ; PostgreSQL réel 61/61 dont
    `random-ban-chat.integration.test.ts` 3/3 ×3 (même message ×4 sur 2 Cores → 1 demande / 1 débit ; deux messages
    pour un seul solde → 1 achat, jamais < 0 ; règlement simultané → 1 remboursement). Pas testé dans le vrai chat.
- (ancien) `!rb` / `!fxcam` BLOQUÉS : Random Ban et FX Cam n'existent qu'en Points de chaîne Twitch (prix = coût de la
  récompense Twitch, remboursement = annulation Twitch). Aucun prix, débit ni remboursement en Jetons : les créer
  = nouveau parcours économique (prix Studio, débit + demande atomiques, remboursement si cible introuvable /
  immunisée / échec, idempotence) → décision d'Antoni avant tout code. 25 000 Jetons : aucun prix de ce type
  n'existe à vérifier.
- Tests : Core complet 873/873 (58 ignorés = intégration) ; `tts-chat.test.ts` 10/10 ; PostgreSQL réel 58/58
  dont `tts-chat.integration.test.ts` 3/3 (même message ×3 sur 2 Cores + extension simultanée → 1 TTS, 1 débit,
  1 réponse) ; typecheck, ESLint, Prettier. Pas testé dans le vrai chat.

## !solde @Pseudo + convention des commandes chat (22/10) — LOCAL, non commité, non validé

- Worktree `scratchpad/solde-wt`, branche `fix/solde-target` depuis `origin/main` (efadea9 ; bot identique à 49c1870).
  7 fichiers : `apps/twitch-bot/src/loyalty-commands.ts` (+ test), `apps/core-api/src/wallet/chat.ts`,
  `chat-messages.ts` (+ `test/wallet.test.ts`), `packages/schemas/src/wallet.ts`, nouveau `docs/CHAT_COMMANDS.md`.
- Cause : `parseLoyaltyCommand` renvoyait `{ kind: 'balance' }` dès que le premier mot était `!solde`, en ignorant les
  arguments → `!solde @Pseudo` (et `!solde pour voir tes jetons`) affichait le solde de l'AUTEUR.
- Correctif : syntaxe stricte (`!solde`, `!solde Pseudo`, `!solde @Pseudo`, casse ignorée ; tout le reste ignoré sans
  réponse) ; cible = mention EventSub, sinon Helix par login retenu seulement si le login renvoyé est identique ;
  introuvable → « viewer « x » introuvable », erreur API → « indisponible », jamais l'auteur. Core :
  `WalletBalanceRequest.requester` facultatif → « @Auteur — @Cible a X Jetons. » (lecture seule ; un Core ancien
  ignore le champ). Convention commune : `docs/CHAT_COMMANDS.md`.
- Tests : bot 242/242 ; Core wallet + http 38/38 (bot/http/wallet 97/98, 1 intermittent `bot-core-bridge` 2/2 seul) ;
  typecheck schemas / Core / bot, ESLint, Prettier. Pas testé dans le vrai chat.
- Livraison : Core puis bot (redéploiements, aucune migration). Tant que seul le bot est livré, la réponse dit
  « @Cible — tu as X » (bonne cible, mauvaise tournure).

## Jeu des mots : une seule annonce + volume du son (22/10) — LOCAL, non commité, non validé

- Worktree `scratchpad/wg-wt`, branche `feat/word-game-feedback` depuis `origin/main` (efadea9). 15 fichiers
  (Core word-game, Studio word-game, tests, `docs/WORD_GAME_PARITY.md` §§ 12.3–12.6, 18). V2 intacte.
- Cause des deux messages : `service.ts` mettait en file l'annonce de trouvaille (montant = total, breaker
  compris, « (💥 +500 breaker) ») PUIS, 2,1 s après, une annonce séparée « casse la streak … +500 jetons » →
  impression d'un breaker payé deux fois. Le crédit Wallet, lui, était déjà unique (un seul mouvement = total).
- Correctif Core : une annonce (`jdm:msg:<id>:find`) : `+{mots} Jetons` (rapidité, doré, combo compris = total −
  breaker) puis ` et brise la streak de {N} d'/de {pseudo} 💥 +{B} breaker !` ; milliers « 3 500 » ; « Jetons »
  majuscule. `ofName` : d' si a/e/i/o/u/y (casse et accents ignorés), sinon de. Annonce de série (palier 3, 6…)
  inchangée (événement distinct). Économie, gains, clés et file inchangés.
- Volume Studio : curseur 0–100 % (pas de 5) dans l'onglet Jeu des mots, stocké dans `runtimeDir/word-game/sound-volume`
  (à côté du jeton OBS), ajouté par Studio à chaque victoire relayée (`volume` 0–1), appliqué par la source OBS à
  ce seul son. Jamais envoyé au Core. Le rafraîchissement 1 s ne redessine pas le curseur pendant qu'on le bouge.
- Tests : Core 121/121 (word-game + steps : victoire simple, doré + rapide, breaker, multi-mots, de/d', montants
  annoncés = crédités, rejeu sans double crédit ni double annonce) ; Studio serveur 550/551 (1 échec intermittent
  `moderation-d4` Soundboard stop, 3/3 seul, hors périmètre), dont volume 0/50/100 %, refus, persistance après
  redémarrage ; typecheck Core / Studio serveur / web, ESLint, Prettier. **Pas testé dans le vrai Studio ni le
  vrai chat.**
- Suite : validation par Antoni (Lab), puis accord commit ; livraison = Core (redéploiement, aucune migration) +
  release Studio.

## Passe UX extension — COMMITÉE (0bf7907, non poussée), ZIP construit, non publiée (22/10)

- Commit `0bf7907` sur `fix/soundboard-compact` (worktree `scratchpad/sb-wt`, parent `origin/main` efadea9) :
  9 fichiers `apps/twitch-extension` seulement, aucune V2.
- ZIP : `scratchpad/sb-wt/apps/twitch-extension/release/raptoru-live-PRODUCTION-0bf7907cdb5e.zip`, buildId
  `production-0bf7907cdb5e-2026-10-22`, apiBase `https://core.raptoru.fr/v1/ext`, SHA-256
  `e079177b819af536625aa17ff38987aabc59fb320e3f581ddf7d30d7942f1d42`. Contenu vérifié = commit (hors fins de
  ligne, runtime-config Production, renommage des assets TTS, .md exclus).
- Reste : Hosted Test par Antoni, puis accord push (`main`) et soumission / publication Twitch.
- Hosted Test sur LeCroupier_ (22/10) : « pas configurée pour cette chaîne » = 401 `wrong_channel`. Le Core
  (Production comme staging) est mono-chaîne : `verifyExtensionJwt` exige `channel_id` du JWT Twitch =
  `TWITCH_CHANNEL_ID` (raptoru_ 83603689) ; les données sont aussi rangées par chaîne. Pas un défaut du ZIP. Ne pas
  changer `TWITCH_CHANNEL_ID` de la Production. Test isolé recommandé : ZIP staging du même commit
  (`release/raptoru-live-STAGING-hosted-test-0bf7907cdb5e.zip`, SHA-256
  `ffc529de79c62d147729f06fea87a91284a0fff1b973b00c612925f33805ff87`, Core staging, paiements simulés) en Hosted
  Test sur raptoru_, hors live, avec `https://core-staging.raptoru.fr` dans les domaines autorisés de la version
  (cause de l'incident 0.0.60).

## Passe UX extension (22/10) — Tombola + autorisation des emotes — détail

Version candidate unique = worktree `scratchpad/sb-wt` (`fix/soundboard-compact`) : Soundboard + Tombola +
emotes, 8 fichiers (`soundboard.css`, `tombola-v2.css`, `bonk-chargeur.css`, `shared/ui.js`, `shared/tombola-v2.js`,
`shared/currency.js`, `shared/hover-marquee.js`, `test/currency.test.js`). Core, bot, prix, Jetons, cooldowns,
permissions et OAuth inchangés. `dist/` construit ; le ZIP officiel (`build:production`) exige un commit d'abord.

- Tombola, liste : (1) **cause principale** — pendant une Tombola ouverte, la liste (plus récents en haut) est
  réécrite à chaque lecture (1 s) ; en vue compacte Twitch (565×376) le viewer était ramené vers le haut d'environ
  une ligne par arrivée (scrollTop 600 → 493 en 5 s), donc jamais en bas avec beaucoup d'inscrits ; ailleurs, la
  liste glissait d'une ligne par arrivée. Correctif `setRows` : la ligne en haut de la vue reste en place (en haut
  de liste, les nouveaux restent visibles). (2) colonne participants `250px 1fr` élargie par un pseudo long
  (+68 px hors écran, barre de défilement invisible, pastilles coupées) → `minmax(0, 1fr)`. Molette et tactile
  vérifiés jusqu'au dernier participant (panel, 600×432, 565×376, 400×288, mobile).
- Tombola, « Je » : `currency.js` (`unitHtml`) affiche la pièce Jetons du wallet (`aria-label`/`title` « Jetons »)
  au lieu de « Je » ; « Cr » inchangé. Concerne montant, historique, « Dernière », résultat — et aussi la console
  Modération V2 (même helper).
- Emotes : flux OAuth inchangé ; cause = retour invisible (message de 4 s pendant que le viewer est dans la fenêtre
  Twitch ; erreur de démarrage ajoutée à un nœud remplacé par le rendu, donc jamais vue ; abandon et validation
  tardive silencieux, attente stoppée 5 s après fermeture de la fenêtre). Correctif : état persistant redessiné à
  chaque rendu (en cours · connectées · non confirmée · erreur), gardé jusqu'au retour du viewer puis 8 s ;
  validation vue plus tard par le serveur (≤ 10 min après la tentative) confirmée par la relecture normale. Succès
  annoncé seulement quand le serveur renvoie `twitch_connected === true`.
- Tests : bancs Playwright (fixtures calibration, liste de 60 avec arrivées en continu ; démo emotes avec
  bascule serveur simulée : succès, fenêtre fermée, tardif, abandon, échec, déjà autorisé, panel, compact),
  Soundboard re-vérifiée ; extension 51/51, ESLint, Prettier, build. **Rien testé dans Twitch réel** (OAuth réel,
  app mobile Twitch, iOS).
- Limites : la notice « en cours » recouvre le bas de l'écran pendant l'attente ; la console Modération affiche
  aussi la pièce ; le tactile iOS réel non vérifiable ici.
- Validation visuelle (22/10) : aperçu local avant/après `node scratchpad/sb-shots/preview-server.mjs` →
  http://127.0.0.1:4810/ (données fictives, fausse fenêtre Twitch, aucun réseau). Livraison isolée prête sans commit :
  `scratchpad/ux-extension-candidate.patch` (8 fichiers, uniquement `apps/twitch-extension`, base efadea9).
  Glisser-déposer Soundboard (22/10, même lot) : causes démontrées dans le simulateur — destination calculée sur
  la carte la plus proche dans une grille qu'on modifiait à chaque mouvement (l'emplacement oscillait au repos,
  l'ordre final dépendait de l'arrêt de l'oscillation), Échap n'annulait pas, grille entièrement reconstruite au
  lâcher (flash), rendu serveur pendant le geste. Correctif (ui.js + soundboard.css) : positions relevées au
  départ (`soundboardDropSlot`, marge 12 %, destination gardée dans les interstices), insertion stricte
  (`moveSoundboardItem`, aussi pour Alt+flèches qui échangeait), cartes en transform pendant le geste, mêmes
  nœuds remis en ordre au lâcher, ordre enregistré une fois, Échap/pointercancel = annulation, états serveur
  différés jusqu'au lâcher, défilement auto aux bords, tactile (appui long). Tests : `test/soundboard-reorder.test.js`
  (insertion, annulation, sauvegarde/rechargement, destination) + banc `sb-shots/drag-probe.mjs` (11 cas, 0
  oscillation, 0 carte recréée) et `drag-safety.mjs` (clic, lecture, favori, nom long, état serveur, tactile).
  Limite : la carte saisie reste dans la grille, donc rognée si on la sort de la zone de la liste.
  Après accord : commit sur `fix/soundboard-compact`, `npm run build:production -w @raptoru/twitch-extension`
  (ZIP + SHA-256), puis téléversement Twitch par Antoni.

## Hors V2 — en attente (21–22/10)

- Extension « écran gris » : `extension/overlay.js` et `mobile.js` affichent une erreur récupérable si le helper Twitch
  manque ou si `onAuthorized` n'arrive pas en 10 s (local, non commité, non validé). Paquet à construire depuis HEAD
  avec ces 2 fichiers seulement (le script refuse un `extension/` modifié).
- Limite des logs : le Core ne journalise que ses 500 (`request failed`), jamais les 4xx ni le 409
  `not_lease_holder` → une perte par bail ne se voit que dans le log du bot (`[loyalty] REJECTED by Core`).

## Bilan du live du 21/10 (Production, Core 11ffe3f, bot 49c1870 ; collecte lecture seule par Antoni)

- Live 18:01 → 23:32 (Paris), 5 h 31. Aucun `not_lease_holder`, `REJECTED by Core`, erreur ni timeout (bot) ; aucune
  erreur Core ; aucune perte par bail démontrée. 3 follows `pending 500` (= statut + montant, pas un HTTP 500) : crédités.
- Fidélité 1 790 récompenses créditées, 0 pending, 0 incohérence wallet. Tombola 14 tirages, 19 gagnants payés,
  171 500 Jetons, 0 impayé. Aucun solde négatif. Random Ban 6 confirmés. Roue V1 : aucun tour.
  `cmd_steps` : 9 mini_game + 106 word_game réussis.
- **Bug démontré — Random Ban / Points de chaîne** : 6 `rb_requests` `confirmed` mais leurs 6 `cp_redemptions`
  « Ban aléatoire » restées `pending` (aucun `cp_job` : normal, un Random Ban n'en crée pas). Cause : la rédemption ne
  suivait son Random Ban que dans `ChannelPointsService.state()` (lecture de l'onglet Studio Points de chaîne) ;
  `claim()` règle sons et effets, pas les Random Ban → sans cette lecture, `pending` pour toujours. `twitch_status =
  unfulfilled` est **voulu** (récompenses créées par SAMMI : Raptoru ne valide ni ne rembourse jamais sur Twitch).
- **Correctif local (non commité, non déployé, isolé de la V2)** : `src/random-ban/service.ts` (`onResult`, appelé
  après le commit de `result()`, échec journalisé sans faire échouer le rapport du bot) + `src/channel-points/service.ts`
  (`settleRandomBans(channel, requestId?)` : seule la rédemption de CE Random Ban). Test : `test/random-ban.test.ts`
  « the redemption follows the result without Studio » (échoue sans le correctif, passe avec ; 28/28 sur RB + Points de
  chaîne ; tsc, eslint, prettier OK). Déploiement = Core seul, aucune migration.
- **Livraison (22/10)** : commit `2e8bfcb` (= 11ffe3f + le patch, empreinte identique) poussé sur `origin/main` sur GO
  d'Antoni, depuis le worktree isolé (le `main` local reste à 11ffe3f avec la V2 non commitée : ne pas `git pull`
  sans précaution, les 3 fichiers du correctif y sont déjà modifiés à l'identique). Image construite localement depuis
  `git archive 2e8bfcb` : correctif présent, aucun code V2, dernière migration `20261031130000_bot_instance.sql`
  (= Production). Rollback : redéployer 11ffe3f (image précédente dans Coolify).
- **DÉPLOYÉ en Production le 22/10 (confirmé par Antoni)** : Core `2e8bfcb912775292070cb9b989746a0134f6c5c`, build
  Docker OK, healthy, rolling update terminé, Coolify Success. Bot inchangé (49c1870). Les 6 anciennes rédemptions
  NON régularisées. **Chantier clos** ; reste seulement la validation fonctionnelle au prochain vrai « Ban aléatoire »
  (sa rédemption doit passer seule à « done », vérifiable en SQL lecture seule). La régularisation des 6 anciennes =
  sujet séparé (ouvrir l'onglet Studio Points de chaîne en profil Production la déclenche : statut seulement).
- Worktree `scratchpad/rb-wt` encore présent : retirer les jonctions de son `node_modules` avec `cmd /c rmdir` avant
  `git worktree remove` (jamais de suppression récursive).
- **Prêt à déployer (22/10, verdict PRÊT)** : patch isolé `rb-fix-11ffe3f.patch` (sha256 `cf8bc96af6007bed…`,
  scratchpad de la session) = 2 fichiers `src` + 2 tests + script `test:integration` ; s'applique proprement sur
  11ffe3f (vérifié sur un checkout neuf). Worktree de vérification `scratchpad/rb-wt` (11ffe3f + patch, sans V2) :
  Core 856 passés, intégration PostgreSQL réel 53/53 dont `random-ban-redemption.integration.test.ts` (6 rédemptions
  simultanées sur 2 Cores, chaque rapport envoyé 2 fois en parallèle, un refus, une « historique » intacte ; 3/3, échoue
  sans le correctif), tsc, eslint, build OK. ⚠ son `node_modules` contient des jonctions vers celui du dépôt : les
  retirer avec `cmd /c rmdir` (jamais une suppression récursive) avant `git worktree remove`.
- **Les 6 anciennes rédemptions (non touchées)** : le code Production actuel les régularise déjà de lui-même à la
  première ouverture de l'onglet Points de chaîne de Studio en profil Production (`state()`) : mise à jour de
  `results`/`status` seulement → « done », aucun appel Twitch, aucun remboursement, aucune ré-exécution (Random Ban
  `confirmed` final, jamais réclamé de nouveau). Dans la file Twitch : « Terminer » si besoin, **jamais « Annuler »**
  (Twitch rendrait 3 000 points pour un ban effectué). Le correctif ne les touche pas (ciblé par requête).
- Encore ouvert : erreurs `cmd_steps` non vérifiées (`error` est jsonb : `error::text`). Complément :
  `audit-live-2026-10-21-b.sql` (scratchpad de la session, via `run-audit.sh`).
- Extension désactivée volontairement une partie du live (accès individuels) : pas un incident.

## Avant la Production (rappel)

- Ordre : migrations R1, R2, R8 → Core → release Studio (migrations Lab) → release extension (module hub, écran
  Équipe) ; bot redéployé (mois cumulés) plus tard. Vérifier en lecture seule les noms de contraintes de `sw_spins`.
- Le module extension reste masqué en Production (`ExtFacade` : `sub_wheel: false`) jusqu'à décision.

## Travaux futurs (non bloquants)

- Permission dédiée aux décisions « À vérifier » (aujourd'hui `subWheelGrant`).
- Annuler une acceptation (`requested` → `owed`) pour `subWheelDraw` (plan § 10 bis, 🟦).
- Liste des invitations dans Studio ; noms des viewers dans les détections R7 (ID seulement aujourd'hui).
- Critère de présence « a écrit dans le chat < 5 min » (aucune donnée stockée).
- Validation visuelle de la vue extension sur les surfaces Vidéo / Panel (testée en mobile seulement).
