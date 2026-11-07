# Parité fonctionnelle de la refonte Studio

**Matrice complète, module par module (07/11/2026)** : [parite/direct.md](parite/direct.md) (modules du direct) et [parite/admin.md](parite/admin.md)
(économie, équipe, administration). Ancien Studio `5d63087`, nouveau Studio, routes du Core et console de l'extension, comparés par le comportement.
Statuts : préservée, déplacée, remplacée, obsolète, manquante, bloquée.

## Bilan du 07/11

Aucun écart sur les droits, les prix enregistrés, les remboursements ou l'idempotence. Écarts trouvés, tous corrigés :

| Écart | Gravité | Correction |
|---|---|---|
| Ouvrir ou fermer les mini-jeux en Production sans confirmation | Grave | Confirmation rétablie |
| Mises et délais des mini-jeux sans « ancien → nouveau » | Moyen | Confirmation rétablie |
| Prix du Bonk sans « ancien → nouveau » | Moyen | Confirmation rétablie |
| Interrupteurs des modules du socle sans confirmation | Moyen | Confirmation rétablie |
| Limites des paliers TTS non saisissables à l'unité, découpe invalide | Moyen | Champ « Jusqu’à », découpe corrigée |
| Recliquer l'état courant renvoyait la commande et rouvrait le choix de file | Moyen | Ignoré |
| Erreur du runtime TTS non affichée | Faible | Affichée |
| Mode Twitch cliquable quand il est indisponible | Faible | Refusé avec un message |
| Recherche des droits de la Roue perdue au relevé | Faible | Protégée |

Déplacé dans cette passe, avec la preuve que rien ne se perd : l'interrupteur Mini-jeux de la Simulation vit dans la page Mini-jeux (même route, même
confirmation en Production) ; le simulateur Spotify passe des réglages à la page ; la fenêtre de la Simulation devient un lien.

Bloqué, limite réelle : ajouter ou remplacer un son du Soundboard (banque livrée avec le Core et l'extension). À arbitrer :
le code mort ci-dessous.

## Audit mécanique du 06/11

Audit du 06/11/2026, contre `5d63087`. Toutes les anciennes pages, y compris la console de modération de l'extension
(`shared/moderation-v2.js`), que l'ancien onglet Modération montait et qui était la vraie source de ses fonctions.

Méthode : routes, commandes, ancres `data-*`, clés de configuration et libellés de boutons comparés fichier par fichier ; câblage
des boutons et des gestionnaires ; chaque écart lu dans le code, ancien et nouveau ; chaque page chargée dans le Lab, panneau ouvert.

Une page absente de ce document : aucun manque trouvé par cette méthode. Lues en entier des deux côtés : Alertes, réglages de la
Tombola, Spotify, droits de la Roue, Récompenses, Système. Comparées mécaniquement, avec lecture ciblée des écarts : les autres pages.

## Corrigé

**Roue du Sub.** Le bouton « Actualiser » de la fiche d'un viewer avait disparu, et la fiche ouverte ne se relit pas seule : un tour
pris entre-temps n'apparaissait pas. Rétabli.

**Système.** En Production, le badge permanent ne disait plus l'état de la connexion : même serveur injoignable, il affichait
« Production · actions réelles », et l'état n'était que dans l'infobulle. Il redit l'état dès que ce n'est pas « Connecté ».

**Alertes.** Les boutons −0,01 s et +0,01 s de la timeline avaient été remplacés par Maj + flèches, mais les flèches ne marchaient
pas après un clic sur la timeline : le pas fin n'était plus atteignable qu'en tabulant. La timeline prend maintenant le focus au clic,
et l'infobulle des boutons d'image indique le raccourci.

## Retrait justifié

| Page | Fonction retirée | Raison |
|---|---|---|
| Alertes | Case « Calibrer la variante » | L'édition est toujours active. Rien ne part vers OBS sans « Enregistrer ». |
| Alertes | Case « Masquer les cadres » | Les cadres n'apparaissent qu'au survol ou à la sélection : sans sélection, l'image est nette. |
| Alertes | Bouton « Rejouer l'aperçu » | Fait double emploi avec « Jouer », qui rejoue avec les mêmes données de test. |
| Commandes | Boutons Précédente et Suivante dans l'éditeur | La liste des commandes reste ouverte à côté de l'éditeur. |
| Tombola | Pastille « Future monnaie » | Bouton désactivé, sans fonction. |
| Modération | « Fermer (sans tirer) » de la Tombola | Dans le Core, `raffle_close` et `raffle_draw` sont la même opération : ce bouton tirait au sort, malgré son nom. « Tirer » et « Annuler » couvrent les deux cas. |
| Modération | Console de l'extension montée dans Studio | Remplacée par la modération native : mêmes commandes, mêmes filtres et même pagination, vérifiés un par un. |

## Tranché

**Bonk, catalogue des emotes.** Ce panneau est un ajout de la refonte, il n'existait pas dans l'ancienne page. Le serveur Studio appelle
une route `/v1/lab/…`, que le transport refuse hors de l'ancien Lab. Pas de nouvelle route Core pour une lecture de confort : le
panneau dit « Catalogue non disponible sur ce profil. L'essai utilise les emotes par défaut. » Aucune fonction historique perdue.

## À arbitrer par Antoni

**Code mort.** `src/moderation.ts`, `src/moderation.css` et `src/tts-config.ts` ne sont plus importés. `tts-config.ts` contient encore un
`confirm()` natif. Leur suppression a été refusée par le contrôle du mode auto. Un agent a ensuite supprimé les deux premiers sans
que ce soit dans sa consigne : ils ont été restaurés, la suppression reste à ta décision. `shell/shell.css` et `studio-theme.css`,
eux, ont été retirés dans le cadre du nettoyage du CSS mort demandé à ce lot.

## Non vérifié ici

Le profil Production n'a pas été exécuté : le badge et les branches propres à Production sont vérifiés par lecture du code, pas à
l'écran. Les lecteurs chargés au lancement (Soundboard en Production) sont présents dans le code, pas testés avec un vrai achat.
