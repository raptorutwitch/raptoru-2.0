# Recette : dernière correction ciblée (environ 15 minutes)

Studio installé fermé, Docker démarré, puis dans `studio-ux` : `npm run studio:lab`. Rien ne parle à Twitch, OBS, Spotify ni
StreamElements réels. Fermer la fenêtre arrête tout. La recette précédente (retour arrière, Tombola, Modération…) est validée.

## 1. Récompenses Twitch (page refaite)

1. **Parcourir.** La page montre une carte par récompense : tuile avec le coût en points et l’icône de ce qu’elle déclenche,
   « Achetable » ou « En pause sur Twitch », les actions de Raptoru en pastilles, l’heure de la dernière demande. Filtres en
   haut (Toutes, Reliées, Sans action, Coupées, Indisponibles sur Twitch), recherche par nom. Le fil des demandes reste à droite.
2. **Interrupteur général.** Coupé : un bandeau ambre le dit au-dessus des cartes (« Activer… » demande confirmation).
3. **Couper une récompense.** L’interrupteur d’une carte coupe ou rallume ses actions Raptoru, avec « Annuler » dans la
   notification. Rien ne change sur Twitch.
4. **La fiche.** Clique la carte « Crédit Soundboard ». Le panneau latéral montre dans l’ordre : la récompense sur Twitch
   (lue, jamais modifiée), « rachetée, elle déclenche », puis l’action **Crédits Soundboard** avec son nombre. « Ajouter une
   action » propose des tuiles par famille : **Crédits TTS** et **Crédits Soundboard** sont deux choix séparés.
   Ajoute une action, ferme le panneau sans enregistrer : la carte affiche « Pas enregistrée », la fiche la reprend.
5. **Tester.** Dans la fiche, la liste dit ce que le test fera vraiment (« à blanc », « RÉEL »), puis « Tester » → « Exécuter ».
   La demande apparaît dans la fiche et dans le fil.
6. **Une demande.** Clique une ligne du fil : qui, quelle récompense, ce que Raptoru a fait action par action, la règle de
   remboursement, et « Voir la fiche ».

## 2. TTS : créditer un viewer fictif

Écris un long message, choisis un viewer pauvre (le menu montre les soldes). Sous le menu : solde, prix du message et
« Il manque … ». « Simuler l’achat » attend ; le bouton ambre « Créditer 50 000 Jetons à … » le débloque en un clic.
« Préparer les 5 viewers » réarme un scénario à plusieurs. Cette zone n’existe que dans le Lab.

## 3. Halloween (vérifié sur le Core du Lab, voir FINALISATION.md)

Alertes → Sub : les Ballons se règlent même profil Halloween coupé. Simulation → Follow et Sub : alertes habituelles.
Active le profil Halloween (Alertes → Réglages) : Follow et Sub passent en Halloween. Recoupe-le en fin d’essai.

## 4. Raid Titan

Alertes → Réglages → Médias : ligne « Copie du Studio installé » → Importer (29 sur 29). Alertes → Raid : la vidéo joue avec
son MP3, fond transparent.
