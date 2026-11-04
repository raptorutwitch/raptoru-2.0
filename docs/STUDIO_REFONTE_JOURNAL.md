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
| 5 — Régie live | Incidents ; points de chaîne (état réel, coupure / activation confirmées avec leurs effets sur les achats : jamais rejoués, points non remboursés par Raptoru, autres modules intacts — même texte sur la page Récompenses, qui confirme désormais aussi la coupure) ; files en direct lues sur les routes des modules (Tombola, Alertes, TTS, Spotify) ; actions nommées par ces mêmes routes : Tombola pause / reprise / annulation, TTS pause / reprise / arrêt du message (Lab ; en Production → Modération) ; contrôles de chaque module en lien. Aucun « arrêter tout ». | fait, à valider |
| 6 — Progression | Onglets Viewers · Titres et badges · Règles d'XP · Reprise WizeBot ; fiche viewer en indicateurs (niveau, XP, rang, présence, messages), inventaire, attribution, XP manuelle, journal ; désactivation confirmée (ce qui s'arrête, ce qui est conservé). | fait, à valider |
| 7 — harmonisation | Les variables des vues historiques prennent les couleurs de la charte dans le shell (composition inchangée) ; Système : titre « Système », « État des services » au lieu d'un second « Centre de contrôle ». Plus aucun défilement horizontal de page à 480 et 1 024 px sur les 29 pages (Tombola et Soundboard, prototypes validés : ce qui reste trop large défile dans la vue). | fait, à valider |

## Pour juger la refonte

- **Aperçu navigateur, données fictives, sans Twitch / OBS / Production** : double-cliquer
  `dev\apercu-refonte-studio.cmd` dans ce worktree (construit l'interface, lance une pile Lab en mémoire, ouvre
  http://127.0.0.1:4411 ; fermer la fenêtre arrête tout). La pile démarre vide : Défis, Boutique et Tombola se
  remplissent en créant des éléments fictifs.
- **Vrai Studio (Electron), profil Lab** : `npm run studio` dans ce worktree.
- **Captures** (pile isolée, données fictives) : `docs/assets/studio-refonte/` — Centre de contrôle, Régie live,
  Modules, Défis (catalogue, atelier), Boutique, Progression, Récompenses Twitch, palette Ctrl+K, Système, et deux
  vues mobiles (Défis, tiroir de navigation).

## État au 04/11 (branche `feat/studio-ux`, locale)

- Vérifié : typecheck, build, lint et Prettier des fichiers touchés ; tests unitaires shell / Régie / Défis /
  supervision / centre de contrôle ; E2E Défis, Boutique (3), Halloween, Progression, Alertes ; Tombola mise en pause
  puis annulée depuis la Régie sur la pile isolée.
- E2E instables hors périmètre : `effects-player` sous charge, `tombola-bonbons` (bloqué une fois), `alerts`
  « families » ; tous passent relancés seuls.
- Pas encore vu dans le vrai Studio ni par Antoni.

### Reste à refondre

1. Alertes (éditeur, file, source OBS, événements réels), Soundboard, Jeu des mots, Halloween, Simulation, Test Lab,
   Système : composition sur les primitives `rs-` (seule la palette est harmonisée aujourd'hui).
2. Tombola, Commandes, Modération, TTS, Bonk : prototypes validés — composition conservée ; seulement responsive et
   palette, sauf décision d'Antoni.
3. Extension Lab : surfaces de l'extension à leurs tailles Twitch (larges par nature).
4. Retirer les styles historiques devenus inutiles quand plus rien ne les utilise.

## Storyboard

Recherché le 04/11 : dépôt (code, docs, toutes branches, messages de commit), checkout principal, `prototypes/`
(15 prototypes, aucun Storyboard), ancien dossier `Documents\Raptoru`, Bureau, Téléchargements. **Introuvable.**
Aucun équivalent n'est inventé ; le lot attend qu'Antoni indique où il se trouve (ou ce qu'il désigne).

## Questions métier Défis — documentées, règles inchangées (décision d'Antoni le 04/11)

1. **Objets récompense masqués ou archivés** : la liste du Core accepte tout objet `status <> draft AND active`, donc un
   objet masqué ou archivé peut être choisi, validé puis attribué ; le sélecteur Studio n'affiche pas son statut (la
   méta n'en fournit pas). La documentation dit « publié et actif ». À décider : filtrer `published && active` (Core et
   Studio) ou assumer.
2. **Fuseau des dates** : Défis convertit début / fin dans le fuseau du PC (le Studio l'affiche « heure de ce PC ») ;
   la Boutique convertit explicitement en Europe/Paris. À décider : aligner Défis sur Paris.
3. **Reprise après suspension** : `activated_at` garde la première activation ; un recomptage après reprise peut compter
   les événements survenus pendant la suspension, dans la fenêtre comptée. La confirmation « Reprendre » le dit. À
   décider : « pause » = gel sans rattrapage, ou rattrapage assumé.
