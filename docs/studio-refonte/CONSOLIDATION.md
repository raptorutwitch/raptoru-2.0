# Consolidation du Studio refondu

Mission reçue le 07/11/2026 après la recette d'Antoni. Direction D validée, pas de nouvelle refonte artistique. La migration et la
préparation à la Production ne sont **pas** validées. Reprendre ici après une interruption. Recette : [RECETTE_CONSOLIDATION.md](RECETTE_CONSOLIDATION.md).
Parité : [PARITE.md](PARITE.md).

## Diagnostics

### Alertes : « 0 sur 29 médias »

- **La liste des 29** : 18 noms en dur (`ALERT_MEDIA`, `apps/studio/server/src/alerts/media-store.ts`) + 11 noms Halloween du catalogue du
  Core. Noms, variantes et profils se résolvent : les 29 ont été importés et servis sur un Lab isolé.
- **Les fichiers réels** : `Videos\Alertes Twitch Pour Claude\Version webm` (16), `Documents\Twitch\Alertes\Raid` (1),
  `Documents\Raptoru 2.0 - Livraisons\2026-10-31-halloween-alertes` (11). `Raid Titan.webm` n'existe sous ce nom dans aucun dossier :
  il n'existe que dans la réserve du Studio installé (`<dossier de données>\apps\studio\server\.runtime\alerts\media`, sous son
  empreinte). Le rapport précédent disait qu'il n'existait nulle part : c'était faux.
- **Le dossier du Lab** : `studio-ux\.lab-data\apps\studio\server\.runtime\alerts\media`. Il était vide.
- **Pourquoi les imports des tests ne se voyaient pas** : ils visaient le dossier de données jetable des tests (scratchpad), jamais `.lab-data`.
  Les deux Labs ne partagent rien. C'est voulu, mais le rapport n'aurait pas dû laisser croire que tes médias étaient en place.
- **Le bouton** : un seul dossier à la fois, le premier proposé, et un rapport d'une ligne.
- **Corrigé** : le panneau liste chaque emplacement, le nombre de fichiers trouvés, le détail par fichier, la raison et la solution.
  Un bouton importe tout depuis les dossiers habituels. La copie du Studio installé est proposée à part, avec confirmation, et chaque
  fichier y est vérifié par empreinte. Les originaux sont seulement lus. Lab uniquement.
- **Médias d'effets** : même cause, même import depuis la page Effets. **Halloween** garde son propre dossier : page Halloween, non traité.

### TTS : « mon message n'entre pas en file »

- Le bouton « Lire » était un aperçu local : il n'a jamais appelé le Core.
- Sans lecteur prêt, le Core refuse tout achat (`player_offline`) : dans le Lab, sans OBS, aucun achat ne pouvait passer.
- **Corrigé** : deux parcours. « Écouter ici » reste local. « Achat simulé » passe par la vraie porte de l'extension
  (`/api/ext-lab/purchase` → `/v1/ext/actions/tokens`, JWT Lab signé pour un viewer fictif) : le Core vérifie, débite, admet ou refuse. Si aucun
  lecteur n'est ouvert, Studio ouvre le sien : OBS n'est pas nécessaire. 5 viewers fictifs, car un viewer n'a qu'un message en attente.

### `!songskip` et les droits de l'équipe

- **Rôles qui existent réellement dans le Core** : Streamer, Supermod (rôle Raptoru, nommé dans Studio), Mod (rôle Twitch), Viewer.
  9 droits accordables par mod. Autre registre, non exposé : le staff du Wallet.
- **Conditions de `!songskip`** (`apps/core-api/src/spotify/chat.ts`) : le rôle du **message** doit être `moderator` ou `broadcaster`. Sinon,
  ignoré **en silence**. Le module doit être ouvert et Studio joignable (sinon le bot répond une erreur : pas de silence).
- **Cause trouvée** : ce rôle vient du badge lu par le bot (`chatRole`, `apps/twitch-bot/src/lab-chat-ingest.ts`), qui ne connaissait que
  `moderator`. Twitch remplace ce badge par `lead_moderator` pour un Lead Moderator. Une Lead Mod est donc un simple viewer pour le
  chat, mais une modératrice pour l'extension, dont le JWT dit `moderator`. C'est ce qu'Antoni décrit.
- **Non prouvé** : le badge réel de cette personne n'est pas lisible d'ici. Autre cas possible : supermod nommée dans Studio mais sans
  badge de modératrice. Dans ce cas elle reste viewer dans le chat, et le correctif ne change rien.
- **Corrigé sur la branche, sans effet tant que le bot n'est pas déployé** : `lead_moderator` compte comme `moderator`. Ce n'est pas seulement
  `!songskip` : toutes les commandes réservées aux mods sont concernées, et Twitch demande de vérifier les deux badges. Aucun droit
  n'a été modifié en Production.

### Spotify

Le simulateur existait, caché en bas des réglages. Il est sur la page, dans le Lab : demandes par viewer, catalogue fictif, cas refusés, commandes
du chat avec leurs réponses, incidents (fin de titre, appareil coupé, 429, ajout incertain, ajout en erreur). Réordonner et approuver n'existent pas
dans Raptoru : la page le dit, ce n'est pas une panne. Le module est fermé par défaut dans le Lab : la page le dit aussi.

### Récompenses

Le Lab n'a pas de Twitch : liste vide. Bouton « Charger le catalogue fictif » : 12 récompenses et leurs actions (interactions natives, crédits, OBS
fictif, une récompense en pause), posées par `syncRewards` et `saveRule`, comme le vrai parcours. Route du Lab seulement : hors de portée du cockpit
de Production. Une règle modifiée dans le Lab n'est pas écrasée.

### Isolation

`npm run studio:lab` utilisait le dossier Electron du Studio installé. En Lab, une connexion OBS saisie pouvait y être écrite. Le Lab a maintenant
son dossier (`%APPDATA%\Raptoru Studio Lab`). Conséquence : favoris et état de fenêtre du Lab repartent de zéro une fois. Les incidents « lecteur
absent » ne sont plus des incidents dans le Lab : un lecteur s'y ouvre à l'usage.

## Lots

| Lot | Commit | État |
|---|---|---|
| Import des médias, achat TTS simulé | `c50d4c5` | Testé sur Lab isolé, Chromium |
| Écarts d'audit, Lead Moderators, Spotify, Récompenses | `c00f1a9` | Idem |
| Laboratoire, Simulation, Équipe, Activité, Communauté, Système, catalogue | `742d399` | Idem |
| Effets, dossier Electron du Lab, E2E des simulateurs, documents | `83306b8` | Idem |
| Centre du Lab, achat TTS dans Electron, vérifications finales | voir `git log` | Vraie fenêtre Electron, dossier isolé |

## Vérifications du 07/11

Core 1 614 sur 1 615 avec PostgreSQL (le fichier interrompu par le crash Windows connu passe seul). Studio 944 sur 955 (même crash, le fichier passe seul, 16 sur 16). Bot 287. E2E : 104 passés
sur 106, les 2 échecs venaient d'un port occupé par le serveur d'essai et d'une spec à mettre à jour, les deux passent ensuite. Lint, types, build propres.

Vraie fenêtre Electron : dossier `Raptoru Studio Lab` confirmé, 12 pages sans erreur ni débordement, lecteur Studio ouvert seul avec 13 vraies voix Windows, achat simulé : 12 000 → 4 500 Jetons Lab,
voix coupée pendant le test. Ce test a trouvé un vrai défaut : le Core apprend le lecteur quelques secondes après Studio, l'achat était refusé ; il est relancé avec la même clé.

Non vérifié : `npm run studio:lab` de bout en bout (il utilise le port 4100), le vrai son de la voix, tes 29 médias dans `.lab-data` (l'import reste ton geste), le profil Production, le déploiement du correctif Lead Moderator.

## Ordre de déploiement à retenir

Le Core doit partir avant ou avec ce Studio : classement de Progression, poids des alertes Follow, règles publiées dans Équipe. Le bot porte le correctif
Lead Moderator. Aucun de ces déploiements n'a été fait.

## Reste

- Supermod : l'interface ne nomme que des membres déjà vus, le Core peut nommer n'importe qui (non exposé).
- Soundboard : ajouter ou remplacer un son reste impossible (banque livrée avec le Core et l'extension).
- Halloween : médias non importés dans le Lab.
- Capacités du Core sans page, ancienne comme nouvelle : [parite/admin.md](parite/admin.md).
