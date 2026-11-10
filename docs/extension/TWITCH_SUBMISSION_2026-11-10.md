# Raptoru Live — dossier Twitch de la livraison du 10/11/2026 (Hosted Test)

> **Objectif : Hosted Test.** Ni soumission à la revue, ni « Release » ne sont demandées à ce stade.
>
> - Le ZIP est construit et vérifié par l'agent. Il n'est **pas téléversé** : la console Twitch est à Antoni (§ 4).
> - Procédure générale : [EXTENSION_NEXT_PUBLICATION.md](EXTENSION_NEXT_PUBLICATION.md).

## 1. Le ZIP

- **Fichier** : `apps/twitch-extension/release/raptoru-live-PRODUCTION-<commit>-depuis-0bf7907-70-commits-shell-v2.zip`,
  dans le worktree `Raptoru 2.0 - Worktrees/release-2026-11-10`.
  - Construit depuis le commit final de `main`.
  - Chemin exact, SHA-256 et `buildId` : dans le rapport de livraison du 10/11.
  - 2 149 fichiers, 12,5 Mo.
- **Interface v2 (Extension Next)** par défaut ; l'ancienne interface reste dans le zip.
- **Core appelé** : `https://core.raptoru.fr/v1/ext`, le Core de Production livré le 10/11.
- **Contenu vérifié** :
  - aucune URL locale, aucun module du Lab, aucun secret ;
  - l'inventaire validé par Antoni est embarqué (`build-inventory.txt`) ;
  - le module Musique est présent (`modules/music/`).
- **Correctifs embarqués** :
  - audit du 09/11 : un seul débit après une réponse perdue, session conservée au renouvellement du jeton, TTS
    incertain revérifié ;
  - lot 1 : plus de bouton coupé ;
  - garde contre l'écran gris.

## 2. Music Hub dans ce Hosted Test

- **Le Core ouvre le module** (variable Coolify `MUSIC_HUB_EXTENSION=testers:1239040922`) :
  - au diffuseur `raptoru_` (toujours inclus) ;
  - à LeCroupier_ (`1239040922`) ;
  - à personne d'autre. Un viewer qui ne partage pas son identité ne le voit jamais.
- **L'extension publique actuelle n'a pas ce module** : elle reste inchangée.
- **Encore faut-il l'allumer dans Studio** : Spotify › « Demandes depuis l'extension ». C'est aussi l'interrupteur
  d'arrêt immédiat (§ 5). Le skip payant a son propre interrupteur (« Skip payant par les viewers »).
- **Règles côté Core, inchangées** :
  - skip viewer à 25 000 Jetons, doublé à chaque skip réussi dans les 30 min, global, retour au prix de base après
    30 min ;
  - skips de modération exclus ; demandes payées protégées ; remboursement unique ; une clé par achat ;
  - skip et seek refusés à un Studio plus ancien que 0.1.28 (`studio_outdated`).
- **Pour ajouter un testeur** : ajouter son identifiant Twitch à la variable (`testers:1239040922,<id>`), puis
  redémarrer le Core. Pour tout le monde (après approbation de Twitch) : `on`.

## 3. Domaines et permissions Twitch

| Réglage (console › Extensions › Raptoru Live › version › Capabilities) | Valeur                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Allowlist for URL Fetching Domains                                     | `https://core.raptoru.fr` (déjà présent : inchangé)                                          |
| **Allowlist for Image Domains**                                        | **ajouter `https://i.scdn.co`** (pochettes Spotify ; Studio n'en laisse passer aucune autre) |
| Identity link, Chat capabilities, Bits                                 | inchangés (aucune permission nouvelle, pas de Bits)                                          |

Sans `i.scdn.co`, Music Hub fonctionne, mais sans pochettes.

## 4. Ce qu'Antoni fait dans la console Twitch

1. Relever la version « Released » actuelle (Versions). Si ce n'est pas `0bf7907`, me le dire, pour corriger `PUBLISHED`.
   Le zip, lui, ne change pas.
2. **Créer une nouvelle version**, au numéro suivant :
   - recopier les réglages de la version publiée (anchors, panel, mobile, Identity link, allowlist) ;
   - ajouter `https://i.scdn.co` aux Image Domains.
3. **Téléverser le ZIP** du § 1 : Files › Upload Version Assets.
4. **Passer la version en Hosted Test** (Status › Move to Hosted Test).
   - Testeurs : la console permet d'en lister. `raptoru_` et LeCroupier_ au minimum.
   - **La version publique reste celle qui est « Released »** : aucun viewer ne voit le Hosted Test.
5. Faire le parcours du § 6, puis me dire ce qui va et ne va pas.
6. Plus tard seulement, sur décision : « Submit for review » (8 à 14 jours), puis « Release ».

## 5. Arrêt immédiat de Music Hub

| Vitesse                    | Moyen                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immédiat, sans redémarrage | Studio › Spotify › « Demandes depuis l'extension » OFF : module caché, demandes, recherches et skips payants refusés. « Commandes du lecteur » OFF : pause, skip et seek de modération coupés |
| Total, ~2 min              | Coolify › `raptoru-core` › variable `MUSIC_HUB_EXTENSION=off`, puis Restart : la façade Musique est refusée à tous (comportement d'avant le 10/11)                                            |
| SMTC (Windows)             | Studio lancé avec `RAPTORU_SMTC=off` : plus de sonde Windows                                                                                                                                  |
| Code                       | `node scripts/coolify-deploy.mjs deploy core 1b25f302832e9cce57dadb4b225b3d031f4cd1f0 --rollback --go`                                                                                        |

## 6. Parcours d'essai (Antoni, vrais Jetons, vrai Spotify)

Avant de commencer :

- **Studio 0.1.28 installé**, Spotify connecté dans Studio, Spotify Desktop ouvert sur le PC.
- **Studio › Spotify** :
  - « Demandes depuis l'extension » ON ;
  - « Commandes du lecteur » ON ;
  - « Skip payant par les viewers » ON ;
  - « Protéger les demandes payées » ON (défaut).
- **Un live en cours.** Les achats en Jetons ne sont acceptés qu'en live, et l'historique de la soirée suit le Daily.

| #   | Qui                  | Faire                                                                                               | Attendu                                                                                     |
| --- | -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | LeCroupier_          | Ouvrir l'extension (Hosted Test), Hub                                                               | carte « Musique » ; un autre compte ne la voit pas                                          |
| 2   | LeCroupier_          | Rechercher un titre, coller un lien Spotify                                                         | résultats avec pochettes                                                                    |
| 3   | LeCroupier_          | Demander un titre (prix Studio, 500 par défaut)                                                     | un débit ; « ajoutée à la file » ; le titre arrive dans la file Spotify                     |
| 4   | LeCroupier_          | Retirer sa demande                                                                                  | confirmation, puis un seul remboursement                                                    |
| 5   | LeCroupier_          | Skip payant sur « en cours » (25 000)                                                               | le titre passe ; un débit ; prix suivant 50 000 ; « Skippé » dans l'historique              |
| 6   | LeCroupier_          | Skip payant sur une demande payée par un autre                                                      | refusé (protégée), rien débité                                                              |
| 7   | Antoni (Studio)      | « Ouvrir l'Open Bar »                                                                               | extension : « Open Bar », demande gratuite, 20 s entre deux demandes ; le skip reste payant |
| 8   | Antoni (Studio)      | « Fermer l'Open Bar »                                                                               | prix et limites habituels                                                                   |
| 9   | raptoru_ (diffuseur) | Pause / Passer sur « en cours », clic sur la barre → « Aller »                                      | le lecteur obéit ; le seek ne compte ni comme skip ni comme nouvelle musique                |
| 10  | Chat                 | `!song` deux fois                                                                                   | une annonce (ou un message normal si l'annonce est refusée), puis silence pendant 30 s      |
| 11  | OBS                  | Studio › Modules › Musique › Overlay : « Assistant OBS » (il n'ajoute qu'une source), puis Afficher | carte au changement de titre (30 s), languette « Demandé par » pour une demande ; variantes |
| 12  | Extension            | Horloge « Musiques de la soirée »                                                                   | les titres du live (Daily en cours)                                                         |
| 13  | Antoni (Studio)      | « Demandes depuis l'extension » OFF                                                                 | la carte disparaît dans les 4 s ; une demande est refusée                                   |

L'assistant OBS ajoute une source et ne modifie rien d'autre ; tu peux aussi ajouter l'URL de l'overlay à la main.
