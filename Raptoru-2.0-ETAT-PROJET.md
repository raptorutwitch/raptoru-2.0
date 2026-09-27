# Raptoru 2.0 — État du projet / fichier de reprise

**Dernière mise à jour : 27 septembre 2026 — Bonk V2 validé visuellement (Lab → Core → Studio → OBS, picker V2 + providers), checkpoint Git et release Studio**

## But de ce fichier
Ce fichier est la source de continuité du projet. Il doit permettre de reprendre Raptoru 2.0 dans une nouvelle conversation sans perdre :
- l’architecture validée ;
- les décisions produit ;
- les validations réellement effectuées ;
- ce qui est fini techniquement ;
- ce qui reste à migrer/repenser ;
- les règles de cutover ;
- la direction produit autour de l’extension, du site, des stats et des cosmétiques.

Il ne faut pas utiliser le mot **« terminé »** de façon ambiguë. Distinguer systématiquement :
1. **Core / moteur techniquement validé** ;
2. **feature fonctionnelle migrée et prête** ;
3. **activée en production**.

---

# 1. Règles de travail verrouillées

- Toujours auditer l’existant avant de modifier.
- Identifier le workspace canonique et le dernier état réellement utilisé avant toute action.
- Correctifs minimaux et causaux ; éviter les refactors opportunistes.
- Tester les non-régressions.
- Ne pas déployer ni pousser sans validation explicite.
- Aucun cutover partiel juste parce qu’un module est techniquement valide.
- **SAMMI + StreamElements restent la production/référence jusqu’au feu vert GLOBAL.**
- Raptoru 2.0 peut être entièrement construit, branché et testé en parallèle.
- Les flags de crédit/chat réels restent OFF tant que le cutover global n’a pas lieu.
- Ne jamais committer `.env`, tokens OAuth, secrets ou fichiers runtime.
- Le Core est la source de vérité métier et économique.
- Le Twitch Bot reste un adaptateur fin Twitch → Core.
- Le Studio est le cockpit local streamer, pas un moteur de logique métier.
- Une logique métier ne doit exister qu’une seule fois dans Core.
- Ne pas recréer SAMMI sous forme d’un moteur générique/DSL de workflows.
- Les données historiques StreamElements (soldes, stats utiles, etc.) seront importées **à la toute fin**, juste avant le cutover, pour éviter qu’elles deviennent obsolètes pendant que les viewers continuent d’utiliser l’ancien système.

---

# 2. Workspace et stack

## Workspace canonique
`C:\Users\Antoni\Documents\Raptoru 2.0`

## Stack
- monorepo npm workspaces + Turborepo ;
- Node 22 ;
- TypeScript strict ;
- Electron pour Studio ;
- Core API ;
- Twitch Bot ;
- Postgres local via Docker ;
- Supabase/Postgres dans l’architecture serveur ;
- Twitch EventSub / Helix ;
- obs-websocket v5, local et réservé au Studio.

## Architecture cible

### Core API
Cerveau/source de vérité :
- Wallet ;
- Loyalty ;
- Daily ;
- Presence ;
- interactions futures ;
- jeux futurs ;
- stats ;
- achievements/cosmétiques futurs ;
- configuration ;
- état durable ;
- règles de calcul ;
- idempotence ;
- historique/audit.

### Twitch Bot
Adaptateur Twitch :
- EventSub ;
- Helix ;
- chat ingress ;
- normalisation des événements ;
- forwarding durable vers Core ;
- aucune logique économique métier propre.

### Studio
Application locale streamer :
- contrôle Start/Stop ;
- état des services ;
- previews ;
- configuration future ;
- obs-websocket ;
- exécution locale des effets/overlays futurs ;
- outils de test.

### Extension Twitch
**Direction produit désormais prioritaire : l’extension doit devenir l’interface principale des viewers.**

Elle sert à :
- découvrir les interactions disponibles ;
- payer/déclencher des actions ;
- utiliser Bonk / Soundboard / TTS / Tombola et futurs modules ;
- afficher prix, cooldowns, disponibilité ;
- afficher profil, progression, stats, achievements et cosmétiques à terme.

L’extension ne possède jamais l’état économique : elle parle au Core.

### Site
Le site doit exploiter la même donnée Core que l’extension :
- profils viewers ;
- stats détaillées ;
- leaderboards ;
- achievements ;
- cosmétiques débloqués/équipés ;
- progression persistante.

---

# 3. Checkpoints Git importants

Historique principal :
- `90bb9a5 — chore: bootstrap clean Raptoru 2.0 monorepo`
- `69e813e — feat: add core daily vertical slice`
- `511744b — feat: add shadow presence tracking`
- `ea5455f — feat: add Studio test lab`
- `0329682 — feat: add core wallet and loyalty foundation`
- `f5e3985 — feat: add loyalty engine preview with presence integration`
- `322b85f — feat: package Raptoru Studio as a Windows installer`
- `22e1716 — feat: finalize Twitch rewards v1 with durable forwarding`
- `a7cc705 — feat: connect daily claims to the core wallet behind a flag`
- `ab7171f — test: strengthen wallet chat and identity coverage`
- `d02b3e5 — feat: import the production Twitch extension as static files`
- `7f90710 — feat: add Extension Lab tab to Raptoru Studio`
- `e8fbdbb — feat: add Raptoru Studio auto-update v1`
- `4995dad — configuration du vrai feed GitHub Releases + correction install/relaunch updater`
- `e12638d — bump Studio 0.1.0 → 0.1.1 pour le premier test réel d’auto-update`
- `1f8cfb0 — style: format wallet tests`
- `6d92a76 — feat: add one-command Raptoru Studio release pipeline`
- `353b052 — hook de test d’échec/rollback du pipeline release`
- `228980f — chore: release Raptoru Studio 0.1.2` (commit de release créé par le pipeline)
- `3665773 — feat: add Bonk Lab interactions to Core`
- `760cd5e — fix: harden Bonk Lab admission and worker readiness`
- `6fbdd0e — feat: add Bonk Lab Studio worker and OBS overlay`
- `45e6cd9 — feat: add Twitch viewer identity and emote catalog to Bonk Lab`
- `717d97b — feat: complete Bonk V2 picker and emote providers`
- commit `docs: update Raptoru 2.0 project state` (ce fichier, désormais versionné), puis commit de release Studio créé par `npm run studio:release` : SHA à lire dans `git log -n 10`.

Règles Git inchangées :
- branche `main` ;
- le repo local Raptoru 2.0 n’a pas de remote Git configuré ;
- aucun push du repo source effectué ;
- un ancien repo privé `raptorutwitch/raptoru-2.0` existe sur GitHub mais contient l’ancien historique et ne doit pas être traité comme miroir du workspace local actuel.

Le pipeline `studio:release` crée un commit local de version après publication réussie ; toujours vérifier `git log -n 10` avant de reprendre.

# 4. État technique actuel — résumé fiable

## Presence
**Techniquement VALIDÉ. Production : NON.**

- Get Chatters environ toutes les 2 minutes pendant le live ;
- snapshots durables ;
- présence validée sur 2 snapshots consécutifs ;
- séparation max 180 s ;
- erreurs/gaps sans rattrapage aveugle ;
- lease worker/channel ;
- `estimated_watch_seconds` ;
- fermeture/reconciliation stream sécurisée.

### Test réel du 25/09/2026
Stream `317823244002` :
`2026-09-25T18:08:21Z → 2026-09-26T01:29:50Z` (~7 h 21)

Résultat :
```text
63 viewers
1762 passive ticks
191350 Jetons passifs théoriques
0 tier_unknown
109900 Jetons événements théoriques
0 transaction Wallet réelle
```

Comparaison StreamElements : écart observé de 0 à 6 minutes sur les viewers comparés.

### Correctifs fermeture live
- reconciliation tardive basée sur la dernière confirmation live ;
- aucun crédit Presence si confirmation live >10 min (`live_unconfirmed`) ;
- Stop All lance `stream:reconcile` via Helix avant arrêt Core ;
- une erreur Helix n’est jamais interprétée comme offline.

---

# 5. Wallet / monnaie

## Wallet Core V1
**Techniquement VALIDÉ. Production : NON.**

Le moteur Wallet est considéré fini techniquement. Il comprend :
- currencies ;
- wallets ;
- opérations ;
- ledger/transactions immuables ;
- idempotence forte ;
- opérations atomiques ;
- locks ciblés/stables ;
- multi-currency natif ;
- balance sans cap ;
- lifetime earned/spent séparés des transferts ;
- staff roles ;
- fondations taux individuels/boosts.

Ledger types :
- reward ;
- spend ;
- transfer_out / transfer_in ;
- admin_add / admin_remove ;
- admin_set_adjustment ;
- penalty ;
- refund ;
- opening_balance.

Pas de dette pour les dépenses normales. Un malus explicite futur pourra rendre une balance négative si cette feature est décidée.

## Multi-currency
**La capacité technique existe déjà dans Wallet. Ce n’est PAS un futur chantier de fondation.**

Les travaux futurs portent seulement sur les usages : monnaies d’événement, règles, affichage, conversion éventuelle, expiration éventuelle, modules qui choisissent leur currency.

---

# 6. Wallet Commands + Permissions

**Techniquement VALIDÉ. Production : NON.**

Commit de couverture :
`ab7171f — test: strengthen wallet chat and identity coverage`

Commandes viewer :
```text
!solde
!balance
!compte
!give
!trade
```

Transfert :
```text
!give @pseudo 500
!give 500 @pseudo
```

Règles :
- minimum 1 ;
- pas de taxe ;
- pas de limite quotidienne ;
- pas de self-transfer ;
- pas de dépassement du solde ;
- atomique ;
- idempotent ;
- monnaie principale par défaut.

Permissions :
- viewer : droits Wallet normaux ;
- mod Twitch normal : mêmes droits qu’un viewer ;
- supermod : admin Wallet ;
- owner/broadcaster : admin Wallet.

Admin : add / remove / set. `set` reste un ajustement ledger et jamais un écrasement silencieux.

Identité canonique : `twitch_user_id`. Le changement de login garde le même wallet.

Dernière validation annoncée :
- Core API : 124 tests passés, 6 skipped ;
- Twitch Bot : 69 tests passés ;
- vrai Postgres déjà couvert par les tests d’intégration/concurrence ;
- `LOYALTY_CHAT_COMMANDS=false` reste OFF.

---

# 7. Loyalty / gains de Jetons

**Techniquement VALIDÉ. Production : NON.**

Les viewers peuvent gagner des Jetons par plusieurs sources déjà raccordées au nouveau système :
- présence/watchtime passif ;
- sub/resub ;
- subgifts ;
- Bits ;
- Follow ;
- Daily.

## Passif
`50 Jetons toutes les 6 minutes validées`

Multiplicateurs :
```text
non-sub : x1
T1      : x2
T2      : x2.5
T3      : x4
```

Taux individuel : remplace le multiplicateur tier pour le passif, sans cumul avec le tier.

Exclusions passives locales/configurables :
- `lecroupier_`
- `streamelements`
- `wizebot`

`Raptoru_` reste éligible pour tester le vrai parcours économique.

## Rewards Twitch V1
**Techniquement VALIDÉ. Production : NON.**

### Sub / Resub
```text
T1 : +2000
T2 : +4000
T3 : +10000
```

### Subgift
Gifter récompensé, recipient non récompensé comme gifter, anonymous sans identité récompensable.

Bonus volume :
```text
1–4   : +0 %
5–9   : +5 %
10–19 : +10 %
20+   : +20 %
```

Les gifts sponsorisés (ex. compte `minecraft`) sont autorisés à gagner des Jetons.

### Bits — calcul marginal progressif
```text
1–499 bits      : 700 Jetons / 100 bits
500–999 bits    : 900 Jetons / 100 bits
1000+ bits      : 1000 Jetons / 100 bits
```

### Follow
`+500 Jetons`, une fois par identité Twitch sur la durée de vie. Un unfollow/refollow ne crée pas une nouvelle récompense.

### Durabilité Rewards
Commit : `22e1716`

- outbox persistante `.loyalty-outbox.json` ;
- écriture avant envoi Core ;
- suppression après acceptation/replay/refus définitif ;
- survit aux restarts et indisponibilités Core ;
- journal des refus définitifs ;
- retry avec délai borné ;
- protection contre plusieurs consommateurs EventSub actifs.

Un cas de course extrême multi-bot subsiste théoriquement mais est considéré non bloquant dans l’usage normal Studio qui démarre une seule instance.

---

# 8. Daily V1

**Techniquement VALIDÉ et raccordé au Wallet. Production : NON.**

Commit initial : `69e813e`

Connexion Wallet : `a7cc705 — feat: connect daily claims to the core wallet behind a flag`

Le Daily possède :
- stream-day ;
- reset 16:00 Europe/Paris ;
- stream-day figé à partir du Twitch `started_at` ;
- plusieurs lives du même stream-day partagent le Daily ;
- streak ;
- éligibilité ;
- reward configurable ;
- claims idempotents ;
- historique.

Récompense actuelle par défaut :
`500 + 150 × streak`, capée à `2000` (configurable).

Le Daily reste propriétaire de :
- l’éligibilité ;
- la streak ;
- le montant ;
- le stream-day ;
- l’unicité du claim.

Le Wallet ne fait que recevoir la décision de crédit.

Connexion Daily → Wallet :
- `DAILY_WALLET_CREDITS=false` par défaut ;
- idempotency key ;
- `wallet_operation_id` ;
- retry des crédits pending ;
- stale `sending` requeue possible car Wallet idempotent ;
- aucun changement produit tant que flag OFF.

**Conclusion économique actuelle : le moteur de monnaie + les principales sources de gains + le Daily sont raccordés proprement.**

---

# 9. Flags de sécurité actuels

État attendu :
```text
LOYALTY_PREVIEW=true
LOYALTY_TWITCH_EVENTS=true
LOYALTY_PASSIVE_CREDITS=false
LOYALTY_EVENT_CREDITS=false
DAILY_WALLET_CREDITS=false
DAILY_CHAT_COMMANDS=false
LOYALTY_CHAT_COMMANDS=false
PRESENCE_SHADOW=true
```

Principe : techniquement validé ≠ activé en prod.

---

# 10. Twitch Auth

## LeCroupier_
Usage Presence / chatters.
Scope principal : `moderator:read:chatters`.

## Raptoru_
Broadcaster ID : `83603689`

Scopes validés :
```text
channel:read:subscriptions
bits:read
moderator:read:followers
```

Le snapshot abonnements réel et les preflights ont été validés.

---

# 11. Raptoru Studio Windows

**Application Windows installable + Extension Lab + auto-update + pipeline de release : VALIDÉS techniquement.**

## Packaging
Format officiel : installateur NSIS x64 per-user.

Install :
`%LOCALAPPDATA%\Programs\Raptoru Studio`

Config data root :
`%APPDATA%\Raptoru Studio\studio.json`

Exemple :
```json
{"dataRoot":"C:/Users/Antoni/Documents/Raptoru 2.0"}
```

Fonctionnement validé :
- lancement raccourci ;
- Node embarqué par Electron ;
- pas de console nécessaire ;
- single instance ;
- Start All / Stop All ;
- Test Lab ;
- Extension Lab ;
- secrets non packagés ;
- ports libérés après arrêt ;
- updater intégré.

## Auto-update réel
Commit de base :
`e8fbdbb — feat: add Raptoru Studio auto-update v1`

Comportement :
- version affichée dans la topbar ;
- bouton `Rechercher une mise à jour` ;
- détection d’une version plus récente ;
- bouton `Mettre à jour` ;
- téléchargement ;
- arrêt propre du serveur local/Core avant installation ;
- installation silencieuse puis relance avec `quitAndInstall(true, true)`.

Le test réel `0.1.0 → 0.1.1` a été validé de bout en bout :
```text
détection
→ téléchargement
→ arrêt propre
→ installation NSIS
→ relance automatique
→ app.getVersion() = 0.1.1
→ Extension Lab toujours présent
```

Le test `0.1.1 → 0.1.2` a validé la **détection réelle depuis l’application installée** :
`Nouvelle version : 0.1.2` + bouton `Mettre à jour`.

Ne pas prétendre que `0.1.2` a été installée si ce point n’a pas été revérifié au runtime au moment de la reprise.

## Repo public de Releases
Repo dédié :
`raptorutwitch/raptoru-studio-releases`

Principes :
- public ;
- ne contient pas le code source Raptoru 2.0 ;
- sert uniquement aux GitHub Releases Studio ;
- updater sans token embarqué ;
- artefacts de release : installateur `.exe`, `.blockmap`, `latest.yml`.

## Pipeline one-command
Commande canonique :
```text
npm run studio:release
```

Dry-run :
```text
npm run studio:release -- --dry-run
```

Le pipeline :
1. vérifie workspace / Git / feed / auth `gh` ;
2. refuse un working tree dirty ;
3. calcule le prochain patch ;
4. bump package + lockfile ;
5. lance les checks ;
6. package Studio ;
7. vérifie version, noms, taille, sha512, blockmap et secrets ;
8. crée d’abord une GitHub Release brouillon ;
9. vérifie les assets ;
10. rend la release publique/latest ;
11. retélécharge anonymement et compare les fichiers ;
12. crée le commit local de release ;
13. ne pousse jamais le repo source.

En cas d’échec :
- arrêt à l’étape fautive ;
- rollback du bump ;
- nettoyage de la release/draft créée quand possible ;
- aucun changement de l’installation Studio courante.

Le dry-run a été validé complètement, ainsi qu’un rollback injecté. La vraie release `v0.1.2` a été publiée avec succès et détectée par le Studio 0.1.1 installé.

## Règle workflow
Après une feature qui impacte Studio :
- développer ;
- tester ;
- obtenir une validation explicite du résultat ;
- lancer `npm run studio:release` ;
- le Studio installé récupère ensuite la nouvelle version via son bouton.

Pas de publication automatique à chaque commit.

## Limites non bloquantes
- installateur non signé → SmartScreen possible en téléchargement manuel ;
- UI Studio encore technique, grosse refonte UX finale repoussée ;
- ne pas transformer le pipeline release en CI/CD complexe sans besoin réel.

# 12. Extension Twitch + Extension Lab

## Extension Twitch actuelle
L’extension de production existante a été importée dans Raptoru 2.0 comme fichiers statiques.

Commit :
`d02b3e5 — feat: import the production Twitch extension as static files`

Archive de référence importée :
`raptoru-live-production-20260920-095259Z-consolidated-final.zip`

Elle contient notamment :
- Bonk ;
- Soundboard ;
- TTS ;
- Tombola ;
- historique/classement ;
- préférences/notifications ;
- surfaces panel, mobile, video component, config et live config.

Direction produit verrouillée :
**Extension-first pour les viewers.**

L’extension doit devenir l’interface principale pour découvrir, payer et déclencher les interactions. Le chat reste un raccourci/fallback, pas l’UX principale des catalogues complexes.

## Extension Lab local
Commit :
`7f90710 — feat: add Extension Lab tab to Raptoru Studio`

Le Lab sert **la vraie extension importée**, mais remplace :
- Twitch helper par un mock local `window.Twitch.ext` ;
- runtime API prod par un EBS Lab local ;
- identité/contexte Twitch par des simulations ;
- économie réelle par des Jetons/crédits fictifs.

Surfaces testables :
- Panel viewer 318×496 ;
- Mobile viewer ;
- Video component, 60 % du player, ratio 3:2 ;
- Config ;
- Live config.

Rôles/contextes :
- viewer ;
- modérateur ;
- broadcaster ;
- identité Twitch partagée/non partagée.

Le Lab actuel permet de tester visuellement :
- Soundboard ;
- Bonk ;
- TTS ;
- Tombola ;
- modération/états UI.

**Soundboard / TTS / Tombola : le Lab reste une simulation locale d’exécution** (wallet fictif en mémoire, journal local, rendu dans Studio).

**Bonk : exécution réelle en mode Bonk Lab** (`npm run bonk:lab`, Studio sur 4101, Core Lab sur 4301, base `raptoru_bonk_lab`) :
```text
extension réelle servie localement
→ façade LabEbs
→ Core local/test (validation, idempotence, channel_sequence)
→ worker Studio
→ obs-websocket + source navigateur « Raptoru Bonk Lab »
→ overlay OBS → ACK started / completed / failed
```
Voir § 16 « Bonk V2 — état validé ».

## Paiements
Les moyens de paiement Jetons et crédits d’extension doivent rester conceptuellement distincts jusqu’à audit complet.

Ne pas transformer aveuglément les crédits d’extension en currency Wallet. Chaque module déclarera plus tard les moyens de paiement acceptés.

Aucune économie réelle n’est utilisée par le Lab.

# 13. Inventaire fonctionnel actuel du stream à migrer/repenser

Cette liste vient de l’inventaire utilisateur du 26/09/2026. Elle devient la base de la roadmap fonctionnelle. Elle n’implique pas que tout sera recodé tel quel : chaque élément doit être audité et classé garder/améliorer/fusionner/remplacer/supprimer.

## Alertes stream
SAMMI gère actuellement :
- Raid ;
- Follow ;
- Sub ;
- Bits ;
- Don ;
- Gift.

Objectif futur : moteur d’alertes centralisé, cohérent avec Raptoru 2.0, sans multiplier des boutons SAMMI indépendants.

## Cam / OBS / ambiance
- overlay cam Shushu animé avec expressions ;
- changement de couleur via point de chaîne / presets filtre OBS ;
- LED derrière le streamer ;
- FX caméra via user-defined shader / obs-shaderfilter ;
- effet **Creepy** : fade noir, coupe micro, freeze frame, grosse distorsion/effet creepy, SFX, restauration de scène ;
- **We’ll Be Right Back** : texte animé + freeze cam en carré + mute + restauration ;
- **NTM** : vidéo transparente simple superposée ;
- effets spéciaux liés au mute streamer après votekick.

Le Creepy est une feature signature à préserver/améliorer.

## Soundboard
- grosse banque de sons ;
- historiquement exécutée par SAMMI ;
- extension actuelle déclenche SAMMI ;
- objectif : migration vers Core/Studio avec catalogue propre, extension-first, recherche/catégories/prix/cooldowns possibles.

## TTS
- texte saisi dans l’extension pour ne pas spoiler le texte dans le chat ;
- voix aléatoire ;
- petit personnage animé aléatoire synchronisé ;
- HTTP requests + animations WEBM ;
- assets/dossiers existants à récupérer.

## Ban aléatoire
- choisit dans les viewers ;
- vérifie follow pour éviter les bots ;
- exclut/protège selon règles mod/ban ;
- distingue sub/non-sub ;
- timeout 3 min si sub, 5 min sinon ;
- animation 2D maison + phrase X a banni Y ;
- déclenchable PDC et Jetons ;
- souhait futur : extension.

## Emote-only
- actuellement redemption PDC gérée par Wizebot ;
- peut rester externe au début.

## Spotify / file musique
- redemption PDC ;
- entrée `titre + artiste` ou lien ;
- recherche et ajout queue ;
- refund auto si introuvable ou ambigu ;
- `!song` donne titre actuel + demandeur ;
- viewer peut annuler sa propre chanson avant lecture et être remboursé ;
- contournement queue Spotify : chanson annulée = skip instantané quand elle arrive ;
- mods : `!songskip` ;
- skip viewer existe mais doit être limité/cooldown pour éviter abus.

## Commandes viewer personnalisées
Certains viewers ont leur propre commande pouvant déclencher :
- un son ;
- une phrase chat ;
- autres petites actions personnalisées.

À conserver sous forme configurable/permissionnée.

## Tombola
Feature très populaire.

- lancement automatique à intervalles aléatoires ;
- montant aléatoire ;
- 60 s pour join ;
- `!join` ou extension ;
- extension affiche participants + timer + gagnants ;
- différé pour ne pas spoiler avant overlay ;
- overlay type bandeau d’info TV ;
- jackpot normal environ 5 000–50 000 ;
- chance ~1/100 de Big Tombola or à ~200 000 ;
- distribution automatique des gains.

## Cash-in PDC → Jetons
Ancien système :
- `!cashin <somme>` ;
- ajuste dynamiquement le prix d’une redemption ;
- viewer achète la redemption ;
- conversion `10 PDC = 1 Jeton` ;
- ratio volontairement très peu rentable.

À décider plus tard si on conserve.

## Daily / streak
Daily nouveau système déjà validé. Ancien `!streak` à reproduire/adapter au nouveau Daily si désiré.

## Start stream flag
Ancien bouton manuel SAMMI servant de garde-fou “stream lancé”.
Dans Raptoru 2.0, la source doit être Twitch/stream state fiable, pas un bouton manuel sauf override de secours explicite.

## Bonk
Feature signature, déjà dans l’extension actuelle.

- viewer choisit une emote ;
- emote projetée vers la cam ;
- physique/rebond/bruit ;
- roule/disparaît/tombe ;
- chat ou extension ;
- Jetons only actuellement ;
- providers : Twitch, emotes de chaînes suivies/sub, 7TV, BTTV, FFZ, emoji style Discord/mobile souhaité ;
- ancien mode lock/loop/spam bancal : envoi par paquets de 5, pas fidèle à l’intention ;
- objectif : queue/burst/combo beaucoup plus précis.

## Level Up Wizebot
- détecte message Wizebot de level-up ;
- joue un son ;
- option par viewer dans l’extension ;
- désactivée par défaut ;
- feature utile à conserver.

## Votekick
Feature sociale importante.

- 1 initiation / heure / viewer ;
- vote 60 s ;
- majority yes → cible timeout ;
- majorité no → initiateur sanctionné ;
- égalité → coin flip ;
- logique “double peine” si unanimité/conditions spécifiques ;
- durée TO augmente avec nombre de votes ;
- mods non ciblables ;
- streamer ciblable ;
- si streamer perd : stream continue, micro forcé mute + animation “muted” réactive à l’audio.

## Caution
- `!caution @pseudo` ;
- vérifie si la cible est timeout ;
- calcule temps restant + prix ;
- confirmation avant paiement ;
- permet de libérer presque tout timeout si paiement ;
- fonctionne aussi sur le mute forcé streamer.

Le raccord mute/demute actuel est imparfait et doit être refait proprement.

## Jeu des mots
**Module le plus populaire du stream. Priorité forte.**

- banque ~16K mots français ;
- mot choisi périodiquement ;
- lettres mélangées ;
- récompense `100 Jetons × nombre de lettres` ;
- <30 s : bonus rapide x3 ;
- 30 s–5 min : x1 ;
- mot très ancien trouvé : x2 ;
- multi-mots dans un message → bonus ;
- streak dynamique à partir de 3 ;
- annonce à chaque palier atteint selon résultat du message ;
- Golden Word aléatoire x4, cumulable avec autres bonus ;
- streak breaker avec prime croissante ;
- problèmes historiques : duplicate/rapid race, messages simultanés qui se squeezent ;
- mode futur **mot maudit** avec lettre cachée ;
- ouvert à de nouveaux modes/événements sans casser la mécanique principale.

## StreamElements — jeux/commandes encore utilisés
- Jetons passifs : déjà remplacés techniquement par Presence/Loyalty ;
- `!duel` : duel pour X Jetons, coin flip, texte seulement actuellement ;
- roulette : mise Jetons, environ 50/50, texte actuellement ;
- slots : 3 emojis identiques ;
- `!oracle` : réponses audio/préenregistrées aléatoires ;
- combo d’emotes chat + breaker ;
- souhait : duel/roulette/slot surtout via extension avec visuels/animations et partage volontaire du résultat pour éviter spam chat ;
- Oracle pourrait devenir plus intelligent/contextuel plus tard.

## Wizebot — reste
- messages d’annonce ;
- commandes classiques d’info ;
- infos jeux, réseaux, codes, etc.

Orientation : déplacer les infos durables vers le site, conserver seulement quelques annonces/commandes utiles dans le chat.

## Stats / leaderboards actuels souhaités
- watchtime global / mois / semaine ;
- messages global / mois / semaine ;
- niveaux + titres ;
- futurs classements spécifiques par module.

---

# 14. Data, profils, achievements et cosmétiques — direction produit

Objectif : **un maximum de modules doit produire sa propre donnée structurée**, non seulement pour l’audit mais pour alimenter le site, les profils et la progression.

Exemples de stats :
- Bonks envoyés, emotes/providers, combos ;
- TTS envoyés, voix/personnages ;
- sons Soundboard ;
- Tombolas participées/gagnées, jackpots ;
- mots trouvés, vitesse, Golden, streaks, breakers ;
- roulette/slots/duels ;
- watchtime/messages ;
- Daily/streak ;
- gains/dépenses cumulés.

## Achievements
Le site doit pouvoir déverrouiller des succès à partir des événements/stats.

Exemples :
- premier Bonk ;
- 100 Bonks ;
- premier Golden Word ;
- streak Jeu des mots ;
- Big Tombola gagnée ;
- 100 h / 500 h / 1000 h watchtime ;
- longue streak Daily ;
- gros win casino ;
- etc.

## Récompenses cosmétiques
Le système futur doit distinguer **possédé** et **équipé**.

Idées :
- titres ;
- bordures leaderboard ;
- cartes de visite ;
- backgrounds/profils ;
- styles de pseudo ;
- FX autour du pseudo ;
- petits effets visuels rares ;
- autres éléments de personnalisation.

But produit : donner une progression persistante et des objectifs amusants qui donnent envie de revenir/farmer sans réduire le stream à une simple monnaie.

---

# 15. Briques communes futures à mutualiser

À construire seulement quand un premier vrai module l’exige, pas comme gros framework abstrait.

Briques probables :
- paiement Wallet / crédits ;
- moyen de paiement autorisé par module ;
- cooldowns ;
- permissions ;
- queue ;
- exécution ;
- ACK ;
- refund automatique si action non exécutée ;
- logs/audit ;
- stats/event emission ;
- configuration Studio ;
- pont vers overlays/OBS.

Flux cible typique :
```text
Extension/chat
  → Core valide l’intention
  → paiement/réservation
  → action en queue
  → Studio/overlay exécute
  → ACK succès
  → stats
```

Si exécution impossible : refund idempotent.

Ne pas créer un moteur générique de workflows. Construire le minimum commun nécessaire aux modules réels.

---

# 16. Roadmap fonctionnelle — état actuel

**Ne plus travailler sur l’infrastructure générale sauf bug réel.**
Le socle nécessaire au développement des features est maintenant suffisamment solide.

## Socle fermé techniquement
- Presence ;
- Wallet Core ;
- Wallet Commands + Permissions ;
- Loyalty passif ;
- Rewards Twitch V1 ;
- Daily V1 ;
- Daily → Wallet ;
- durabilité/restarts ;
- Studio runtime/package Windows ;
- Extension Twitch importée ;
- Extension Lab local ;
- auto-update Studio réel ;
- pipeline `studio:release` one-command ;
- Bonk V2 Lab (Extension Lab → Core → Studio → OBS, picker V2 + providers).

Tous ces éléments restent distincts d’un cutover production global.

## Bonk V2 — état validé

**Validé visuellement le 27/09/2026. Techniquement validé, mais PAS activé en production.**
SAMMI / StreamElements / système actuel restent la production jusqu’au feu vert global Raptoru 2.0.

Commits : `3665773`, `760cd5e`, `6fbdd0e`, `45e6cd9`, `717d97b` (voir § 3).

### Pipeline réel Lab
```text
Extension Lab (vraie extension servie localement)
→ façade LabEbs (Studio)
→ Core local/test (Lab Core 4301, base raptoru_bonk_lab)
   - validation emote par provider/id
   - idempotence (idempotency key + hash de requête)
   - interaction persistante, ordre durable channel_sequence
   - paiement simulé
→ worker Studio (journal, claims/leases, ACK)
→ OBS (obs-websocket, source navigateur « Raptoru Bonk Lab » 1920×1080)
→ overlay → ACK started / completed / failed
```
Lancement : `npm run bonk:lab` (Studio 4101, Lab Core 4301). Connexion OBS par mot de passe dans l’UI du Lab (non stocké).
Statuts : `accepted → queued → executing → completed` / `failed` / `execution_unknown` ; `executing` seulement après ACK `started`, `completed` seulement après fin réelle du rendu.

### Catalogue
- Twitch viewer OAuth `user:read:emotes` (compte test raptoru_), token stocké uniquement dans la base Lab, jamais exposé à l’extension/OBS ;
- catalogue viewer Twitch réel (Get User Emotes, ~1141 emotes) ;
- Twitch statiques + animées ;
- Bits regroupés via `emote_type = bitstier` ;
- Twemoji complet (~1914, banque Unicode de l’extension) ;
- 7TV, BTTV, FFZ : catalogues publics de la chaîne (globales + chaîne), sans token, cache Core 10 min ;
- validation Core par provider/id : le client n’envoie que `provider` + `provider:id` ;
- Core construit lui-même les URL (Twemoji local, CDN Twitch/7TV/BTTV/FFZ à gabarit fixe) ; aucune URL arbitraire client ; Core ne sert/proxy aucune image ;
- l’overlay n’accepte que ces formes d’URL, sinon échec explicite.

### Organisation finale du picker
Rail :
- Récents
- Favoris
- Twitch
- Bits
- Extension
- Emoji

Extension :
- Raptoru_
  - 7TV
  - BTTV
  - FFZ seulement si présent
- Globales
  - 7TV
  - BTTV
  - FFZ

Emoji : Smileys & personnes, Animaux & nature, Nourriture, Activités, Voyage & lieux, Objets, Symboles, Drapeaux.

### UX validée
- rail hiérarchique/repliable (état persisté localement) ;
- continuous scroll ;
- picker persistant entre les polls (aucun rebuild complet toutes les 5 s) ;
- lazy rendering par tranches de lignes ;
- recherche multi-provider (nom d’emote, chaîne, provider, emoji) ;
- emotes animées directement dans la grille ;
- tailles finales plus grandes (panel 4 colonnes, mobile 5, video 10) ;
- favoris (ordre personnel persisté) ;
- drag & drop de l’ordre des favoris (souris, section Favoris uniquement) ;
- étoile desktop discrète (hitbox locale 24 px, anti-clic accidentel) ;
- bouton favori tactile dans la barre du bas (masqué sur desktop) ;
- scroll stable pendant polling.

Façade Lab : catalogues en stale-while-revalidate (aucune requête ne dépasse le timeout 8 s de l’extension).

### Isolation
- `test_mode = true` imposé serveur ;
- paiement simulé (`payment_mode = simulated`) ;
- `real_debited = 0` (contrainte DB) ;
- aucun Wallet réel ;
- aucune progression/stats réelles ;
- zéro SAMMI, zéro StreamElements, zéro EBS prod.

### Bonk Fidelity — encore à faire plus tard (polish futur, non bloquant)
- impact FX plus proche du legacy ;
- ciblage centre caméra ;
- réglages variation de taille ;
- disparition plus punchy / variantes.

### Encore à faire avant tout usage production (avec le feu vert global seulement)
- nouvelle Twitch Extension non publiée : la console Twitch devra autoriser les domaines d’images `cdn.7tv.app`, `cdn.betterttv.net`, `cdn.frankerfacez.com` ;
- stats structurées Bonk ;
- Wallet réel + refund idempotent ;
- cutover uniquement avec le feu vert global.

### Production
**Bonk V2 est techniquement validé mais n’est PAS activé en production.**
SAMMI / StreamElements / système actuel restent production jusqu’au feu vert global Raptoru 2.0.

## Roadmap après Bonk
Ordre recommandé à date (Bonk V2 validé) :
1. Soundboard ;
2. TTS ;
3. Tombola ;
4. Bonk Fidelity (polish, non bloquant) ;
5. instrumentation stats/profil au fil des modules ;
6. Jeu des mots 2.0 ;
7. achievements/cosmétiques ;
8. FX/Creepy/BRB/NTM ;
9. Votekick/Caution/Random Ban ;
10. Spotify ;
11. duel/roulette/slots/oracle et satellites.

Cette roadmap reste modulable après audit réel de chaque feature.

# 17. Import des données historiques / cutover

**À FAIRE TOUT À LA FIN.**

Ne pas importer maintenant les soldes/statistiques StreamElements car ils continuent de bouger en production.

Plan final attendu :
1. tout le nouveau système fonctionnel est prêt ;
2. audit final StreamElements/SAMMI ;
3. extraction des soldes/stats à conserver ;
4. dry-run import ;
5. comparaison ;
6. éventuel gel très court ;
7. import final ;
8. validation ;
9. feu vert global ;
10. ancien chemin OFF → nouveau chemin ON.

Pas de cutover économique avant ce moment.

---

# 18. Agents de code / modèles — règle pratique

## Claude Code
Utilisé comme agent principal jusqu’ici.

Choix pratique :
- petite tâche / docs / fix mécanique : Sonnet ;
- slice normal multi-fichiers : Sonnet ;
- architecture, concurrence, idempotence, migration risquée : Opus 5.5.

Ne pas utiliser Opus par réflexe si Sonnet suffit.

## Astra Mid via Codex Code / app bureau ChatGPT
Astra Mid a maintenant accès directement au même workspace canonique :
`C:\Users\Antoni\Documents\Raptoru 2.0`

Accès confirmé :
- Git ;
- branche `main` ;
- fichiers du repo ;
- 8 workspaces npm ;
- scripts `dev`, `build`, `test`, `typecheck`, `lint`, `check`, `studio`, `studio:desktop`, `studio:package`, `studio:release`.

Il a déjà réalisé l’audit Bonk V2 complet sans modifier la prod ni le code.

Conclusion pratique :
- Astra peut servir de complément quand Claude manque de crédits ;
- il peut aussi faire audits, revues croisées et slices bien bornés ;
- ne jamais faire travailler Claude et Astra simultanément en écriture sur le même workspace ;
- préférer : agent A → commit/checkpoint propre → agent B reprend ;
- toujours relire Git status/diff/log avant de reprendre un chantier.

## Documentation commune
`CLAUDE.md` existe à la racine pour les règles Claude/release.

Un `AGENTS.md` commun à tous les agents a été proposé mais **n’est pas confirmé comme créé** à ce checkpoint. Ne pas supposer son existence : vérifier le repo.

# 19. Reprise dans une nouvelle conversation / nouvel agent

Au démarrage d’une nouvelle conversation ou d’une session Astra/Claude :

1. travailler uniquement dans :
   `C:\Users\Antoni\Documents\Raptoru 2.0`
2. lire ce fichier en entier ;
3. lire `CLAUDE.md`, `README.md` et les docs pertinentes du module ;
4. exécuter au minimum `git status`, `git log -n 10 --oneline` et vérifier le HEAD réel ;
5. ne jamais supposer qu’un SHA de ce document est encore le HEAD ;
6. rappeler que SAMMI + StreamElements restent la prod/référence ;
7. rappeler que les données historiques SE seront migrées à la toute fin ;
8. distinguer :
   - techniquement validé ;
   - migré/branché ;
   - activé en production ;
9. ne jamais cutover un module juste parce qu’il passe ses tests ;
10. pour Studio, une feature validée peut ensuite passer par `npm run studio:release` ;
11. Bonk V2 est validé (§ 16) : ne pas le refaire ; seul le polish Bonk Fidelity reste, non bloquant.

### Audit Bonk de référence
Rapport :
`outputs/Audit-Bonk-V2.md` dans la session Astra qui l’a produit, ou fichier exporté fourni par l’utilisateur.

Le rapport est un audit statique. Aucun test OBS/SAMMI/prod n’a été exécuté pendant cet audit.

### État Git à revérifier
Après la clôture Bonk V2 du 27/09/2026 :
- branche `main` ;
- dernier commit fonctionnel `717d97b`, puis commit doc et commit de release Studio ;
- tree propre attendu (hors runtime/.env ignorés).

Toujours vérifier l’état actuel avant toute modification.

# 20. Résumé ultra-court

```text
Raptoru 2.0 = Core central + Twitch Bot fin + Studio Electron local + Extension viewer + Postgres.

VALIDÉ TECHNIQUEMENT, mais pas activé prod :
- Presence
- Wallet Core
- Wallet Commands + Permissions
- Loyalty passif
- Rewards Twitch
- Daily
- Daily → Wallet
- durabilité/restarts
- Studio Windows
- Extension Lab
- auto-update Studio
- pipeline studio:release
- Bonk V2 Lab (validé visuellement le 27/09/2026)

Studio :
- updater réel validé en 0.1.0 → 0.1.1
- v0.1.2 publiée via le pipeline one-command
- Studio 0.1.1 détecte bien v0.1.2
- feed public = raptorutwitch/raptoru-studio-releases
- repo source local non poussé

Extension :
- vraie extension prod importée
- Lab local permet Soundboard/TTS/Tombola avec économie fictive (simulation locale)
- nouvelle extension (picker V2) NON publiée sur Twitch

BONK V2 = VALIDÉ (Lab), PAS ACTIVÉ EN PROD :
- Extension Lab → Core local/test → Studio → OBS → overlay (ACK started/completed/failed)
- catalogue : Twitch viewer (OAuth user:read:emotes) statiques + animées, Bits,
  7TV / BTTV / FFZ (chaîne + globales), Twemoji complet (~1914)
- Core valide provider/id et construit les URL ; aucune URL client
- picker : rail Récents / Favoris / Twitch / Bits / Extension / Emoji,
  continuous scroll, lazy, persistant entre les polls, recherche multi-provider,
  animées dans la grille, favoris + drag & drop, étoile desktop, bouton favori tactile
- test_mode=true, payment_mode=simulated, real_debited=0
- zéro Wallet réel, zéro stats/progression réelle, zéro prod
- reste (non bloquant) : Bonk Fidelity (impact FX, centre caméra, tailles, disparition)

PROCHAIN CHANTIER :
Soundboard → TTS → Tombola → stats/profils → Jeu des mots 2.0 → achievements/cosmétiques → FX → modération sociale → Spotify/casino.

Production réelle actuelle :
SAMMI + StreamElements.

Import historique :
SEULEMENT à la toute fin juste avant cutover global.

Agents :
- Claude Code = agent principal
- Astra Mid/Codex Code = accès confirmé au même workspace, bon pour audit/review/slices bornés
- jamais deux agents en écriture en parallèle
```

