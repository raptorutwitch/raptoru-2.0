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

- **Audit fonctionnel** (mission d'Antoni : démarrages, cycle du live, automatisations, réglages).
  - Méthode : lecture seule du code (Core, bot, Studio, extension, lecteurs), quatre audits parallèles, constats graves
    relus dans le code. Aucune action en Production ; aucun service, bot, OBS ni Studio installé lancé. Au moment des
    tests, ports 4100 / 4110 / 4301 / 4399 libres (Studio installé non lancé).
  - Livrable : [AUDIT_FONCTIONNEL.md](AUDIT_FONCTIONNEL.md). Principes structurants : CONTEXTE § 17. Lots F1-F7 :
    ROADMAP.
  - `0675b9b` :
    - lecteur Soundboard de Production monté au lancement (régression de la refonte : page par défaut = Centre) ;
    - `RaffleRuntime.simulatedStream=false` en Production : `stream_start` refusé, `stream_end` refusé sur une session
      Twitch ;
    - Tombola et widget ne proposent plus le live simulé en Production ;
    - interrupteur mini-jeux « PRODUCTION » avec confirmation ;
    - voyant Caution sur `seen_ms_ago`.
  - `cde6c4f` : Test Lab limité aux arrêts en Production (`testLabActionAllowed`).
  - `a49178a` : Boutique, une action à la fois.
  - E2E `tombola-bonbons` : échec relancé seul, puis rejoué sur les fichiers de `f1f1b03` restaurés temporairement dans le
    worktree. Il échoue de la même façon : défaut antérieur.

## 05/11/2026

- **Décisions H1-H16 tranchées par Antoni** ; GO pour le développement autonome en Lab (CONTEXTE § 18).
- Base PostgreSQL jetable dédiée : conteneur `studio-ux-test-pg` (port 55499) ; jamais `raptoru2-pg`, `vk-test-pg` ni
  `raptoru-lab-v2-pg`. Le Studio installé tournait (port 4100) : jamais utilisé, aucun test sur ses ports ni son dossier.
- `76de82e` F1 vérité des états. `9e1e3fa` P0-2. `5b792f8` P0-3 (contre-preuve : le test échoue sur `updated_at`).
  `67b1d04` P0-4. `04ccc3f` H2 (course réelle à deux Cores sur PostgreSQL : 20 prises / lectures simultanées → aucune
  prise, un remboursement par utilisation). `ba1b669` H3. `d167ca4` H4. `53b9981` H5. `2355f55` H13. `e944670` H15.
  `3311fb5` H16. `3e4e1db` / `38d8d43` F4 « Prêt pour le live ». `a0ed9a7` H8.
- Constat corrigé en passant : la carte Spotify de la Régie attendait `open` / `closed` alors que le Core renvoie
  `ready` / `MODULE_DISABLED` / un motif de refus (état faux affiché depuis le lot 7a).
- Suite Core complète (PGlite) : 1 333 tests verts ; un test d'historique de Modération ajusté (un TTS de 20 min est
  désormais remboursé par l'expiration à 5 min). Suites Roue, migrations, H2 : vertes sur PostgreSQL réel (106 + 5).
- Aperçu isolé (pile E2E, port 4411, données fictives) : Centre de contrôle en 1280 px et 390 px, sans défilement
  horizontal.

- Suite (05/11, nuit) : `0246e56` P0-5 bot · `ad5eeb4` F5 · `2d2e7c6` Extension Lab · `f9e9724` **H1** + `23b8434` (les
  suites PostgreSQL canoniques ouvrent un live comme Twitch le ferait : 9 fichiers, 22 tests verts ; avant correction,
  12 échecs, exactement ceux-là) · `c93dc4d` Jeu des mots dans la préparation · `061c5a8` **H6** · `a53873a` **H10 /
  H12 / H14**.
- Suite Core complète après H1 : 1 351 tests verts. Bot : 287 verts.

## Vérifications marquantes

- Storyboard cherché le 04/11 : dépôt (code, docs, branches, messages de commit), checkout principal, `prototypes/`
  (15 prototypes : bonk-impact-fx, bonk-salves-ux, commands-v2…v6, hub-nav-dots(-footer), moderation-v2(-d4, -refined),
  tombola-v2, tts-v2-extension-ux, tts-v2-player), `Documents\Raptoru`, Bureau, Téléchargements : introuvable.
- Suite E2E complète du 04/11 : `effects-player` (6 échecs sous charge, passe seul), `tombola-bonbons` bloqué une fois,
  `alerts` « families » une fois (4/4 seul) ; aucun fichier de la refonte n'y touche.
- Essai Régie sur pile isolée : Tombola fictive lancée, mise en pause, annulée depuis la Régie.
