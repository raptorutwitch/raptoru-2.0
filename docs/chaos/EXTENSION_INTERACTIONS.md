# Interactions : Chaos V2 et Bonk dans l'extension, modération FX (maquette, 26–27/11/2026)

**État** : maquette UX **Lab seulement**, sur un **faux Core** (données fictives). Rien n'est publié ni branché au Core,
aux Jetons, à Studio ou au moteur. Branche locale `feat/ext-interactions` (worktree `agent`). Base produit :
[ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md) § 10. Direction validée par Antoni le 26/11 (couleurs framboise,
navigation compacte, catalogue, réordonnancement, fiches agrandies, achat avec suivi) ; cette passe la finit.

## 0. Voir la maquette

- Double-clic sur `apps/twitch-extension/Apercu Effets live.cmd` : l'extension en mode démo dans sept tailles réelles
  (lecteur Twitch normal 563 × 376, composant vidéo 651 × 434, Android 393 × 484 et 360 × 409 avec l'adresse réelle de
  l'appli, iPhone simulé 390 × 460, panneau 318 × 496, plein écran 1053 × 702). Boutons : onglet, rôle (viewer,
  modérateur, « Modération FX »), scénario, fiche ouverte, durée max (30 s actuel / 60 s simulé), effets à venir.
- Paramètres d'URL : `ixTab` (chaos, bonk), `ixRole` (viewer, mod), `ixMod=1` (section FX ouverte), `ixScenario`,
  `ixOpen` (id d'effet), `ixCap` (30, 60), `ixPlanned=1`. Bouton **Lab** du catalogue : les mêmes réglages.

## 1. Structure et identité

- Module **Interactions** = un conteneur et une navigation : **Chaos** (palette framboise) et **Bonk** (le vrai écran Bonk,
  embarqué tel quel, **avec ses couleurs** : le pouce du sélecteur passe en fondu à l'ambre-rouge de Bonk ; aucune
  variable partagée ni composant Bonk n'est touché).
- Sélecteur segmenté à la place du titre de l'en-tête (molette, glisser, flèches ; deux sous-modules : pas de carrousel).
- **Plus d'onglet Régie** pour les viewers. L'équipe voit un bouton **FX** (bouclier) qui ouvre la section FX de la
  console de modération (§ 9).

## 2. Catalogue

- Bandeau en direct (effet à l'écran, acheteur, temps restant, file, ma place), bouton **Mes crédits** (§ 8, visible si
  j'en ai) et **Mes effets** ; filtres Tout / Favoris / Mouvement / Vision / Image.
- Cartes homogènes, marges réduites ; ☆ dans le coin de la zone texte (hors du bouton de la carte) ; ruban « crédit »
  quand j'ai un crédit pour l'effet ; réordonnancement par appui long (geste de la Soundboard, inchangé), Alt + flèches.
- Libellés viewer : **Zoom** (`zoom`), **Ivresse** (`drunk`), **Flash** (`flash`), **Couleur** (`color`) ; identifiants
  moteur inchangés.

## 3. Fiche (générique)

Une seule fiche pour tous les effets, construite depuis le catalogue : aperçu, **préréglages**, **force**, contrôles
propres (glissière continue ou à crans, interrupteur, teinte, point visé), **durée**, moyen de paiement (Jetons ou
crédit), issue, détail du prix, bouton compact en deux temps. Marges et espacements réduits ; aperçu collé à gauche et
pleine colonne sur PC (y compris le lecteur normal 563 × 376) ; sur téléphone, aperçu puis réglages empilés, zone
d'achat toujours en bas de l'écran.

## 4. Les 13 effets : réel ou simulé

« Réel » = une capacité du moteur aujourd'hui (variante, niveau, paramètre exposé ou transition permise, relevés dans le
registre v3, `lab-modules/interactions/registry.js`). Chaque réglage atteignable est vérifié par un test (plus de 300).

| Effet          | Préréglages viewer (variantes réelles)                                                             | Force (niveaux réels)                                         | Contrôles (paramètres réels)                                                                                                                                                                                            | Reste à Studio                               |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Écran retourné | 180°                                                                                               | —                                                             | Entrée : rotation 0,55 s / lente 1,5 s / d'un coup (transitions ramp, cut)                                                                                                                                              | coins, écran                                 |
| Miroir         | gauche ↔ droite, haut ↔ bas (**à valider en jeu**), alternance                                     | —                                                             | Changement toutes les 2 / 3 / 5 s (`interval_ms`), entrée retournement / instantanée                                                                                                                                    | écran                                        |
| Tremblement    | Léger, Secousse, Vibration, Par rafales, Séisme, Impact (descriptions = amplitude et rythme réels) | —                                                             | **Intensité 20–100 %** (`intensity`, repart de celle du préréglage)                                                                                                                                                     | amplitudes, roulis, fréquence, amortissement |
| Zoom           | Progressif, Coup de zoom, Pulsations, Zoom et dézoom, Intermittent                                 | —                                                             | Zoom ×1,5 à ×6 (`factor`), point visé 16:9 (`focus_x`, `focus_y`)                                                                                                                                                       | recentrage, rythme                           |
| Ivresse        | Pompette, Ivre, Ivre mort, Vertige                                                                 | Léger, Marqué, Extrême                                        | « L'ivresse monte peu à peu » (`progression` 1)                                                                                                                                                                         | dérive, ondulation…                          |
| Vision tunnel  | —                                                                                                  | Léger, Marqué, Extrême                                        | Animation fixe / se rétrécit / dérive (`mode`), **zoom supplémentaire : interrupteur + glissière ×1,1–3,5** (`zoom`, 1 = sans zoom), point visé                                                                         | forme, bords, voile                          |
| Paupières      | Naturel, **Un clignement**, Répétés, Lent, Somnolence, Lutte contre le sommeil, Yeux fermés        | Mi-closes, Presque, Complètement                              | Naturel : yeux fermés à chaque clignement 0,1–5 s (`hold_ms`) ; Un clignement : fermeture 0,2–3 s ; Répétés : 2–6 par série (`count`), pause 1,5–8 s (`interval_ms`) ; Lent : lenteur 0,3–1,5 s (`close_ms`, `open_ms`) | courbure, cils, teinte                       |
| Flash          | Court, Intense, Rémanence longue                                                                   | —                                                             | — (3 à 9 s)                                                                                                                                                                                                             | teinte                                       |
| Brouillard     | (nappes)                                                                                           | **Marqué, Dense, Occultant** (la brume légère reste à Studio) | —                                                                                                                                                                                                                       | couleur, vent, résolution                    |
| Flou           | Constant, Pulsé, Progressif, Vague                                                                 | Léger, Marqué, Extrême                                        | —                                                                                                                                                                                                                       | minimum, période                             |
| Pixelisation   | Constante, Progressive, Intermittente (**Rétro retiré**)                                           | —                                                             | **Taille des pixels 6 à 112 px** à crans (`block`, borne réelle 2–160)                                                                                                                                                  | grille, couleurs, Rétro                      |
| Couleur        | Noir et blanc, Film noir, Sépia, Négatif, Délavé, Saturé, Monochrome                               | —                                                             | Saturation ×1,5–3 (`saturation`), teinte libre (`tint` #rrggbb)                                                                                                                                                         | force, contraste                             |
| VHS / glitch   | VHS légère, abîmée, Tracking instable, Glitch bref, Glitch violent                                 | —                                                             | —                                                                                                                                                                                                                       | grain, bavure, pertes                        |

Constats dans le moteur (code lu, aucune modification) :

- **Paupières** (Vision.cs) : modes `naturel` (clignements à intervalle organique), `serie`, `ferme` (fermés presque
  toute la durée), `somnolence` (paupières qui tombent, deux micro-sommeils), `resistance` (fermés, s'entrouvrent,
  retombent, se rouvrent à la fin). « Un clignement » = mode naturel sur une durée fixe (fermeture + 1,6 s) : un seul
  clignement, sans changement moteur ; plusieurs achats = plusieurs clignements, l'un après l'autre (file, délais et
  sécurité inchangés). Le rendu est une amande (paupière haute = fermeture, basse = fermeture^1,8) : l'aperçu la reprend.
- **Tremblement** : Impact = un choc amorti en 0,65 s puis plus rien → durée fixe 3 s ; Séisme monte pendant le premier
  quart puis gronde (le « s'apaise » n'existe pas : c'est la transition de sortie) ; Rafales = coups toutes les 1,5 s.
- **Zoom** Pulsations / Intermittent / Zoom et dézoom : un nombre fixe de zooms répartis sur la durée → 15 ou 20 s au
  plus, et le prix suit le temps réellement zoomé.
- **Miroir haut ↔ bas** : curseur calculé par la même composition que l'horizontal validé, jamais essayé en jeu.
- **Brouillard** : la montée (transition d'entrée, 2,5 s) est **comptée dans la durée** ; la dissipation (3 s) vient
  **après** elle ; les nappes dérivent pendant toute la durée. Une montée de 5 s non décomptée n'existe pas (§ 13).

## 5. Durées : trois plafonds

1. **Registre (moteur)** : 1 à 60 s, la borne absolue de toute activation.
2. **Sécurité de Studio** (Chaos › Sécurité › durée maximale) : 30 s par défaut, réglable jusqu'à 60 s ; le moteur
   refuse au-delà, quelle que soit la source (Studio, Core, test). C'est ce qui bloquait la glissière à 30 s.
3. **Autorisation viewer** (futur Core) : la plage vendue par effet et par préréglage, toujours sous les deux autres.

La maquette suit ces trois plafonds : glissière jusqu'au plafond Sécurité (Lab : « 30 s · Sécurité actuelle » ou « 60 s ·
simulé »), plages propres (Flash 3–9 s, Yeux fermés 3–15 s, Répétés 5–30 s, Brouillard dès 10 s, Impact 3 s fixe,
Un clignement fixe, pulsations 15–20 s au plus). Pour vendre 60 s : relever la Sécurité dans Studio (réglage d'Antoni),
puis le Core autorise la plage effet par effet (§ 13).

## 6. Prix (fictifs) : la logique

`prix = base de l'effet × gêne du réglage × durée`, arrondi à 50 Jetons, jamais moins de 50.

- **Gêne du réglage** : calculée sur les **valeurs réelles** que le moteur appliquera (défauts → variante → niveau →
  demande), rapportée au réglage de référence de l'effet, jamais sur le nom d'un préréglage : amplitude réelle et part
  du temps où ça bouge (Tremblement), part de l'écran hors champ et temps zoomé (Zoom), part de l'écran assombrie (Tunnel),
  densité × opacité × épaisseur (Brouillard), flou moyen (Flou), taille des pixels (Pixelisation), part du temps yeux
  fermés × profondeur (Paupières), temps aveuglé et rémanence (Flash), balancement / vision double / flou (Ivresse,
  racine carrée : la gêne croît moins vite que la déformation), changements d'axe (Miroir alterné). Seule la Couleur
  garde un jugement simple (négatif et contraste fort se lisent moins bien). Le détail du prix l'affiche en clair
  (« amplitude 4,5 % de l'écran »).
- **Durée** : une part fixe (un déclenchement interrompt, quelle que soit sa longueur) + une part par seconde :
  ×(0,3 + 0,07 × s) → 10 s ×1, 30 s ×2,4, 60 s ×4,5.
- **Base (10 s, réglage de référence)**, calée sur l'économie réelle : on gagne ~100 Jetons/h de visionnage (200 abonné),
  500 à 2 000 par Daily ; on dépense 200 par Bonk, 500 par son, 7 500 à 37 500 un TTS, 20 000 un Random Ban, 25 000 un
  passage de musique, 1 500 un !fxcam. Couleur 2 000 · VHS 3 000 · Tremblement 4 000 · Zoom, Flou, Pixelisation 5 000 ·
  Ivresse, Brouillard 6 000 · Tunnel 7 000 · Flash 7 500 · Miroir 9 000 · Écran retourné 12 000 · Paupières 14 000
  (référence : yeux fermés tout du long).
- Exemples (10 s) : Couleur 2 000, Secousse 4 000, Séisme 8 050, Brouillard marqué 6 000 / occultant 15 800, Yeux fermés
  13 450, Un clignement 1 700, Écran retourné 12 000 (30 s : 28 800).
- Fréquence d'utilisation : traitée par les délais (1 min par viewer et par effet, 1 min commune pour le Flash), pas par
  le prix ; un prix dynamique (selon l'affluence) serait une décision Core. Aucune valeur n'est définitive.

## 7. Aperçus

Scène stylisée, animée seulement dans la fiche ; l'aperçu lit les valeurs réelles du réglage (amplitude et rythme du
tremblement, cadre du zoom au point visé, rayon / obscurité / zoom du tunnel, chronologie des paupières calculée comme le
moteur et dessinée en amande, densité du brouillard, flou, taille des pixels, saturation et teinte). Étiquette « Aperçu
simulé » ; mouvement réduit respecté (images figées) ; une seule animation à la fois. Image de visée (zoom, tunnel) :
fictive, annoncée comme telle (capture du stream : § 13).

## 8. Crédits d'effets offerts

- **Viewer** : bouton « Mes crédits » dans le bandeau (nombre), liste (effet, conditions : durée et force au plus,
  origine, motif) avec **Utiliser** ; dans la fiche, « Payer avec : Jetons | Mon crédit » ; le réglage est borné par le
  crédit (glissière, forces non couvertes grisées) ; bouton « Utiliser mon crédit », solde intact ; historique
  (reçu, utilisé, rendu, retiré). Ruban sur la carte de l'effet.
- **Règles (faux Core)** : un crédit = un effet précis, une utilisation ; consommé à l'achat ; **rendu** (le crédit, pas
  des Jetons) si la demande ne démarre jamais ou est retirée / arrêtée avec remboursement ; attribution et retrait par la
  modération avec motif obligatoire.
- **Modèle de données (Core, lot 2+)** :
  - `chaos_effect_credits` : `id`, `channel_id`, `viewer_id`, `effect_id` (id moteur), `constraints` (JSON :
    `max_duration_ms`, `levels[]`, `presets[]`), `source_kind` (`streamer` | `moderator` | `reward` | `event`),
    `source_actor_id`, `reason`, `granted_at`, `expires_at` (facultatif), `state` (`available` | `reserved` | `used` |
    `revoked` | `expired`), `request_id` (demande qui l'a utilisé), `updated_at`.
  - `chaos_effect_credit_events` (journal, jamais modifié) : `credit_id`, `kind` (`granted`, `reserved`, `used`,
    `restored`, `revoked`, `expired`), `actor`, `reason`, `at`, `request_id`.
  - Consommation **une seule fois** : réservation atomique (`UPDATE … SET state='reserved' WHERE id = ? AND state =
'available'`) dans la même transaction que la création de la demande, clé d'idempotence de l'achat ; `used` au
    démarrage, `available` de nouveau (événement `restored`) si la demande échoue, expire ou est remboursée.
  - Attribution : commande Core `chaos.credit.grant` (Studio = streamer ; modérateur avec la permission `chaos.credits`),
    `chaos.credit.revoke` ; récompenses et événements plus tard par le même chemin.

## 9. Modération : la section FX de la console (D4)

- La console de modération de l'extension (`shared/moderation-v2.js`, D4, sur le Core) a une ligne par module (TTS,
  Soundboard, Bonk, Tombola) et une vue par module (en cours, en attente, récents, menus d'action). Chaos y devient une
  **ligne de plus, « FX »** (mêmes classes, mêmes styles : `modules/moderation/moderation.css`) : pas de Régie isolée,
  pas de panneau en double. Studio aura la même section (la console D4 est aussi la modération de Studio).
- Contenu (maquette `lab-modules/interactions/moderation-fx.js`) : à l'écran `n/4` (acheteur, réglage, payé, temps
  restant, barre, **Arrêter**), en attente `n/3` (position, acheteur, départ estimé, **Retirer**), récents (statut,
  motif, **Rembourser**), crédits offerts en attente (**Retirer**) ; en tête : **Offrir un effet**, **Offrir un crédit**,
  **Tout arrêter** (confirmation), état **Ouverts / Suspendus** (suspendre et reprendre les achats). Arrêter / retirer :
  « et rendre » ou « sans rembourser » (motif obligatoire) ; rembourser après coup : motif obligatoire.
- En Lab, la console D4 n'a pas de faux Core : la section s'ouvre depuis Interactions (bouton **FX**, équipe seulement).
  Branchement : `MOD_KEYS` + `MODS.chaos` (libellé FX) dans moderation-v2.js, read models `/moderation/v2/chaos/*` et
  commandes `/moderation/v2/actions` (`chaos.stop`, `chaos.cancel`, `chaos.refund`, `chaos.pause`, `chaos.stop_all`,
  `chaos.gift`, `chaos.credit.grant`, `chaos.credit.revoke`), permissions vérifiées et auditées par le Core. Rôles
  simulés en Lab : aucune protection.

## 10. Règles provisoires (faux Core, testées, non figées)

Emplacements du moteur (1 retournement, 2 caméras, 3 filtres, 4 calques) et Sécurité (4 effets à la fois) ; le même
effet jamais deux fois à la fois ; file de 3 ; une demande en attente par viewer ; 1 min entre deux achats du même effet
par le même viewer ; Flash : 1 min commune, refusé en mode doux ; prix revérifié à la confirmation ; durée hors plafond
refusée ; jamais démarrée en 3 min = remboursée intégralement ; arrêtée avant 25 % = remboursement proposé ; sans
remboursement = motif obligatoire ; Tout arrêter suspend les achats.

## 11. Ajouter un effet (architecture)

- Un effet = **une entrée de `catalog.js`** : id moteur, libellé, groupe, base de prix, préréglages (variantes),
  forces (niveaux), contrôles (`slider` avec `param` ou `apply`, `stops` ; `choice` ; `toggle` avec `on` / `off` ;
  `hue` ; `point`), durées (de l'effet ou du préréglage, fixe possible), fonction de gêne sur les valeurs réelles,
  phrase et liste « reste au streamer ». Les bornes et valeurs viennent de l'extrait du registre (`registry.js`,
  régénéré depuis le registre).
- **Son aperçu** : quelques variables lues dans `preview.js` + ses règles CSS. Un contrôle vraiment nouveau (ex. une
  palette d'emotes) s'ajoute une fois dans la fiche générique.
- Rien d'autre : fiche, demande au moteur, prix, file, crédits, modération et tests sont génériques (les tests
  parcourent automatiquement les réglages du nouvel effet contre le registre).
- **Effets positifs à venir** (Confettis, Pluie d'emotes Twitch / abonnés / 7TV / BTTV réutilisant le catalogue Bonk) :
  déclarés dans `PLANNED` (groupe « célébration »), visibles en Lab avec « À venir », jamais achetables. Ils devront être
  des calques du moteur (écran du streamer, pas seulement OBS) : une variante de registre et un rendu, puis une entrée
  de catalogue.

## 12. Pont local de test : extension Lab → Studio → moteur → écran / OBS

Ce qui existe (branche `feat/chaos-studio`) : Studio sert l'extension Lab sur la même origine
(`http://127.0.0.1:4100/ext/`, CSP `connect-src 'self'`) ; `POST /api/chaos/test` accepte exactement la forme de
`engineRequest()` (`effect, variant, level, params, duration_ms, transition`) et la valide (schéma strict) ; le moteur
valide, met en file, joue ; STOP et STOP ALL existent.

Interface minimale à ajouter (passe Studio, pas encore faite) :

1. Une route **Lab seulement** `POST /api/chaos/lab-activate` dans `runtime.ts` : même corps que `engineRequest()`,
   `source: { kind: 'extension', ref: 'Lab' }` (pour être traité comme un viewer : paramètres exposés seulement, pas de
   couche d'entrée, effet désactivé refusé), sorties OBS du mode actuel, garde **même hôte** + en-tête Studio + **profil
   Lab** obligatoire ; réponse : `request_id`, état (démarré, en file, refusé + raison).
2. Dans la maquette, un interrupteur Lab « Jouer pour de vrai sur mon PC » : à la confirmation, un `fetch` vers cette
   route en plus du faux Core (aucun Jeton, aucun Core, aucune publication Twitch ; inopérant hors de Studio Lab).
3. Fusionner les deux branches dans un même arbre de travail (la maquette est sur `feat/ext-interactions`, Studio Chaos sur
   `feat/chaos-studio`) ou lancer Studio depuis un arbre qui contient les deux.

Dépendances : garde de jeu (jamais pendant un jeu actif sans l'accord d'Antoni), Studio Lab lancé par Antoni, moteur
installé. Validation possible dès que (1) à (3) sont faits : quelques heures de travail Studio, testable seulement sur le
PC d'Antoni.

## 13. Travaux ultérieurs (Studio, moteur, Core) — rien de cela ne fonctionne aujourd'hui

| Travail                                                                                                                                                                                                                                                  | Où                             | Dépend de         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------- |
| Module `chaos` du Core : catalogue viewer, devis, achat idempotent, file, délais, remboursements, read models                                                                                                                                            | Core                           | lot 2             |
| Préréglage du streamer appliqué après le style du viewer : le Core envoie tous les paramètres du réglage, ou le moteur ignore le préréglage pour une source externe                                                                                      | Core ou moteur                 | décision d'Antoni |
| Bloc `viewer` du registre élargi : préréglages vendus, forces, contrôles (paramètre + bornes viewer), plages de durée par préréglage                                                                                                                     | registre + Core                | lot 2             |
| 60 s vendues : Sécurité relevée dans Studio + plage autorisée par le Core                                                                                                                                                                                | Studio (réglage) + Core        | décision d'Antoni |
| Brouillard « 5 s de montée non décomptées » : soit le Core ajoute la montée à `duration_ms` (≤ 3 s, plafond des transitions, et il faut de la marge sous la Sécurité), soit le moteur gagne une montée hors durée et une limite de transition plus haute | Core ou moteur                 | décision d'Antoni |
| Section FX dans la console D4 (ligne de module, read models, commandes, permission `chaos.credits`) ; même section dans Studio                                                                                                                           | extension + Core + Studio      | lot 2             |
| Crédits d'effets : tables, commandes, réservation atomique, journal                                                                                                                                                                                      | Core                           | lot 2+            |
| Capture du stream pour viser (scène de programme d'OBS, au plus toutes les 15 s, seulement fiche ouverte ; domaine d'images autorisé dans la console Twitch)                                                                                             | Studio + Core + console Twitch | après lot 2       |
| Pont local de test (§ 12)                                                                                                                                                                                                                                | Studio                         | GO d'Antoni       |
| Confettis, Pluie d'emotes (calques moteur visibles sur l'écran)                                                                                                                                                                                          | moteur + registre              | lot 3             |
| Miroir haut ↔ bas : essai en jeu                                                                                                                                                                                                                         | Antoni                         | —                 |

## 14. Responsive et tests

- Vérifié (Chromium) : 563 × 376, 651 × 434, 1053 × 702, Android 393 × 484 et 360 × 409, iPhone **simulé** 390 × 460
  (taille, toucher, densité 3, user agent iOS — pas Safari / WebKit, non installé ici), panneau 318 × 496 ; catalogue,
  fiches chargées (Paupières, Tunnel, Miroir), modération FX : 35 contrôles automatiques, aucun défilement horizontal,
  bouton d'achat toujours visible, fiche et modération jamais coupées. Parcours cliqués : glisser, favoris, achat avec
  crédit, modération (retirer sans motif refusé, crédit offert), Bonk.
- Tests : `test/interactions-model.test.js` (29 cas : fidélité au registre, durées, prix selon la gêne, file, crédits,
  modération) ; suite de l'extension ; banc `test/responsive/lab-module.mjs` ; matrice v2 rapide.
- **Non vérifié** : vrai téléphone (Android, iPhone) dans l'appli Twitch.

## 15. Fichiers

`apps/twitch-extension/extension/lab-modules/interactions/` : `module.js`, `view.js` (fiche et catalogue génériques),
`catalog.js` (13 effets + 2 à venir), `registry.js` (extrait généré du registre), `model.js` (faux Core, crédits),
`moderation-fx.js` (section FX, format D4), `preview.js`, `prefs.js`, `reorder.js`, `glyphs.js`, `interactions.css`,
`apercu.html` / `apercu.js`. Jamais embarqués (`scripts/package.mjs` retire `lab-modules/`).

Régénérer `registry.js` (depuis le worktree chaos-v2) : lire `packages/schemas/src/chaos-registry.json` et en écrire les
effets publics (paramètres : défaut, bornes, valeurs, exposition ; variantes et niveaux avec leurs paramètres ;
transitions ; emplacements ; limites) au même format — le test de fidélité s'appuie dessus.

## 16. Décisions qui restent à Antoni

1. Les vrais prix (bases, part fixe de la durée) et la grille de gêne.
2. Relever la Sécurité à 60 s, et pour quels effets.
3. Préréglage du streamer contre style du viewer (§ 13).
4. Brouillard : montée hors durée (Core) ou changement moteur.
5. Crédits : qui peut en offrir (modérateurs ? permission dédiée), expiration, contraintes par défaut.
6. Miroir haut ↔ bas à essayer en jeu ; nom de l'acheteur affiché à l'écran (oui par défaut).
