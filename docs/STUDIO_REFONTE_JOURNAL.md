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

## Storyboard

Recherché le 04/11 : dépôt (code, docs, toutes branches, messages de commit), checkout principal, `prototypes/`
(15 prototypes, aucun Storyboard), ancien dossier `Documents\Raptoru`, Bureau, Téléchargements. **Introuvable.**
Aucun équivalent n'est inventé ; le lot attend qu'Antoni indique où il se trouve (ou ce qu'il désigne).

## Arbitrages relevés (non tranchés par la refonte)

- Défis : la liste des objets récompense du Core inclut des objets masqués/archivés (`status <> draft AND active`) ; le
  sélecteur Studio n'affiche pas leur statut (méta sans statut). À corriger côté Core avant d'utiliser une récompense objet.
- Défis : dates converties dans le fuseau du PC (affiché « heure de ce PC ») ; la Boutique convertit en Europe/Paris.
- Défis : la reprise après suspension peut compter les événements survenus pendant la suspension (sémantique à décider).
