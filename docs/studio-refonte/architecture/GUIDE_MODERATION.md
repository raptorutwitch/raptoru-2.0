# Modération dès la création d'un module

## Questions standard (à répondre dans la définition)

| Question | Où la réponse vit |
|---|---|
| Le viewer paie-t-il ? | `viewer.<action>.price` (capacité `wallet`) |
| L'équipe voit-elle le journal ? | `moderation.visible` (obligatoire pour un module payant) |
| Peut-on rembourser, et qui ? | `moderation.refund`: `never` ou `moderator` |
| Quand rembourser ? | `moderation.note` (affichée dans Studio) |
| Hors live ? | `liveOnly` (par défaut, une action payante est réservée au live) |
| Un viewer bloqué ? Une pause globale ? | communs, appliqués par l'hôte (`viewer_blocked`, `global_pause`) |
| Une action restée en attente ? | `expireQueuedMs` → échec et remboursement unique |

`checkModule` refuse :
- un module à actions viewer sans politique de modération ;
- un module payant invisible pour la modération.

## Primitives partagées (ne pas réécrire)

- **Recherche / historique** : `module_activity`, avec filtres module, viewer et limite (`/activity`). Les lignes
  donnent qui, quoi, combien, l'état, l'opérateur et le motif.
- **Remboursement** : toujours **le débit d'origine**, une seule fois (verrou de ligne + clé du portefeuille). Motif
  obligatoire, opérateur enregistré, audit `<module>.refund`. Jamais de crédit arbitraire : il n'existe pas de route
  pour cela.
- **Permissions côté serveur** : `assertAccess(…, 'refund')` (modérateur) dans le Core.
  - Studio : l'acteur est forcé au streamer par le relais et le cockpit.
  - Extension : l'acteur est le jeton vérifié ; le journal est fermé aux non-membres de l'équipe dès la porte, puis
    revérifié par le Core.

## Limite connue

La console de modération D4 de l'extension (`moderation-v2.js`, prototype validé) reste câblée sur TTS, Soundboard,
Bonk et Tombola. Les modules du socle ont leur panneau générique **sous le module**, pas dans la console D4.

Les fondre exige une décision d'interface : faut-il un onglet « Modules » dans D4 ? Je ne l'ai pas fait seul.

## Mise à jour du 05/11 : D4 intégrée

La limite ci-dessus est levée.
- **Où.** D4 › « Autres modules », dans l'extension et dans Studio › Modération : mêmes panneaux et mêmes routes que sous
  chaque module.
- **Règles en plus.** Pas de remboursement de son propre achat depuis l'extension. Le journal n'est lu que pour un module
  dont la politique est visible.
- **Ce que D4 garde.** Ses actions propres à TTS, Soundboard, Bonk et Tombola : rien n'en a été retiré.
