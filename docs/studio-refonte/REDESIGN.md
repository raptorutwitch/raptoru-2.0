# Redesign UX/UI intégral de Studio

Mission reçue le 06/11/2026, après la recette d'Antoni dans Electron. **Verdict : la refonte UX/UI de STUDIO FOUNDATION
COMPLETE n'est pas validée** : les pages internes restent les anciennes pages déplacées dans une nouvelle structure. La
fondation technique (Core, Lab, modularité) reste la base.

Les interfaces historiques ne sont plus des modèles : elles servent uniquement à retrouver les fonctions et les réglages.
Toutes les fonctions métier, permissions et interactions Core sont conservées. Le Core reste l'unique autorité.

## Phase 1 : trois directions (en cours)

Galerie locale : `prototypes/studio-redesign/index.html`, ou `dev/apercu-directions.cmd` (dossier `prototypes/` ignoré par Git, comme les autres prototypes : il reste dans ce worktree). Fichiers statiques, données
fictives, aucune connexion, aucune page fonctionnelle remplacée.

| Direction | Idée | Réglages |
|---|---|---|
| A · Régie | Console de diffusion : volets fixes, barre d'état globale | Inspecteur, valeurs à tirer |
| B · Plateau | Une chose à l'écran, en très grand, dock de chapitres | Phrases à mots cliquables, tiroir |
| C · Atelier | Établi de tuiles, une couleur par module | Directement sur les tuiles |

Écrans prototypés : TTS, Tombola, Alertes, avec leurs états (vide, pause, lecteur absent, en cours, résultat, lecture).
Vérifié dans Chromium à 1024 × 768, 1360 × 900 et 1920 × 1080 : parcours souris et clavier scriptés, aucune erreur
console. Non essayé dans Electron.

**Attendu : le choix artistique d'Antoni.** Rien de la suite ne démarre avant.

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
