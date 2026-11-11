# Recette manuelle : modération de l'extension (post-live 11/11)

À faire par Antoni. D'abord dans le **Lab** (économie de test), puis en Production **après** le déploiement du Core et
l'envoi du nouveau ZIP en Hosted Test. Aucun test ne doit utiliser de Jetons Production sans décision d'Antoni.

Lab : `Ouvrir Music Hub (Lab).cmd` à la racine du worktree `post-live` (viewer, modérateur, supermod) ou
`npm run studio:lab`.

## 1. Portefeuille (ex « Wallet admin »)

- [ ] Modération › colonne de gauche : un lien **Portefeuille** sous « Autres modules ».
- [ ] Clic : la recherche s'ouvre avec « Portefeuille de… ». Taper `@pseudo` (avec l'arobase) trouve le viewer ; un
      login différent du nom affiché s'affiche en gris (`@login`).
- [ ] Choisir le viewer : sa fiche s'ouvre **sur son Portefeuille** (Jetons, crédits TTS, crédits Sons).
- [ ] « + Créditer » 250, motif : le solde monte de 250 ; l'ajustement apparaît dans « Ajustements » et dans
      l'Historique (« Portefeuille », avec l'auteur et le motif).
- [ ] « − Débiter » plus que le solde : le solde tombe à 0, jamais en dessous.
- [ ] Le pied de la fiche dit « Portefeuille de test du Lab » dans le Lab, « Jetons réels de la chaîne » en Production.
- [ ] Un modérateur **sans** la permission « Portefeuille » : cadenas sur le lien, fiche « Réservé à la permission
      « Portefeuille » », aucun bouton Créditer.
- [ ] Équipe et permissions : la permission s'appelle « Portefeuille ».
- [ ] Nulle part le mot « Wallet ».

## 2. Commandes chat des modérateurs (Lab : simulateur de chat de Studio)

- [ ] `!addpoints @viewer 500 test` par un supermod → « 500 Jetons crédités à @… (solde : …) ».
- [ ] `!crediter 500 @viewer` (ordre inversé) → idem.
- [ ] `!removepoints @viewer 999999` → retire au plus le solde, dit « … sur 999 999 demandés ».
- [ ] Par un viewer → « commande réservée à l'équipe de modération ».
- [ ] Par un modérateur sans la permission → « permission « Portefeuille » requise ».
- [ ] Pseudo inconnu → « introuvable · rien n'a été fait » ; `!addpoints @x 1k` → message d'usage ;
      `!addpoints @x 2000000` → « 1 000 000 Jetons au plus par commande ».
- [ ] Sur soi-même par un modérateur → refus.

## 3. Musique dans la modération

- [ ] Une demande de chanson payée en Jetons apparaît dans l'Historique et la fiche du viewer (« Musique · titre — artiste »).
- [ ] Demande **terminée** (jouée, refusée, retirée) : bouton **Rembourser** (permission « Portefeuille ») → remboursée
      une seule fois ; un second clic dit « Déjà remboursé ».
- [ ] Demande encore en file ou en lecture : pas de bouton Rembourser.
- [ ] Skip payant : apparaît (« Skip payant »), remboursable une fois ; le prix du skip suivant ne change pas.
- [ ] Studio › Modération : ouvrir un achat Musique depuis une fiche viewer ne plante pas (nécessite le Studio de cette branche).

## 4. Tombola

- [ ] Ouvrir une tombola, 6 participants (chat + extension) : **les 6 lignes** sont dans la liste de l'écran ouvert, la
      dernière atteignable en défilant, badges « Chat » et « Extension ».
- [ ] Un 7ᵉ qui rejoint pendant que l'écran est ouvert apparaît sans recharger.
- [ ] Au-delà de 30 participants : le lien dit « +N · Tout voir ».
- [ ] Panneau étroit (318 px), normal (400), large (565), hauteur réduite : pas de défilement horizontal.

Captures automatiques de référence : `.lab-data/tombola-captures/` (générées par l'E2E, non versionnées).
