# Raptoru Studio — journal de la refonte UX/UI

Référence durable : `docs/RAPTORU_STUDIO_UX_UI_2026-11-04.md` (étude Astra ; charte partie F, lots § E.4).
Branche locale `feat/studio-ux` (worktree `Raptoru 2.0 - Worktrees/studio-ux`). Rien n'est poussé, publié ni déployé :
chaque lot attend la validation manuelle d'Antoni.

## Règles tenues par tous les lots

- Chaque vue existante est montée une seule fois (`main.ts`) ; le shell ne fait que l'afficher. Aucun moteur, lecteur,
  poller ou handler économique n'est dupliqué. `?tab=<id>` reste une adresse valide (alias vers `?p=<page>`).
- Styles nouveaux préfixés `rs-` (jetons `--rs-*` dans `shell/shell.css`) ; aucune règle globale sur `.row`, `.card`, `button`.
- Actions sensibles : la confirmation dit la portée réelle (Core, versement, Production). Pas de « tout arrêter ».
- Données de test fictives uniquement (pile E2E isolée, PGlite).

## Lots

| Lot | Contenu | État |
|---|---|---|
| 0 — vérité des états | Bandeau profil dérivé du profil effectif (plus de « paiement simulé » en Production) ; textes SAMMI / Économie / simulation corrigés. | fait, à valider |
| 1 — shell | Six rubriques + Laboratoire séparé, favoris (étoile, 6 max), récents, Ctrl+K (pages seulement, aucune action), fil d'Ariane, liens profonds `?p=`, historique navigateur, tiroir < 900 px, supervision compacte (une ligne par incident, « Vu » conservé), Centre de contrôle, catalogue Modules, hubs Régie / Communauté / Activité / Laboratoire. Système = l'ancien accueil Studio (inchangé). | fait, à valider |
| 2 — Défis | Catalogue (état vide expliqué), atelier en trois sections visibles (Présentation · Condition et période · Récompense) + résumé + vérification Core sans écriture ; brouillon / activation / recomptage séparés ; activation et recomptage confirmés avec leur portée réelle (rétroactivité, versements) ; reprise prévient du recomptage ; suivi en page propre, retrait d'objet expliqué. | fait, à valider |
| design system | Primitives `rs-` partagées dans `shell/shell.css` : page, en-tête, retour, message, puce d'état, tableau, champs, sections numérotées, notes / alertes, onglets segmentés, filtres, résumé. Défis et Boutique les utilisent. | en place |
| 3 — Boutique | Catalogue filtrable (type, état, recherche) ; atelier en sections Type · Présentation · Apparence · Disponibilité · Offres, aperçu raptoru.fr latéral (rendu réel du Core, inchangé) ; « Achats et dons » séparés de la création ; remboursement expliqué. Mêmes routes, mêmes contrôles d'image. | fait, à valider |
| 4 — Récompenses Twitch | Une seule vue montée, plusieurs pages canoniques : « Récompenses Twitch » (récompenses avec leurs actions affichées, éditeur, historique, liens vers les modules) et une page par module (Effets, Spotify, Random Ban, Caution, Votekick, Roue du Sub) via `setFocus`. Chaque page module liste les récompenses qui la déclenchent (lien → règle de la récompense) quand ce lien existe vraiment dans les règles (Effets, Random Ban) ; Spotify garde sa récompense propre ; Caution, Votekick, Roue du Sub ne sont pas déclenchés par une règle de récompense (aucun lien inventé). | fait, à valider |

## Checkpoint (04/11, commit `a08a249` sur `feat/studio-ux`)

- Lots 0 à 4 commités. Vérifié : typecheck + build Studio web, lint et Prettier des fichiers touchés, tests unitaires
  `studio-shell` / `challenges-form` / `supervision-view`, E2E navigateur Défis, Boutique (3), Halloween Studio / Titres,
  Progression, Alertes (pile isolée, données fictives). Captures 1440 / 1024 / 480 px : pas de défilement horizontal
  sur les pages refondues.
- E2E hors périmètre observés pendant la suite complète : `effects-player` (6 échecs sous charge, passe relancé seul ;
  aucun fichier de la refonte n'y touche) ; `tombola-bonbons` s'est bloqué une fois (instabilité connue) ; `alerts`
  « families » une fois (passe 4/4 relancé).
- Pas encore vérifié dans le vrai Studio (Electron) ni par Antoni. Lancement pour essai : `npm run studio` depuis ce
  worktree (profil Lab).
- Vues historiques non refondues (s'affichent dans le shell, inchangées) : Tombola, Alertes, Commandes, Jeu des mots,
  Modération, Halloween, Progression, Soundboard, Simulation, Test Lab, Extension Lab, Système (ancien accueil).
  Tombola déborde horizontalement à 480 px (prototype validé : à traiter sans toucher à sa composition).

### Régie live — étape 1 (commit suivant `a08a249`)

`shell/regie.ts` : incidents en cours ; état réel des automatisations de points de chaîne (Core du profil) avec
« Couper / Activer les automatisations… » (même route `/api/channel-points/settings` que la page Récompenses ; la
confirmation de coupure dit ce qui n'est pas fait : récompenses toujours achetables, non remboursées, autres modules
intacts) ; contrôles nommés de chaque module = lien vers l'écran qui les porte. Tests : `studio-shell.test.ts`.

### Suite prévue (ordre de la mission)

1. Régie live, étape 2 : états en lecture des files (alertes, TTS, Spotify, Tombola) et actions nommées réutilisant les
   routes existantes, profil par profil (en Production, certaines commandes vivent dans Modération : y renvoyer).
   Lire le contrat de chaque route avant de l'appeler d'ici. Jamais d'« arrêter tout ».
2. Alertes et déclencheurs, sons et lecteurs (Soundboard, TTS), jeux, Halloween, communauté et modération, activité,
   système, laboratoire : passer chaque vue sur les primitives `rs-` en gardant l'UX validée (extraction locale seulement).
3. Uniformisation générale ; retirer les styles historiques devenus inutiles seulement quand plus rien ne les utilise.

## Storyboard

Recherché le 04/11 : dépôt (code, docs, toutes branches, messages de commit), checkout principal, `prototypes/`
(15 prototypes, aucun Storyboard), ancien dossier `Documents\Raptoru`, Bureau, Téléchargements. **Introuvable.**
Aucun équivalent n'est inventé ; le lot attend qu'Antoni indique où il se trouve (ou ce qu'il désigne).

## Arbitrages relevés (non tranchés par la refonte)

- Défis : la liste des objets récompense du Core inclut des objets masqués/archivés (`status <> draft AND active`) ; le
  sélecteur Studio n'affiche pas leur statut (méta sans statut). À corriger côté Core avant d'utiliser une récompense objet.
- Défis : dates converties dans le fuseau du PC (affiché « heure de ce PC ») ; la Boutique convertit en Europe/Paris.
- Défis : la reprise après suspension peut compter les événements survenus pendant la suspension (sémantique à décider).
