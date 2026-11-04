# Refonte de Raptoru Studio — journal

Historique daté et détails de mise en œuvre. **L'état courant n'est pas ici** : [CHECKPOINT.md](CHECKPOINT.md),
[ROADMAP.md](ROADMAP.md) ; les règles et décisions : [CONTEXTE.md](CONTEXTE.md).

## 04/11/2026

- **Lancement** (GO d'Antoni) à partir de l'étude d'Astra. Worktree `studio-ux`, branche `feat/studio-ux`.
- **`a08a249` — lots 0 à 4.**
  - Lot 0 : bandeau profil dérivé du profil effectif ; textes SAMMI / Économie / simulation corrigés.
  - Lot 1 : `shell/` (registre, barre latérale, favoris, récents, Ctrl+K, fil d'Ariane, `?p=` + alias `?tab=`, tiroir,
    supervision compacte). La supervision réutilise `/api/supervision` et `/api/supervision/ack` ; l'ancien bandeau
    n'est plus monté. L'Extension Lab ne lisait sa surface qu'au montage : le shell clique son bouton `[data-surface]`.
  - Design system : primitives `rs-` extraites de Défis pour être partagées avec la Boutique.
  - Lot 2 Défis, lot 3 Boutique (onglet Achats et dons ; les E2E passent par l'onglet), lot 4 Récompenses Twitch
    (`setFocus` : une vue, plusieurs pages ; Spotify n'est pas une action de règle, aucun lien inventé pour Caution,
    Votekick, Roue du Sub).
  - Incident de travail : un aller-retour PowerShell `Get-Content`/`Set-Content` a corrompu l'UTF-8 de `registry.ts`
    (non suivi à ce moment) ; réparé par conversion inverse 1252 → UTF-8 avant commit. Depuis : écrire via Python.
- **`1d8992a` — Régie étape 1** : incidents, état des automatisations de points de chaîne, coupure nommée, contrôles
  par module en liens.
- **`b1aab1f` — Régie étape 2** : files Tombola (`/api/raffle/snapshot`), Alertes (`/api/alerts/state`), TTS
  (`/api/tts-lab/status`), Spotify (`/api/spotify/state`) ; actions par `/api/raffle/actions` et
  `/api/tts-lab/moderation`. Textes de confirmation des points de chaîne centralisés dans `channel-points-view.ts`
  (vérifié dans le Core : `automations_off` = aucune action ni crédit, jamais rejouée). La page Récompenses confirme
  maintenant aussi la coupure.
- **`f5c5b0d` — Progression** en onglets ; l'E2E passe par les onglets.
- **`4282312` — habillage des vues historiques** : variables `--bg`, `--card`, `--accent`… mappées sur la charte ;
  correctifs petite largeur (Halloween, Tombola, Soundboard).
- **`377e726` — kit de revue** : `dev/apercu-refonte-studio.cmd`, captures (données fictives).
- **Consolidation documentaire** : création de `docs/studio-refonte/` (CONTEXTE, ROADMAP, CHECKPOINT, ce journal,
  `captures/`) ; ancien `docs/STUDIO_REFONTE_JOURNAL.md` déplacé ici ; étude Astra laissée à sa place (référencée par le
  code). Décisions d'Antoni intégrées : tout Studio refondable, Studio extensible, Laboratoire essentiel, catégories
  Production / Lab / Simulation / Aperçu.

## Vérifications marquantes

- Storyboard cherché le 04/11 : dépôt (code, docs, branches, messages de commit), checkout principal, `prototypes/`
  (15 prototypes : bonk-impact-fx, bonk-salves-ux, commands-v2…v6, hub-nav-dots(-footer), moderation-v2(-d4, -refined),
  tombola-v2, tts-v2-extension-ux, tts-v2-player), `Documents\Raptoru`, Bureau, Téléchargements : introuvable.
- Suite E2E complète du 04/11 : `effects-player` (6 échecs sous charge, passe seul), `tombola-bonbons` bloqué une fois,
  `alerts` « families » une fois (4/4 seul) ; aucun fichier de la refonte n'y touche.
- Essai Régie sur pile isolée : Tombola fictive lancée, mise en pause, annulée depuis la Régie.
