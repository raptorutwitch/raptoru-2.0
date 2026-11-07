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
- Régression complète avant H9 : Core 1 360 verts ; Studio 876 (3 attentes ajustées à H3 / H5 / P0-2, `3d8f681` ;
  `effects-player` instable sous charge, vert seul) ; extension 72 ; build web et lint propres.
- `3a06b78` **H9** : complément de fidélité ; course à deux Cores sur PostgreSQL (même relevé appliqué 6 fois) : un
  complément par gain.

## Vérifications marquantes

- Storyboard cherché le 04/11 : dépôt (code, docs, branches, messages de commit), checkout principal, `prototypes/`
  (15 prototypes : bonk-impact-fx, bonk-salves-ux, commands-v2…v6, hub-nav-dots(-footer), moderation-v2(-d4, -refined),
  tombola-v2, tts-v2-extension-ux, tts-v2-player), `Documents\Raptoru`, Bureau, Téléchargements : introuvable.
- Suite E2E complète du 04/11 : `effects-player` (6 échecs sous charge, passe seul), `tombola-bonbons` bloqué une fois,
  `alerts` « families » une fois (4/4 seul) ; aucun fichier de la refonte n'y touche.
- Essai Régie sur pile isolée : Tombola fictive lancée, mise en pause, annulée depuis la Régie.

## 05/11/2026 — mission fondatrice « socle modulaire »

- Constats mesurés par quatre analyses en lecture seule, recoupées dans le code (`architecture/FRICTIONS.md`). Un module
  transversal coûtait ~45 fichiers et ~65 endroits.
- Socle : contrat + `checkModule`, hôte unique dans les deux Cores, journal générique, routes, relais Studio,
  fournisseur du Centre de contrôle, page générique, porte de l'extension partagée Production / Lab, registre, achat
  par intention, modération générique, porte du lecteur OBS, générateur.
- Démos :
  - A : 1 fichier + 2 lignes ;
  - B : 2 fichiers + 3 lignes ;
  - C : mini-jeux, 6 réglages H10 et supervision, règles et tests conservés.
- Bugs trouvés et corrigés :
  - liste blanche du client Lab de Studio sans `/v1/lab/module-settings/`, `/v1/lab/daily/`, `/v1/lab/modules/` : les
    réglages H10 / H12 / H14 étaient refusés en profil Lab, et les tests de l'époque contournaient ce client ;
  - contrôle d'hôte absent sur trois relais Studio ;
  - typecheck du serveur Studio rouge.
- Suites :

  | Suite                      | Résultat    |
  | -------------------------- | ----------- |
  | Core                       | 1 380 verts |
  | Intégration PostgreSQL     | 191 verts   |
  | Studio                     | 884 verts   |
  | Extension                  | 78 verts    |
  | Bot                        | 287 verts   |
  | Build web, lint, typecheck | propres     |

  Deux plantages 0xC0000409, relancés seuls et verts.

- Vu en navigateur sur la pile isolée (4411) : trois défauts trouvés et corrigés (`dbb1798`).

## 05/11/2026 — Opération fondation totale (consolidation, premières migrations)

- **Revue indépendante du socle.** Un sous-agent en lecture seule a relevé 13 constats, tous corrigés (`77e614d`).
  P0 latent : le cockpit de Studio relayait une action viewer avec le viewer nommé dans le corps de la requête.
- **Porte chat** (`0148b26`). L'origine `module:<id>` est autorisée par une seule migration pour tous les futurs modules.
- **D4 › « Autres modules »**, dans l'extension et dans Studio, avec une seule implémentation.
- **Friction S1 traitée.** Deux trous silencieux trouvés en navigateur dans la pile d'aperçu : relais et `/api/lab`
  absents.
- **Adaptateurs.**
  - Votekick : délai de relance et plage de sanction.
  - Caution : tarifs ; le devis garde son prix ; « prolongé » compté en minutes.
  - Random Ban, Jeu des mots, Boutique d'événement : état seulement.
  - Matrices de parité dans `architecture/MIGRATIONS.md`.
- **Studio.** Page du socle en tuiles ; panneau de réglages compact avec un vrai interrupteur, partagé par Bonk et Points
  de chaîne.
- **Suites.**

  | Suite       | Résultat |
  | ----------- | -------- |
  | Core        | 1 396    |
  | Intégration | 191      |
  | Studio      | 884      |
  | Extension   | 78       |
  | Bot         | 287      |

## 05/11/2026 — Mission continue

- Vérification ciblée du socle (10 questions) : les réponses et leurs tests sont dans `PREUVES.md`. Un manque a été
  comblé : aucun test ne prouvait qu'un module Lab ne laisse aucun réglage en Production.
- Extension, `8a2f113` : Commandes, Roue du Sub et Événements s'enregistrent eux-mêmes.
  - Retirés de `ui.js` : 21 endroits (7 par module) ; `ui.js` passe de 6 361 à 6 289 lignes.
  - Nouveau E2E : aller-retour sans rechargement.
- Lecteur OBS fictif générique, en Lab seulement, par `claim` / `report`. Le doublon de la démo est supprimé.
  - Vérifié en navigateur : achat → échec → remboursé.
- « Prêt pour le live » en grille de cartes.
- `LIVRAISON.md` préparé. Rien n'est exécuté.
- Revue indépendante des deux changements structurels : aucun P0 / P1, 3 P2 corrigés (`4624658`).

## 05/11/2026 — Mission d'exécution (extension)

- E2E de parité TTS V2 et Tombola V2 écrits et verts **avant** l'extraction. Il a fallu brancher sur la pile un vrai
  worker TTS et un lecteur fictif : jusque-là, la pile ne montrait que le TTS V1.
- `registerModuleVariant` (`onState`) : TTS V2, Tombola V2 puis D4 sortis de `ui.js`.
- Défauts trouvés en route :
  - `start()` absent sur TTS V2, ce qui faisait planter le dessin ;
  - P1 : écran vide en modérateur, trouvé par l'E2E et par la revue ;
  - la liste du Hub se refermait à chaque nouvel état (défaut ancien, visible des viewers) ;
  - deux E2E fragiles (tuile de carrousel cachée), consolidés.
- Revue indépendante de `50e8601` : 1 P1 et 1 P2, corrigés dans `2d9f7b2`. Le test du chemin rapide est vérifié par
  mutation.

## 05/11/2026 — Continuation : Soundboard, Bonk, cycle de vie

- E2E TTS intermittent : deux vraies causes (premier composer remplacé ; remboursements tardifs des lecteurs fictifs qui
  tombaient dans le test suivant). Aucune attente ajoutée : signal `data-recovered`, lecteurs qui acquittent.
- Soundboard : aperçu, retour d'envoi et vue dessinée sortis de `ui.js` ; deux défauts anciens du volume trouvés par le
  nouvel E2E (Échap inopérant après un nouvel état).
- Bonk : pile E2E avec fournisseurs fictifs dans le Lab Core ; E2E de parité ; ancien message au retour corrigé ; envoi
  sorti de `ui.js`.
- `lifecycle.e2e.ts` : transitions Hub sans rechargement, lectures arrêtées à la fermeture, coupure réseau, 3 rôles.
- Revue indépendante : 1 défaut réel et 1 test faible, corrigés (`d3e564a`).
- Pile E2E morte une fois en cours de série (`ERR_CONNECTION_REFUSED`, puis `fetch failed`) : non reproduite depuis ;
  journaux complets conservés à chaque série pour la prochaine occurrence.

## 05/11/2026 — Frontières Soundboard et Bonk

- Soundboard puis Bonk deviennent des variantes de module dans leurs fichiers ; les extensions du contrat (corps du
  module, en-tête, mémoire, services de l'hôte) servent les deux. `ui.js` 6 005 → 3444 lignes.
- Les E2E de parité, écrits avant, ont trouvé 6 défauts réels : tri et volume inutilisables à la souris, Échap avalé,
  prix Bonk faux dans le Lab, délai Bonk sans libellé, étoile couvrant l'emote sur les cellules de 44 px.
- Twitch fictif dans le Lab Core (OAuth, scope, catalogue) : le parcours Twitch de Bonk est testé sans Twitch.
- Outils : les skills navigateur / bureau n'ont pas d'outil branché dans cette session ; Playwright et les captures
  avant/après restent la vérification visuelle.

## 05/11/2026 — Chemins V1 de l'extension

- Vérifié qui affiche les V1 : jamais la Production pour la Tombola et la modération (le Core envoie toujours les V2),
  le TTS seulement en repli ; le Lab sans Core et le paquet de calibration toujours. Conservés.
- Harnais : l'extension en mode démo sur la pile E2E ; tests écrits avant chaque déplacement.
- TTS V1, Tombola V1, modération V1 en variantes ; le porte-monnaie d'en-tête lit le paiement déclaré. `ui.js` 1 642.
- Défaut trouvé : Échap ne fermait pas l'historique d'un utilisateur dans la console V1 (focus perdu) ; corrigé.
- Studio : Alertes en onglets (même contenu, rangé par tâche) ; Système débarrassé de la carte « Modules » trompeuse en
  Production ; Prêt pour le live replie ce qui est prêt.

## 05/11/2026 — Lab cible

- Décision d'Antoni : deux environnements (Lab local, Production VPS) ; staging gardé intact, sans maintenance.
- Le Core principal tourne en `CORE_ENVIRONMENT=lab` (gardes au démarrage) ; un seul assemblage pour Production et Lab.
- L'Extension Lab parle au vrai `/v1/ext` ; le transport Production de Studio fonctionne contre le Core Lab local :
  une interaction TTS complète passe sans aucune route `/v1/lab`.

## 06/11/2026 — Lab cible (suite)

- Choix d'Antoni : catalogues d'émotes réels en lecture seule, le reste fictif. 7TV / BTTV / FFZ publics = option du Core
  coupée par défaut ; Twitch fictif (un vrai catalogue Twitch demanderait un vrai compte et un secret d'app).
- `npm run studio` peut tourner sur le véritable Core en mode Lab (opt-in), avec le chemin du profil Production, le
  simulateur de chat sur la porte du bot (Lab seulement) et les modules en mode Lab (simulateur Spotify).

## 06/11/2026 — Parité du Lab sur le véritable Core

- Toutes les specs E2E tournent sur l'assemblage de Production ; premier passage 73/91, puis corrigé famille par famille.
- Défauts réels trouvés par cette parité : le Core disait toujours `twitch_connected: false` à l'extension (la liaison
  Twitch n'était jamais confirmée, en Production aussi) ; le build Studio sortait en erreur depuis `8ef2912`.
- Verrous : Electron reconnectait l'OBS enregistré et le Test Lab pouvait lancer le vrai bot : refusés dans ce Lab.
- Le retrait de l'ancien Lab attend la validation d'Antoni.

## 06/11/2026 — Mission STUDIO FOUNDATION COMPLETE

- Critères fixés dans `FOUNDATION_COMPLETE.md`, puis captures de toutes les pages sur un vrai serveur isolé, avant de toucher à
  l'interface.
- Constats principaux : TTS et Bonk sans page (renvoi à l'Extension Lab, absente en Production) ; Centre illisible ; bandeaux
  d'incidents sur toutes les pages ; catalogue sans état ; pied de barre tronqué (`box-sizing` absent de `.rs-side`) ; Test Lab et
  contrôles de vrai chat affichés dans un Lab où ils ne peuvent pas marcher ; style de l'aperçu Boutique inaccessible sur le Core
  principal (point dans le chemin, refusé par le cockpit).
- Lancer `npm run studio:lab` depuis le dépôt lisait le dossier de données du checkout : corrigé, le Lab a son dossier et sa base.
- Incident maîtrisé : un essai de la commande avec l'ancienne version du script (écriture refusée, non vue) a lancé Electron à
  côté du Studio installé. Le verrou d'instance l'a fermé aussitôt : pas de serveur, pas de Core, fenêtre du Studio installé
  seulement remise au premier plan. Le Studio installé a continué sans interruption. D'où le refus explicite (D32).

## 06/11/2026 — Recette UX/UI refusée, redesign intégral

- Antoni, après test dans Electron : meilleure navigation, mais pages internes héritées, formulaires techniques, textes
  envahissants, confirmations natives, débordements. Mission : vraie refonte du produit, sans conservatisme.
- Trois directions prototypées sur TTS, Tombola et Alertes avec une simulation commune : `prototypes/studio-redesign/`.
- Polices embarquées en local (OFL), pour que les prototypes et le futur Studio ne dépendent d'aucun réseau.
- Retour d'Antoni sur A, B, C : aucune retenue. Direction D conçue à partir de l'identité réelle du stream (site, overlays, DA Tombola,
  personnages TTS, vraies alertes) et de son métier d'animateur : ces références manquaient aux trois premières.

## 06-07/11/2026 — Refonte complète en direction D

- Coque, design system, modération native et toutes les pages refaites (`636872c`, `c6d6333`, `207df5f`, puis le commit d'harmonisation).
- L'audit de parité ([PARITE.md](PARITE.md)) a trouvé trois manques, corrigés, et sept retraits justifiés.
- L'agent d'harmonisation a été interrompu sans compte rendu. Son travail a été repris : audit de toutes les pages à trois tailles, corrections, suites complètes.
- Il avait supprimé `moderation.ts` et `moderation.css` hors consigne, après un refus du contrôle du mode auto : fichiers restaurés, décision laissée à Antoni.
- Vocabulaire : il avait aussi changé les Alertes en Ouvert / Fermé. Rétabli en Off / Test / Actif, le vocabulaire d'Antoni.
- Essai Electron réel avec `appData` redirigé et serveur Lab isolé : profil du Studio installé non touché.

## 07/11/2026 — consolidation

- Recette d'Antoni : direction D validée, migration non validée. Détail : [CONSOLIDATION.md](CONSOLIDATION.md).
- Audit de parité par comportement : [parite/direct.md](parite/direct.md), [parite/admin.md](parite/admin.md).
- Correction : le rapport précédent disait `Raid Titan.webm` introuvable ; il est dans la réserve du Studio installé.
