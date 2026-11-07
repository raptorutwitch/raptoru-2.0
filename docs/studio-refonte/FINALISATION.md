# Mission finale : finitions, socle modulaire, préparation de la migration

Reçue le 07/11/2026 après la recette de la consolidation. Direction D validée ; migration et Production **non** validées.
Aucun push, aucun déploiement, aucun remplacement du Studio installé, aucune action réelle Twitch / OBS / Spotify / StreamElements.
Reprendre ici après une interruption (`git log --oneline -20`). Recette : [RECETTE_FINALE.md](RECETTE_FINALE.md). Livraison :
[LIVRAISON.md](LIVRAISON.md) § 9. Données : [MIGRATION_DONNEES.md](MIGRATION_DONNEES.md). Parité : [PARITE.md](PARITE.md).

## Lots

| # | Lot | Commit | Vérifié |
|---|---|---|---|
| 1 | Ballon araignée qui se recoche | `bec4256` | reproduit puis corrigé (navigateur) ; Electron sur le vrai Lab |
| 2 | Raid Titan, son des Bits | `3114e76`, `47e9fba` | diagnostic en lecture seule (empreintes, ffprobe, historique Git) |
| 3 | Retour / Suivant | `7e92b07` | navigateur ; Electron sur le vrai Lab |
| 4 | TTS : soldes, prix, refus, scénario | `d9c1c3b`, `47e9fba`, `a8c8ddb` | Electron sur le vrai Lab (refus, crédit, achat) |
| 5 | Tombola : fermer le résultat, retour seul, réglages repliables | `d96fcd0` | tests unitaires, capture ; manche complète non rejouée |
| 6 | Modération : densité, équipe, vocabulaire | `2755e02` | captures à 1024, 1280, 1366 |
| 7 | Récompenses : Twitch / Raptoru / demandes | `e1bcc2e` | capture, tests |
| 8 | Simulation | `88b614c` | capture, tests |
| 9 | Activité, Communauté | `37942e1` | tests, captures |
| 10 | Modularité : preuve et guides | `2793c85` | suites ciblées vertes, exercice rejoué hors dépôt |
| 11 | Matrice des données | `2793c85` | lecture du code |
| 12 | Plan de livraison et retour arrière | `5dda773` | lecture du code |
| 13 | `npm run studio:lab` réel, suites finales | — | voir « Vérifications » |

## Diagnostics

**Ballon araignée.** Ton Lab n'a que l'Araignée dans le tirage du Sub. Le Core garde toujours au moins une animation, donc la décocher
ne changeait rien ; mais l'écran la montrait décochée (le relevé était différé tant que la case gardait le focus), puis la recochait au
retour. Elle est maintenant verrouillée avec une explication, sur Alertes comme sur Halloween. Le profil Halloween coupé et le tirage
enregistré sont deux réglages distincts : le texte le dit.

**Raid.** Le catalogue attend `Raid Titan.webm` et `Raptoru_Alerte_Raid_Sound.mp3`, inchangés depuis le 16/10. La vidéo a été fabriquée
ce jour-là depuis `Documents\Twitch\Alertes\Raid\Titan Avi 4.avi` (AVI 2 Go converti en WebM transparent, sans son). Son seul exemplaire
est la copie du Studio installé (empreinte conforme). `Alerte Titan DERNIERE FINALE.webm` est un autre média ; aucun fichier « Red »
trouvé. Le bouton « tout importer » ignore volontairement la copie du Studio installé : il faut l'import explicite, avec confirmation.

**Bits.** `bits_default` n'a jamais eu de fichier son (`audio: null` depuis sa création), et `Alerte Bits.webm` n'a aucune piste audio
(ffprobe). Aucun MP3 Bits n'existe dans tes dossiers ni dans les magasins de Studio. Le Lab joue donc comme le Studio installé. L'écran
disait « son de la vidéo » : il dit maintenant « aucun fichier son ». Ajouter un son est ta décision (tu fournis le fichier).

**Son d'ouverture de la Tombola.** Les trois emplacements sont vides dans le Core du Lab (la configuration de Production n'y est pas
copiée). Et Studio ne joue jamais ce son, même en aperçu : seule la source OBS le joue, une fois, à l'ouverture. Pas de défaut.

**TTS.** Un clic sur un message en file ouvrait déjà son détail, sans rien retirer. Défaut trouvé par le test Electron : un refus
faute de Jetons affichait `insufficient_tokens` (le Core n'emploie pas le code attendu par l'écran).

## Modularité (preuve et guides)

- Nouveau module : 1 fichier Core + 2 lignes dans `core-api/src/modules/index.ts` ; Studio suit seul (page, catalogue, Ctrl+K, Système).
  Exercice `minuteur_de_scene` rejoué hors dépôt : contrat valide, achat 1 000 → 900, rejeu sans second débit, page et recherche.
- Refaire un onglet de l'extension : 1 fichier `<onglet>-v2.js` + 1 import dans `ui.js` ; l'ancien écran reste en variante
  complémentaire, la bascule vient d'un signal du Core. Recette : `architecture/GUIDE_EXTENSION.md`.
- Suites ciblées vertes : Core 28/28 et 2/2 en PostgreSQL réel, Studio 49/49, extension 10/10. `modularity.e2e.ts` passe dans l'E2E complet.
- Obstacle connu : la Tombola V1 est inatteignable (`raffle_v2: true` en dur dans `ext-facade.ts`). Qui pilote ce signal est ta décision.
- Recalculs hors du Core relevés : bornes TTS (corrigé), règle du bouton « Rembourser » recopiée (affichage seulement, le Core
  revérifie), prix TTS V1 de l'extension (ancien écran, non touché). Détail : `architecture/GUIDE_EXTENSION.md`.
- Alias Roulette / Slot / Duel : une table par famille dans le Core, servant au parseur et aux mots réservés. Un gestionnaire d'alias
  n'y dupliquerait rien ; Studio et l'extension devront lire la liste du Core au lieu de leurs copies.

## `npm run studio:lab` réel

- Lancé tel quel, Studio installé fermé : build, base Docker, Electron, Core du Lab sur 4302, lien Core « Connecté », 28 médias sur 29.
- Fermeture de la fenêtre Studio : Electron, serveur et Core arrêtés en 1 à 2 s, ports 4100 / 4110 / 4302 libérés.
- Premier essai en conflit avec mon serveur d'essai (il occupait déjà 4302) : Studio l'a dit dans Laboratoire › Services
  (« port 4302 déjà utilisé… »). Ne jamais lancer les deux ensemble.
- À savoir : le Lab ouvre les fenêtres Halloween sur ton écran (overlay et « Chaos ») parce que le réglage Halloween est actif dans
  `.lab-data`. Comportement existant, pas modifié.

## Reste

- Halloween : médias non importés dans le Lab. Soundboard : ajouter ou remplacer un son reste impossible.
- Supermod : seulement pour des membres déjà vus.
- Code mort à arbitrer : `moderation.ts`, `moderation.css`, `tts-config.ts`.
- Modération à 1024 px : la 5e colonne des files demande un petit défilement horizontal.
- Rien n'a tourné contre la vraie Production ; le badge de ta modératrice reste à confirmer.
