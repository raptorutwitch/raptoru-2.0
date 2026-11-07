# Recette manuelle — STUDIO FOUNDATION COMPLETE

Environ 30 minutes, dans Electron, sur la branche `feat/studio-ux`. Rien ne touche Twitch, le vrai OBS, le Wallet ou la
Production. Cocher ce qui marche, noter ce qui gêne : c'est cette recette, et elle seule, qui valide le jalon.

## Avant de commencer

1. Fermer le Studio installé (mêmes ports 4100 et 4110).
2. Démarrer Docker Desktop.
3. Dans le worktree :

```text
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux"
npm run studio:lab
```

La commande refuse de démarrer si un Studio tourne déjà. Elle démarre la base du Lab (son propre conteneur Docker,
`raptoru-lab-core-pg`, port 55460), construit tout, puis ouvre Studio sur son propre dossier de données (`.lab-data`) : aucun
`.env`, aucun jeton et aucun profil Production ne peuvent y être lus. Le premier lancement prend 2 à 3 min.

**Retour arrière** : `npm run studio:legacy` relance l'ancien Lab.

## 1. Démarrage (2 min)

- [ ] En bas à gauche : « Profil Lab · Core local », lisible.
- [ ] Système › Services : Postgres, base Lab du Core principal et Core local sont prêts.
- [ ] Système › Connexions : OBS ne se connecte pas à ton vrai OBS (il est fictif).

## 2. Centre et Modules (5 min)

- [ ] Centre de contrôle : une phrase dit où tu en es, le détail s'ouvre au clic, chaque ligne mène à la bonne page.
- [ ] Un incident éventuel tient sur une ligne en haut, « Détails » l'ouvre.
- [ ] Modules : chaque module montre son état ; les filtres fonctionnent.
- [ ] Ctrl+K : « tts », « coffre », « roue » ouvrent la bonne page.
- [ ] Une étoile sur une page l'ajoute aux favoris.

## 3. Le chemin viewer (8 min)

Laboratoire › Extension Lab, surface Panel viewer.

- [ ] Un TTS part et joue (Aperçu ici sur la page TTS, ou la source OBS d'un OBS de test) ; le solde fictif baisse.
- [ ] Un son du Soundboard joue après « Activer le son ».
- [ ] Un Bonk : emote fictive, impact sur l'overlay si tu l'ouvres dans le navigateur.
- [ ] Passer en Modérateur : la console D4 s'ouvre, une sanction et un remboursement fonctionnent.
- [ ] Laboratoire › Simulation : « Démarrer » le live, envoyer `!roulette 100` après avoir activé les mini-jeux.

## 4. Pages de module (8 min)

- [ ] TTS : Pause / Reprendre ; « Prix et limites » enregistre un palier (il remplace l'onglet de Modération).
- [ ] Bonk : la zone se déplace et s'enregistre, « Prix et limites » est là.
- [ ] Alertes : Lancer un aperçu ; « Envoyer dans la file ».
- [ ] Jeu des mots : le réglage d'intervalle s'enregistre.
- [ ] Random Ban : les règles sont repliées, rien de ce que tu réglais n'a disparu.
- [ ] Spotify, Roue du Sub, Votekick, Caution : les simulateurs et réglages habituels sont là.
- [ ] Tombola : un lancement rapide, puis un tirage.
- [ ] Commandes : créer une commande, la tester dans Simulation.

## 5. Modularité (3 min)

- [ ] Modules › Nouveaux modules › Coffre mystère : activer, fixer le prix à 150.
- [ ] Extension Lab : acheter un coffre ; il coûte 150.
- [ ] Sur sa page : « Prendre la prochaine action » puis « Échec (rembourse) » : le solde revient.

## 6. Activité et confiance (4 min)

- [ ] Activité : les actions faites ci-dessus apparaissent, filtres compris.
- [ ] Système › Services : « Réessayer / redémarrer le Core local » relance le Lab ; les pages le disent le temps du redémarrage.
- [ ] Rien dans l'interface ne te semble te mentir sur ce qui marche.

## Décision attendue

| Question                                                                | Réponse d'Antoni |
| ----------------------------------------------------------------------- | ---------------- |
| Studio te convient-il comme base ?                                      |                  |
| Le jalon est-il validé ?                                                |                  |
| Retirer l'ancien Lab ([RETRAIT_ANCIEN_LAB.md](RETRAIT_ANCIEN_LAB.md)) ? |                  |
| Page ou parcours à reprendre avant de livrer ?                          |                  |
