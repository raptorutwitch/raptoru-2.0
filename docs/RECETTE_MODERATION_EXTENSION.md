# Recette manuelle : modération de l'extension (post-live 11/11)

À faire par Antoni. D'abord dans le **Lab** (économie de test), puis en Production **après** le déploiement du Core et
l'envoi du nouveau ZIP en Hosted Test. En Production : montants contrôlés et petits (ex. 1 Jeton), annulés ensuite.

Lab : `Ouvrir Music Hub (Lab).cmd` à la racine du worktree `post-live` (viewer, modérateur, supermod) ou
`npm run studio:lab`. Ce qui est déjà couvert par les tests automatiques est marqué (auto).

## 1. Portefeuille (ex « Wallet admin »)

- [ ] Modération › colonne de gauche : un lien **Portefeuille** sous « Autres modules ». (auto)
- [ ] Clic : la recherche s'ouvre avec « Portefeuille de… ». Taper `@pseudo` trouve le viewer ; un login différent du
      nom affiché s'affiche en gris (`@login`). (auto pour `@viewer`)
- [ ] Un nom inconnu : « Personne pour « … » ». (auto)
- [ ] Choisir le viewer : sa fiche s'ouvre **sur son Portefeuille** (Jetons, crédits TTS, crédits Sons). (auto)
- [ ] « + Créditer » 250, motif : le solde monte de 250 ; l'ajustement apparaît dans « Ajustements » et dans
      l'Historique › Modération (« Portefeuille », auteur, motif). (auto pour le solde)
- [ ] « − Débiter » plus que le solde : le solde tombe à 0, jamais en dessous.
- [ ] Le pied de la fiche dit « Portefeuille de test du Lab » dans le Lab, « Jetons réels de la chaîne » en Production.
- [ ] Un modérateur **sans** la permission : cadenas sur le lien, fiche « Réservé à la permission « Portefeuille » »,
      aucun bouton Créditer. (auto)
- [ ] Équipe et permissions : la permission s'appelle « Portefeuille ».
- [ ] Panneau 318 px, hauteur réduite : rien de coupé, pas de défilement horizontal.

## 2. Commandes chat de l'équipe (Lab : simulateur de chat de Studio ; Production : 1 Jeton)

- [ ] `!addpoints @viewer 1 test` par un supermod → « 1 Jetons crédités à @… (solde : …) ».
- [ ] `!crediter 1 @viewer` (ordre inversé) → idem.
- [ ] `!removepoints @viewer 999999` → retire au plus le solde, « … sur 999 999 demandés ».
- [ ] Par un viewer → « commande réservée à l'équipe de modération ».
- [ ] Par un modérateur sans la permission → « permission « Portefeuille » requise ».
- [ ] Pseudo inconnu → « introuvable · rien n'a été fait » ; `!addpoints @x 1k` → usage ;
      `!addpoints @x 2000000` → « 1 000 000 Jetons au plus par commande ».
- [ ] Sur soi-même par un modérateur → refus.
- [ ] `!wallet add @viewer 1` par un supermod → même réponse que `!addpoints` ; par un modérateur sans permission →
      refus ; `!wallet set @viewer 5` par un supermod → « réservé au streamer » ; par toi → appliqué.

## 3. Musique dans la modération

- [ ] Historique › filtre **Musique** : les achats Musique seulement, chaque ligne avec le titre. (auto)
- [ ] Une demande retirée **sans** remboursement : fiche « Musique · titre — artiste », « Retirée par la modération »,
      montant ; **Rembourser** (permission « Portefeuille ») → remboursée une fois, le bouton disparaît. (auto)
- [ ] Demande en file ou en lecture : pas de bouton Rembourser.
- [ ] Open Bar : montant « gratuit », jamais remboursable.
- [ ] Skip payant : « Skip payant », remboursable une fois ; le prix du skip suivant ne change pas.
- [ ] Modérateur sans permission : Rembourser avec un cadenas. (auto)
- [ ] Studio › Modération › Historique : l'achat Musique s'ouvre (nécessite le Studio de cette branche). (auto)
- [ ] **Studio 0.1.29 + nouveau Core** : l'historique de Studio ne montre pas les achats Musique et ne plante pas.

## 4. Tombola

- [ ] 0 participant : « En attente des premières inscriptions… » ; tu rejoins : « (toi) ». (auto)
- [ ] 6 participants (chat + extension) : les 6 lignes, la dernière atteignable, badges « Chat » / « Extension ». (auto)
- [ ] Un 7ᵉ qui rejoint pendant que l'écran est ouvert apparaît sans recharger. (auto)
- [ ] 31 participants : 30 lignes et « +1 · Tout voir » ; « Tout voir » montre tout le monde. (auto, jusqu'à 120)
- [ ] 318 / 400 / 565 px, hauteur réduite, zoom : pas de défilement horizontal. (auto)

## 5. Tutoriel de l'extension

- [ ] « Bien démarrer » : `!solde` (plus `!jetons`), pas de `!cashin` ni `!oracle`, pas de prix écrit en dur.

Captures automatiques : `.lab-data/tombola-captures/` du worktree (générées par les E2E, non versionnées).
