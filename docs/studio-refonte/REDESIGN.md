# Redesign UX/UI intégral de Studio

Mission reçue le 06/11/2026, après la recette d'Antoni dans Electron. **Verdict : la refonte UX/UI de STUDIO FOUNDATION
COMPLETE n'est pas validée** : les pages internes restent les anciennes pages déplacées dans une nouvelle structure. La
fondation technique (Core, Lab, modularité) reste la base.

Les interfaces historiques ne sont plus des modèles : elles servent uniquement à retrouver les fonctions et les réglages.
Toutes les fonctions métier, permissions et interactions Core sont conservées. Le Core reste l'unique autorité.

## Phase 1 : direction artistique (en cours)

Galerie locale : `prototypes/studio-redesign/index.html`, ou `dev/apercu-directions.cmd` (dossier `prototypes/` ignoré par
Git, comme les autres prototypes : il reste dans ce worktree). Fichiers statiques, données fictives, aucune connexion, aucune
page fonctionnelle remplacée.

**Retour d'Antoni sur A, B, C (06/11) : aucune ne convient comme direction définitive.**

| Direction | Verdict |
|---|---|
| A · Régie | Trop technique et dense. À garder : l'éditeur d'alertes (aperçu direct, timeline, déplacement, édition visuelle, tests) |
| B · Plateau | Rejetée, à ne pas conserver |
| C · Atelier | La moins éloignée, mais impersonnelle, éléments énormes, couleurs trop présentes, surtout Tombola. À garder : quelques tuiles, petits accents colorés, contrôles accessibles |

Il refuse : logiciel financier, console d'ingénieur, tableau de bord générique, grosses cartes identiques.

**Direction D · Coulisses, VALIDÉE le 06/11 après essai.** Idée : Studio voit ce que voient les viewers et se règle directement
dessus.

- Identité reprise du stream, pas d'un modèle : bleu nuit et turquoise (raptoru.fr), Bahnschrift (overlays), Inter (site), rose
  réservé à l'extension, or aux gros gains, ambre aux 10 dernières secondes (langage de `prototypes/tombola-v2/DA.md`).
- Vrais contenus : personnages TTS du dépôt ; vraies alertes lues depuis `Videos\Alertes Twitch Pour Claude\Version webm`, sans
  copie (le prototype ne les affiche donc que sur ce PC).
- Deux signatures : le cadre de visée pour la sélection, la règle graduée pour le temps et les prix.
- Une composition par module : scène et escalier des prix (TTS), ticket puis arène en spirale (Tombola), éditeur à timeline et
  texte déplaçable (Alertes). Réglages sur l'objet, puis panneau à la demande avec recherche.

Vérifié dans Chromium à 1024 × 768, 1360 × 900 et 1920 × 1080 : parcours scripté, vraies vidéos lues, aucune erreur console. Non
essayé dans Electron.

**Phase 1 terminée.** Retours d’Antoni sur D et mission : BRIEF_PAGES.md, DESIGN_SYSTEM.md.
La mission
reprend en autonomie sans nouveau cahier des charges.

## Phase 2 : exécution autonome après le choix

Ordre prévu, ajustable selon les dépendances :

1. Coque, navigation, fenêtres, design system (jetons, polices embarquées localement).
2. Composants communs : confirmations `dialog` (53 `confirm()` natifs dans 22 fichiers à remplacer), notifications avec
   annulation, popovers, tiroirs, interrupteurs, champs.
3. Centre de contrôle et Régie.
4. Pages des modules et réglages, parcours par parcours.
5. Laboratoire, simulation, outils.
6. Activité, Modération, Communauté, historiques.
7. Harmonisation.
8. Corrections, vérifications, recette dans Electron.

Le raccordement d'un nouveau module doit donner d'office le design system, la navigation, les états, les notifications et
les composants communs, en laissant au module son interface spécialisée.

## Garde-fous

Branche `feat/studio-ux` uniquement. Aucun push, déploiement, migration distante, action réelle sur Twitch ou OBS, ni
changement du Studio installé. Retour arrière : la refonte précédente reste dans l'historique (`9e62353`).
