# Music Hub — état (08/11/2026)

> Branche `feat/music-hub` (worktree `Raptoru 2.0 - Worktrees\music-hub`, partie de `feat/extension-next` 2f45ac1).
> **Lab uniquement.** Rien n'est poussé, fusionné, déployé ni publié. Non validé par Antoni.

## 1. En une phrase

Le module « Musique » de l'extension (shell v2) est une **nouvelle entrée dans la file Spotify V2 existante**,
payée en Jetons. Ce n'est ni un second lecteur ni une seconde file. La récompense « Choisi la prochaine musique »
(1 500 points) reste inchangée.

## 2. Le système existant (Spotify V2, en Production depuis le 25/10) — référence `docs/SPOTIFY_V2.md`

- **Core** (`apps/core-api/src/spotify/service.ts`) : seule autorité.
  - Il reçoit les rédemptions et les tient dans `spotify_requests` : file logique FIFO, quotas par viewer, exceptions,
    commandes `!song*`, fin du live.
  - Il confie le travail à Studio par `spotify_jobs`.
  - Il rembourse les points par une action Twitch CANCELED (`cp_twitch_actions`, exécutée par le bot).
- **Studio** (`apps/studio/server/src/spotify/*`) : seul à appeler Spotify.
  - OAuth PKCE du compte Premium du streamer.
  - Recherche notée, `POST /me/player/queue` et suivi de la lecture.
  - Passage automatique des demandes annulées.
  - Simulateur du Lab (`sim.ts`).
  - Page Studio « Spotify ».
- **Bot** : exécute les remboursements Twitch (`CP_TWITCH_ACTIONS`) et relaie le chat (`SPOTIFY_CHAT`).

## 3. Ce qui est réutilisé tel quel

- File, ordre, quotas (`usage()`), exceptions par viewer et délai entre deux demandes. Ce délai compte aussi une
  demande retirée par le viewer : c'est la règle anti-abus existante.
- Fin du live, commandes `!song`, `!songqueue`, `!mysong`, `!songcancel`, `!songremove`, `!songskip`.
- Job `song_request` et chemin exact de Studio (identifiant de titre, sans nouvelle recherche).
- Ajout réel à la file Spotify, passage automatique, suivi de lecture, cache et rythme des appels.
- Lecture automatique : inchangée.

## 4. Ce qui est ajouté

| Couche                  | Ajout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schémas                 | `SPOTIFY_RULES.extensionPriceTokens` (500), jobs `search` et `control`, `SpotifySearchItem`, actions du panneau `pause` / `resume` / `volume`, `remove.refund`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Migration               | `20261122130000_music_hub.sql` (prod) et son jumeau Lab, additive et idempotente. Colonnes de réglage : `extension_enabled` (false), `extension_price_tokens` (500), `no_duplicates` (true), `player_controls` (false). Colonnes de demande : `payment` (`channel_points` par défaut), `price_tokens`, `refund_status`, `display`. Source `extension` et jobs `search` / `control`.                                                                                                                                                                                     |
| Core                    | `extensionSearch` : un job réutilisé pendant 5 min pour le même texte, 20 recherches par minute et par viewer. `extensionRequest` : débit en Jetons dans la **même transaction** que la demande et son job, clé d'idempotence, prix attendu. `extensionCancel`, `extensionModerate` (permissions de `lab-moderation`), `control`, `extensionState`. `refundPayment` est le seul chemin de remboursement, au plus une fois ; `keepPayment` sert au retrait sans remboursement. Routes `/v1/lab/spotify-ext/*` et façade `/v1/ext/music/*` **seulement si `config.lab`**. |
| Studio                  | Exécution des jobs `search` (catalogue, 10 résultats au plus) et `control` (PUT pause / play / volume, résultat relu, jamais supposé). Le simulateur reçoit un catalogue fictif de 26 titres (`LABMUSIC…`) et un lecteur (pause, volume).                                                                                                                                                                                                                                                                                                                               |
| Page Studio « Spotify » | Groupe « Extension » du panneau : interrupteur, prix, doublons, commandes du lecteur. Pause / Reprendre et volume dans « Lecture en cours ». Paiement sur chaque ligne de la file. « Sans rembourser » **pour les Jetons seulement**. Historique : « Extension », « Jetons remboursés » / « Jetons gardés ».                                                                                                                                                                                                                                                            |
| Extension               | `modules/music/` (module de session v2, chargé à l'ouverture). Carte du Hub avec un compteur (« 3 en file » / « Fermé »). Lecture en cours avec progression. Onglets Rechercher / File / Mes demandes. Feuille de confirmation : prix, solde après, limites. File avec position, attente estimée, Retirer. Équipe : menu de retrait (avec ou sans remboursement, double clic), Pause / Reprendre / Passer / Volume / Ouvrir-Fermer. Fixtures du banc de calibration.                                                                                                    |

## 5. Comment les deux entrées convergent

```
Récompense (1 500 pts) ─┐                        ┌─ !song / !songqueue / !songcancel / !songremove / !songskip
                        ├─► spotify_requests ─► job song_request ─► Studio ─► file Spotify ─► lecture
Extension (500 Jetons) ─┘    (une file, un usage(), un ordre)       (même chemin exact)
```

Seul le paiement diffère :

- **points** : refus, annulation ou retrait → Twitch CANCELED par le bot, comme avant ;
- **Jetons** : débit à la demande ; refus, annulation, retrait ou fin du live → `economy.refund` une seule fois
  (`refund_status`). Un retrait « sans rembourser » donne `kept`.

Les points ne sont jamais convertis en Jetons, et une demande n'est jamais payée deux fois. Une même clé
d'idempotence, sur deux Cores à la fois, produit une seule demande et un seul débit (test sur PostgreSQL réel).

## 6. Tests

| Suite                                                                                                                                                                                                     | Résultat                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Core `test/music-hub.test.ts` (11) : off par défaut, recherche, débit unique, refus avant débit, file et quotas partagés, refus Studio, retraits, modération, lecteur, `!songcancel` en Jetons            | 11/11                                                                          |
| Core `test/music-hub.integration.test.ts` (PostgreSQL réel, deux Cores) : même clé, limite sous concurrence, annulation et retrait simultanés → un remboursement                                          | 3/3 (`TEST_DATABASE_URL` sur la base de test du conteneur `studio-ux-test-pg`) |
| Core `spotify-service`, `migration-scopes`                                                                                                                                                                | verts                                                                          |
| Studio `spotify-runtime` (jobs de recherche et de contrôle), `spotify-view` (+5 Music Hub)                                                                                                                | 58/58, 24/24                                                                   |
| Extension vitest                                                                                                                                                                                          | 127/127                                                                        |
| Extension `test:requests` (requêtes réseau des autres modules)                                                                                                                                            | identique à la référence                                                       |
| Matrice responsive v2 `--views hub,music` (19 tailles : vidéo, panneau, mobile, zooms)                                                                                                                    | 0 contrôle coupé, 0 chevauchement, 0 cible < 24 px                             |
| Matrice responsive legacy (shell inchangé)                                                                                                                                                                | 0 contrôle coupé, 0 chevauchement                                              |
| E2E Lab `e2e/music-hub.e2e.ts` : carte du Hub, recherche, demande en Jetons, file partagée, retrait remboursé, refus du délai, retrait sans remboursement par un modérateur, pause / reprise, page Studio | vert                                                                           |

**Rien n'a été testé à la main par Antoni.** Rien n'a été testé avec un vrai compte Spotify ni sur Twitch.

## 7. Tester

- **Regarder le module (sans rien lancer d'autre)** : double-clic sur « Comparer legacy et v2.cmd » (ou
  `npm run lab:compare -w @raptoru/twitch-extension` depuis ce worktree). Choisir Données « Calibration » et Module
  « Musique ». Ce sont des données fictives en lecture seule : une demande y est refusée « not_available ».
- **Le parcours réel du Lab** : fermer le Studio installé (le Lab prend le port 4100), puis `npm run studio:lab`
  **depuis ce worktree**.
  1. Dans Studio → Spotify : passer « Ouvert », puis dans le panneau « Extension » activer « Demandes depuis
     l'extension » (et « Commandes du lecteur » si tu veux tester l'équipe).
  2. Ouvrir l'extension du Lab : `http://127.0.0.1:4100/ext/mobile.html?shell=v2&labRole=viewer` (ou
     `labRole=moderator` pour l'équipe).
  3. Hub → Musique → chercher « nuit », « comète », « odyssée » (trop long) ou « session perdue » (indisponible).
  4. Tout est simulé : catalogue fictif, Jetons du Lab, aucun appel à Spotify ni à Twitch.

## 8. Limites Spotify et Twitch (textes officiels lus le 08/11)

| Sujet                                     | Constat                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Son de Spotify diffusé sur le stream      | **Interdit**. Sources : Spotify Developer Policy III.4, III.5, III.6 et III.10, conditions d'utilisation (EUA) et User Guidelines, rubrique « broadcasting ». **Cela concerne aussi la récompense déjà en Production**, que le Music Hub ne crée pas. C'est à Antoni d'arbitrer. |
| Afficher le catalogue aux viewers         | Autorisé sous conditions : attribution Spotify, lien vers Spotify, pochette non recadrée. Les pochettes sont déjà en `contain`. **Attribution et lien restent à ajouter** avant tout fournisseur réel.                                                                           |
| Pilotage du lecteur par un tiers (équipe) | Peu clair dans la politique. Désactivé par défaut (`player_controls` = false).                                                                                                                                                                                                   |
| Faire payer en Jetons                     | Peu clair, plutôt défavorable (Developer Policy IV.2.2 et II.2 : monétisation autour du contenu).                                                                                                                                                                                |
| Marque                                    | Logo et vert Spotify seulement selon leurs guidelines, sans co-marquage. Le module utilise un vert émeraude propre à Raptoru, sans logo.                                                                                                                                         |
| Quotas                                    | Mode développement : 5 utilisateurs, Premium. Le quota étendu est réservé aux organisations d'au moins 250 000 utilisateurs actifs par mois. La recherche renvoie au plus 10 résultats.                                                                                          |
| Twitch                                    | Extension Policy 6.2.2 : pas de Bits pour un jukebox. Les points de fidélité (Jetons) sont permis.                                                                                                                                                                               |
| Alternatives sous licence                 | Soundtrack by Twitch est arrêté. L'extension Pretzel a été retirée. L'API Epidemic Sound demande un accord partenaire payant. Monstercat Gold et StreamBeats n'ont pas d'API documentée.                                                                                         |

Rien n'utilise d'API privée, de scraping ni d'extraction audio. La simulation n'est jamais présentée comme une
intégration Spotify : le pied du module l'indique (« Catalogue de démonstration (Lab) »).

## 9. Garde-fous Production

- La façade `/v1/ext/music/*` et le résumé de session ne répondent que si `config.lab`. En Production, l'extension
  ne voit pas le module (`offered: false`).
- `extension_enabled` vaut false par défaut. Avec ce réglage, la récompense et les commandes du chat se comportent
  exactement comme avant (testé).
- La migration prod est **additive**, avec des valeurs par défaut qui gardent l'ancien comportement. Un déploiement
  du Core l'appliquerait : `coolify-deploy` exige `--migrations-approved`, donc un GO explicite.

## 10. Décisions ouvertes (Antoni)

1. **Conformité** : faut-il ouvrir le Music Hub sur Spotify alors que la diffusion est interdite (§ 8), y compris pour
   la récompense actuelle ? Faut-il plutôt un autre fournisseur (sous licence) ?
2. **Prix** : 500 Jetons par demande (provisoire) ? Faut-il une formule différente pour les abonnés ?
3. **Commandes du lecteur pour l'équipe** (pause, volume) : les garder ? À qui ?
4. **Ouverture en Production** : ouvrir la façade (le code la ferme), appliquer la migration, déployer le Core,
   installer Studio, publier l'extension. Chaque étape sur GO.

## 11. Reste à faire (non bloquant pour le Lab)

- Attribution et lien Spotify dans le module, si un fournisseur réel est retenu.
- Messages de chat propres aux demandes de l'extension (aujourd'hui : silencieuses, l'extension affiche le résultat).
- Barre de progression mise à jour par la lecture réelle de Studio quand elle arrive (aujourd'hui : relevé toutes les
  4 s, puis extrapolation).
