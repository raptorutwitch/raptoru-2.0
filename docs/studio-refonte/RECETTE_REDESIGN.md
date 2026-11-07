# Recette de la refonte Studio (direction D « Coulisses »)

Environ 30 minutes, dans Electron, sur le Lab isolé. Aucune action réelle : ni Twitch, ni OBS, ni Jetons réels.

## Lancer

1. Ferme le Studio installé et démarre Docker Desktop.
2. Dans `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux` :

   ```
   npm run studio:lab
   ```

Retour à l'interface précédente : commit `9e62353`. Rien n'est poussé ni publié.

## À vérifier

**Coque.** Barre latérale, recherche Ctrl+K, favoris, bandeau d'incidents, badge Lab en bas. Une page reste au même endroit quand on y revient.

**TTS.** Ouvre la source OBS dans un navigateur depuis la page, envoie un message de test :

- le personnage et les sous-titres sont identiques à l'overlay, et les mots s'allument si ta voix le permet ;
- un message en attente ou déjà lu s'ouvre avec son texte complet ;
- « Passer » et « Passer et rembourser » sont distincts, et le solde suit ;
- les paliers de prix se déplacent et s'ajoutent sur la courbe.

**Tombola.** Lance une manche depuis la page, compare avec l'ancienne : inscriptions, super tickets, tirage, annulation, automatisations. Regarde si le nouvel historique se lit naturellement.

**Alertes.** Importe tes médias depuis le panneau (`Videos\Alertes Twitch Pour Claude\Version webm`) :

- timeline, déplacement et taille des textes, transitions d'entrée et de sortie ;
- position de l'alerte dans l'écran OBS, sans confusion avec la position des éléments ;
- variantes et poids de tirage ;
- `Raid Titan.webm` n'existe nulle part : le refaire depuis `Titan Avi 4.avi` si tu le veux.

**Modération.** Depuis Files : ouvrir une demande, retirer avec ou sans remboursement, bloquer et débloquer un viewer, pause par module et pause globale. Rien ne doit obliger à ouvrir l'extension.

**Modules.** Ouvre Soundboard, Bonk, Spotify, Roue du Sub, Random Ban, Votekick, Caution, Commandes, Jeu des mots, Récompenses, Boutique, Défis, Progression. Chacun doit avoir sa propre composition, pas un formulaire standard.

**Centre, Régie, Système, Laboratoire, Activité.** Le Centre dit si tu peux lancer le live. La Régie couvre tous les modules du direct. Le Laboratoire donne accès à l'extension simulée et aux simulateurs.

**Fenêtres.** Réduis à 1024 × 768 : rien ne doit être coupé. En Modération, les colonnes défilent de côté.

## Dire

- Ce qui ne te plaît pas à l'œil, page par page.
- Toute fonction ancienne qui te manque : l'audit est dans [PARITE.md](PARITE.md).
- Les décisions listées dans [PARITE.md](PARITE.md) § « À arbitrer par Antoni ».
