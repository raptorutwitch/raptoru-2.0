# Passe post-live du 11/11/2026

Mandat « PASSE POST-LIVE » d'Antoni après le live test réel de la nouvelle extension et du Music Hub (testeurs : Aouh,
modérateur ; Jinai_, Goz___, PsyCoWiNi, happybearman). Branche `feat/post-live-moderation` (depuis `origin/main`
`b4e65c6`), worktree `Documents\Raptoru 2.0 - Worktrees\post-live`. **Rien n'est déployé, publié ni fusionné.**

## 1. Ce qui a été fait

| Lot | Problème remonté                                                 | Cause                                                                                                                                        | Correction                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Les modérateurs ne peuvent plus créditer/retirer en chat         | `!addpoints` (StreamElements) jamais porté ; `!wallet` vérifie l'ancienne table `staff_roles` (sans écran, sans le broadcaster)              | `!addpoints`/`!crediter`, `!removepoints`/`!debiter` = l'action `wallet_adjust` de la modération (permission « Portefeuille », login exact, 1 à 1 000 000, une fois par message, audit) — Core        |
| A2  | Tombola : « 6 participants, 5 lignes »                           | `shared/tombola-v2.js` plafonnait l'aperçu de l'écran ouvert à 5 lignes derrière un petit « Tout voir » ; le Core envoie bien toute la liste | jusqu'à 30 lignes dans l'aperçu (l'écran défile), au-delà « +N · Tout voir » ; mise à jour en direct du lien — extension                                                                              |
| A3  | Achats Spotify invisibles et non remboursables par la modération | les achats Musique (`spotify_requests`, skips payants) n'étaient pas dans l'historique D4                                                    | achats Musique dans l'historique et la fiche viewer ; « Rembourser » (permission « Portefeuille ») une seule fois, seulement une demande terminée avec un débit d'origine — Core + extension + Studio |
| B   | « Wallet » / recherche de viewer                                 | —                                                                                                                                            | « Portefeuille » partout dans la modération ; lien « Portefeuille » → recherche (`@pseudo` accepté, viewers canoniques inclus) → fiche du viewer ouverte sur son Portefeuille — Core + extension      |
| C   | Inventaire et catalogue des commandes                            | —                                                                                                                                            | [INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md), conception [CATALOGUE_COMMANDES_SITE.md](CATALOGUE_COMMANDES_SITE.md) (rien publié)                                                 |

Détails de sécurité (mandat) :

- **Autorisation côté serveur** : le Core décide la permission depuis le rôle Twitch lu par le bot et les grants D4 ;
  le texte du chat et les paramètres de l'extension ne donnent aucun droit. Un viewer est refusé sans appel à Twitch.
- **Identité exacte** : Helix par login exact ; sans Helix, un seul viewer connu ; ambigu ou inconnu → rien n'est fait.
- **Montants** : entiers stricts, 1 à 1 000 000 en chat ; jamais sous 0 ; plafond du Wallet respecté.
- **Doublons** : clé `chat:<message_id>` ; remboursement Musique verrouillé (`for update`), refusé s'il est déjà fait,
  sans débit d'origine ou demande non terminée ; le skip garde son statut (le prix des skips suivants est inchangé).
- **Audit** : chaque action dans `lab_moderation_audit` (acteur, rôle, motif, avant/après).
- **Pas de second système de Jetons** : tout passe par l'économie de la modération (canonique en Production, de test
  dans le Lab). Aucune migration.
- La fiche viewer dit désormais quelle économie elle touche (« Jetons réels de la chaîne » / « de test du Lab ») : le
  texte « Wallet de test du Lab · jamais l'économie réelle » était affiché à tort en Production.

## 2. Tests

Automatiques (aucun n'est une validation) :

- Core : `wallet-admin-chat` (11), `music-hub` (bloc modération), `lab-moderation`, `moderation-d4` — 77 passés.
- PostgreSQL réel (base locale de test) : `music-hub.integration`, `economy-interactions.integration`,
  `economy-lot6.integration` dont **un même `!addpoints` livré à deux Cores à la fois ne crédite qu'une fois** et deux
  `!removepoints` simultanés ne descendent pas sous 0 — passés.
- Extension : 132 tests unitaires passés. Studio : `studio-moderation`, `moderation-d4`, `raffle-overlay-model` passés.
- E2E dans le Lab (vraie interface de l'extension dans Chromium) : `tombola-participants` (6 lignes à 318/400/565 px,
  hauteurs normale et réduite, badges, 7ᵉ en direct) ; `moderation-portefeuille` (lien, recherche `@viewer`, fiche,
  crédit ; cadenas pour un modérateur sans permission) — passés.
- `tsc` Core et Studio web propres ; eslint et Prettier propres sur les fichiers modifiés.

Non vérifié ici : la vraie Production (Helix réel, vrais rôles, vrais Jetons), un vrai OBS, l'extension hébergée par
Twitch. Recette manuelle : [RECETTE_MODERATION_EXTENSION.md](RECETTE_MODERATION_EXTENSION.md).

## 3. Livraison nécessaire (chaque étape sur GO d'Antoni)

1. **Core** : déploiement de la branche (A1, A3, B côté Core). Aucune migration, aucune variable.
2. **Extension** : nouveau ZIP (Tombola, Portefeuille, Musique dans la modération) → Hosted Test.
3. **Studio** : release seulement pour que la modération native de Studio affiche les achats Musique sans erreur et
   nomme la permission « Portefeuille » (`apps/studio/web`). Sans elle, ouvrir un achat Musique depuis une fiche
   viewer dans Studio échoue (le Core déployé envoie ces lignes) : **déployer le Core et la release Studio ensemble**.
4. **Bot** : rien.

## 4. Décisions laissées à Antoni

- `!wallet add|remove|set` (bot, `staff_roles`) : l'aligner sur la permission « Portefeuille » ou le retirer.
- Mots des modules à réserver dans Commands V2 ; tutoriel de l'extension à corriger ; `!solde @x` public ou non.
- Catalogue public : lancer les lots de [CATALOGUE_COMMANDES_SITE.md](CATALOGUE_COMMANDES_SITE.md) § 5 ou non.
