# Extension Raptoru Live — plan d'exécution de la refonte (08/11/2026)

Plan issu de l'[audit du 07–08/11](EXTENSION_RESPONSIVE_ARCHITECTURE_AUDIT_2026-11-07.md) et des décisions d'Antoni du 08/11.
**Rien n'est implémenté.** Ce document est le cahier des charges des futures missions : chaque lot s'exécute sans
réinventer l'architecture ; une mission qui veut s'en écarter le dit et le justifie avant de coder.

Base : `origin/main` `13ed6e8`. Faits mesurés le 08/11 sur le code réel (données fictives de la calibration, Chromium) :
annexes de l'audit et § 12 ci-dessous.

---

## 0. Décisions prises (Antoni, 08/11)

| #   | Décision                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Référence artistique = la composition 651×434** (profil normal actuel). Ce n'est pas un changement de réglage Twitch.                                                                                           |
| 2   | **Réglage console = 65 %** (vérifié par Antoni) : l'iframe réelle est ≈ 565×376 chez Antoni, et varie chez chaque viewer.                                                                                         |
| 3   | Refonte architecturale profonde autorisée, **sans réécriture gratuite** ; pas de framework ou de techno choisis pour moderniser.                                                                                  |
| 4   | **On reconstruit la mécanique, pas l'identité** : direction artistique, cartes, animations, navigation, densité et proportions conservées. Tout changement visuel important est justifié par une contrainte.      |
| 5   | Responsive hybride : échelle bornée (plancher initial ≈ 0,85, à vérifier), réorganisation sous le plancher, plafond au-dessus ; jamais de `transform: scale()` global.                                            |
| 6   | Socle commun pour l'extension, équivalent de Studio Coulisses, sans framework maison.                                                                                                                             |
| 7   | Mobile conservé, puis amélioré sur le même socle.                                                                                                                                                                 |
| 8   | Les 4 correctifs bloquants, le filet de sécurité contre les contenus coupés et le correctif « écran gris » (ciblé, sans l'ancienne Roue du Sub) forment un lot initial séparé. `99157a3` et sa branche préservés. |
| 9   | Builds sécurisés par des **protections techniques**, pas par une consigne.                                                                                                                                        |
| 10  | Calibration Hosted Test préparée, **non publiée**, aucun viewer sollicité pour l'instant ; elle ne bloque pas le socle.                                                                                           |
| 11  | Production intacte : worktree isolé depuis `main`, ni Core, ni bot, ni Studio installé, ni version Twitch publiée ; aucun contrat économique modifié.                                                             |

---

## 1. Architecture cible

### 1.1 Principes

1. **Pas de framework, pas de bundler.** Modules ES natifs servis tels quels : c'est ce que Twitch relit (code lisible,
   règle 2.5), ce que le Lab sert octet pour octet (`studio/server/src/extension-lab/serve.ts`) et ce qui marche déjà.
   Les besoins réels (chargement à la demande, mises à jour ciblées du DOM) se couvrent avec `import()` dynamique et ~100
   lignes d'utilitaires, comme `patch`/`keyed` dans Studio (`apps/studio/web/src/ds/ds.ts`). Option bon marché :
   `// @ts-check` + `tsc --noEmit` sur les nouveaux fichiers (types sans build).
2. **Surface ≠ profil.** La surface (composant vidéo, panel, pop-out, mobile, config) vient de la page et des paramètres
   Twitch ; elle décide du comportement (cadence de relevé, fermeture, modules permis). Le **profil** de mise en page vient
   uniquement de la **taille CSS réellement disponible**. Aujourd'hui les deux sont confondus (classes `body`, seuils 520,
   560/900 et 340 en JS, 7 systèmes de seuils : audit § D-7).
3. **Une seule mesure.** Un `ResizeObserver` sur la racine pose `--kg`, `--kt`, `data-profile` et `data-surface`. Aucun
   module ne mesure la fenêtre.
4. **Le shell possède la plomberie, le module sa composition.** Le shell fournit le cadre (en-tête, corps défilant, pied
   d'action), les composants, l'état, le cycle de vie. Le module garde sa mise en page interne, ses animations et ses classes.
5. **Le Core décide.** Le shell affiche ce que le Core renvoie ; aucune règle métier nouvelle côté extension ; les
   requêtes économiques restent **identiques octet pour octet** (vérifié par des « requêtes de référence », § 10).
6. **Remplaçable par morceaux.** Le nouveau shell héberge les vues non migrées via le contrat hôte existant ; chaque vue
   migre seule ; l'ancien shell reste emballé jusqu'à la fin pour le retour arrière.

### 1.2 Couches

```
HTML (4 pages, noms inchangés)  →  app/boot.js        Twitch : helper, JWT, contexte, visibilité, garde « écran gris »
                                   app/surface.js     surface + paramètres (anchor, platform, popout, studio, demo*)
                                   app/layout.js      ResizeObserver → --kg, --kt, data-profile (hystérésis)
                                   app/store.js       session/état, relevés (poller), horloge 1 s partagée, abonnements
                                   shared/api.js      client Core existant (JWT, Idempotency-Key, retry, 8 s) — conservé
                                   app/shell.js       routeur Hub ↔ module, en-tête, porte-monnaie, notifications,
                                                      préférences, tutoriel, restrictions, toasts
                                   app/host.js        contrat hôte existant (ctx.host) déplacé depuis ui.js, pas réécrit
                                   app/frame.js       cadre de vue : en-tête · corps défilant · pied d'action
                                   app/ui/*.js        composants partagés (§ 4)
                                   app/registry.js    registre (vues du socle, de session, variantes) + chargement à la demande
                                   modules/<id>/      vue migrée : view.js + <id>.css (+ modèle si nouveau)
```

### 1.3 Contrat d'une vue migrée

Extension du contrat déjà en place (`{node, start, destroy, onState, attached}`, CONTRATS § 10–13), pas un nouveau système :

```js
// modules/tts/index.js — seule ligne ajoutée ailleurs : l'entrée du registre
registerView({
  id: 'tts',
  match: (env) => env.state?.module?.tts_v2 === true, // les règles d'apparition actuelles, inchangées
  styles: ['modules/tts/tts.css'], // injecté par le shell au premier montage
  wallet: { label: 'TTS', credits: (s) => /* existant */ 0 },
  load: () => import('./view.js'), // chargé à la demande
});
// modules/tts/view.js
export function mount({ frame, store, client, host, surface }) {
  frame.title('TTS');
  frame.body.append(/* composition propre au module */);
  frame.footer.set(/* ligne de paiement : toujours visible */);
  const off = store.watch('tts', render); // relevé partagé, suspendu hors écran et au démontage
  return { onState: render, destroy: () => off() };
}
```

Règles : une vue ne lit pas `window.innerWidth`, ne crée pas d'intervalle hors `store` (horloge partagée), ne pose pas de
classe sur `body`, ne dessine pas dans l'en-tête du shell hors des emplacements du cadre (`frame.headAfter`, `frame.headIcon`,
qui remplacent les points d'entrée actuels de Soundboard et Bonk).

### 1.4 Rendu

Le shell actuel reconstruit tout le panneau à chaque état (`ui.js:1110-1113`) puis restaure défilement et brouillons. Le
nouveau shell dessine son chrome **une fois** et met à jour des emplacements (solde, badges, puces). Les vues gardent leur
nœud et reçoivent `onState`. Les listes vivantes (file TTS, participants, sons, historique, tables D4) passent par un
`keyed()` qui ne remplace que les lignes changées : focus, survol, défilement et saisies restent en place sans mécanisme de
restauration.

---

## 2. Structure des fichiers et responsabilités

État actuel : 63 293 lignes HTML/CSS/JS, dont `base.css` 16 477, `overlay.css` 5 778, `mobile.css` 5 033, `unicode-emojis.js`
9 648, `ui.js` 1 642, `moderation-v2.js` 1 916 ; 16 Mo d'assets (twemoji 7,6 Mo, sons 4,3 Mo, TTS 1,2 Mo).

| Chemin cible                                                               | Contenu                                                                                                                                                                                                                                                                       | Origine                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `panel.html`, `mobile.html`, `video_component.html`, `config.html`         | Inchangés de nom (chemins déclarés en console). Helper Twitch en premier, puis feuilles du shell, puis `app/boot.js`.                                                                                                                                                         | existants, allégés                                                         |
| `app/boot.js`                                                              | Remplace la logique dupliquée d'`overlay.js` et `mobile.js` (auth, relevé, visibilité, reprise, garde « écran gris »).                                                                                                                                                        | fusion des deux (≈ 320 l. aujourd'hui)                                     |
| `app/surface.js`                                                           | `video` / `panel` / `popout` / `mobile` / `config` ; paramètres `anchor`, `platform`, `popout`, `studio`, `demoModule`, `demoScenario`, `labRole`, `labIdentity`.                                                                                                             | règles éparpillées (`overlay.js:25-26`, `panel-view`, seuils 520)          |
| `app/layout.js`, `app/tokens.css`, `app/shell.css`                         | Mesure et profils ; jetons ; reset minimal et cadre.                                                                                                                                                                                                                          | nouveau ; valeurs reprises des feuilles actuelles                          |
| `app/store.js`                                                             | État de session (`/session` + `/state`), `poller` commun, horloge 1 s partagée, pause hors écran.                                                                                                                                                                             | `overlay.js`/`mobile.js` + intervalles des vues                            |
| `app/shell.js`, `app/host.js`, `app/hub.js`                                | Navigation, chrome, Hub « Pop Premium » (même rendu), contrat hôte.                                                                                                                                                                                                           | extraits de `ui.js` (Hub `1356-1504`, hôte `257-311`, `run` `564-642`)     |
| `app/frame.js`, `app/ui/*.js`, `app/ui.css`                                | Cadre de vue et composants du § 4.                                                                                                                                                                                                                                            | `ui-primitives.js` (conservé et complété) + doublons locaux regroupés      |
| `app/registry.js`                                                          | `registerView` / `registerSessionModule` / `registerModuleVariant` + `load` dynamique.                                                                                                                                                                                        | `module-registry.js` (même contrat)                                        |
| `modules/<id>/view.js`, `<id>.css`                                         | Une vue migrée : composition + **toutes** ses règles CSS (profils compris) dans une feuille.                                                                                                                                                                                  | règles réécrites depuis base/overlay/mobile + feuille du module            |
| `shared/*` (modèles, client, services)                                     | Restent en place tant qu'on n'a pas besoin de les modifier : `api.js`, `purchase.js`, `currency.js`, `notifications.js`, `emote-access.js`, `emote-picker.js`, `unicode-emojis.js`, `*-model.js`, `tts-characters.js`, `tts-calibration.js`, `experience.js`, `demo-data.js`. | inchangés (pas de déplacement gratuit)                                     |
| `legacy/` (temporaire)                                                     | Ancien shell et feuilles `base/overlay/mobile.css`, servis seulement si le shell « legacy » est choisi ; retirés au lot 6.                                                                                                                                                    | `ui.js`, `overlay.js`, `mobile.js`, CSS historiques                        |
| `scripts/package.mjs`, `scripts/targets.mjs`, `scripts/verify-package.mjs` | Emballage unique (production / staging / calibration), cibles autorisées, vérification d'un zip.                                                                                                                                                                              | `build-staging.mjs` + `build-calibration.mjs` ; `build.mjs` supprimé       |
| `test/responsive/`                                                         | Banc de mesure (serveur, `audit.mjs`, matrice, balayage, captures de référence, requêtes de référence).                                                                                                                                                                       | scripts de l'audit (aujourd'hui hors dépôt, dossier temporaire de session) |

Préfixe CSS du socle : `rx-` (absent du code actuel). Les modules **gardent leurs classes** (`ttsv2`, `tmbx`, `sbx`,
`rh-`…) : on réécrit leurs règles, pas leur JS, ce qui limite le diff et le risque.

---

## 3. Stratégie responsive autour du 651×434

### 3.1 Deux échelles, pas une

- **Géométrie** `--kg = clamp(0.85, min(L/651, H/434), 1.15)` : espacements, rayons, tailles de cartes, d'icônes, de
  vignettes, hauteurs de rangées. Les traits de 1 px ne sont pas mis à l'échelle.
- **Texte** `--kt = clamp(0.95, min(L/651, H/434), 1.10)` et planchers absolus : **aucun texte sous 10 px**, corps ≥ 12 px.
  Raison : à 565×376 (le vrai 65 %), une échelle unique donnerait `0,866` et ramènerait les textes actuels de 9–11 px à
  7,8–9,5 px ; et un viewer qui zoome pour mieux lire verrait son zoom annulé. Le texte suit donc la composition de loin.
- Calcul en JS (un `ResizeObserver`) : le CSS ne sait pas encore diviser une longueur par une longueur de façon portable.
  Valeurs par défaut en CSS (`--kg: 1; --kt: 1`, profil normal) si le script échoue.
- Hystérésis de ± 8 px sur les changements de profil (pas de clignotement pendant un redimensionnement).

### 3.2 Profils

| Profil      | Condition (px CSS de la racine)            | Comportement                                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **normal**  | paysage, `0,85 ≤ min(L/651, H/434) ≤ 1,15` | La composition 651 réduite ou agrandie **à l'identique** : même grille, mêmes groupes, mêmes rapports.                                                                                                                                                                                          |
| **compact** | paysage, `< 0,85`                          | `--kg` bloqué à 0,85. Corps défilant, pied d'action fixe, en-tête resserré ; la colonne secondaire (personnages TTS, participants Tombola, file) devient un **volet** ouvert par un bouton visible quand la largeur ne la permet plus. Rien de caché sans signe.                                |
| **large**   | paysage, `> 1,15`                          | `--kg` bloqué à 1,15 (composition ≤ 749×499). L'espace en plus va à des zones **utiles** déclarées par le module (colonnes de sons en plus, file TTS visible, liste de participants plus large) ; sinon marges maîtrisées. Le fond et les panneaux occupent toute l'iframe (règle Twitch 2.11). |
| **étroit**  | portrait (H ≥ L) ou L < 360                | Composition empilée actuelle du panel et du mobile, référence 390 de large, `--kg = --kt = 1`.                                                                                                                                                                                                  |

Modificateur `data-touch` (surface mobile ou `pointer: coarse`) : cibles principales ≥ 44 px, secondaires ≥ 32 px
(recommandation Twitch mobile). Partout ailleurs : ≥ 24 px (WCAG 2.5.8).

### 3.3 Ce que cela donne aux tailles connues

| Situation                     | Iframe   | Rapport | Profil           | `--kg` | `--kt` |
| ----------------------------- | -------- | ------- | ---------------- | ------ | ------ |
| 75 % (référence)              | 651×434  | 1,00    | normal           | 1,00   | 1,00   |
| **65 % (réglage actuel)**     | 565×376  | 0,87    | normal           | 0,87   | 0,95   |
| 60 %                          | 521×347  | 0,80    | compact          | 0,85   | 0,95   |
| 65 % + zoom 110 %             | 514×342  | 0,79    | compact          | 0,85   | 0,95   |
| 65 % + zoom 125 %             | 452×301  | 0,69    | compact          | 0,85   | 0,95   |
| 65 % + zoom 150 % (Wenhuir ?) | 377×251  | 0,58    | compact          | 0,85   | 0,95   |
| Mode théâtre 1080p (hyp.)     | 867×578  | 1,33    | large            | 1,15   | 1,10   |
| Plein écran 1080p (hyp.)      | 1053×702 | 1,62    | large            | 1,15   | 1,10   |
| Panel                         | 318×496  | —       | étroit           | 1      | 1      |
| Mobile portrait               | 390×844  | —       | étroit           | 1      | 1      |
| Mobile paysage (hyp.)         | 844×390  | 0,90    | normal + tactile | 0,90   | 0,95   |

**Conséquence assumée du choix 651** : au 65 %, on verra la **densité du 651** réduite, donc moins d'éléments à la fois
qu'aujourd'hui (≈ 5 participants au lieu de 7, ≈ 14 sons au lieu de 20) et un peu plus de défilement. C'est la
composition que tu préférais le 14/10.

### 3.4 Règles de mise en page communes

- La racine ne coupe plus jamais : elle défile en dernier recours (`overflow: auto`, `overscroll-behavior: contain`).
- Le cadre de vue est une grille `auto / minmax(0, 1fr) / auto` : en-tête, corps défilant, pied d'action. Le bouton
  d'achat ou de validation est **dans le pied**, donc jamais coupé.
- Pas de hauteur minimale fixe sur un conteneur de page ; les colonnes fixes deviennent `minmax(min, idéal)` × `--kg`.
- Les seuils de **contenu** d'un module (nombre de colonnes de sons, etc.) s'expriment par profil ou par container query
  locale (`@container`, supporté par le WebView iOS 16.4 minimum de l'app Twitch), jamais par une media query de fenêtre.
- Popovers et menus bornés à l'iframe (déjà le cas). **Pas d'attribut `popover` ni d'ancrage CSS** : absents d'iOS 16.4.
  `<dialog>` natif autorisé (pas `alert`/`confirm`/`prompt`, interdits par le sandbox).
- `prefers-reduced-motion` géré une fois dans `app/shell.css`.

---

## 4. Composants réellement mutualisables

Recensés dans le code actuel (doublons réels, pas hypothétiques) :

| Composant                    | Remplace                                                                                                                        | Utilisé par                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Cadre de vue (`frame`)       | en-têtes et corps propres à chaque vue, `ownHeader`, `headIcon`, `headAfter`, `data-scroll-key`                                 | toutes les vues                                   |
| En-tête porte-monnaie        | `ui.js:1178-1301` + `createCurrencySwitch` / `createWalletFace` (conservés)                                                     | Hub, TTS, Soundboard, Bonk, Événements, Coffre    |
| Bouton d'achat               | `purchase.js` (deux temps, une clé par intention) généralisé ; aujourd'hui seul le Coffre l'utilise                             | TTS, Soundboard, Bonk (salve), Événements, Coffre |
| Dialogue (`<dialog>`)        | tutoriel `ui.js:644-756`, restrictions, dialogues D4, emotes Twitch Bonk, confirmation Événements                               | 6 implémentations                                 |
| Popover / menu               | « Voir tous les modules », préférences, notifications, menus tri/filtre/volume Soundboard, listes D4                            | ≈ 8 implémentations                               |
| Feuille (`sheet`)            | feuilles D4, historique, centre de notifications                                                                                | 3                                                 |
| Toast                        | `flash()` de `ui.js` + toasts locaux de Bonk, Commandes, D4, Événements, Soundboard                                             | 6 implémentations                                 |
| États                        | chargement, vide, erreur récupérable, Core injoignable, autorisation en attente, identité non partagée, module fermé / en pause | toutes les vues                                   |
| Puces et pastilles           | puces de restriction, `.lpill`, puces du Hub                                                                                    | Hub, Roue, D4                                     |
| Contrôle segmenté / onglets  | onglets D4, filtres Soundboard, choix de monnaie                                                                                | 3                                                 |
| Champ de recherche           | Soundboard, Commandes, D4, sélecteur d'emotes                                                                                   | 4                                                 |
| Compte à rebours             | intervalles 1 s de Tombola, Événements, cooldowns, restrictions → horloge partagée du `store`                                   | 5                                                 |
| Relevé (`poller`)            | relevés TTS 2 s, Tombola 1/3 s, D4 2 s, Événements 5 s, Coffre 5 s                                                              | 5                                                 |
| Défilement texte (`marquee`) | `hover-marquee.js` (conservé)                                                                                                   | Soundboard, Hub                                   |

**Non mutualisés** (propres au module, conservés) : scène et sprites TTS, grille Soundboard, chargeur et sélecteur Bonk,
tirage Tombola, tables D4, carrousel du Hub (`hub-carousel.js`, conservé tel quel).

---

## 5. Desktop et mobile

- **Même code, compositions différentes.** Le panel et le mobile partagent déjà `mobile.js` ; le composant vidéo partage
  `ui.js`. Demain une seule entrée (`app/boot.js`), un seul shell ; la différence est le profil (étroit) et la surface
  (tactile, pas de Commandes sur le panel, `↻` remplacé par le relevé).
- Chaque vue migrée livre **ses quatre profils dans le même lot** (normal, compact, large, étroit) : le mobile n'est pas un
  lot final.
- Le mobile garde sa composition actuelle (empilée) ; ce qui change : défilement sain (bug § D-5 corrigé à la racine),
  cibles tactiles, composants partagés.
- Pop-out du panel (`popout=true`) : profil selon la taille, comme le composant.
- Validation sur vrais appareils (iOS ≥ 16.4 et Android) en Hosted Test, au lot 3 (TTS pilote) puis au lot 5.

---

## 6. À conserver

| Élément                                                                                                                                                                    | Pourquoi                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Identité visuelle : palettes, dégradés, rayons, ombres, 73 animations (`@keyframes` : Bonk 14, Tombola 10, TTS 9, Soundboard 7…)                                           | c'est la décision 4 ; inventaire par vue, chaque animation gardée ou remplacée **nommément** |
| `shared/api.js`                                                                                                                                                            | JWT, `Idempotency-Key`, retry avec la même clé, budget 8 s : correct et testé                |
| Modèles purs testés (`bonk-model`, `soundboard-model`, `commands-v2-model`, `currency`, `tts-characters`, `tts-calibration`, `events-shop` logique, `bonk-chargeur-model`) | 15 fichiers de tests vitest ; aucune raison de les toucher                                   |
| `purchase.js`, `notifications.js`, `emote-access.js`, `emote-picker.js` (+ `picker.css`), `hub-carousel.js`, `hover-marquee.js`, `experience.js` (thèmes)                  | fonctionnent, contrats propres                                                               |
| Contrat de registre (variantes, modules de session, modules du socle) et `ctx.host`                                                                                        | déjà le bon découpage ; déplacé, pas réécrit                                                 |
| Logique des vues TTS V2, Tombola V2, D4, Événements, Soundboard, Bonk                                                                                                      | on change leur cadre et leur CSS, pas leur comportement                                      |
| Fixtures de calibration, `demo-data.js`, HUD                                                                                                                               | base du banc de tests                                                                        |
| Logique d'emballage de `build-staging.mjs` (zip STORED, noms sûrs, refus des URL héritées)                                                                                 | acceptée par Twitch                                                                          |
| Clés `localStorage` (`raptoru-live:*`, `tts-v2-preview-calibration`)                                                                                                       | les favoris, ordres et notifications des viewers survivent                                   |

## 7. À reconstruire

| Élément                                                            | Mesure qui le justifie                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fondation CSS `base.css` + `overlay.css` + `mobile.css` (≈ 978 Ko) | **Couverture mesurée le 08/11** (7 vues × 3 surfaces × 10 tailles, menus ouverts) : 5,0 %, 4,2 % et 2,2 % des octets servent. 2 414 + 1 839 + 1 619 `!important`. Les règles utiles sont réécrites sur les jetons dans la feuille de chaque module ; le reste disparaît au lot 6. |
| Shell (`ui.js` `createModulePanel`)                                | reconstruction totale à chaque état, écouteurs jamais retirés, Hub et routage mêlés                                                                                                                                                                                               |
| Entrées `overlay.js` / `mobile.js`                                 | même logique écrite deux fois (d'où le correctif « écran gris » à poser deux fois)                                                                                                                                                                                                |
| Détection de surface et seuils                                     | 7 systèmes concurrents                                                                                                                                                                                                                                                            |
| Chargement                                                         | **≈ 2,2 Mo** de JS + CSS non compressés et 54 modules chargés **avant** le Hub, sur chaque surface, dont `unicode-emojis.js` (Bonk seulement). Cible : ≤ 700 Ko pour afficher le Hub, le reste à la demande.                                                                      |
| Toasts, dialogues, popovers, relevés, compteurs dupliqués          | § 4                                                                                                                                                                                                                                                                               |
| Page de configuration                                              | parle encore de SAMMI ; appelle une route qui répond `not_available`                                                                                                                                                                                                              |
| Emballage (`build.mjs`)                                            | produit un paquet branché sur l'ancien serveur (§ 9, lot 0)                                                                                                                                                                                                                       |

**Retiré au lot 6 seulement, sur ton accord** : TTS V1, Tombola V1, Modération V1 (inatteignables sur le Core actuel,
sauf TTS V1 si le Core ne lit pas sa configuration), tiroir et dock de l'ancien overlay, règles `.jdm-*` mortes,
traçage `timeout-debug` actif par défaut, interface de restrictions (le Core de Production n'envoie pas `restrictions`).

---

## 8. Contrats à préserver

### 8.1 Twitch

- Noms des pages déclarées en console : `panel.html`, `mobile.html`, `video_component.html`, `config.html`.
- Helper `extension-files.twitch.tv/helper/v1/twitch-ext.min.js` **en premier** dans chaque page ; aucun script inline,
  aucun `eval`, tout le code dans le zip, aucune librairie par CDN, pas d'iframe imbriquée.
- Le composant occupe toute son iframe ; le mobile affiche tout en portrait **et** en paysage.
- Pas de raccourci clavier global (Échap dans un dialogue reste permis) ; audio avec volume, démarré muet.
- JWT d'`onAuthorized` (toujours le dernier) ; `actions.minimize()` pour fermer le composant ; `listen('broadcast')`.
- Domaines appelés : ceux déjà déclarés (Core `core.raptoru.fr`, `static-cdn.jtvnw.net` pour les emotes) ; aucun nouveau.
- `onContext` ne donne aucune taille d'iframe : on n'en dépend pas.

### 8.2 Core

- Façade `/v1/ext` telle que consommée aujourd'hui (liste complète : annexe A2 § 3.4) : chemins, corps, codes d'erreur,
  `Authorization: Bearer`, `Idempotency-Key` (une clé par intention, réutilisée au retry), `/session` puis `/state` fusionné,
  `/modules/v3` (socle). **Aucune route ni aucun champ nouveau pendant la refonte.**
- Les prix, soldes, crédits et disponibilités affichés viennent des champs que le Core envoie déjà ; quand l'extension
  recalcule aujourd'hui (audit A2 § 6), la vue migrée lit le champ du Core s'il existe, et garde le calcul actuel sinon,
  signalé dans le rapport du lot. `expected_price` n'existe que pour `/modules/v3` : l'étendre aux achats historiques est
  un **chantier Core séparé** (décision § 13-5).

### 8.3 Studio et Lab

- Le Lab sert `extension/` octet pour octet en substituant le helper et `shared/runtime-config.js` (`serve.ts`) : le format
  de `RUNTIME` reste compatible (champs ajoutés optionnels).
- Paramètres d'URL utilisés par Studio et les E2E : `anchor`, `mode`, `platform`, `state`, `language`, `locale`, `labRole`,
  `labIdentity`, `demoModule`, `demoScenario`, `studio`, `popout` (ex. `studio/web/src/pages/tombola.ts:616`).
- Le Studio installé sert une copie figée de l'extension : rien à faire de ce côté.

---

## 9. Lots

Chaque lot : worktree isolé depuis `origin/main` à jour, branche dédiée, commits locaux ; push, merge, Hosted Test et
publication **seulement sur GO explicite**. Le nouveau shell est fusionné « éteint » (shell legacy par défaut) tant que le
lot 5 n'a pas basculé : un paquet de Production construit entre-temps reste fonctionnellement identique.

### Lot 0 — Sécurité et préparation (aucun changement visible des viewers) · taille S

1. **Emballage verrouillé** (protections vérifiables) :
   - `npm run build` **refuse** et affiche les trois commandes valides ; `build.mjs` et `dist/` disparaissent.
   - Un seul script `scripts/package.mjs --target production|staging|calibration`. Les cibles et leur `apiBase` sont
     figées dans `scripts/targets.mjs` (`https://core.raptoru.fr/v1/ext`, `https://core-staging.raptoru.fr/v1/ext`, aucune
     pour la calibration). Toute autre valeur est refusée.
   - Le `shared/runtime-config.js` **source** devient non configuré (`mode: 'unconfigured'`, aucune URL) : zipper le
     dossier à la main donne une extension qui affiche « Version non configurée », jamais un appel à l'ancien serveur.
   - Garde à l'exécution dans `api.js` : un `apiBase` hors de la liste (production, staging, `/ext-lab/api` du Lab) est
     refusé avec une erreur visible. Défense en profondeur si un paquet est fabriqué autrement.
   - Le zip embarque `build-manifest.json` (cible, commit, `apiBase`, date) ; `npm run verify:package -- <zip>` rouvre le
     zip et vérifie : cible connue, `apiBase` attendu, aucune chaîne `raptoru.fr/api`, les 4 pages présentes, helper en
     premier, aucun script inline, pas de `.md`, pas de mock, commit propre.
   - Tests vitest des refus (ancienne URL, cible inconnue, arbre modifié, `npm run build`) ; test de dépôt : aucune
     occurrence de `raptoru.fr/api` dans `extension/`.
   - Vérifier que la substitution du Lab (`serve.ts`) et `build:calibration` fonctionnent avec la nouvelle source.
2. **Documentation** : `docs/OPERATIONS.md` § 7, `apps/twitch-extension/README.md` (65 %, commandes), `GUIDE_EXTENSION.md`,
   `REPRISE.md`.
3. **Sauvegardes** : garder `backup/roue-v2-wip-2026-10-25` et `99157a3` ; en faire un `git bundle` rangé hors Git dans
   `Documents\Sauvegarde Raptoru 2.0\` (le pousser sur GitHub : décision § 13-6). Ne rien nettoyer dans le checkout principal.
4. **Références** :
   - verser le banc de l'audit dans `apps/twitch-extension/test/responsive/` (serveur statique, `audit.mjs`, matrice,
     balayage), lancé par `npm run test:responsive` ;
   - **captures de référence à 651×434** de chaque vue et état (vide, chargement, erreur, solde insuffisant, file pleine,
     long pseudo, 70 sons, 200 participants), rôles viewer / modérateur ;
   - **requêtes de référence** : pour chaque action payante ou de modération, la requête exacte émise (méthode, chemin,
     corps, présence de `Idempotency-Key`) par le shell actuel, en mode démo ;
   - résultats de la matrice sur le code actuel (défauts connus listés, pour mesurer les progrès).
5. **Relevés console (Antoni)** : version servie (n° et date), hauteur du panel, mobile activé, possibilité de remettre en
   ligne une version approuvée antérieure, disponibilité du service de configuration. Je fournis la liste à cocher.
6. **Kit de calibration** prêt, non téléversé : build de calibration à jour (le HUD affiche aussi profil, `--kg`, `--kt`),
   procédure Hosted Test sur LeCroupier_, message type pour Wenhuir et Ace of Spade (non envoyé).

Sortie : protections testées, docs justes, références versionnées. Rien à publier.

### Lot 1 — Correctifs bloquants (architecture actuelle, diff minimal) · taille S

| Correctif         | Changement                                                                                                                                                               | Preuve attendue                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| TTS               | `.ttsv2` en grille `auto / minmax(0,1fr) / auto` ; la ligne de paiement sort de la zone coupée ; contenu défilant ; colonne `minmax(180px, 250px)`, empilée sous ~440 px | « Confirmer » et le choix de monnaie visibles de 377×251 à 1053×702, zooms 100–150 %                        |
| Hub               | retrait de `min-height: 330px` (`hub.css:19`) ; barre du bas jamais compressée                                                                                           | Historique, « Voir tous les modules », « ? » visibles jusqu'à 250 px de haut                                |
| Tombola           | seuil de la grille 560 → 521 (`tombola-v2.css:881`), liste défilante en compact (`:1007-1012`)                                                                           | participants atteignables de 521 à 559 de large                                                             |
| Mobile TTS        | la règle `body.mobile:has(.ttsv2) .m-body` (`tts-v2.css:11`) ne vise plus que le conteneur de page, pas le `.m-body` interne (`tts-v2.js:302`)                           | personnages et flèches atteignables à 360×780 et 844×390                                                    |
| Filet de sécurité | `body.component-view .drawer__body` défile au lieu de couper (`overlay.css:118-123, 236-246`)                                                                            | aucun élément d'action coupé sur la matrice                                                                 |
| Écran gris        | reprise des **deux seuls** blocs `overlay.js` / `mobile.js` de `99157a3` (`git show 99157a3 -- <2 fichiers> \| git apply`) ; rien d'autre de ce commit                   | helper absent → message immédiat ; pas d'`onAuthorized` → message à 10 s ; session tardive → message effacé |

Tests : matrice responsive, vitest, E2E Studio `tts-tombola`, `lifecycle`, `v1-parity`, `soundboard`. Recette Antoni en
Lab. **Publication : décision § 13-1.**

### Lot 2 — Socle (nouveau shell, éteint par défaut) · taille L

1. `app/boot.js`, `surface.js`, `layout.js`, `store.js` ; `tokens.css` (valeurs **relevées** dans `hub.css`, `tts-v2.css`,
   `tombola-v2.css`, `soundboard.css`, `bonk-chargeur.css`, `currency-switch.css` : aucune nouvelle palette).
2. `frame.js` et composants du § 4.
3. `shell.js` + `host.js` (contrat hôte déplacé) + Hub reconstruit **au même rendu** sur le cadre (carrousel conservé).
4. Adaptateur : toutes les vues non migrées tournent dans le nouveau shell par les contrats existants, dans un cadre qui
   défile.
5. Chargement à la demande des vues et de leurs feuilles ; feuilles legacy chargées seulement par le shell legacy ou par
   une vue non migrée ; vérification automatique qu'aucune règle legacy ne s'applique à un élément `rx-`.
6. Choix du shell : option d'emballage `--shell=legacy|v2` (champ `RUNTIME.shell`) et paramètre `?shell=` dans le Lab.
   Défaut : `legacy`.
7. Documentation `docs/extension/SOCLE.md` (l'équivalent de `DESIGN_SYSTEM.md` de Studio) : jetons, profils, cadre,
   composants, « une nouvelle vue », interdits.

Sortie : tout fonctionne à l'identique dans le nouveau shell (E2E verts avec `?shell=v2`), Hub responsive, fidélité du Hub
validée à 651×434. **Preuve de concept** : le plancher 0,85 et les planchers de texte sont jugés ici sur captures, par toi,
avant d'aller plus loin.

### Lot 3 — Module pilote : TTS · taille M

TTS V2 dans `modules/tts/` : cadre (pied = paiement), quatre profils (normal = deux colonnes du 651 ; compact = volet
personnages ; étroit = empilé du mobile ; large = file ou aperçu en plus), relevé via `store`, bouton d'achat partagé
(**même requête** que les requêtes de référence), sprites et animations inchangés. Comparaison V1 à 651×434, matrice,
mobile réel. **Premier Hosted Test** (version de test, pas publiée) sur LeCroupier_ avec ton compte, et si possible
Wenhuir et Ace of Spade (kit du lot 0).

### Lot 4 — Migration des autres modules · taille L

Ordre (du plus simple au plus risqué ; chaque sous-lot se valide seul) :

| Sous-lot | Modules                                                | Point d'attention                                                                                               |
| -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 4a       | Tombola V2, Événements, Coffre, Commandes, Roue du Sub | Tombola : en-tête propre (`ownHeader`) et code résiduel dans `ui.js` ; Commandes/Roue : Lab seulement côté Core |
| 4b       | Soundboard                                             | dessine aujourd'hui dans le corps et l'en-tête de l'hôte ; CSS sur 4 feuilles ; favoris en `localStorage`       |
| 4c       | Bonk (+ chargeur, sélecteur, tour)                     | plus gros ensemble d'assets ; service d'emotes de l'hôte ; flux OAuth                                           |
| 4d       | Modération D4                                          | 3 modes de largeur (560/900 en JS) → profils ; pop-out ; tester modérateur, supermod, diffuseur                 |
| 4e       | Page de configuration                                  | réécriture courte (plus de SAMMI), éventuellement l'interrupteur de retour arrière (§ 13-3)                     |

Gabarit d'un sous-lot : règles CSS réécrites sur les jetons dans `modules/<id>/<id>.css` ; cadre et profils ; listes
`keyed` ; achats par le bouton partagé ; la vue ne dépend plus d'aucune feuille legacy (couverture vérifiée) ; requêtes
identiques aux références ; E2E ; fidélité à 651 ; matrice ; recette Antoni.

### Lot 5 — Validation complète et bascule · taille M

1. Défaut `--shell=v2` ; shell legacy encore emballé.
2. Matrice complète, tous états et rôles (anonyme, identité non partagée, viewer, modérateur, supermod, diffuseur).
3. Économie en Lab sur le vrai Core en mode Lab (PostgreSQL réel) : achats, crédits, remboursements, concurrence et
   idempotence ; aucune différence de requête.
4. Modération D4 complète.
5. Hosted Test : ton PC (plusieurs zooms, théâtre, plein écran), Wenhuir, Ace of Spade, iOS et Android réels.
6. Conformité Twitch relue (annexe A1) ; notes pour les reviewers ; **soumission par toi**.

### Lot 6 — Nettoyage (après ≥ 2 semaines de version stable) · taille S

Retrait du shell legacy, de `base/overlay/mobile.css`, des vues V1 et des éléments du § 7, sur ton accord explicite.

**Découpage différent de ta proposition** : (a) le Hub entre dans le lot 2, parce qu'il _est_ la navigation du nouveau
shell ; (b) le mobile est validé dans chaque lot au lieu d'un lot dédié ; (c) un lot 6 de nettoyage, séparé de la bascule,
garde un retour arrière tant que la nouvelle version n'a pas fait ses preuves.

---

## 10. Critères de validation

### Visuels

| #   | Critère                                                                                                                        | Mesure                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| V1  | À 651×434, chaque vue a la composition de la référence : mêmes zones, même ordre, mêmes composants, mêmes animations           | écart de pixels sur zones fixes ≤ bruit de la référence (zones animées masquées) + page côte à côte validée par toi |
| V2  | À 565×376, c'est la composition 651 réduite : rapport des boîtes principales = 0,87 ± 3 %                                      | banc de mesure                                                                                                      |
| V3  | Aucun texte < 10 px, corps ≥ 12 px, quel que soit le profil                                                                    | taille calculée de chaque texte visible                                                                             |
| V4  | Aucun élément d'action coupé par un ancêtre `overflow` ; action principale visible sans défilement en normal, compact et large | `audit.mjs` sur la matrice complète                                                                                 |
| V5  | Aucun défilement horizontal ; défilement de la racine seulement en dernier recours                                             | banc                                                                                                                |
| V6  | Cibles ≥ 24 px partout ; ≥ 44 px pour les actions principales en tactile                                                       | banc                                                                                                                |
| V7  | Profil large : composition ≤ 1,15 ; pas de zone vide anormale ; fond sur toute l'iframe                                        | captures + ta revue                                                                                                 |
| V8  | Animations : inventaire par vue, chacune présente ou remplacée nommément ; `prefers-reduced-motion` respecté                   | liste dans le rapport du lot                                                                                        |

### Fonctionnels

| #   | Critère                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Les E2E Studio qui touchent l'extension (17 fichiers) passent avec les deux shells                                                            |
| F2  | Chaque action payante ou de modération émet **la même requête** que sa requête de référence (chemin, corps, clé d'idempotence par intention)  |
| F3  | Clés `localStorage` conservées : favoris, ordre, alias, volume, notifications                                                                 |
| F4  | Une vue quittée n'émet plus aucune requête et ne laisse aucun minuteur (compte des intervalles actifs)                                        |
| F5  | Conformité Twitch vérifiée par test : helper en premier, aucun script inline, aucune ressource externe hors liste, CSP stricte du Lab         |
| F6  | Garde « écran gris » et erreurs récupérables sur chaque surface                                                                               |
| P1  | Performance : ≤ 700 Ko non compressés pour afficher le Hub (≈ 2,2 Mo aujourd'hui), un seul `ResizeObserver`, aucune mesure en boucle de rendu |

« Validé » = testé par toi. Les tests automatiques sont des preuves, jamais une validation.

---

## 11. Stratégie de test

| Niveau                 | Outil                                                                                           | Quand                           |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| Unitaire               | vitest : modèles existants + calcul des profils/échelles + emballage                            | chaque commit                   |
| Banc responsive        | Playwright sur les fixtures de calibration (`test/responsive/`) : matrice, balayage, références | chaque vue migrée               |
| Requêtes de référence  | même banc, mode démo : capture des requêtes et comparaison                                      | chaque vue qui achète ou modère |
| E2E Lab                | Studio `apps/studio/server/e2e/*` sur le Core en mode Lab                                       | fin de lot                      |
| Économie / concurrence | tests du Core existants (PostgreSQL réel) si une vue touche un achat                            | lots 3–5                        |
| Hosted Test            | Twitch réel (CDN, CSP, JWT), comptes de test                                                    | lots 3 et 5                     |
| Appareils réels        | iOS ≥ 16.4, Android                                                                             | lots 3 et 5                     |
| Ta recette             | Lab puis Hosted Test                                                                            | chaque lot                      |

Matrice : composant 377×251 · 452×301 · 514×342 · 521×347 · **565×376** · 600×432 · **651×434** · 750×500 · 867×578 · 1053×702
(dpr 1 / 1,25 / 1,5) ; panel 318×300 · 318×496 · pop-out 400×700 · 800×900 ; mobile 360×780 · 390×844 · 430×932 · 844×390.
Pendant le développement : tests ciblés ; suites globales avant livraison (règle du projet).

---

## 12. Risques et retour arrière

| Risque                                                                                                                    | Parade                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review Twitch « Rejected » = définitive                                                                                   | une seule soumission pour la refonte, après Hosted Test complet et relecture A1                                                                                                 |
| **Publier le lot 1 publie aussi tout le travail non publié depuis `0bf7907`** (44 commits : Événements, socle, variantes) | décision § 13-1 ; dans tous les cas Hosted Test de toute l'extension avant soumission                                                                                           |
| Retour arrière après publication                                                                                          | (1) remettre en ligne la version précédente depuis la console, **non vérifié** (lot 0) ; (2) interrupteur sans review (§ 13-3) ; (3) sinon une nouvelle soumission (8–14 jours) |
| Dérive visuelle                                                                                                           | références 651, page côte à côte, ta validation par vue                                                                                                                         |
| Lisibilité au 65 %                                                                                                        | échelle de texte séparée + planchers (§ 3.1), jugés au lot 2                                                                                                                    |
| Fuite du CSS legacy dans les nouvelles vues                                                                               | préfixe `rx-`, feuilles legacy chargées seulement si nécessaire, vérification automatique ; peu de sélecteurs génériques dans l'ancien CSS (reset `*`, `button`, `html, body`)  |
| Régression économique                                                                                                     | aucun changement de contrat ; requêtes de référence ; tests du Core inchangés                                                                                                   |
| WebView mobile                                                                                                            | iOS 16.4 minimum : pas d'attribut `popover`, pas d'ancrage CSS ; container queries, `:has`, `dvh` et `<dialog>` disponibles ; appareils réels                                   |
| Studio et Lab dépendent des paramètres d'URL et de la substitution de `runtime-config.js`                                 | contrats § 8.3 ; E2E                                                                                                                                                            |
| Branche longue qui diverge de `main`                                                                                      | lots courts, fusionnés « éteints » (shell legacy par défaut) sur ton GO                                                                                                         |
| Checkout principal (données du Studio installé)                                                                           | jamais utilisé ; aucun `clean` / `reset` / `checkout`                                                                                                                           |

Retour arrière pendant le développement : abandonner la branche du lot ; après fusion : shell legacy par défaut ; après
bascule : option de shell, interrupteur ou version précédente.

---

## 13. Décisions qui te reviennent

1. **Publication du lot 1** : (a) depuis `main`, recommandé : les correctifs partent avec tout le travail déjà fait depuis
   le 22/10, après un Hosted Test complet ; (b) branche correctrice partant de la version publiée : risque minimal, mais
   les correctifs sont à refaire et le travail non publié attend la refonte.
2. **Planchers de texte** : `--kt` ≥ 0,95, aucun texte sous 10 px, corps ≥ 12 px. Certains textes du Hub (8,5–9 px
   aujourd'hui) grossiront un peu. À trancher sur captures au lot 2.
3. **Interrupteur de retour arrière sans review** : le service de configuration de Twitch (segment diffuseur, écrit depuis
   la page de configuration de l'extension) choisirait le shell à distance, sans changer le Core. Il doit être activé dans
   la version soumise (à vérifier en console). Alternative : un champ du Core, mais c'est un changement de Core.
4. **Retraits du lot 6** : vues V1, tiroir/dock de l'overlay, interface de restrictions, traçage `timeout-debug`.
5. **`expected_price` sur les achats historiques** (TTS, Soundboard, Bonk, Événements) : un chantier Core séparé, après la
   refonte, ou jamais.
6. **Sauvegarde `99157a3`** : un bundle hors Git suffit-il, ou faut-il aussi pousser la branche de sauvegarde sur GitHub ?
7. **Usage de l'espace en grand écran**, module par module : je propose des défauts (plus de colonnes de sons, file TTS,
   participants plus larges), à valider sur captures.
8. **Cibles tactiles 44 px sur mobile** : boutons principaux un peu plus grands que la maquette actuelle.

---

## 14. Verdict sur les capacités futures (sans rien construire maintenant)

| Besoin                                | Ce que le socle apporte                                                                                                | Ce qui manquera (chantier propre, plus tard)                                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modules indépendants (Roulette, Slot) | vue = un dossier + une entrée du registre, chargée à la demande ; cadre, porte-monnaie, bouton d'achat, états, profils | côté Core : un module du socle (`/modules/v3`) avec tirage **dans le Core**, idempotence, mise attendue (`expected_price` existe déjà pour ces modules)                                                                                                                   |
| Animation d'un résultat               | la vue joue un résultat **reçu** du Core ; jamais calculé côté client                                                  | —                                                                                                                                                                                                                                                                         |
| Partage dans le chat                  | bouton explicite, un message par clic                                                                                  | envoi par le bot via le Core (déjà en place) plutôt que l'API chat d'extension (12 messages/min/chaîne, 280 caractères, capacité « chat » à activer) ; jamais automatique                                                                                                 |
| Sessions, tables, tours (Blackjack)   | `store` avec abonnements ; une source « en direct » pourra remplacer un relevé sans toucher aux vues                   | côté Core : agrégat de session (table, tours, délais, reprise) ; diffusion : signal « ça a changé » par Extension PubSub (1 message/s/chaîne, 5 Ko ; non concerné par l'arrêt du PubSub historique) puis lecture au Core, ou flux SSE/WSS du Core (domaine déjà autorisé) |
| Spectateurs                           | un viewer sans identité partagée a un id opaque : il peut regarder                                                     | état public de la session côté Core                                                                                                                                                                                                                                       |
| Reconnexion, erreurs                  | relevé suspendu hors écran, reprise au retour, erreurs récupérables, garde « écran gris »                              | reprise de session côté Core                                                                                                                                                                                                                                              |

**Verdict** : après la refonte, un **jeu solo à résultat immédiat** (Roulette, Slot) se branche sans toucher au socle ; le
travail est surtout côté Core et artistique. Le **multijoueur synchronisé** (Blackjack, spectateurs) demandera un chantier
Core (sessions, diffusion) ; côté extension, il ne demandera qu'une source « en direct » dans le `store`. Rien de cela
n'est construit pendant la refonte.

**Garde-fous Twitch pour les jeux de hasard** : les Bits ne doivent jamais servir à miser, entrer dans un tirage ou acheter
un lot aléatoire (règles 6.2.3 à 6.2.6) ; aucun gain ne doit avoir de valeur monétaire. Les Jetons doivent donc rester
**sans valeur monétaire, non achetables avec des Bits ou de l'argent, et non échangeables contre de l'argent**. C'est un
point à garder en tête pour toute évolution de l'économie.

Sources Twitch consultées le 08/11 :
[politiques des extensions](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/) ·
[monétisation](https://dev.twitch.tv/docs/extensions/monetization/) ·
[référence de l'API (Send Extension Chat Message)](https://dev.twitch.tv/docs/api/reference/) ·
[PubSub et extensions](https://dev.twitch.tv/docs/pubsub/) ·
[cycle de vie des produits](https://dev.twitch.tv/docs/product-lifecycle/) ·
[fiche App Store de Twitch, iOS 16.4 minimum](https://apps.apple.com/eg/app/id460177396).
