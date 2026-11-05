# Refonte de Raptoru Studio — contexte (source de vérité)

Ordre de lecture d'une nouvelle session : [CHECKPOINT.md](CHECKPOINT.md) → ce document → [ROADMAP.md](ROADMAP.md).
L'historique détaillé est dans [JOURNAL.md](JOURNAL.md). Les règles générales du dépôt (`CLAUDE.md`, `docs/REPRISE.md`)
priment.

## 1. Objectif

Faire de Raptoru Studio (l'app Electron du PC qui administre, crée, modère et pilote le stream) un outil de nouvelle
génération : navigation claire, une destination par fonctionnalité, ateliers guidés, régie live opérationnelle, état
réel toujours visible, frontières Production / Lab / Simulation / Aperçu sans ambiguïté, et une structure qui accueille
les futurs modules sans être reconstruite. Ce n'est pas un simple habillage : les parcours et l'organisation changent,
les capacités métier restent.

## 2. Historique des décisions

| Date | Décision | Source |
|---|---|---|
| 04/11 | Étude UX/UI d'Astra : diagnostic, architecture cible, charte (partie F), lots de migration (§ E.4). | [étude](../RAPTORU_STUDIO_UX_UI_2026-11-04.md) |
| 04/11 | GO de la refonte en Lab, par lots, sans validation intermédiaire ; aucune Production ni release Studio implicite. | Antoni |
| 04/11 | Direction et lots 0-4 validés « en Lab » comme direction (pas comme validation manuelle d'écran). Continuer en autonomie. | Antoni |
| 04/11 | Questions métier Défis : documentées, règles inchangées pour l'instant (§ 13). | Antoni |
| 04/11 | **Tout Studio peut être refondu**, prototypes validés compris : un prototype validé fixe un fonctionnement, pas une interface. Capacités métier conservées. | Antoni (consolidation) |
| 04/11 | Studio doit accueillir les futurs modules sans nouvel onglet principal ni nouvelle charte (§ 9). | Antoni |
| 04/11 | Le Laboratoire, en particulier l'**Extension Lab**, est essentiel : mieux organisé, jamais dégradé ni supprimé. | Antoni |
| 04/11 | Catégories strictes **PRODUCTION / LAB / SIMULATION / APERÇU LOCAL** selon le comportement technique réel (§ 7) ; simulations inutiles ou trompeuses à éliminer progressivement après vérification des usages. | Antoni |
| 04/11 | **Audit fonctionnel** (démarrages, cycle du live, automatisations, réglages) : [AUDIT_FONCTIONNEL.md](AUDIT_FONCTIONNEL.md). La refonte devient fonctionnelle autant que visuelle ; principes au § 17. Arbitrages métier H1-H16 en attente. | mission d'Antoni |
| 05/11 | **H1-H16 tranchés** (§ 18) ; GO pour le développement autonome **en Lab** (aucune Production, aucune publication). | mission d'Antoni |

## 3. Problèmes du Studio initial (résumé Astra, non réaudité)

- 15 onglets à plat dans une barre supérieure, dont des outils de test au même niveau que les modules du live.
- Plusieurs grands bandeaux d'incidents empilés qui repoussaient le contenu ; libellés d'état parfois faux (« paiement
  simulé » affiché en Production, mentions SAMMI après son abandon).
- Défis : slug, condition et date facultative au même niveau ; un recomptage (qui verse de vraies récompenses) présenté
  comme une actualisation.
- Points de chaîne : une page très longue qui contenait aussi Spotify, Random Ban, Caution, Votekick, Roue du Sub.
- Boutique : création, ventes, achats et dons mélangés sur une page.
- Responsive absent (défilement horizontal, barre rognée), styles globaux partagés (`.card`, `button`, `.row`).
- Détail : [étude Astra](../RAPTORU_STUDIO_UX_UI_2026-11-04.md) parties A-B ; captures d'origine
  `docs/assets/studio-ux-actuel-*.jpg`.

## 4. Architecture technique existante (inchangée par la refonte)

- **Core** (`apps/core-api`, Coolify/VPS) décide de tout : économie (Wallet, Jetons), règles, progression, défis,
  cosmétiques, files. **Bot** (`apps/twitch-bot`) parle à Twitch (EventSub, chat). **Extension** Twitch
  (`apps/twitch-extension`) pour les viewers. **Site** raptoru.fr (dépôt séparé). **OBS** piloté par Studio (sources
  navigateur, WebSocket).
- **Studio** = `apps/studio/desktop` (Electron) + `apps/studio/server` (serveur local Node : routes `/api/*`, proxy vers
  le Core du profil, lecteurs OBS, Lab EBS) + `apps/studio/web` (interface TS/Vite/DOM, sans framework).
- Profil Studio : **Lab** (Core local, données isolées) ou **Production** (Core de Production appairé). Le profil
  effectif est lu sur le serveur local et affiché par `studio-profile.ts` (`.rs-profile[data-profile]`).
- Le checkout principal `Documents\Raptoru 2.0` est le dossier de données du Studio installé : jamais de `git clean`,
  `reset --hard`, `checkout .`.

## 5. Architecture UX retenue

Six destinations + un Laboratoire séparé (registre `apps/studio/web/src/shell/registry.ts`) :

| Destination | Rôle | Contenu actuel |
|---|---|---|
| Centre de contrôle | Accueil : santé, incidents, favoris, récents, préparation du live | hub |
| Régie live | Pendant le stream : état réel des files, coupures nommées, accès aux contrôles | hub + Modération |
| Modules | Catalogue de toutes les fonctionnalités, par groupes (Sons & voix, Alertes & points de chaîne, Jeux & tirages, Effets & mise en scène, Interactions à sanction, Musique, Commandes du chat, Événements saisonniers) | hub + pages modules |
| Communauté | Viewers, progression, boutique, défis | hub + Progression, Boutique, Défis |
| Activité | Incidents et historiques | hub |
| Système | Profil, Core, bot, comptes Twitch, OBS, lecteurs, runtime | ancien accueil Studio |
| **Laboratoire** (à part, bas de barre) | Simulation, Test Lab, Extension Lab | hub + vues |

Règles de navigation : barre latérale 232 px (tiroir sous 900 px), ≤ 6 favoris (défaut : Tombola, Alertes, Récompenses
Twitch, Défis), récents (6), palette **Ctrl+K** qui ouvre des pages et n'exécute jamais d'action, fil d'Ariane ≤ 3
niveaux, adresse canonique `?p=<page>` (+ paramètres de vue, ex. `surface=`), anciens `?tab=<vue>` gardés comme alias,
historique navigateur. Supervision compacte : une ligne par incident sous l'en-tête, « Vu » conservé, pastille santé.

## 6. Design system (charte Astra partie F, appliquée)

- Jetons `--rs-*` dans `apps/studio/web/src/shell/shell.css` : surfaces (canvas `#0f1416`, barre `#12191c`, surface
  `#182126`, relief `#202b31`), bordures, texte (`#eef3f1` / muted / dim), accent menthe Raptoru `#83dfc1` (encre
  `#0e241c`), états succès / alerte `#f0c780` / danger `#ff9797` / info `#9ecbff`, focus `#c2a9ff` (2 px, décalage 3 px).
  Segoe UI ; rayons 12 px (panneaux) / 8 px (contrôles).
- Primitives `rs-` (tout nouveau code les utilise, aucune règle globale sur `.card`, `.row`, `button`) : `rs-page`,
  `rs-page-head`, `rs-head-row`, `rs-back`, `rs-flash`, `rs-chip is-<état>`, `rs-panel`, `rs-cols`, `rs-tiles`/`rs-tile`,
  `rs-rows`/`rs-row`, `rs-tbl` + `rs-scroll`, `rs-form` + `rs-fields` (2 colonnes, `span2`), `rs-step` (sections
  numérotées), `rs-check`, `rs-unit`, `rs-note`, `rs-warn`, `rs-adv` (paramètres repliés), `rs-dl` (résumé), `rs-seg`
  (onglets segmentés), `rs-filters`, `rs-btn` (`primary`, `danger`, `quiet`, `sm`), `rs-live`/`rs-live-card` (Régie),
  `rs-state is-ok|is-down|is-unknown`, `rs-muted`, `rs-sr`.
- Pont avec les vues historiques : dans le shell, leurs variables (`--bg`, `--card`, `--accent`…) prennent les jetons de
  la charte. **C'est un habillage, pas une refonte** (voir ROADMAP).

## 7. Production / Lab / Simulation / Aperçu (règle stricte)

Classer selon ce que fait **techniquement** l'action, pas selon le nom de l'écran :

| Catégorie | Définition | Exemples actuels |
|---|---|---|
| **PRODUCTION** | Core de Production : données et opérations réelles (Jetons, sanctions Twitch, OBS du stream, achats). Portée dite avant d'agir. | Profil Production : Défis (activation, recomptage), Boutique (remboursement, dons), coupure des points de chaîne, Tombola |
| **LAB** | Environnement isolé (Core local, base locale) : opérations réelles **sur des données isolées**. Pas une simulation. | Profil Lab ; pile E2E en mémoire |
| **SIMULATION** | Événements ou données artificiels injectés pour tester un comportement (peuvent traverser le vrai circuit). | « Envoyer dans la file » des Alertes, chat simulé, live simulé |
| **APERÇU LOCAL** | Rendu des vrais composants sans exécution métier. | Aperçu des alertes, aperçu raptoru.fr des cosmétiques, « Écouter » un son d'effet, Extension Lab (Lab EBS local) |

Règles : ne jamais présenter une simulation ou un aperçu comme connecté à la Production ; ne jamais masquer un état
inconnu derrière un statut rassurant (« État inconnu », « Supervision indisponible ») ; jamais de donnée inventée
présentée comme réelle ; aucune simulation ne modifie soldes, récompenses, sanctions, équipements, achats, paramètres
actifs ou files OBS de Production ; ne pas relier un aperçu local au Core de Production sans autorisation explicite.

**Inventaire à classer (non encore audité en détail, ROADMAP lot 9)** :

| Outil | Comportement relevé | Classement provisoire |
|---|---|---|
| Extension Lab (`extension-lab.ts`) | Extension de production servie par Studio dans des cadres Twitch réalistes, contexte Twitch simulé, Lab EBS local, Jetons fictifs ; ne peut joindre que ce Studio (CSP). | Aperçu local + simulation — **essentiel, à garder** |
| Widget « Simulation de stream » (`simulation.ts`, barre du haut) | Mélange live simulé, **ingestion du vrai chat Twitch** et **sortie réelle dans le chat par LeCroupier_**, mini-jeux. En Production : live simulé retiré et interrupteur mini-jeux annoncé réel avec confirmation (`0675b9b`). | **Ambigu** : actions réelles sous le nom « Simulation » → à séparer (lot 9) |
| Vue Simulation (`simulation-tab.ts`) | Simulateur de chat (identités, rôles), mêmes interrupteurs que le widget. | Simulation utile ; à regrouper |
| Test Lab (`test-lab.ts`) | « Temporary » : services locaux (Postgres, Core 3000, bot, auth), test de présence. En Production : seuls les arrêts sont permis (`cde6c4f`) : un bot démarré ici tournerait hors du bail du Core de production. | Diagnostic réel / historique → à auditer |
| Aperçu Alertes | Moteur réel dans une iframe, sans file. | Aperçu local |
| « Tester » d'une récompense (Récompenses Twitch) | Exécute la règle enregistrée **pour de vrai** (OBS, Soundboard, effets, Spotify sans mode à blanc ; crédits et Random Ban à blanc). | Action réelle — libellé à clarifier (audit P0-6) |
| Random Ban « Tester » | Tirage à blanc, jamais de timeout. | Simulation (lecture Twitch réelle) |
| Spotify, onglet simulateur (Lab) | Simulateur du module en profil Lab. | Simulation utile |

## 8. Le Laboratoire et l'Extension Lab

- Le Laboratoire (bas de la barre) regroupe Simulation, Test Lab, Extension Lab. L'ouvrir ne change pas le profil.
- **Extension Lab** : surfaces `panel`, `video` (composant vidéo), `mobile`, `config` ; rôle (viewer, modérateur…),
  identité Twitch partagée ou non ; les actions acceptées sont jouées sur la scène locale (son, voix TTS, Bonk, Tombola).
  Adresses directes : `?p=extension-lab&surface=video` (le shell clique le bouton de surface). Les cartes Lab TTS et Bonk
  y vivent (`?p=tts`, `?p=bonk` ouvrent la surface `panel`). Les surfaces gardent les tailles Twitch (larges par nature).
- À garder et améliorer (organisation, lisibilité) ; jamais supprimé pour simplifier la navigation.

## 9. Ajouter un module (convention)

1. Choisir sa destination selon l'usage réel (une des six, ou Laboratoire) — **jamais un septième onglet principal**.
2. Déclarer une page dans `PAGES` (`registry.ts`) : `id`, `label`, `section`, `group` (Modules), `icon`, `desc`,
   `keywords`. Elle apparaît alors dans la barre / le catalogue / Ctrl+K / le fil d'Ariane.
3. Vue : soit une nouvelle vue (`mountX(root) → { setVisible, setFocus? }`) montée **une fois** dans `main.ts`
   (`VIEW_IDS`), soit une partie d'une vue existante (`view` + `anchor`, la vue implémente `setFocus`, comme les modules
   réglés dans Récompenses Twitch). Ne jamais monter deux fois une vue ni recopier un handler : la Régie, la recherche et
   les favoris mènent à la même page.
4. Interface en primitives `rs-` ; un nouveau fichier pour un écran significatif (le fichier central ne fait que câbler).
5. Actions sensibles : confirmation qui dit la portée réelle (Core, versement, remboursement, Production) ; catégorie
   § 7 visible quand elle change le sens de l'action.
6. Tests : `apps/studio/server/test/studio-shell.test.ts` vérifie que chaque vue est atteignable et que les alias
   tiennent ; ajouter un test du module et, si le parcours est critique, un E2E sur la pile isolée.

## 10. Charte d'évolution (règles durables)

- **Navigation** : un module = une destination canonique ; tous les accès y mènent ; aucune duplication de handler.
- **Conception** : tout module peut être repensé, fusionné, déplacé ; conserver les comportements utiles ≠ conserver
  l'ancienne interface. Ne jamais retirer une capacité réelle parce qu'elle est difficile à intégrer.
- **Extensibilité** : nouvelles fonctionnalités dans les six destinations ou le Laboratoire ; pas de généricité
  prématurée (pas de moteur de formulaires abstrait tant que trois écrans ne le justifient pas).
- **Cohérence** : composants et jetons du design system ; pas de nouvelle charte par fonctionnalité.
- **Simulation** : portée technique toujours identifiée ; aucune donnée inventée présentée comme réelle ; aucun état
  inconnu masqué.
- **Tests** : une amélioration graphique ne casse pas une interaction ; une simulation utile reste possible ; parcours
  économiques, OBS et Twitch testés en priorité (E2E sur pile isolée, données fictives).
- **Évolution** : nouveaux modules, rapprochements et outils sans reconstruire la navigation.

## 11. Comportements à conserver absolument

Contrats du Core, du Wallet, des routes `/api/*`, de l'extension et des lecteurs OBS ; permissions et confirmations
existantes ; idempotence des achats / dons / versements ; Tombola (pause, reprise, annulation, tirage, overlay) ;
modération D4, sanctions, remboursements ; files TTS / alertes / Spotify ; règles figées d'un défi activé ;
anciennes adresses `?tab=` ; Extension Lab et les simulations utiles ; séparation Lab / Production.

## 12. Contraintes de sécurité et de travail

- Aucun push, merge, déploiement, migration distante, release Studio, changement de flag ou action OBS / Twitch /
  Wallet de Production sans GO explicite d'Antoni. « Validé » = testé à la main par Antoni.
- Dépôt public : jamais de nom, identifiant ou achat de viewer réel ; données fictives seulement.
- Ne jamais créer de contenu métier (défis, montants, cosmétiques) à la place d'Antoni.
- SAMMI est abandonné : ne jamais le réintroduire.
- Fichiers à ne pas toucher : modifications non commitées d'autres sessions (ex. worktree `site-hub-core`).

## 13. Décisions ouvertes

1. **Défis — objets récompense masqués / archivés** : le Core les accepte (`status <> draft AND active`) ; la méta ne
   donne pas leur statut. Filtrer `published && active` ou assumer.
2. **Défis — fuseau** : dates en heure du PC (affiché), la Boutique utilise Europe/Paris. Aligner ?
3. **Défis — reprise après suspension** : peut compter les événements survenus pendant la suspension (dit dans la
   confirmation). Gel ou rattrapage ?
4. **Storyboard** : introuvable (dépôt, branches, `prototypes/`, ancien dossier Raptoru, Bureau, Téléchargements, le
   04/11). Aucun équivalent inventé ; Antoni doit dire ce qu'il désigne.
5. Classement final des outils de simulation (§ 7) et sort du Test Lab « temporaire ».
6. ~~Arbitrages de l'audit fonctionnel H1-H16~~ : **tranchés le 05/11**, voir § 18.

## 14. Emplacements

| Quoi | Où |
|---|---|
| Shell, registre, icônes, Régie, styles de la charte | `apps/studio/web/src/shell/` (`shell.ts`, `registry.ts`, `icons.ts`, `regie.ts`, `shell.css`) |
| Montage des vues | `apps/studio/web/src/main.ts` |
| Vues refondues | `challenges.ts/.css`, `cosmetics.ts/.css`, `channel-points.ts/-view.ts/.css`, `progression.ts/.css` |
| Serveur local, routes | `apps/studio/server/src` |
| Tests unitaires | `apps/studio/server/test` (vitest) — `studio-shell.test.ts` pour le shell et la Régie |
| E2E navigateur | `apps/studio/server/e2e` (Playwright ; pile isolée `lab-stack.ts`) |
| Étude Astra (référence historique, ne pas réécrire) | `docs/RAPTORU_STUDIO_UX_UI_2026-11-04.md`, maquette `docs/RAPTORU_STUDIO_UX_UI_2026-11-04.prototype.html`, images `docs/assets/studio-ux-*` |
| Copie d'origine des livrables Astra | `Documents\Codex\2026-11-04\files-pasted-by-the-user-raptoru\outputs\` |
| Captures de revue (données fictives) | `docs/studio-refonte/captures/` |
| Aperçu en un clic | `dev/apercu-refonte-studio.cmd` |

Branche `feat/studio-ux` (locale, non poussée), partie de `docs/site-hub-delivered` (68420a0, elle-même sur `main`
8a897a5). Worktree : `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux`.

## 15. Commandes

```text
# depuis le worktree studio-ux
npm run build -w @raptoru/schemas            # une fois (types partagés)
npm run build -w @raptoru/studio-web         # build de l'interface
cd apps/studio/web    && npx tsc -p tsconfig.json                 # typecheck
cd apps/studio/server && npx vitest run test/studio-shell.test.ts # tests shell + Régie
cd apps/studio/server && npx playwright test challenges cosmetic progression-studio halloween alerts
npx prettier --end-of-line auto --check <fichiers> ; npx eslint <fichiers>
dev\apercu-refonte-studio.cmd                # aperçu navigateur, pile isolée, données fictives
npm run studio                               # vrai Studio Electron (profil Lab)
```

Pièges connus : PowerShell `Get-Content`/`Set-Content` corrompt l'UTF-8 (passer par Python ou l'outil d'écriture) ;
Prettier exige `--end-of-line auto` (checkout CRLF) ; E2E instables sous charge, à relancer seuls : `effects-player`,
`tombola-bonbons`, `alerts` « families », `progression-studio`.

## 16. Références

`docs/REPRISE.md` (point d'entrée général) · `docs/ROADMAP.md` (modules du projet) · `docs/ARCHITECTURE.md` ·
`docs/OPERATIONS.md` · `docs/CHALLENGES.md` · `docs/COSMETIC_SHOP.md` · `docs/CHANNEL_POINTS_V1.md` ·
`docs/COMMANDS_V2_STATUS.md` · `docs/ASTRA_GLOBAL_AUDIT_2026-10.md`.

## 17. Principes fonctionnels (audit du 04/11, structurants)

Détail et preuves : [AUDIT_FONCTIONNEL.md](AUDIT_FONCTIONNEL.md).

- **Grille d'états unique** (§ B.1 de l'audit) :
  - axes : Disponibilité (autorisé / bloqué par le serveur) · Intention (activé / en pause / désactivé) · Constat (prêt /
    en attente + dépendance / erreur / inconnu) · Activité (en cours ou non) · Démarrage (permanent / avec le live /
    manuel) ;
  - **une intention ON ne s'affiche jamais en vert si le constat n'est pas « prêt »** ;
  - la grille étend le `ModuleStatus` du Centre de contrôle, sans nouveau modèle.
- **L'intention vit dans le Core, le constat est recalculé** par les fournisseurs du Centre de contrôle. Pas de moteur
  générique de déclencheurs ni de workflows ; des règles explicites par module.
- **Variables d'environnement = plafond de sécurité**, base = intention réglable dans Studio : migration progressive des
  interrupteurs de comportement (P2-2). Une variable qui bloque un module s'affiche comme « bloqué par le serveur ».
- **Une seule vérité du live à terme** (P2-1) : le live simulé n'existe qu'en profil Lab. Depuis `0675b9b`, le serveur
  Studio le refuse en Production.
- **Aucun démarrage automatique de tirage, vote ou ouverture** au début du live (recommandation H7) ; seule la
  préparation du live est automatique, et elle est en lecture seule.
- **Un test réel se déclare réel** jusqu'au bout : libellé, confirmation, portée.
- **Cotes et tables de gains** restent dans le code ; prix, recharges, durées et limites deviennent réglables avec des
  bornes côté Core (H10).
- Tant qu'un arbitrage H n'est pas tranché, **le comportement métier actuel est conservé**. Depuis le 05/11, les seize
  sont tranchés (§ 18) ; une règle métier hors de ces décisions ne change jamais en silence.

## 18. Décisions métier validées le 05/11 (H1-H16)

Antoni a tranché les seize arbitrages de l'audit (§ H) et donné son GO pour les mettre en œuvre **en Lab uniquement**.
Rien n'atteint la Production sans nouvelle autorisation explicite (déploiement, migration, release, extension).

| # | Décision | Mise en œuvre |
|---|---|---|
| H1 | Interactions payantes liées au stream **uniquement en live** (Soundboard, TTS, Bonk, Chaos, `!rb`, Caution, Votekick, Spotify, effets de points de chaîne) ; refus avant débit, source de live canonique. Pas la Boutique, le Wallet, le Daily, la fidélité. Aucun contournement en Production ; tests en Lab. | à faire |
| H2 | Travaux OBS des points de chaîne non commencés : **expiration à 2 min**, remboursement unique quand c'est possible. | codé, testé |
| H3 | Alertes : **30 min**, commande « Vider la file » (en attente seulement). | codé, testé |
| H4 | TTS : **5 min** (au lieu de 30). | codé, testé |
| H5 | StreamElements : **ACTIVE repris en Production** au redémarrage (Lab : TEST). | codé, testé |
| H6 | Spotify en fin de live : fermer, annuler les non commencées, **rembourser** quand c'est possible, jamais deux fois. | à faire |
| H7 | Activités ponctuelles **manuelles** (aucun démarrage automatique nouveau). | rien à coder (comportement actuel) |
| H8 | Jeu des mots : **ON/OFF durable**, intervalle réglable (5-15 min par défaut). | codé, testé |
| H9 | Fidélité `tier_unknown` : **taux de base immédiat, complément différé** une seule fois. | à faire |
| H10 | Prix, recharges, durées, limites **réglables** (§ D.3 Essentiels), bornes Core ; jamais cotes ni tables de gains. | à faire |
| H11 | « Exécuter maintenant (réel) » et aperçu distincts ; Spotify à blanc. | codé, testé |
| H12 | Bonk : prix et recharge réglables, **valeurs actuelles du Core** par défaut. | à faire |
| H13 | Roue : choix V1/V2 en **paramètres avancés** ; bug de frontière corrigé séparément. | codé, testé |
| H14 | Daily : **paliers réglables**, heure fixe. | à faire |
| H15 | « Annoncer mes Level Up » **masqué**. | codé (extension à publier par Antoni) |
| H16 | Moteur des Défis : **état réel affiché**, jamais activé d'ici. | codé, testé |

« Codé, testé » = tests automatiques seulement. Rien n'est validé par Antoni ni publié. État détaillé : ROADMAP.

