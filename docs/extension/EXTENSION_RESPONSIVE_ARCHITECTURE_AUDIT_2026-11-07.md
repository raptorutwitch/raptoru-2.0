# Extension Raptoru Live — audit responsive, architecture et conformité Twitch (07–08/11/2026)

Audit **en lecture seule** de `origin/main` `13ed6e8`. Rien n'a été modifié dans le code, l'extension publiée, le Studio
installé, la Production ni les données. Annexes détaillées (preuves fichier:ligne, sources, mesures) — et comparaison visuelle en taille réelle :
[v1-comparaison.html](audit-2026-11-07/v1-comparaison.html) ·
[A1 règles Twitch](audit-2026-11-07/A1-regles-twitch.md) · [A2 architecture](audit-2026-11-07/A2-architecture.md) ·
[A3 diagnostic responsive](audit-2026-11-07/A3-responsive.md) · [A4 matrice de mesures](audit-2026-11-07/A4-matrice-mesures.md) ·
[captures](audit-2026-11-07/captures/) · **[plan d'exécution de la refonte (08/11)](PLAN_REFONTE_EXTENSION_2026-11-08.md)**.

Méthode : documentation officielle Twitch consultée en ligne le 07/11 (URL dans A1) ; lecture du code et de l'historique Git ;
**mesures réelles** dans Chromium (Playwright) des trois surfaces rendues avec les données fictives de la version
« calibration » de l'extension (`apps/twitch-extension/calibration/`), sur ~40 tailles et 3 densités de pixels, 248 captures.
Ce qui n'a **pas** été fait : aucun test dans Twitch (Hosted Test), aucun appareil mobile réel, aucune mesure des écrans de
Wenhuir ou d'Ace of Spade (leurs dimensions ne sont pas connues).

---

## A. Résumé pour le streamer (2 minutes)

- **Est-ce faisable ?** Oui. Rien dans les règles Twitch n'empêche une extension qui s'adapte à la place réelle. Twitch le
  _demande_ même pour les composants et les pop-outs (« ne suppose aucune dimension »).
- **Pourquoi ça casse aujourd'hui ?** L'extension a été composée et validée pour **une seule taille** : 565×376 (ta mesure à
  65 %), auparavant 600×432. Tout est en pixels fixes et la racine ne défile jamais : ce qui ne tient pas est **coupé**, pas
  réarrangé. Mesuré : avec un zoom navigateur de 110 % le bouton « Confirmer » du TTS disparaît déjà ; à 125 % le bas du Hub
  aussi ; au réglage 60 % (521×347) la liste des participants de la Tombola est inaccessible. Sur grand écran (plein écran,
  mode théâtre) rien n'est coupé mais tout s'étire : zone de texte de 760 px, colonnes vides, textes restés minuscules.
- **Ta V1 peut-elle être préservée ?** Oui comme **équivalence de composition** : mêmes cartes, mêmes proportions, même densité
  autour de 565×376, légèrement réduite sur les petites fenêtres, plafonnée sur les grandes. Pas au pixel près partout : en
  dessous d'environ 85 % de la V1 le texte deviendrait illisible, il faut alors réarranger (pied d'action fixe, défilement
  explicite), jamais couper.
- **Wenhuir et Ace of Spade ?** Wenhuir (zoom 125–150 % signalé le 22/10) : son iframe fait probablement entre 380×250 et
  480×340 px CSS — c'est exactement la zone où tout casse aujourd'hui ; elle deviendra utilisable et équilibrée. Ace of Spade
  (grand écran) : la composition sera plafonnée et centrée au lieu de s'étirer. **À vérifier avec leurs vraies mesures** (§ K).
- **Twitch l'autorise-t-il ?** Oui. Les seules vraies contraintes : tout le code dans le zip (pas de CDN), le script Twitch
  chargé en premier, pas de script inline, le composant doit occuper toute son iframe, pas d'iframe imbriquée. Aucune n'empêche
  la solution recommandée, qui est du CSS natif.
- **La meilleure solution ?** Un **socle commun léger** (mesure de l'espace en un seul endroit, une échelle bornée, un cadre de
  vue « en-tête / contenu défilant / pied d'action toujours visible », des jetons de taille partagés) adopté **module par module**,
  en commençant par le TTS. Pas de `transform: scale()` global (texte flou, zones cliquables faussées, et c'est déjà ce que fait
  l'« Autoscale » de Twitch que tu as écarté en octobre pour son flou).
- **Faut-il tout reconstruire ?** Non. Les modules, les données et le Core restent. On refait le **cadre** et on adapte chaque
  vue à ses règles. Quatre bugs visibles aujourd'hui peuvent être corrigés avant, en petit lot.

**Verdict : faisable avec création d'un socle commun, et quelques concessions visuelles sous ~85 % de la V1** (§ L).

---

## B. Réalité de l'extension actuelle

| Fait                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Preuve                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Surfaces déclarées : **Composant vidéo** (`video_component.html`), **Panel** (`panel.html`), **Mobile** (`mobile.html`), Config. Pas d'overlay plein écran déclaré (console non lisible d'ici).                                                                                                                                                                                                                                                                                 | `scripts/build.mjs:22-27`, `README.md:13-15` (A2 § 1)              |
| La **surface principale sur ordinateur est le composant**, ouvert d'office à 100 % de son iframe. Le « tiroir » 300×360 sur la vidéo est un reste de l'ancien overlay, encore livré.                                                                                                                                                                                                                                                                                            | `overlay.js:25-26,142-148`, `overlay.css:98-123`                   |
| Panel et mobile = **le même script** (`mobile.js`) ; le panel ne diffère que par sa largeur 318 px.                                                                                                                                                                                                                                                                                                                                                                             | A2 § 1                                                             |
| Une seule coquille pour tout : `shared/ui.js` `createModulePanel`, qui **redessine tout le panneau** à chaque changement d'état, en préservant défilements, brouillons et la vue de module ouverte.                                                                                                                                                                                                                                                                             | `ui.js:1110-1113, 459-519`                                         |
| Registre de modules à trois entrées : modules du socle (`/modules/v3`), modules de session (Commandes, Roue, Événements), variantes V1/V2 (TTS, Tombola, Modération, Soundboard, Bonk).                                                                                                                                                                                                                                                                                         | `module-registry.js`, A2 § 3                                       |
| Réglage du composant : **60 % (README) ou 65 % (décision du 14/10)** — à confirmer dans la console. 60 % donne 521×347, une taille où la Tombola est coupée.                                                                                                                                                                                                                                                                                                                    | `README.md`, `docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md` § 4     |
| Version publiée : présumée `0bf7907` (22/10) ; zip Halloween `f1c9a7d` préparé, soumission non prouvée ; 44 commits d'extension depuis. **Non vérifiable d'ici** (console Twitch).                                                                                                                                                                                                                                                                                              | A2 § 2                                                             |
| ⚠ `npm run build` emballe encore l'**ancien EBS** (`raptoru.fr/api`). Le seul paquet de Production valide est `npm run build:production` (`core.raptoru.fr/v1/ext`). `OPERATIONS.md` § 7 et le README indiquent la mauvaise commande.                                                                                                                                                                                                                                           | `shared/runtime-config.js:4`, `build-staging.mjs:35-39`            |
| ⚠ Le checkout principal (dossier de données du Studio installé, resté sur `11ffe3f`) porte des modifications d'extension non commitées. La partie Roue du Sub est **déjà remplacée** dans `main`. Le **correctif « écran gris »** (bloqueur / boucliers : message récupérable au lieu d'un panneau vide après 10 s, `overlay.js`, `mobile.js`) n'existe que là et dans le commit de sauvegarde `99157a3` (branche locale `backup/roue-v2-wip-2026-10-25`), **pas dans `main`**. | `git diff` du checkout principal ; `git log -S` (vérifié le 08/11) |

Taille du code : `base.css` 16 477 lignes, `overlay.css` 5 778, `mobile.css` 5 033, ~1 380 tailles de police en `px` dont 368
sous 10 px ; aucune unité `rem`, 4 occurrences de container queries.

---

## C. Règles et contraintes Twitch

Sources consultées le 07/11/2026 (URL exactes et citations : A1). **O** = obligatoire (le non-respect bloque la review) ·
**R** = recommandé · **L** = liberté d'implémentation.

| Règle                                                                                                                                                                                           | Source                         | Cat.            | Conséquence pour Raptoru                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel : hauteur réglable **100–500 px** par version ; largeur 318 non réglable                                                                                                                  | life-cycle                     | **O** (console) | Le panel garde 318 de large ; on choisit la hauteur.                                                                                           |
| « 318 × 496 » : « pour éviter le défilement dans l'iframe », 10 px de marge intérieure                                                                                                          | designing                      | **R**           | Conseil de design, pas une limite ; contredit le maximum 500. Ne pas l'appliquer au composant.                                                 |
| Pop-out panel : l'iframe prend presque toute la fenêtre, redimensionnable ; « mise en page fluide… ne suppose aucune dimension » ; paramètre `popout=true`                                      | designing / building           | **R**           | Le panel aussi doit s'adapter (aujourd'hui figé à 318).                                                                                        |
| Composant : **doit utiliser toute la taille de l'iframe** (2.11) ; ne pas dupliquer l'interface du cadre (2.10)                                                                                 | guidelines-and-policies        | **O**           | Un « carré V1 centré dans du vide » serait contestable : la composition plafonnée doit occuper l'iframe (fond, panneaux), pas laisser un trou. |
| Réglages du composant (ratio, hauteur cible en % du lecteur, Autoscale / ScalePixels)                                                                                                           | forum 2019 seulement           | **?**           | Plus documentés sur dev.twitch.tv ; l'Autoscale existe (tu l'as testé : flou).                                                                 |
| Le Helper ne donne **aucune taille d'iframe** ; `onContext` donne `displayResolution`, `isFullScreen`, `isTheatreMode`, thème, langue ; `onPositionChanged` **supprimé** (changelog 08/06/2026) | reference, change-log          | **L**           | La mesure se fait dans la page (ResizeObserver / container queries) : c'est permis et c'est la seule voie.                                     |
| Script Helper `extension-files.twitch.tv/helper/v1/twitch-ext.min.js` dans chaque HTML, **en premier** (2.9)                                                                                    | guidelines                     | **O**           | Déjà fait ; le socle ne doit rien charger avant.                                                                                               |
| Tout le JS/CSS/HTML **dans le zip** ; scripts seulement depuis l'extension, extension-files et Google Analytics (2.8)                                                                           | guidelines, get started        | **O**           | Aucune librairie par CDN. Le socle doit être du code maison ou embarqué.                                                                       |
| Pas de script inline, pas d'`eval` (2.6) ; styles inline permis                                                                                                                                 | life-cycle, get started        | **O**           | Les variables CSS posées par JS (`style.setProperty`) restent permises.                                                                        |
| JS lisible (2.5) ; sinon code source exigé                                                                                                                                                      | guidelines                     | **O**           | Le code non minifié actuel convient.                                                                                                           |
| Pas d'iframe imbriquée (2.2) ; pas de raccourcis clavier (2.3) ; audio seulement avec volume, démarré muet (2.4) ; données AJAX validées avant le DOM (2.7)                                     | guidelines                     | **O**           | Soundboard / TTS : contrôle de volume et état muet à revérifier à la review.                                                                   |
| Liste blanche des domaines appelés (2.12)                                                                                                                                                       | guidelines                     | **O**           | Inchangée si le socle n'appelle que le Core.                                                                                                   |
| Sandbox : `allow-forms allow-scripts allow-same-origin allow-popups…` → **pas d'`alert`/`confirm`/`prompt`**, pas de navigation du parent                                                       | get started                    | **O**           | Toute confirmation est une modale maison (déjà le cas).                                                                                        |
| Mobile : optionnel ; si activé, tout visible **en portrait et paysage** (3.4), iOS 10+/Android 4.1+                                                                                             | guidelines                     | **O** si mobile | Le bug mobile TTS en paysage (§ D-5) est un risque de review.                                                                                  |
| Mobile : ≤ 1 Mo, < 3 s, cibles ≥ 44 pt                                                                                                                                                          | designing                      | **R**           | Cibles actuelles 12–18 px par endroits.                                                                                                        |
| Contraste, peu de tailles de police, thème clair/sombre                                                                                                                                         | designing                      | **R**           | Notre thème sombre fixe est un choix ; à assumer.                                                                                              |
| Developer Rig **arrêté** (fin de support janvier 2023) → Local Test puis **Hosted Test**                                                                                                        | product lifecycle, forum staff | fait            | Seul le Hosted Test reproduit le vrai CDN et la vraie CSP.                                                                                     |
| Review : 8–14 jours ; « Rejected » = définitif, Client ID révoqué                                                                                                                               | life-cycle                     | **O**           | Soumettre une version mûre, recettée en Hosted Test.                                                                                           |

Contradictions relevées dans la doc Twitch : 496 vs 500 ; deux CSP différentes (life-cycle ancienne, Get Started à jour du
31/07/2026) ; « fonts.google.com » vs exemple « fonts.googleapis.com » ; « Helper en premier » vs exemples officiels. Non
documenté : tailles en mode théâtre / plein écran / mobile, effet du zoom, format de `displayResolution`, limite de taille du zip.

---

## D. Diagnostic responsive (mesuré)

Classement par impact ; preuves fichier:ligne et captures dans A3 / A4.

| #   | Cause                                                                                                                                                 | Où                                                                                                        | Effet                                                                                                                              | Tailles touchées                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Colonnes fixes `1fr 250px` sans défilement dans `.ttsv2 {overflow:hidden}`                                                                            | `tts-v2.css:245`, `:243`                                                                                  | **« Confirmer · 7 500 J » et le choix de monnaie coupés : achat impossible**                                                       | hauteur < ~340, largeur < ~400 ; dès le zoom 110 % ([capture](audit-2026-11-07/captures/video-514x342@1.1-tts.png)) |
| 2   | `.rh-hub { min-height:330px }` dans une racine qui ne défile pas                                                                                      | `hub.css:19` + `overlay.css:5-10`                                                                         | Bas du Hub (Historique, « Voir tous les modules », « ? ») coupé ; sous 260 px le carrousel aussi                                   | hauteur < ~320 (zoom 125 %)                                                                                         |
| 3   | Racine `overflow:hidden` partout (`html, body.overlay`, `#panel.drawer__body`)                                                                        | `overlay.css:5-10, 98-123`                                                                                | Rien ne défile : tout ce qui dépasse est perdu ; le focus clavier peut même pousser l'en-tête hors de vue sans retour              | toutes les petites tailles                                                                                          |
| 4   | Fenêtre « compact-video » (≥ 521 large, 321–400 haut) mais grille Tombola à partir de 560 ; corps compact `overflow:hidden`                           | `tombola-v2.css:881, 995-1012`                                                                            | **Participants inaccessibles** ([capture](audit-2026-11-07/captures/video-521x347@1-raffle_join.png))                              | 521–559 de large — dont **521×347 = réglage 60 %**                                                                  |
| 5   | `body.mobile:has(.ttsv2) .m-body {height:100vh; overflow:hidden}` touche aussi le `.m-body` interne du TTS                                            | `tts-v2.css:11`, `tts-v2.js:302`                                                                          | Liste des personnages inaccessible en paysage ; flèches coupées à 360 px                                                           | mobile 844×390, 360×780                                                                                             |
| 6   | Aucune largeur max, colonnes fixes complétées par `1fr`, tailles figées en px                                                                         | tous les CSS de module                                                                                    | Grands écrans : composition étirée et vide, textes restés à 9–13 px ([capture](audit-2026-11-07/captures/video-867x578@1-tts.png)) | ≥ ~750 de large (théâtre, plein écran)                                                                              |
| 7   | Seuils propres à chaque vue (TTS par classe de page, Modération 560/900 en JS, Commandes 520, Tombola 560, Soundboard 400 de haut, Hub 340/460 en JS) | A3 § 1.2                                                                                                  | Une vue peut basculer en compact pendant que sa voisine non : incohérences                                                         | partout                                                                                                             |
| 8   | Cibles et textes minuscules                                                                                                                           | Bonk (poignée 40×12, effacer 15×39), étoiles Soundboard 18×18, lignes Modération 17 px, textes Hub 8,5 px | Difficile au doigt et en zoom                                                                                                      | toutes tailles                                                                                                      |
| 9   | Règles fluides `clamp(…vh…)` **mortes** : elles visent `.jdm-*`, absentes des pages                                                                   | `overlay.css:120-345`, requêtes de `base.css`                                                             | Bruit de maintenance, fausse impression de responsive                                                                              | —                                                                                                                   |

Ce qui va bien : popovers bornés à l'écran ; Soundboard et Bonk ne coupent rien ; le redimensionnement en direct donne le même
résultat qu'un chargement neuf ; le panel 318×496 tient (cibles mises à part).

**Zone réellement couverte aujourd'hui** : environ 540–620 × 340–420 px CSS autour de 565×376. Les viewers réels vont
d'environ **380×250** (portable + zoom 150 %) à **1050×700** (plein écran) — hypothèse de calcul en A3 § 3.

---

## E. Analyse des solutions

| Approche                                                         | Pour                                                                                                                                                                                                                                                                                                                                                                                          | Contre (réels, pas théoriques)                                                                                                                                                                                                                                                                                                                                                                                                                               | Verdict                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| **A. Échelle uniforme** (`transform: scale` d'un cadre 565×376)  | Reproduit la V1 « en capture »                                                                                                                                                                                                                                                                                                                                                                | Texte rastérisé ou rééchantillonné (flou, déjà constaté avec l'Autoscale Twitch) ; la taille de layout reste 565×376, donc les popovers, `getBoundingClientRect`, `position:fixed` et le défilement calculent dans un repère faux ; à 0,67 (zoom 150 %) le texte de 9 px devient **6 px** et les cibles de 18 px deviennent 12 px ; **annule le zoom que le viewer a choisi pour mieux lire** ; en grand écran agrandit tout de 50 % (ce que tu ne veux pas) | **Rejetée** comme mécanisme principal |
| **B. Responsive classique** (flex, grid, media queries, `clamp`) | Natif, net, accessible                                                                                                                                                                                                                                                                                                                                                                        | Seul, il réarrange librement et s'éloigne vite de la V1 ; ×7 modules si chacun choisit ses seuils (déjà le cas, § D-7)                                                                                                                                                                                                                                                                                                                                       | Nécessaire mais pas suffisant         |
| **C. Responsive à échelle contrôlée** (hybride)                  | Une échelle **de mise en page** (pas une transformation) : les tailles (police, espacements, rayons, cibles) sont `calc(base × k)` avec `k` = place disponible / V1, **bornée** (≈ 0,85 → 1,15) ; texte net, zones cliquables vraies ; sous le plancher, des **profils** de mise en page (compact, étroit) réarrangent sans couper ; au-dessus du plafond, composition centrée et largeur max | Il faut convertir les tailles des vues migrées en jetons ; demande une discipline commune                                                                                                                                                                                                                                                                                                                                                                    | **Recommandée**                       |
| **D. Plusieurs compositions** (normale, compacte, mobile)        | Lisible                                                                                                                                                                                                                                                                                                                                                                                       | Si ce sont des copies : triple maintenance. Utile seulement comme **profils** d'un même composant (c'est le « profil » de C)                                                                                                                                                                                                                                                                                                                                 | Intégrée à C                          |
| **E. Autoscale Twitch** (ScalePixels)                            | Zéro code                                                                                                                                                                                                                                                                                                                                                                                     | Flou (testé le 14/10), plus documenté officiellement, agrandit aussi en grand écran                                                                                                                                                                                                                                                                                                                                                                          | Écartée                               |

Réalisation de C sans framework : `container-type: size` sur la racine de vue ; unités de container (`cqw`, `cqh`) et `clamp()`
pour calculer `k` **en CSS pur**, ou un unique `ResizeObserver` dans le shell qui pose `--k` et `data-profile` sur la racine
(utile si l'on veut une hystérésis entre profils). Les container queries et unités `cq*` sont prises en charge par les navigateurs
actuels (Chrome 105+, Safari 16+, Firefox 110+) ; **ce n'est pas une garantie** pour toutes les webviews mobiles : prévoir une
valeur par défaut (`k = 1`, profil normal) si elles manquent. Les navigateurs ne permettent pas à l'iframe de distinguer
proprement « zoom navigateur » et « petite fenêtre » (`devicePixelRatio` mélange zoom et mise à l'échelle Windows) — et ce n'est
pas nécessaire : on répond à la **taille utile en px CSS**, avec un plancher de lisibilité qui respecte le zoom choisi.

### Scénarios de refonte (Partie 9 de la mission)

Notes relatives de 1 (faible) à 5 (fort).

| Critère                             | A. Corriger l'existant module par module | B. Shell commun + migration progressive | C. Refonte complète                 | **D. Hybride recommandé** : lot de correctifs immédiats, puis B avec un module pilote |
| ----------------------------------- | ---------------------------------------- | --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| Fidélité V1                         | 4                                        | 4                                       | 2 (risque de nouvelle direction)    | 4                                                                                     |
| Petites fenêtres                    | 3                                        | 5                                       | 5                                   | 5                                                                                     |
| Grandes fenêtres                    | 2                                        | 4                                       | 4                                   | 4                                                                                     |
| Conformité Twitch                   | 5                                        | 5                                       | 4 (nouvelles dépendances possibles) | 5                                                                                     |
| Mobile                              | 3                                        | 4                                       | 4                                   | 4                                                                                     |
| Risque de régression                | 2 (faible)                               | 3                                       | 5 (élevé)                           | 2, puis 3                                                                             |
| Complexité / effort                 | 2                                        | 3                                       | 5                                   | 1, puis 3                                                                             |
| Maintenabilité                      | 2 (7 systèmes de seuils restent)         | 4                                       | 4                                   | 4                                                                                     |
| Ajout de modules / remake d'onglets | 2                                        | 5                                       | 5                                   | 5                                                                                     |
| Retour arrière                      | 5                                        | 4 (variantes)                           | 2                                   | 5, puis 4                                                                             |

A répare vite mais garde la dérive actuelle ; C coûte beaucoup sans rien apporter que B ne donne ; **D** sert les viewers tout
de suite (les 4 bugs bloquants) et construit le socle sur un cas réel avant de toucher aux modules complexes.

---

## F. Architecture modulaire proposée (le « shell » de l'extension)

**Ce que le shell centralise** (et rien de plus) :

1. **Mesure et profil** : un seul observateur de taille → `--k` (échelle bornée) et `data-profile` (`normal`, `compact`, `etroit`,
   `large`) sur la racine. Les modules ne mesurent plus la fenêtre eux-mêmes (les seuils en JS de Modération, Hub, TTS disparaissent).
2. **Jetons de taille** : police, espacements, rayons, cibles minimales (`--t-…`, `--s-…`, `--hit` ≥ 32 px CSS au profil normal),
   exprimés en `calc(base × var(--k))` ; plancher de police explicite.
3. **Cadre de vue** : en-tête (retour, titre, portefeuille) · **contenu qui défile** · **pied d'action toujours visible** (le bouton
   d'achat/validation ne peut plus être coupé). La racine ne cache plus jamais un débordement : elle défile en dernier recours.
4. **Primitives déjà présentes à consolider** : modale, popover borné, toast, état vide / chargement / erreur (`ui-primitives.js`).
5. **Cycle de vie** : `mount(node, ctx) → { onState, destroy }` (le contrat `{node, start, destroy}` du socle existe déjà) ;
   nettoyage des écouteurs et minuteurs du shell (aujourd'hui jamais retirés : `ui.js:215, 332, 356`).

**Ce qui reste au module** : sa composition interne (grille de sons, file TTS, carrousel Bonk, tableau de modération), ses
seuils de **contenu** (ex. nombre de colonnes de sons) exprimés via le profil, ses animations.

**Ce que le shell ne fait pas** : pas de nouveau framework, pas de virtual DOM, pas de changement de l'API Core, pas de règle
métier. Le redessin complet de `ui.js` reste (il préserve déjà défilement et brouillons) ; on change ce qu'il dessine.

| Module                                                  | Difficulté d'adoption | Pourquoi                                                                                                                          |
| ------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Coffre (démo socle), Commandes, Roue du Sub, Événements | Simple                | Déjà isolés (Commandes / Roue : Lab seulement côté Core)                                                                          |
| **TTS V2**, **Tombola V2**                              | Moyen                 | Vues autonomes mais colonnes fixes, détection de surface par classe, code Tombola encore dans `ui.js`                             |
| **Soundboard**, **Bonk**                                | Complexe              | Dessinent dans le corps et l'en-tête du shell, CSS réparti sur 4 feuilles, instances dans `host.memory`, service d'emotes partagé |
| **Modération D4** (1 916 lignes)                        | Complexe              | Application dans l'application : 3 modes de largeur, pop-out, bascule Commandes                                                   |
| Hub                                                     | Complexe              | C'est la navigation elle-même                                                                                                     |
| Tombola V1, Modération V1, TTS V1                       | —                     | Probablement inatteignables (le Core force V2) ; à confirmer avant tout retrait (§ K)                                             |

Remake d'onglet : le registre de **variantes** (V1/V2) existe et permet de remplacer une vue par une autre sans toucher au Core ;
mais seule la variante TTS sait réellement retomber sur l'ancienne. Une nouvelle vue migrée peut donc être livrée comme
**variante** (bascule possible), ce qui sert de filet de sécurité.

---

## G. Compatibilité avec le Core

Le Core reste l'unique autorité : il revérifie chaque achat (prix, solde, cooldown, droits). L'extension **affiche** en revanche des
valeurs qu'elle recalcule elle-même (A2 § 6) : prix et paliers TTS (`tts-v2.js:118-158`, et `ttsBuy` n'envoie pas le prix
attendu), prix par défaut et cooldown Soundboard (`soundboard-view.js:209-225`), méthodes de paiement codées en dur
(`wallet-payment.js:5-25`), crédits de l'en-tête additionnés localement (`ui.js:1214-1222`), « remboursable » recalculé
(`moderation-v2.js:1320`), prix de salve Bonk, « pas assez de Bonbons » (Événements). Risque : **un affichage qui diffère de ce
que le Core fera**, pas une perte d'argent. La refonte doit afficher ce que le Core renvoie et passer `expected_price` partout
(le mécanisme `purchase.js` existe, utilisé seulement par le Coffre). Ce n'est pas un préalable au responsive, mais chaque vue
migrée doit le faire au passage.

---

## H. Fidélité visuelle à la V1

**Ce qu'on sait de la V1** (mesuré par toi le 14/10 en Hosted Test) : composant **565×376 px CSS** (65 %, ratio 3:2, Autoscale
OFF), lecteur ≈ 1029×579 px CSS ; tu préférais la composition du rendu **651×434** (75 %), recomposée nativement dans 565×376.
Les prototypes validés ont été capturés à **600×432**. **Inconnu** : le zoom / la mise à l'échelle Windows et la taille de fenêtre
de ta mesure (le HUD les affichait, le document ne les note pas).

**Stratégie** :

- La V1 = la composition 565×376 actuelle, à `k = 1`. On la capture comme **référence** (une capture par vue et par état).
- **De 565 à ~480 de large** (k ≥ 0,85) : réduction proportionnelle seule — même grille, mêmes groupes ; c'est là que la V1 est
  préservée « telle quelle ».
- **Sous ce plancher** : profil compact — marges réduites, colonne secondaire repliable (personnages TTS, participants
  Tombola en volet), titres secondaires raccourcis, contenu défilant, pied d'action fixe. Jamais une fonction cachée sans
  signe visible.
- **Au-dessus de ~650 de large** (k plafonné ≈ 1,15) : la composition grandit un peu puis s'arrête ; l'espace en plus sert à des
  colonnes **utiles** (plus de sons par ligne, file TTS visible à côté) ou à des marges maîtrisées ; les panneaux occupent toute
  l'iframe (règle 2.11).
- Les rapports internes (carte/bouton/texte) sont garantis par les jetons : tout est `base × k`, donc les proportions restent.

---

## I. Protocole de validation

**Matrice** (composant, px CSS) : 380×250 · 452×301 (zoom 125 %) · 480×320 · 514×342 (110 %) · **521×347** (60 %) ·
**565×376** (V1) · 600×432 · 651×434 (75 %) · 750×500 · 867×578 (théâtre) · 1053×702 (plein écran), chacune à dpr 1 / 1,25 / 1,5.
Panel : 318×300 / 318×496 / pop-out 400×700 et 800×900. Mobile : 360×780, 390×844, 430×932, paysage 844×390.

**Rôles × états** : non connecté, viewer, modérateur, supermod ; vide, chargement, erreur, solde insuffisant, texte TTS de
2 000 caractères, pseudo très long, 70 sons, 200 participants.

**Critères automatiques** (le script de mesure de l'audit en est la base, A3 § 0) : aucun élément d'action **coupé par un
ancêtre `overflow`** (pas seulement « pas de défilement horizontal ») ; bouton principal de chaque vue entièrement visible ;
police ≥ plancher ; cibles ≥ seuil ; popovers dans la fenêtre ; navigation atteignable au clavier ; aucun défilement parasite de
la racine ; écart à la référence V1 mesuré sur des captures comparatives à k = 1.

**Étapes** : 1) Lab local (données fictives de la calibration, Playwright) ; 2) **Local Test** Twitch ; 3) **Hosted Test** avec la
version calibration (HUD de taille) sur ton PC **et** chez Wenhuir et Ace of Spade (comptes de test) ; 4) mobile réel (iOS et
Android, si le mobile reste activé) ; 5) soumission. Le Developer Rig n'est plus supporté : ne pas s'en servir.

**Performance** : un seul `ResizeObserver` (ou du CSS pur), aucune mesure dans les boucles de rendu, pas de librairie ajoutée ;
contrôler la taille du zip et le temps de premier affichage (recommandation mobile : ≤ 1 Mo, < 3 s).

---

## J. Plan de réalisation proposé (après ta validation)

| Lot                                      | Contenu                                                                                                                                                                                      | Validation                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **0. Préalables** (petits)               | Confirmer le réglage console (60/65 %) ; corriger la commande de build dans `OPERATIONS.md`/README ; décider du sort du correctif « écran gris » non commité ; identifier la version publiée | Doc à jour, console relue par toi                                     |
| **1. Correctifs immédiats** (sans socle) | TTS : pied « Confirmer » toujours visible ; Hub : retirer le `min-height` bloquant ; Tombola : aligner 521/560 ; mobile TTS : sélecteur `.m-body` ; racine qui défile en dernier recours     | Matrice I sur ces vues ; Hosted Test ; **publication possible seule** |
| **2. Référence V1**                      | Captures de référence à 565×376 de chaque vue/état ; mesures réelles de Wenhuir et d'Ace (build calibration)                                                                                 | Dossier de référence versionné                                        |
| **3. Shell** (worktree isolé)            | Mesure + `--k` + profils, jetons, cadre de vue, nettoyage du cycle de vie ; démonstration sur le Coffre                                                                                      | Matrice complète sur le Coffre                                        |
| **4. TTS** (module pilote)               | Migration complète, affichage des prix du Core, `expected_price`                                                                                                                             | Matrice + comparaison V1 + ta recette                                 |
| **5. Tombola, Hub**                      | Migration                                                                                                                                                                                    | idem                                                                  |
| **6. Soundboard, Bonk**                  | Migration (sortir leur CSS de `base.css`/`overlay.css`)                                                                                                                                      | idem                                                                  |
| **7. Modération D4**                     | Migration, 3 modes → profils du shell                                                                                                                                                        | idem, en modérateur et supermod                                       |
| **8. Panel, pop-out, mobile**            | Même shell ; panel fluide en pop-out                                                                                                                                                         | Appareils réels                                                       |
| **9. Nettoyage ciblé**                   | Règles `.jdm-*` mortes, tiroir d'overlay inutilisé (sur ton accord)                                                                                                                          | Zip plus léger                                                        |
| **10. Recette et soumission**            | Hosted Test complet, puis review Twitch                                                                                                                                                      | Ta validation, puis Twitch                                            |

Une **preuve de concept isolée** (lot 3 sur le Coffre + le TTS du lot 4) est recommandée avant de s'engager sur les modules
complexes : elle tranche la question des jetons et des profils sur un cas réel en peu de temps. Retour arrière : chaque vue migrée
peut rester une **variante** basculable ; l'extension publiée n'est remplacée qu'après Hosted Test et ta validation. La
possibilité de remettre en ligne une ancienne version approuvée depuis la console Twitch **n'est pas vérifiée** : à confirmer
avant la première soumission (sinon, le retour arrière passe par une nouvelle version soumise).

---

## K. Décisions qui te reviennent

> **Tranché le 08/11** (Antoni) : référence artistique **651×434** ; réglage console vérifié à **65 %** ; plancher initial
> 0,85 ; correctifs avant le socle ; mobile conservé ; anciennes vues gardées temporairement ; mesures réelles préparées sans
> bloquer le socle. Suite et nouvelles décisions : [plan d'exécution](PLAN_REFONTE_EXTENSION_2026-11-08.md). Mesures
> ajoutées le 08/11 : couverture CSS (`base` 5,0 %, `overlay` 4,2 %, `mobile` 2,2 % utilisés) et charge initiale
> (≈ 2,2 Mo JS + CSS, 54 modules avant le Hub), plan § 7.

1. **Référence V1** : 565×376 actuel (k = 1), ou la composition du 651×434 que tu préférais ?
2. **Plancher d'échelle** : ~0,85 (lisibilité prioritaire, réarrangement en dessous) ou plus bas (V1 plus fidèle, texte plus petit) ?
3. **Ordre** : lot 1 (correctifs immédiats, publiables vite) avant le socle — recommandé — ou directement le socle ?
4. **Mesures réelles** : peux-tu obtenir de Wenhuir et d'Ace of Spade une session Hosted Test avec la version calibration (comptes
   ajoutés comme testeurs) ? Sans elles, leurs cas restent des estimations.
5. **Mobile** : garder la vue mobile activée (et donc la recetter sur appareils réels) ou la limiter au panel ?
6. **Variantes V1** (TTS, Tombola, Modération) : les garder comme filet ou les retirer après migration ?

---

## L. Verdict

**Faisable avec création d'un socle commun, avec des concessions visuelles limitées sous ~85 % de la V1.**

- Rien n'est interdit par Twitch : la solution est du CSS natif embarqué, sans dépendance, sans script inline, et le composant
  continue d'occuper toute son iframe.
- Scénario recommandé : **D** (correctifs immédiats, puis shell commun et migration progressive à partir du TTS). La correction
  seule (A) garderait 7 systèmes de seuils et la dérive actuelle ; la refonte complète (C) n'apporte rien que le socle ne donne,
  pour beaucoup plus de risque.
- La V1 est préservée là où elle peut l'être (≈ 480–650 px de large) ; en dessous, la lisibilité impose de réarranger ; au-dessus,
  on plafonne. Un pixel-perfect sur toutes les tailles n'est ni possible sans flou ni souhaitable (il annulerait le zoom de lecture
  des viewers).
- Limites honnêtes : tailles réelles de Wenhuir et d'Ace inconnues ; aucun test fait dans Twitch ; réglage console non lu ;
  version publiée non prouvée.
