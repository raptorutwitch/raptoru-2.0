# Supervision des interactions viewers — lots 1 et 2 (Studio seul)

- **Livré le** : 23/10/2026.
- **Worktree** : `sup-wt`, branche `fix/supervision`, base `origin/main` = `2d80c2a`.
- **État** : non commité, **non validé** (aucun test manuel d'Antoni à ce stade).
- **Plan** : `docs/PLAN_SUPERVISION_2026-10-23.md`.
- **Incident d'origine** : `docs/TWITCH_CONNECTION_INCIDENT_2026-10-22.md` (dépôt principal).

## Ce qui change pour le streamer

1. **Centre de contrôle → tuile « Interactions viewers (TTS, Soundboard, Bonk) »**.
   - Une ligne par élément : Studio ↔ Core (profil Production), TTS, Soundboard, Bonk.
   - Les règles sont **celles du Core** :
     - un module dont le dernier signal accepté par le Core date de plus de 10 s → « Non vu par le Core » (le Core
       refuse ses demandes) ;
     - lecteur TTS / Soundboard absent → « Lecteur absent » ;
     - Bonk : « OBS déconnecté », « Source absente » ou « Overlay absent ».
   - Pour chaque cause : la dernière erreur connue du module, le délai depuis le dernier signal, et quoi faire.
2. **Bandeau global** sous la barre d'onglets, **visible sur tous les onglets** :
   - rouge pendant une panne confirmée : module, cause, depuis quand, « Action requise » ou « Récupération
     automatique en cours » ;
   - vert une fois rétabli (« indisponible de … à … ») ;
   - il reste affiché **jusqu'au clic sur « Vu »**. Une panne en cours ne peut pas être masquée.
3. **Notification Windows** :
   - **une seule** par panne confirmée, et une seule au rétablissement, **même si Studio est au premier plan** ;
   - un clic ramène Studio ;
   - jamais répétée pendant une même panne. À la réouverture de Studio, une panne déjà terminée n'est pas renotifiée.
4. **Anti-fausses alertes** :
   - une panne n'est « confirmée » qu'après **30 s** d'indisponibilité continue ;
   - en dessous, c'est une **microcoupure** : notée dans l'historique et le journal, sans bandeau ni notification.
5. **Historique « Coupures récentes »** dans le Centre de contrôle (50 derniers changements), plus **une ligne par
   changement** dans `%APPDATA%\Raptoru Studio\logs\studio-server.log`. Par exemple : `[supervision] Soundboard :
indisponible (player_offline) — Lecteur absent`, puis `… rétabli après 13 min 50 s`.
6. **Bot** : il entre dans le même mécanisme (bandeau et notification si le Centre de contrôle le voit en erreur).
   Pour un bot sur le **VPS**, la consigne nomme la connexion perdue, dit que le bot se reconnecte seul et renvoie au
   journal Coolify. Elle ne renvoie **plus** vers « Connexions Twitch » (jetons du PC). Pour un bot sur ce PC, la
   consigne reste inchangée.
7. **Profil Production : réautorisation des jetons du PC masquée**.
   - Le panneau devient « Comptes Twitch — jetons de ce PC », avec la mention « Non utilisés par le bot de Production
     (VPS) ».
   - Le bouton « Réautoriser » disparaît, et le serveur refuse aussi (`production_profile`).
   - « Vérifier » reste disponible. **En Lab, rien ne change.**
   - Les jetons locaux existants ne sont pas touchés.

**Refus métier ≠ panne** :

- un module mis **en pause par le streamer** (TTS en pause / désactivé) apparaît « Arrêté », jamais en panne ;
- solde insuffisant, cooldown et file pleine ne passent pas par cette supervision.

Le comptage des refus réellement subis par les viewers est **côté Core : lot 3, non commencé**.

## Fichiers

| Fichier                                                                                                     | Rôle                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/studio/server/src/supervision/signals.ts` (nouveau)                                                   | état des modules d'après les règles d'admission du Core, tuile du Centre de contrôle                                        |
| `apps/studio/server/src/supervision/supervisor.ts` (nouveau)                                                | transitions, microcoupure / panne confirmée (30 s), historique, « Vu », `GET /api/supervision`, `POST /api/supervision/ack` |
| `apps/studio/server/src/index.ts`                                                                           | branchement (lecture des runtimes TTS / Soundboard / Bonk, liaison Production, bot)                                         |
| `apps/studio/server/src/{tts-lab,sound-lab,bonk-lab}/worker.ts`, `bonk-lab/runtime.ts`                      | `lastHeartbeat` et `sourceReady` rendus lisibles (un mot chacun)                                                            |
| `apps/studio/server/src/control-center/bot.ts`                                                              | consigne selon l'hôte du bot (`botTwitchHint`)                                                                              |
| `apps/studio/server/src/twitch-oauth/twitch-connections.ts`, `web/src/twitch-connections.ts`                | profil Production : réautorisation refusée et masquée, mention « jetons de ce PC »                                          |
| `apps/studio/web/src/supervision-banner.ts` (nouveau), `main.ts`, `control-center.ts`, `control-center.css` | bandeau global, historique                                                                                                  |
| `apps/studio/desktop/src/incident-notifier.ts` (nouveau), `main.ts`                                         | notification Windows (Electron `Notification`, `AppUserModelID` `fr.raptoru.studio`)                                        |

## Tests (automatiques, aucun test manuel à ce stade)

- Nouveaux :
  - `server/test/supervision.test.ts` (16) ;
  - `server/test/supervision-view.test.js` (4) ;
  - `desktop/test/incident-notifier.test.ts` (5) ;
  - Production dans `twitch-connections.test.ts` (2) et `twitch-connections-view.test.js` (1).
- Suites : Studio serveur complète, Studio desktop (31/31), typecheck serveur / web / desktop, lint, Prettier, build
  web. Les résultats chiffrés sont dans le rapport de livraison.
- Aperçu rendu avec le vrai code et les vraies feuilles de style, sur des données simulées (scénario « lecteur
  Soundboard absent de 22:40 à 22:53 ») : `docs/assets/supervision-preview-2026-10-23.png`.

## Limitations connues

- **C'est la vue de Studio**, pas ce que le Core a réellement refusé. Le comptage des refus viewers et l'historique
  côté Core sont au **lot 3** (historique persistant en base, décision du 23/10, migration à valider).
- **Historique en mémoire** : remis à zéro au redémarrage de Studio. Le journal `studio-server.log` garde l'exécution
  en cours et la précédente (5 Mo).
- **Notifications seulement si Studio tourne.** Sans Studio, aucun TTS / Soundboard / Bonk ne peut être joué de toute
  façon.
- La tuile Bonk reprend le contrôle actuel de la source (`sourceReady` : source « Raptoru Bonk Lab » affichée à
  l'écran). Le défaut DSK connu n'est **pas** corrigé ici.
- La santé du bot reste celle que le bot rapporte (F3–F9 du rapport d'incident : lot bot séparé).
- **Non testés ici** :
  - la notification Windows réelle (Electron n'est pas installé dans le worktree ; la logique est testée, l'affichage
    du toast non) ;
  - le comportement en conditions réelles avec OBS.

## Installateur de test 0.1.7-sup.1 (23/10) — construit, NON installé, NON publié

- **Fichier** : `C:\Users\Antoni\Documents\rs-sup\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.1.exe`
  (120 894 105 o, SHA-256 `90c5c6925f5b1e0438b77dbf421ed06ed9338736462241cda14f0a2b0d141f05`).
- **Clone de construction** : `C:\Users\Antoni\Documents\rs-sup` (chemin court), sur `2d80c2a`, push désactivé. Il
  contient les modifications de `sup-wt`, copiées sans commit. Construit avec `turbo run build`, `stage.mjs` et
  `electron-builder --publish never`, sans le script `studio:release` : pas de GitHub, pas de mise à jour automatique.
- **Version** : `0.1.7-sup.1` est une étiquette de test posée au moment de la construction, dans le paquet seulement
  (`package.json` du dépôt inchangé, toujours 0.1.6).
  - Elle est **inférieure** à une future 0.1.7 publique : l'updater pourra la remplacer normalement.
  - `build-info.json` garde le SHA `2d80c2a` (aucun commit) et ajoute un champ `source` qui mentionne les lots non
    commités.
  - Studio « À propos » affichera « 0.1.7-sup.1 / 2d80c2aa548a ».
- **Vérifié dans le paquet** : `supervision/signals.js`, `supervisor.js`, `incident-notifier.js`, le bandeau dans le
  bundle web et le refus `production_profile` sont présents. Aucun `.env` ni jeton (`stage.mjs`).
- **Installation actuelle intacte** : `%LOCALAPPDATA%\Programs\Raptoru Studio` est toujours en 0.1.7 / `2d80c2a`.

### Installer pour tester (hors live, sur décision d'Antoni)

1. Fermer Raptoru Studio (fenêtre et serveur).
2. Lancer `Raptoru Studio Setup 0.1.7-sup.1.exe`. Il remplace la 0.1.7 dans le même dossier.
   - Les données sont conservées : `%APPDATA%\Raptoru Studio` (profil, appairage Production, identifiants OBS chiffrés,
     journaux) et le dossier de données `C:\Users\Antoni\Documents\Raptoru 2.0`, désigné par
     `%APPDATA%\Raptoru Studio\studio.json`.
3. Ouvrir Studio et vérifier : profil Production « connecté », « À propos » = 0.1.7-sup.1.

### Retour arrière vers 0.1.7

1. Fermer Studio.
2. Paramètres Windows → Applications → Raptoru Studio → Désinstaller. Les données de `%APPDATA%\Raptoru Studio` ne
   sont pas supprimées (`deleteAppDataOnUninstall` non activé).
3. Lancer `C:\Users\Antoni\Documents\rs017\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7.exe` (SHA-256
   `ac3f66c93bf67ab294a1b709394d7ba014c367894ea2fa71b6449d2bea5ba591`, vérifié le 23/10).
4. Ouvrir Studio : « À propos » = 0.1.7 / `2d80c2a`, profil Production connecté.

### Test manuel court (≈ 10 min, hors live, OBS ouvert, rien n'est diffusé)

Prérequis : Studio 0.1.7-sup.1 en profil Production, OBS ouvert. **Ne pas streamer.**

1. **État initial** : Studio → Centre de contrôle. La tuile « Interactions viewers » est verte : Studio ↔ Core
   Connecté, TTS Prêt (N voix), Soundboard Prêt, Bonk Prêt. Aucun bandeau. Panneau « Comptes Twitch — jetons de ce
   PC » : pas de bouton « Réautoriser ».
2. **Microcoupure (< 30 s)** :
   - dans OBS, masquer (œil) **la source navigateur du lecteur Soundboard** pendant ~15 s, puis la réafficher ;
   - attendu : la tuile passe en rouge « Lecteur absent » en ≤ 10 s, puis redevient verte ;
   - **aucun bandeau ni notification** ;
   - « Coupures récentes » montre « indisponible (player_offline) » puis « microcoupure de … s, rétablie seule ».
3. **Panne confirmée (> 30 s)** :
   - masquer la même source pendant ~60 s ;
   - attendu vers 30–40 s : **bandeau rouge** sur tous les onglets (« Soundboard : Lecteur absent · Action
     requise ») et **une notification Windows** « Raptoru — Soundboard indisponible » ;
   - pas de seconde notification pendant la panne.
4. **Rétablissement** :
   - réafficher la source ;
   - attendu : bandeau **vert** « Soundboard rétabli · indisponible de … à … » avec « Vu », et **une notification**
     « Raptoru — Soundboard rétabli » ;
   - un clic sur la notification ramène Studio.
5. **« Vu »** : cliquer → le bandeau disparaît. L'historique garde les lignes.
6. **Journal** : `%APPDATA%\Raptoru Studio\logs\studio-server.log` contient les lignes `[supervision] …`.
7. _(Optionnel)_ Même essai avec la source **TTS**, puis avec l'**overlay Bonk** : « Overlay absent » ou « Source
   absente ».

Si la source est seulement masquée et non retirée, le lecteur peut continuer à signaler selon les réglages OBS (option
« Arrêter la source quand elle n'est pas visible »). Si rien ne bouge à l'étape 2, **désactiver** la source ou fermer
temporairement le lecteur Soundboard.

À noter pour le rapport :

- délai d'apparition du rouge ;
- délai du bandeau et de la notification ;
- texte affiché ;
- tout faux positif constaté.

## Correctif « Ctrl+R oblige à réactiver la Soundboard » (23/10) — non commité, NON validé

**Diagnostic** :

- Le lecteur Soundboard de Production est une `<iframe>` dans la fenêtre Studio (`web/src/sound-lab.ts`), pas une
  source OBS.
- Ctrl+R (menu Electron par défaut) recharge **la page Studio et cette iframe**. Il ne recharge **pas** le serveur
  Studio, le worker Soundboard ni le Core.
- « Activer le son » ne vivait que dans la mémoire de la page (`audioEnabled`, `sound-player/player.js`). Après le
  rechargement, le lecteur repart sans son ; Studio signale `player_ready: false` au Core, qui refuse les Soundboards
  (`player_offline`).
- **Le module ne passe pas de ON à OFF** : réglages, sons actifs et protection de volume sont dans le Core et ne
  bougent pas. **Seul le lecteur perd sa disponibilité.**
- **La supervision ne le provoque pas, elle le rend visible** : bandeau après 30 s.
- **Présent en 0.1.7** : le `player.js` installé est identique à `2d80c2a` (aux fins de ligne près) et ne mémorise
  rien.

**Correctif** :

- `sound-player/audio-choice.js` (nouveau) et `player.js` : le choix est mémorisé dans le stockage local du lecteur
  (`raptoru.soundboard.audio`) :
  - « Activer le son » → `on` ; au chargement, le son est rétabli sans clic quand le navigateur l'autorise (Electron :
    oui par défaut) ;
  - nouveau bouton **« Couper le son »** → `off` : un rechargement **ne réactive jamais** une coupure volontaire ;
  - jamais activé → comportement inchangé (premier clic requis) ;
  - navigateur qui refuse le son → message « exige un clic », sans le compter comme une coupure.
- Studio reçoit l'info `off` (`runtime.ts`, `worker.ts` : `cutOnPurpose`) : la supervision affiche « Son coupé
  (volontaire) » en **off**, sans bandeau ni notification. Le Core refuse quand même les Soundboards tant que le son
  est coupé, ce qui est voulu ; l'extension l'indique.

**Tests** :

- Navigateur sur la **vraie page du lecteur** (`e2e/players.e2e.ts`, 4 nouveaux) :
  - activé puis rechargé → rétabli sans clic ;
  - coupé puis rechargé → reste coupé, puis réactivable ;
  - jamais activé → inchangé ;
  - refus du navigateur → demande un clic.
- **Preuve de non-régression** : le premier test **échoue** sur le lecteur d'origine (`2d80c2a`) et passe avec le
  correctif.
- Unitaires : `test/sound-audio-choice.test.js` (2) et supervision « coupé volontaire » = off (1).
- Résultats :
  - `e2e/players.e2e.ts` 9/9 ;
  - suite Studio serveur 59 fichiers, 577/577, sortie 0 ;
  - typecheck, lint et Prettier OK.

**Non couvert ici** :

- l'essai réel dans Electron (Ctrl+R dans Studio) : à faire hors live ;
- l'installateur `0.1.7-sup.1` déjà construit **ne contient pas** ce correctif : il faudra le reconstruire.

## Passe de finalisation (23/10, après-midi) — 0.1.7-sup.2, non commitée, NON validée

### 1. OAuth des comptes Twitch du PC

**Causes démontrées** :

- Un jeton d'accès Twitch dure environ 4 h. Sur ce PC, seuls des consommateurs locaux le renouvellent : bot du Test
  Lab et adaptateur chat du Lab (`TwitchAuth.init` → validation → renouvellement sur 401). Ils le font sans
  intervention à leur démarrage et pendant leur fonctionnement.
- En profil Production, **aucun service ne les utilise**. Le bot VPS a ses propres copies, et les Points de chaîne
  passent par le bot de Production. Personne ne renouvelle donc les jetons du PC, et l'accès expire chaque jour.
- Studio affichait cet état normal comme « Jeton refusé ou expiré » (badge rouge). « Vérifier » faisait seulement
  `GET /validate`, sans jamais renouveler : 401 → « refusé » → réautorisation inutile.
- « Dernière validation : jamais » : les vérifications vivent en mémoire de Studio et repartent à zéro à chaque
  redémarrage.
- Défaut annexe du lot 1 : le code `production_profile` était renvoyé comme `invalid_request`.

**Corrections** :

- Bot : `twitch-auth --renew` (`runTwitchRenewal`) reprend **le chemin de démarrage du bot** (`TwitchAuth`) :
  - verrou de fichier partagé avec tous les consommateurs ;
  - renouvellement unique même si plusieurs demandes arrivent en même temps ;
  - nouveau jeton de renouvellement conservé, validé avant écriture ;
  - refus définitif sans boucle ;
  - aucun jeton n'est affiché.
- Studio « Vérifier » : `GET /validate`. Si Twitch refuse et qu'un jeton de renouvellement existe (ou qu'un
  renouvellement interrompu est en attente), Studio appelle ce renouvellement, puis revalide.
  - Résultat « Autorisation vérifiée — renouvelé automatiquement le … ».
  - Une réautorisation n'est demandée **que** si le renouvellement est refusé (`refresh_rejected` : révocation,
    changement de mot de passe), si les droits manquent, ou en cas de mauvais compte ou de fichier absent.
  - Twitch injoignable ou verrou occupé : « temporaire, réessaie », jamais rouge.
- Affichage :
  - nouvel état « Accès expiré · renouvelable » (orange en Lab, neutre en Production), avec explication ;
  - en Production, aucun rouge pour un état normal ou temporaire ;
  - un vrai refus reste signalé, et précise « sans effet sur le bot de Production ».
- Pas de renouvellement automatique en tâche de fond. Ce n'est pas nécessaire : les consommateurs locaux renouvellent
  à l'usage. Cela préserve aussi la règle « le tableau de bord ne réécrit rien de lui-même ».

**Fonctionnalités dépendant des jetons du PC** :

- **Lab uniquement** : ingestion chat du Lab et alertes Twitch Lab (LeCroupier_), bot du Test Lab, réception des
  Points de chaîne en Lab (raptoru_).
- **Profil Production : aucune.** Bot, EventSub, Points de chaîne et alertes passent par le bot VPS.

### 2. Soundboard Ctrl+R

Correctif inchangé. Il est présent dans le paquet (`sound-player/audio-choice.js`). Tests navigateur 9/9.

### 3. Supervision

- **« Réserve » après rétablissement (constaté)** : un seul tick en erreur rendait la tuile orange jusqu'au tick
  suivant (≤ 1 s, mais l'affichage ne se rafraîchit que toutes les 5 s). Désormais, un module prêt et vu par le Core
  reste **vert** avec « Prêt · erreur passagère » et la dernière erreur en consigne.
- **Démarrage** : 20 s de grâce, sans comptage, le temps que les lecteurs et OBS se reconnectent. Une panne encore là
  après la grâce est confirmée 30 s plus tard (≈ 50 s après le lancement).
- **Notifications** : la logique (une par panne, une au retour) était déjà testée. Les notifications restent
  maintenant référencées jusqu'à leur fermeture, sinon Electron perd le clic. Lors du test du 23/10, la notification
  de **panne** n'a pas été mentionnée : **à revérifier**.
- **« Paiement encore simulé »** (cartes Production Soundboard, TTS, Bonk) : libellé obsolète. Le Core de Production
  est en économie canonique : l'extension débite le Wallet Raptoru via le port d'économie
  (`interaction:<id>:debit`), avec remboursement unique. Libellés corrigés. Les Points de chaîne de la Soundboard
  sont payés sur Twitch.
- **Mise à jour GitHub des versions de test** : une version `0.1.7-sup.x` faisait chercher à l'updater un canal
  « sup » inexistant, d'où l'erreur. Les versions de test (contenant un `-`) ne contactent plus GitHub et affichent
  « Version de test … : mises à jour automatiques désactivées ». Les versions officielles `x.y.z` ne changent pas.

### 4. Tests (état final, codes de sortie)

| Suite                                                    | Résultat                                                | Sortie |
| -------------------------------------------------------- | ------------------------------------------------------- | ------ |
| Studio serveur (vitest)                                  | 59 fichiers, 583/583                                    | 0      |
| Bot (vitest)                                             | 26 fichiers, 248/248, dont `twitch-renewal.test.ts` 6/6 | 0      |
| Studio desktop (vitest)                                  | 7 fichiers, 34/34                                       | 0      |
| Studio E2E navigateur (Playwright, toute la suite)       | 34/34, dont lecteurs 9/9                                | 0      |
| Typecheck bot / Studio serveur / page / desktop          | OK                                                      | 0      |
| ESLint `apps/studio` + `apps/twitch-bot`                 | OK                                                      | 0      |
| Prettier (sources modifiées)                             | OK                                                      | 0      |
| Build (`turbo run build --force`, clone de construction) | 8/8                                                     | 0      |

Scénarios OAuth simulés :

- valide (rien réécrit) ;
- expiré → renouvelé (jeton de renouvellement tourné conservé, redémarrage sans nouveau renouvellement) ;
- refus → définitif, fichier intact ;
- Twitch injoignable → temporaire ;
- **deux renouvellements simultanés → un seul appel `/token`** ;
- aucun secret dans les événements.

Côté Studio :

- renouvellement réussi → « vérifié » ;
- refus → réautorisation ;
- sortie non reconnue → `refresh_failed` ;
- pas de jeton de renouvellement → aucun appel ;
- renouvellement interrompu confié au bot.

### 5. Installateur 0.1.7-sup.2

- `C:\Users\Antoni\Documents\rs-sup\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.2.exe`
- 120 898 338 o
- SHA-256 `57391245f90bbaa86bc11be82d7a56c6b062a369e6f07e13f4470a3d55f3ccb7`
- Clone resynchronisé avant construction : mêmes 37 fichiers que `sup-wt`, 0 différence de contenu (fins de ligne
  exceptées).
- Contenu vérifié dans le paquet : version, correctifs présents, aucun `.env` ni jeton.
- Précédents conservés :
  - `…\rs-sup\apps\studio\desktop\release-0.1.7-sup.1\Raptoru Studio Setup 0.1.7-sup.1.exe` (SHA-256 `90c5c692…`,
    inchangé) ;
  - `…\rs017\…\Raptoru Studio Setup 0.1.7.exe`.
- Studio installé au moment de la construction : **0.1.7-sup.1**.

### 6. Procédure unique de validation hors live (≈ 15 min, OBS ouvert, sans streamer)

Installation :

1. Fermer Studio.
2. Lancer `Raptoru Studio Setup 0.1.7-sup.2.exe` : il remplace la version installée et conserve les données.
3. Ouvrir Studio. Sur ~50 s, **aucun bandeau** ne doit apparaître.
4. « À propos » = 0.1.7-sup.2.
5. Widget de mise à jour : « Version de test … : mises à jour automatiques désactivées », sans erreur GitHub.

Comptes Twitch :

6. Les deux comptes ne sont **pas rouges** (« Accès expiré · renouvelable » ou « Non vérifié »).
7. Cliquer « Vérifier » sur LeCroupier_, puis sur raptoru_. Attendu : « Autorisation vérifiée — renouvelé
   automatiquement le … ». **Ceci renouvelle réellement les jetons du PC**, ce qui est sans effet sur le bot VPS.
8. Pas de bouton « Réautoriser » en Production.

Soundboard :

9. « Activer le son » dans le lecteur Soundboard de Studio, puis **Ctrl+R** : le son est rétabli seul.
10. « Couper le son », puis **Ctrl+R** : il reste coupé. La tuile affiche « Son coupé (volontaire) », sans bandeau.
11. « Activer le son » pour le rétablir.

Supervision :

12. Microcoupure : désactiver la source navigateur Soundboard environ 15 s → ligne « microcoupure », aucun bandeau,
    aucune notification.
13. Panne : environ 60 s → **notification « indisponible »** et bandeau rouge ; une seule notification.
14. Rétablissement : réactiver la source → **notification « rétabli »** et bandeau vert, puis « Vu ». La tuile
    repasse au vert sans rester en « Réserve ».
15. Cartes Soundboard / TTS / Bonk de l'onglet Studio : « Paiement réel au Wallet Raptoru… ».

Retour arrière :

- vers 0.1.7-sup.1 ou 0.1.7 : désinstaller (données conservées), puis lancer l'installateur voulu ;
- les jetons du PC renouvelés en sup.2 restent valides pour les versions précédentes, qui lisent les mêmes fichiers.

### 7. Non validable automatiquement

- toast Windows réel et clic ;
- Ctrl+R réel dans Electron ;
- autoplay réel d'Electron ;
- renouvellement réel auprès de Twitch ;
- comportement OBS réel ;
- affichage du widget de mise à jour d'une version de test.
