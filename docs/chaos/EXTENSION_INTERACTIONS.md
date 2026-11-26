# Interactions : Chaos V2, Bonk et la Régie dans l'extension (maquette, 26/11/2026)

**État** : version UX aboutie, **Lab seulement**, branchée sur un **faux Core** (données fictives). Rien n'est publié
ni branché au Core, aux Jetons ou au moteur. Branche locale `feat/ext-interactions` (worktree `agent`). Remplace la
première maquette « Effets live » (même branche, `3a848143`). Base produit :
[ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md) § 10.

## 0. Voir la maquette

- Double-clic sur `apps/twitch-extension/Apercu Effets live.cmd` (nom gardé) : l'extension en mode démo dans six tailles
  réelles côte à côte (lecteur Twitch normal 563 × 376, composant vidéo 651 × 434, appli Android 393 × 484 et
  360 × 409 avec l'adresse réelle de l'appli, panneau 318 × 496, plein écran 1053 × 702). Boutons : onglet, rôle,
  scénario, fiche ouverte, plafond de durée. Fermer la fenêtre noire arrête tout.
- À la main (banc `node test/responsive/server.mjs`) :
  `http://127.0.0.1:4471/demo-v2/video_component.html?anchor=component&labModules=interactions&demoModule=interactions`
  - `ixTab` (chaos, bonk, regie), `ixRole` (viewer, mod), `ixScenario` (voir le panneau Lab), `ixOpen` (id d'effet),
    `ixCap` (30 ou 60).
- Le bouton **Lab** du catalogue (pointillés ambre) : scénario, rôle, plafond Sécurité, effacer favoris, ordre et
  réglages. Jamais montré à un viewer (le module n'existe qu'en Lab).

## 1. Nom, structure, navigation

- Module **« Interactions »** (carte du Hub : framboise vers ardoise, « Chaos et Bonk : agis sur le stream »).
  Sous-modules : **Chaos** (effets de stream), **Bonk** (le vrai écran Bonk, embarqué tel quel, sa carte quitte le Hub
  via `groups`), **Régie** (équipe seulement).
- **Sélecteur dans l'en-tête de l'extension, à la place du titre** (hook `headAfter`) : segmenté, pouce framboise qui
  glisse sous l'onglet choisi. Retour, sélecteur et solde : rien d'autre dans la barre.
  - PC (composant vidéo) : les trois noms. Téléphone et panneau : le nom de l'onglet choisi, des pictogrammes pour les
    autres (largeur 130 px environ).
  - Molette au survol du sélecteur : un cran par geste (280 ms), sans boucle, jamais la page dessous. Glisser le doigt
    sur le sélecteur : un cran. Clavier : flèches, Début, Fin (motif `tablist`).
  - **Carrousel infini écarté** : avec deux ou trois sous-modules, il n'aurait rien à faire défiler, perdrait l'ordre
    de lecture et le clavier. Au-delà de quatre interactions, le même sélecteur passera en bande défilante aimantée
    (`scroll-snap`), toujours bornée.
- Le ‹ de l'en-tête referme d'abord ce qui est ouvert (fiche, détail), puis revient au Hub (socle : un écran hébergé peut
  prendre le ‹ en premier, `app/panel.js` ; seuls les Mini-jeux s'en servaient, inchangés).

## 2. Direction artistique

- Teinte d'identité **#9E2941** (framboise désaturée) ; contrepoint **ardoise** froide (#2C3A44) ; textes blanc chaud
  (#F6EDEF) et rose pâle (#EEB0BC) ; surfaces prune très sombres, posées sur le fond violet-noir de Raptoru.
- Une seule couleur pour « choisi / actif » : la framboise pleine (onglet, filtre, option, bouton d'achat). Le sauge
  (#9FCBB8) ne dit que « en direct / tout de suite » ; l'ambre, « attente / blocage » ; jamais de dégradé multicolore.
- Voisins vérifiés : Bonk ambre → rouge, Mini-jeux cramoisi vif #FF2F55 → lie-de-vin, Tombola rose → violet, TTS violet.
  Interactions est la seule framboise **désaturée** avec un contrepoint froid.
- Mouvements courts (150 à 300 ms), aucune brillance animée ; mouvement réduit respecté partout.

## 3. Catalogue

- Bandeau **en direct** en tête (une ligne) : l'effet à l'écran (le mien d'abord) avec son acheteur, son temps restant et
  une barre ; `+N` s'il y en a d'autres ; la file `n/3` et **ma place** (« toi 2e »). Toucher : le détail (à l'écran
  `n/4` avec acheteurs et barres, la file avec positions et départs estimés, les règles en une phrase).
- Bouton **Mes effets** (horloge, pastille = mes demandes en cours) à droite du bandeau : mes achats du live et leur sort.
  Plus de bandeau pleine largeur en bas. Après un achat, le bandeau dit pendant 5 s « Ton Miroir · 2e dans la file ».
- Filtres : Tout, **Favoris** (☆, compteur), Mouvement, Vision, Image.
- Cartes compactes (aperçu figé + nom + « dès … ») : 2 colonnes sur téléphone et panneau, 3 sur le lecteur normal,
  4 à 5 en grand. ☆ posée sur l'aperçu, hors du bouton de la carte. État : temps sur l'aperçu (en cours, recharge) ;
  blocage écrit à la place du prix (File pleine, En pause, Pas sur ce jeu, Le tien attend) ; aperçu terni si bloqué.
- **Ordre personnel** : appui long (300 ms) puis glisser, **le geste de la Soundboard** repris à l'identique (bouger de
  plus de 10 px avant = défilement ou clic, la carte suit le doigt, seules les cartes entre l'origine et la destination
  glissent d'une place, emplacement en pointillés, défilement aux bords, Échap annule, le clic qui suit le lâcher
  n'ouvre rien). Clavier : Alt + flèches. Réordonner dans un filtre ne touche que les effets visibles.
- Réutilisé tel quel : `shared/soundboard-model.js` (`moveSoundboardItem`, `reorderSoundboardVisibleSubset`,
  `normalizeSoundboardOrder`, `soundboardDropSlot`) et `shared/stored-ids.js`. Le geste est copié dans
  `lab-modules/interactions/reorder.js` plutôt qu'extrait de la Soundboard validée (à extraire le jour où elle bouge).
- Préférences gardées sur l'appareil (localStorage, facultatif) : `raptoru-live:interactions-favorites`, `-order`,
  `-choices` (derniers réglages par effet), `-tip-seen`. Isolées du faux Core ; le compte viewer côté Core pourra prendre
  le relais (lot 2 ou après).

## 4. Fiche d'un effet

- **S'agrandit depuis sa carte** : le contour de la carte devient le panneau (« container transform », 300 ms), puis le
  contenu apparaît ; le catalogue recule derrière. La fiche prend toute la zone du module (téléphone : toute la hauteur
  disponible). Retour immédiat : ‹ Effets, Échap ou le ‹ de l'en-tête, refermeture vers la carte, le focus y revient.
- Contenu : en-tête (‹, nom, **gêne** 1 à 3, ☆), aperçu agrandi animé, phrase, **Style** (préréglages), **Intensité**,
  contrôles propres à l'effet, **Durée** (glissière avec chronomètre), rappel des règles et « Réglé par le streamer ».
- PC large : aperçu à gauche (collant), réglages à droite. Fiche basse (lecteur normal) : aperçu réduit.
- Pied toujours visible : l'issue (« Démarre tout de suite », « 2e dans la file · ~0:20 », ou la raison du refus),
  **Prix** (le détail ligne par ligne, le solde avant / après) et un **bouton compact** « Lancer | 1 450 ◈ »
  (« Réserver » si l'effet attendra) ; deux temps : « Confirmer » 4 s avec une barre qui se vide, puis envoi.
- Aucun coût caché : chaque option payante affiche son écart (« +30 % ») sur sa puce ; le détail liste chaque
  coefficient.

## 5. Les 13 effets : ce que le viewer règle (capacités réelles du moteur)

Source : registre v3 (`packages/schemas/src/chaos-registry.json`, branche `feat/chaos-studio`) et page Effets de
Studio. Style = **variante** du registre (les « préréglages » de Studio), force = **niveau** du registre, contrôle =
**paramètre exposé** ou **transition** permise. Test : chaque réglage atteignable produit une demande au moteur valide
contre un relevé du registre (`test/fixtures/chaos-registry-viewer.json`).

| Effet             | Styles (variantes)                                                       | Force (niveaux)                                 | Contrôles viewer                                                                                                          | Reste au streamer                                                |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Écran retourné    | 180° (`rotate180`)                                                       | —                                               | Entrée : rotation 0,55 s, rotation lente 1,5 s, d'un coup (`transition` ramp / cut, ≤ 520°/s)                             | coins pendant la rotation, écran                                 |
| Miroir            | gauche ↔ droite, haut ↔ bas (**à valider**), alternance                  | —                                               | Rythme de l'alternance 2 / 3 / 5 s (`interval_ms`) ; entrée retournement ou instantanée                                   | écran                                                            |
| Tremblement       | Léger, Secousse, Impact, Par rafales, Séisme, Vibration                  | Léger, Marqué, Extrême (`intensity`)            | —                                                                                                                         | amplitudes, roulis, fréquence, amortissement, intervalles, bords |
| Zoom chaotique    | Progressif, Coup de zoom, Zoom et dézoom, Pulsations, Intermittent       | — (le facteur fait la force)                    | **Zoom ×1,5 à ×6** (`factor`, crans de 0,5) ; **point visé** sur une zone 16:9 (`focus_x`, `focus_y`, 0..1)               | recentrage, rythme des pulsations, au-delà de ×6                 |
| Écran ivre        | Pompette, Ivre, Ivre mort, Vertige                                       | Léger, Marqué, Extrême                          | « L'ivresse monte peu à peu » (`progression` 1)                                                                           | dérive, ondulation, vision double, flou, respiration, vitesse    |
| Vision tunnel     | —                                                                        | Léger, Marqué, Extrême (rayon, obscurité, zoom) | Animation fixe / se rétrécit / le regard dérive (`mode`) ; point visé                                                     | forme, bords, couleur du voile, zoom                             |
| Paupières         | Naturel, Rapide, Fatigué, Qui résistent, Yeux fermés                     | Mi-closes, Presque, Complètement                | —                                                                                                                         | vitesses, courbure, cils, teinte                                 |
| Flash aveuglant   | Court, Intense, Rémanence longue                                         | —                                               | durée 3 à 9 s                                                                                                             | teinte, temps d'aveuglement                                      |
| Brouillard        | Nappes, Bancs mouvants, Nappes qui passent, Arrive peu à peu, Se dissipe | Brume, Marqué, Dense, Opaque                    | —                                                                                                                         | couleur, vent, résolution                                        |
| Flou              | Constant, Pulsé, Progressif, Vague                                       | Léger, Marqué, Extrême (`amount`)               | —                                                                                                                         | flou minimal, période                                            |
| Pixelisation      | Constante, Progressive, Intermittente, Rétro                             | Fins, Gros, Énormes (`block`)                   | —                                                                                                                         | grille, couleurs par canal                                       |
| Filtre de couleur | Noir et blanc, Film noir, Sépia, Inversion, Délavé, Saturé, Monochrome   | —                                               | Saturé : **saturation ×1,5 à ×3** (`saturation`) ; Monochrome : **teinte libre** (glissière arc-en-ciel → `tint` #rrggbb) | force, contraste fin                                             |
| VHS / glitch      | VHS légère, VHS abîmée, Tracking instable, Glitch bref, Glitch violent   | —                                               | —                                                                                                                         | grain, bavure, pertes de bande                                   |

Points vérifiés dans le moteur (code, pas de nouvelle mesure) :

- **Miroir haut ↔ bas** : `MirrorEffect` applique `Transform(0, 1, -1)` ; `FrameBuilder.AddCursor` compose la même
  transformation pour le curseur (position retournée sur l'axe vertical, image retournée puis tournée de 180° = miroir
  vertical). Le calcul est le même que pour l'horizontal validé, mais **aucun essai en jeu ni test dédié** : signalé
  « à valider » dans la fiche (Lab). L'alternance passe par un demi-tour (même chemin).
- **Couleur libre** : `tint` est un paramètre couleur exposé ; la roue est une glissière de teinte (un doigt, précise).
- **Point visé** : coordonnées relatives (0..1), valables à toutes les résolutions (2560 × 1440 aujourd'hui).
- Écrit nulle part ailleurs que dans le moteur, à retenir pour le lot 2 :
  - **Durée** : le moteur refuse au-delà de min(registre 60 s, **Sécurité › durée maximale, 30 s par défaut**). La
    glissière va donc de 5 à **30 s** (crans de 5 s) ; 60 s seulement si Antoni relève le plafond dans Studio (bouton
    Lab « 60 s »). Le bloc `viewer` du registre (4 durées fixes 5 / 10 / 20 / 30 s, 3 paliers) devra devenir : variantes
    proposées, niveaux, contrôles (paramètre + bornes viewer), plage de durée `{min, max, step}` — changement de
    registre et de Core, **pas du moteur**.
  - **Effets simultanés** : Sécurité › 4 effets actifs au plus (défaut) en plus des emplacements (1 retournement,
    2 caméras, 3 filtres, 4 calques). Le faux Core l'applique.
  - **Préréglage du streamer** : le moteur applique défauts → variante → niveau → **préréglage enregistré dans Studio**
    → demande. Le préréglage d'Antoni peut donc écraser le style choisi par un viewer. Lot 2 : le Core envoie
    explicitement les paramètres du style et de la force choisis (permis : tous exposés), ou le moteur ignore le
    préréglage pour une source externe (changement moteur, à décider).

## 6. Prix (fictifs) : structure

`prix = base de l'effet (10 s) × style × force × options × durée`, arrondi à 50 Jetons, jamais moins de 50.

- Base selon la **gêne** (1 à 3) : Couleur 350 ; Tremblement, Paupières 450 ; Zoom 550 ; Flou, Pixelisation, VHS 500 ;
  Ivre, Tunnel, Brouillard 600 ; Miroir 700 ; Écran retourné 800 ; Flash 900. Flou, Pixelisation et Brouillard sont
  classés gêne 3 : leur prix suit leur pouvoir de masquer le jeu.
- Force : ×0,7 / ×1 / ×1,6 (Brouillard ×0,7 / ×1 / ×1,3 / ×1,7 ; Paupières ×0,8 / ×1 / ×1,3).
- Styles plus forts : +10 à +30 % (Alternance +30 %, Séisme +20 %, Ivre mort +30 %…) ; plus doux : −10 à −20 %.
- Zoom : ×(0,7 + 0,15 × facteur) (×2 = base, ×6 = ×1,6). Durée : ×(0,4 + 0,06 × s) (10 s = ×1, 30 s = ×2,2).
- Le Core fixera les vrais montants ; la vue affichera son devis (`quote`) sans rien calculer.

## 7. Aperçus

- Une scène de jeu stylisée (ciel, collines, cible, barre de vie, viseur) en dégradés CSS, à laquelle chaque effet
  applique une **approximation** : rotation, miroir, secousse selon le style et la force, cadre de zoom au point visé,
  tunnel troué au point visé (rayon du niveau), paupières courbes, nappes de brouillard, flou, grille de pixels,
  filtres de couleur avec la teinte choisie, lignes et décalage VHS. Étiquette « Aperçu simulé » : ce n'est jamais le
  rendu du moteur.
- Catalogue : image figée (l'instant le plus parlant), légère animation au survol de la souris seulement. Fiche : animée,
  suit chaque réglage. Une seule animation à la fois ; coupée quand la fiche se ferme ; figée en mouvement réduit ;
  aucune image téléchargée.
- **Image du stream pour viser** (zoom, tunnel) : pas disponible dans l'extension (la vidéo Twitch n'est pas lisible
  depuis l'iframe). La fiche montre un chargement bref puis l'**image fictive**, annoncée comme telle. Faisable plus tard :
  Studio prend une capture réduite de la **scène de programme d'OBS** (déjà diffusée, aucune donnée privée), au plus une
  fois toutes les 15 s et seulement quand une fiche de visée est ouverte ; le Core la sert ; le domaine doit être ajouté
  aux domaines d'images autorisés de l'extension (console Twitch). Jamais sur les cartes du catalogue.

## 7 bis. Effets actifs, file, historique

Voir § 3 (bandeau en direct, détail, Mes effets). Le nom de l'acheteur est montré (il est déjà public dans le chat) ;
une option Core pourra l'anonymiser.

## 8. Règles provisoires (faux Core `model.js`, testées, non figées)

- Emplacements du moteur et Sécurité (4 à la fois) ; le même effet jamais deux fois en même temps (le second attend).
- File de 3 ; une demande en attente par viewer ; même viewer, même effet : 1 min après sa fin ; deux viewers peuvent
  acheter le même effet (le second attend). Flash : 1 min commune, refusé en mode doux.
- Prix vérifié à la confirmation (« Le prix a changé »), durée au-delà du plafond refusée, rien n'est débité.
- **Remboursements** : jamais démarré (expiré en 3 min, ou retiré de la file) = intégral par défaut ; arrêté en cours
  avant 25 % = proposé d'office ; au-delà, au choix de la modération ; ne pas rembourser demande toujours un motif ;
  remboursement après coup possible une fois, avec motif. Tout est tracé (acteur, motif). Règles ajustables au lot 2.

## 9. Régie et Studio

- Onglet **Régie** (équipe) : Pause / Reprendre, **Tout arrêter** (confirmation), **Offrir un effet** (même fiche, gratuit,
  devant la file) ; listes À l'écran (`n/4`, acheteur, temps), File (position, départ, expiration), Historique (acteur,
  motif, remboursé) avec Arrêter, Retirer, Rembourser.
- Le faux Core **ne protège rien** : rôle simulé (paramètre `ixRole` ou modérateur de la démo). Le Core vérifiera le rôle
  côté serveur pour chaque action.
- Studio aura un panneau complet (« File et historique ») lisant les **mêmes données** du module `chaos` du Core.

## 10. Responsive et Twitch mobile

- Repères du Blackjack mobile repris : adresse réelle de l'appli (`mobile.html?platform=mobile&anchor=component`,
  correctif du 24/11), hauteur bornée par `--vh`, lecteur normal 563 × 376 comme taille par défaut du PC.
- Vérifié par captures et parcours cliqués (Chromium, toucher simulé pour le mobile) : 563 × 376, 651 × 434,
  1053 × 702, 393 × 484, 360 × 409 (catalogue), 318 × 496. Bouton d'achat toujours visible, aucune fiche coupée.
- **Non vérifié** : vrai téléphone dans l'appli Twitch (Android, banc mobile `extension/BANC_MOBILE_TWITCH.md`) et
  **iPhone** (aucune mesure de la zone iOS dans le dépôt). Le glisser au doigt et le défilement vertical sont le code de
  la Soundboard, mais doivent être essayés sur téléphone.

## 11. Fictif, réel, contrat du Core (lot 2)

- Fictif : prix, viewers simulés (un achat toutes les 14 à 24 s), file, délais, solde (débité localement ; l'en-tête
  garde le solde de la démo), aperçus, image de visée, rôles.
- Réel : catalogue (variantes, niveaux, paramètres, bornes du registre), Bonk, socle v2 (Hub, en-tête, échelle,
  chargement à la demande), préférences locales.
- Le module `chaos` du Core devra fournir : effets (état, raison, `minPrice`), à l'écran (acheteur, restant), file
  (position, départ, expiration), mes effets, **devis** `quote(effet, réglage)` → `{ price, lines, outcome, block }`,
  achat idempotent avec `expected_price` ; pour l'équipe : retirer, arrêter, rembourser, pause, tout arrêter, offrir.
  La vue appellera `client.moduleState` / `moduleAct` à la place de `model.js`.

## 12. Idées d'effets (bonus, inchangé)

Confettis (priorité 1), Pluie d'emotes, Écran fissuré, Signal perdu, Game Boy (style du filtre), Écran penché ;
saisonnier : neige / pluie ; plus tard : Hypnose, Puzzle ; non : aberration chromatique (déjà dans VHS).

## 13. Fichiers et tests

- `apps/twitch-extension/extension/lab-modules/interactions/` : `module.js` (entrée, carte, `groups`, `headAfter`),
  `view.js` (vue), `catalog.js` (13 effets, prix, demande au moteur), `model.js` (faux Core), `prefs.js` (favoris,
  ordre, réglages), `reorder.js` (glisser), `preview.js` (aperçus), `glyphs.js`, `interactions.css`, `apercu.html/.js`.
  Jamais embarqués (`scripts/package.mjs` retire `lab-modules/`).
- Socle : `app/v2.js` (`?labModules=interactions`), `app/panel.js` (couleurs de la carte ; le ‹ d'un écran hébergé).
- Tests : `test/interactions-model.test.js` (21 cas : fidélité au registre sur plus de 300 réglages, plafonds de durée,
  prix, emplacements et Sécurité, file, délais, flash, remboursements, modération) ; suite de l'extension ; banc
  `test/responsive/lab-module.mjs` ; parcours cliqués et captures (achat, détail du prix, favoris, glisser, clavier,
  Régie, Bonk, molette du sélecteur).

## 14. Décisions qui restent à Antoni

1. Les vrais prix (et la part de la gêne dans la base).
2. Garder le plafond à 30 s ou le relever à 60 s pour les viewers.
3. Préréglage du streamer vs style du viewer (§ 5) : le Core envoie tout, ou le moteur ignore le préréglage pour les
   viewers.
4. Miroir haut ↔ bas : à essayer en jeu avant de l'ouvrir aux viewers.
5. Montrer le nom de l'acheteur à l'écran (oui par défaut) ; « Tout arrêter » rembourse-t-il au-delà de 25 % ?
6. Capture du stream pour viser (§ 7) : à faire, ou image fictive suffisante.
