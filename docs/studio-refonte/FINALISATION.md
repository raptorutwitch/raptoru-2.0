# Mission finale : finitions, socle modulaire, préparation de la migration

Reçue le 07/11/2026 après la recette de la consolidation. Direction D validée ; migration et Production **non** validées.
Aucun push, aucun déploiement, aucun remplacement du Studio installé, aucune action réelle Twitch / OBS / Spotify / StreamElements.
Reprendre ici après une interruption ; dernier commit : `git log --oneline -5`.

## Lots

| # | Lot | État |
|---|---|---|
| 1 | Alertes : variante Halloween qui se recoche | en cours |
| 2 | Alertes : Raid Titan, son des Bits | à faire |
| 3 | Navigation arrière / avant | à faire |
| 4 | TTS : détail d'un message, solde, prix, refus, scénario | à faire |
| 5 | Tombola : fermer le résultat, son d'ouverture, densité des réglages | à faire |
| 6 | Modération : densité des files, permissions, vocabulaire | à faire |
| 7 | Récompenses : récompense / action / demandes séparées | à faire |
| 8 | Simulation : live fictif, viewer, résultat | à faire |
| 9 | Activité, Communauté, Système : défauts concrets | à faire |
| 10 | Modularité : preuve d'un module, remake d'un onglet de l'extension | à faire |
| 11 | Matrice de migration des données | à faire |
| 12 | Plan de livraison et rollback | à faire |
| 13 | `npm run studio:lab` réel, suites finales, Electron | à faire |

## Points de vigilance

- Ne jamais toucher aux ports 4100 / 4110 / 3789 tant que le Studio installé tourne ; serveur isolé : 4398 / 4408.
- Les originaux des médias sont seulement lus.
- Aucune migration réelle : préparer seulement.
