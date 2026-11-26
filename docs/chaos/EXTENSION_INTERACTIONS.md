# Interactions : Chaos V2 et Bonk dans l'extension, modération FX (maquette, 26–28/11/2026)

**État** : maquette UX **Lab seulement**, sur un **faux Core** (données fictives). Rien n'est publié ni branché au Core,
aux Jetons, à Studio ou au moteur. Branche locale `feat/ext-interactions` (worktree `agent`). Base produit :
[ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md) § 10. Direction validée par Antoni le 26/11 (couleurs framboise,
navigation compacte, catalogue, réordonnancement, fiches agrandies, achat avec suivi). Passes de finition : 27/11 (effets
réels, prix, crédits) et 28/11 (crédits compacts, « Conditions », achats répétés, charges du clignement, glissières Flou,
fluidité, modération dans la vraie console, bouclier, badge Tombola).

## 0. Voir la maquette

- Double-clic sur `apps/twitch-extension/Apercu Effets live.cmd` : l'extension en mode démo dans sept tailles réelles
  (lecteur Twitch normal 563 × 376, composant vidéo 651 × 434, Android 393 × 484 et 360 × 409 avec l'adresse réelle de
  l'appli, iPhone simulé 390 × 460, panneau 318 × 496, plein écran 1053 × 702). Boutons : onglet, rôle (viewer,
  modérateur, « Modération FX » = modérateur qui touche le bouclier), scénario, fiche ouverte, durée max (30 s actuel /
  60 s simulé), effets à venir.
- Paramètres d'URL : `ixTab` (chaos, bonk), `ixRole` (viewer, mod : la session de démo devient celle d'un modérateur
  sur la console D4), `ixMod=1` (le bouclier est touché au chargement), `ixScenario`, `ixOpen` (id d'effet), `ixCap`
  (30, 60), `ixPlanned=1`. Bouton **Lab** du catalogue : les mêmes réglages (changer de rôle recharge la page).
- Le faux Core survit à un rechargement de l'onglet (sessionStorage) : achat en cours, file, crédits, charges, solde.

## 1. Structure et identité

- Module **Interactions** = un conteneur et une navigation : **Chaos** (palette framboise) et **Bonk** (le vrai écran Bonk,
  embarqué tel quel, **avec ses couleurs** : le pouce du sélecteur passe en fondu à l'ambre-rouge de Bonk ; aucune
  variable partagée ni composant Bonk n'est touché).
- Sélecteur segmenté à la place du titre de l'en-tête (molette, glisser, flèches ; deux sous-modules : pas de carrousel).
- **Plus d'onglet Régie** pour les viewers. Les modérateurs ont le **bouclier** de l'en-tête (générique, § 9) : sur
  Chaos il ouvre la section **FX** de la vraie console de modération, sur Bonk la section Bonk.

## 2. Catalogue

- Bandeau en direct (effet à l'écran, acheteur, temps restant, file, ma place), deux petits boutons **crédits** (billet +
  nombre, visible si j'en ai) et **mes effets** qui ouvrent le même popover compact (§ 8) ; filtres Tout / Favoris /
  Mouvement / Vision / Image.
- Cartes homogènes, marges réduites ; ☆ dans le coin de la zone texte (hors du bouton de la carte) ; ruban « crédit »
  quand j'ai un crédit pour l'effet ; réordonnancement par appui long (geste de la Soundboard, inchangé), Alt + flèches.
- Libellés viewer : **Zoom** (`zoom`), **Ivresse** (`drunk`), **Flash** (`flash`), **Couleur** (`color`) ; identifiants
  moteur inchangés.

## 3. Fiche (générique)

Une seule fiche pour tous les effets, construite depuis le catalogue : aperçu, **préréglages**, **force**, contrôles
propres (glissière continue ou à crans, interrupteur, teinte, point visé), **durée**, moyen de paiement (Jetons ou
crédit), issue, détail du prix, bouton compact. Marges et espacements réduits ; aperçu collé à gauche et pleine colonne
sur PC (y compris le lecteur normal 563 × 376) ; sur téléphone, aperçu puis réglages empilés, zone d'achat toujours en
bas de l'écran.

- **Moins de texte permanent** : une phrase d'accroche, la description concrète du préréglage choisi ; plus de liste
  « réglé par le streamer » (forme, douceur des bords, rendu…) ni de règles écrites en bas de fiche.
- **« Conditions »** (lien jaune orangé dans l'en-tête) : panneau compact avec ce qui touche CET achat — durée possible
  (et plafond du live), compatibilité et cumul, file ou charges, délai, remboursement, particularité de l'effet (montée
  du brouillard…). Se ferme au second clic, au clic à côté, avec Échap. Ce qui **empêche** l'achat reste écrit en clair
  au-dessus du bouton (délai, file pleine, solde, charges, hors live…), jamais seulement dans ce panneau.
- **Achats répétés** : la fiche reste ouverte après un achat ; « c'est parti ! » ou « réservé : 2e dans la file » s'affiche
  dans la fiche, le solde (en-tête), la file, le bandeau, les charges et la modération se mettent à jour tout de suite ;
  une demande refusée dit sa raison sans quitter la fiche.
- **Confirmation** : deux temps par défaut (prix, puis « Confirmer » pendant 4 s). Case **« Ne plus demander »** au moment
  de confirmer (décochée par défaut), réversible dans « Prix » (« Confirmer chaque achat »), gardée dans le navigateur.
  Le prix est toujours sur le bouton. Protection : bouton bloqué pendant l'envoi, puis 0,7 s après la réponse (double clic
  involontaire) ; chaque intention a une **clé d'idempotence** (un renvoi de la même intention ne débite jamais deux
  fois, testé). Rien ne contourne les règles du Core, les plafonds ou le solde : tout est revérifié à l'achat. En vrai
  (Jetons réels), le mode sans confirmation est à valider avant la Production.

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
| Flou           | Constant, Pulsé, Progressif, Vague                                                                 | —                                                             | **Puissance du flou 15 à 95** par pas de 5 (`amount`, borne réelle 1–100 ; les anciens niveaux valaient 28 / 55 / 90), libellée « Léger · 25 » … « Illisible · 95 »                                                     | minimum, période                             |
| Pixelisation   | Constante, Progressive, Intermittente (**Rétro retiré**)                                           | —                                                             | **Taille des pixels 6 à 112 px** à crans (`block`, borne réelle 2–160)                                                                                                                                                  | grille, couleurs, Rétro                      |
| Couleur        | Noir et blanc, Film noir, Sépia, Négatif, Délavé, Saturé, Monochrome                               | —                                                             | Saturation ×1,5–3 (`saturation`), teinte libre (`tint` #rrggbb)                                                                                                                                                         | force, contraste                             |
| VHS / glitch   | VHS légère, abîmée, Tracking instable, Glitch bref, Glitch violent                                 | —                                                             | —                                                                                                                                                                                                                       | grain, bavure, pertes                        |

Constats dans le moteur (code lu, aucune modification) :

- **Paupières** (Vision.cs) : modes `naturel` (clignements à intervalle organique), `serie`, `ferme` (fermés presque
  toute la durée), `somnolence` (paupières qui tombent, deux micro-sommeils), `resistance` (fermés, s'entrouvrent,
  retombent, se rouvrent à la fin). « Un clignement » = mode naturel sur une durée fixe (fermeture + 1,6 s) : un seul
  clignement, sans changement moteur ; plusieurs achats = plusieurs clignements, l'un après l'autre, avec des **charges**
  (§ 4 bis). Le rendu est une amande (paupière haute = fermeture, basse = fermeture^1,8) : l'aperçu la reprend.
- **Flou** : un seul vrai réglage d'intensité, `amount` (1–100) ; la glissière le pilote directement (pas de conversion).
  **Pixelisation** : `block` seul, à crans géométriques (×1,4 environ : progression régulière à l'œil), pas de seconde
  sélection de force.
- **Tremblement** : Impact = un choc amorti en 0,65 s puis plus rien → durée fixe 3 s ; Séisme monte pendant le premier
  quart puis gronde (le « s'apaise » n'existe pas : c'est la transition de sortie) ; Rafales = coups toutes les 1,5 s.
- **Zoom** Pulsations / Intermittent / Zoom et dézoom : un nombre fixe de zooms répartis sur la durée → 15 ou 20 s au
  plus, et le prix suit le temps réellement zoomé.
- **Miroir haut ↔ bas** : curseur calculé par la même composition que l'horizontal validé, jamais essayé en jeu.
- **Brouillard** : la montée (transition d'entrée, 2,5 s) est **comptée dans la durée** ; la dissipation (3 s) vient
  **après** elle ; les nappes dérivent pendant toute la durée. Une montée de 5 s non décomptée n'existe pas (§ 13).

## 4 bis. « Un clignement » : charges

- **Viewer** : 10 charges au plus ; une revient toutes les 6 s (pleines en 1 min) ; chaque clignement confirmé en
  utilise une. Jauge de dix segments dans la barre du bouton (« 8/10 · +1 dans 4 s »), à jour dès l'achat. Plus de
  délai d'une minute pour ce préréglage ; les autres préréglages de Paupières gardent leurs règles.
- **Quatre plafonds distincts** (faux Core, `BURST` dans model.js, valeurs provisoires) :
  1. charges du viewer (10, recharge 6 s) ;
  2. demandes acceptées : 10 clignements en attente au plus, **tous viewers confondus** ;
  3. cadence réelle : un clignement à la fois (le même effet ne joue jamais deux fois), 0,5 s entre la fin de l'un et le
     départ du suivant, dans l'ordre d'achat, sans doublon (clé d'idempotence) ;
  4. sécurité : 20 clignements par minute glissante pour tout le chat — deux viewers ne cumulent pas leurs charges
     au-delà.
     Les protections du moteur (photosensibilité, effets actifs, Sécurité) restent en place ; Paupières n'est pas
     photosensible au registre, le Flash garde son délai commun.
- Un clignement jamais joué (retiré, expiré) rend ses Jetons **et** sa charge. La modération voit « Clignements en
  attente · n/10 » et peut les retirer.
- **À développer** (§ 13) : côté Core, l'état des charges par viewer (`n`, `at`) et la file `burst` avec ses plafonds
  communs, en base, sous verrou ; côté moteur, rien d'obligatoire (un clignement = une activation `naturel` courte),
  mais un déclenchement « un clignement » natif (sans 1,6 s d'yeux ouverts autour) et une limite de cadence du moteur
  lui-même seraient plus sûrs.

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

- **Viewer** : petit bouton billet + nombre dans le bandeau ; popover compact avec un sélecteur « Effets | Crédits n » ;
  un crédit = une ligne courte (effet, durée au plus, « + » s'il a d'autres limites, petit bouton **Utiliser**) ; le
  détail (limites complètes, origine, motif) s'ouvre au clic sur la ligne ; l'**historique** (Reçu, Utilisé, Restitué,
  Annulé, avec date et motif) est replié derrière un petit bouton horloge et se ferme au clic à côté, avec Échap ou au
  second clic. Une aide d'une ligne s'affiche une seule fois (croix « Compris »). « Utiliser » ouvre la fiche de l'effet
  avec le crédit présélectionné : réglage borné par le crédit (glissière, forces non couvertes grisées), bouton
  « Utiliser mon crédit », solde intact. Ruban sur la carte de l'effet.
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

## 9. Modération : la section FX dans la vraie console (D4)

**Intégré dans le vrai shell** (code de production, branche locale) :

- **Point d'extension générique de la console** (`shared/module-registry.js` `registerModerationSection`, lu par
  `shared/moderation-v2.js`) : une section ajoutée = une ligne de plus dans la navigation des modules (même composant
  `modLine`), sa vue dans le même panneau (`pane`, `sec`, `rows`, `row--now`, `h`, `statebtn`…, styles
  `modules/moderation/moderation.css`), ses boutons d'en-tête (`data-xact`) rendus par la console. Sans section
  enregistrée, la console est identique à avant.
- **Bouclier générique** (`app/panel.js` `moderationShortcut`) : modérateurs seulement, console D4 seulement, à gauche
  du solde, dans l'en-tête des modules qui ont une section : TTS, Soundboard, Bonk, Tombola (table
  `MODERATION_SECTION`), ou un module qui déclare `moderationSection(view)` (Interactions : FX sur Chaos, Bonk sur
  Bonk). Le clic ouvre la console **directement sur la bonne section** ; son bouton de retour devient « Retour à
  Soundboard » (ou au module d'origine) et y ramène. Aucun bouclier ailleurs, ni pour un viewer. Le Core vérifie les
  permissions de chaque lecture et commande ; le bouclier n'épargne que la navigation.
- En-tête étroit (≤ 400 px) avec le bouclier : l'icône décorative du titre s'efface et le badge Tombola passe en point +
  billet, pour que rien ne se chevauche (matrice v2 : même résultat qu'avant ce lot).

**Simulé (Lab seulement, `lab-modules/interactions/lab-moderation.js`, jamais embarqué)** :

- Une **source de démo** (`registerDemoSource`, utilisée uniquement en mode démo par `shared/api.js`) : avec
  `?ixRole=mod`, la session de démo devient celle d'un modérateur sur la console D4 ; ses lectures `/moderation/v2/*`
  reçoivent des données minimales (TTS, Sons, Bonk, Tombola presque vides) ; **toute commande D4 est refusée** (« pas
  disponible dans ce test ») : rien ne fait croire qu'elle agit sur le live. Le solde affiché est celui du faux Core.
- La **section FX** (`moderation-fx.js`, styles `moderation-fx.css`) sur le faux Core partagé (`store.js`), annoncée
  « Lab · faux Core : aucune action ne touche le live » : à l'écran `n/4` (acheteur, réglage, payé, temps restant,
  barre, **Arrêter**), en attente `n/3` (position, acheteur, départ estimé, **Retirer**), clignements en attente `n/10`,
  récents (statut, motif, **Rembourser**, « Tout » pour l'historique complet), crédits offerts en attente (**Retirer**) ;
  en-tête : **Offrir un effet** (effet, préréglage, durée), **Offrir un crédit**, **Tout arrêter** (confirmation),
  **Ouverts / Suspendus**. Arrêter / retirer : « et rendre » ou « sans rembourser » (motif obligatoire) ; une demande
  retirée au moment où elle démarre est arrêtée avec le remboursement voulu. Hors live, Chaos coupé ou Studio
  interrompu ne se lèvent pas d'ici.

**Contrat de branchement (Core, lot 2)** : enregistrer la section FX en production (même `registerModerationSection`,
ou une entrée `chaos` dans `MOD_KEYS`), read models `/moderation/v2/chaos/overview` (actifs, file, burst, récents,
crédits en attente, état) et commandes `/moderation/v2/actions` (`chaos.stop`, `chaos.cancel`, `chaos.refund`,
`chaos.pause`, `chaos.resume`, `chaos.stop_all`, `chaos.gift`, `chaos.credit.grant`, `chaos.credit.revoke`), chacune
avec clé d'idempotence, permission vérifiée (`chaos.moderate`, `chaos.credits`) et ligne d'audit ; la même section
dans Studio (la console D4 y est la modération).

## 10. Règles provisoires (faux Core, testées, non figées)

Emplacements du moteur (1 retournement, 2 caméras, 3 filtres, 4 calques) et Sécurité (4 effets à la fois) ; le même
effet jamais deux fois à la fois ; file de 3 ; une demande en attente par viewer ; 1 min entre deux achats du même effet
par le même viewer ; Flash : 1 min commune, refusé en mode doux ; Un clignement : charges (§ 4 bis) ; prix revérifié à la
confirmation ; durée hors plafond refusée ; même clé d'idempotence = même réponse, aucun second débit ; jamais démarrée en
3 min = remboursée intégralement ; arrêtée avant 25 % = remboursement proposé ; sans remboursement = motif obligatoire ;
Tout arrêter suspend les achats ; Chaos désactivé, Studio interrompu, hors live : refusé avant tout débit, avec la raison
(Studio interrompu : ce qui jouait est rendu, la file attend son retour puis expire remboursée).

### Ce que le Core devra garder, ce qui reste dans le navigateur

- **Core (en base)** : demandes (file, actives, terminées, motifs, remboursements), crédits et leur journal, charges par
  viewer, file `burst`, reçus d'idempotence, état des achats (ouverts, suspendus), plafonds, audit de modération.
  En Lab, le faux Core les garde dans l'onglet (sessionStorage) : un rechargement les retrouve.
- **Navigateur (localStorage, facultatif)** : favoris, ordre des cartes, derniers réglages par effet, astuce vue, aide
  des crédits vue, « Ne plus demander ». Un stockage bloqué n'oublie que ces préférences.

## 11. Ajouter un effet (architecture)

- Un effet = **une entrée de `catalog.js`** : id moteur, libellé, groupe, base de prix, préréglages (variantes),
  forces (niveaux), contrôles (`slider` avec `param` ou `apply`, `stops` ; `choice` ; `toggle` avec `on` / `off` ;
  `hue` ; `point`), durées (de l'effet ou du préréglage, fixe possible), `charges` d'un préréglage (achats rapides),
  fonction de gêne sur les valeurs réelles, une phrase, une `note` de condition propre à l'effet (montée du brouillard…).
  Les bornes et valeurs viennent de l'extrait du registre (`registry.js`, régénéré depuis le registre). Les
  « Conditions » sont générées (`conditionsFor`, model.js) depuis ces métadonnées.
- **Son aperçu** : quelques variables lues dans `preview.js` + ses règles CSS. Un contrôle vraiment nouveau (ex. une
  palette d'emotes) s'ajoute une fois dans la fiche générique.
- Rien d'autre : fiche, demande au moteur, prix, file, crédits, modération et tests sont génériques (les tests
  parcourent automatiquement les réglages du nouvel effet contre le registre).
- **Effets positifs à venir** (Confettis, Pluie d'emotes) : déclarés dans `PLANNED` (groupe « célébration »), visibles
  en Lab avec « À venir », jamais achetables. Ils devront être des calques du moteur, **visibles sur le moniteur du
  streamer** (pas seulement dans OBS) : une variante de registre et un rendu, puis une entrée de catalogue. La Pluie
  d'emotes réutilisera les ressources de Bonk sans les recopier : le sélecteur d'emotes de Bonk et son catalogue (emotes
  Twitch de la chaîne et d'abonnés, 7TV, BTTV, autres fournisseurs déjà pris en charge, droits d'accès du viewer
  compris) ; la fiche n'ajoutera qu'un contrôle « emote » qui ouvre ce sélecteur, et le moteur recevra l'URL de l'image
  déjà résolue (aucun nouveau fournisseur côté moteur).

## 11 bis. Fluidité

Mesuré dans Chromium sans GPU (pas un banc GPU du moteur) : ouverture de la fiche VHS en 20 ms de construction, aucune
tâche longue, pire image 17 ms pendant l'animation ; au repos, une seule animation tourne (l'onde du badge Tombola).
Ce qui a changé :

- ouverture et fermeture de la fiche en **transformation + opacité** depuis la carte (composées, plus de `clip-path`
  animé qui repeignait toute la fiche à chaque image) ; l'aperçu animé démarre **après** l'ouverture ;
- glitch VHS de l'aperçu en transformation seule ; le grand aperçu a sa propre couche (`will-change: transform`) : ses
  filtres sont calculés une fois ;
- point « en direct » animé en transformation (au lieu d'une ombre repeinte) ;
- repeints utiles seulement : une carte n'est redessinée que si son état change (avant : les 13, chaque seconde), le pied
  de la fiche et le popover « Effets / Crédits » non plus (un clic n'est jamais perdu dans un repeint) ;
- les vignettes du catalogue restent figées (animées seulement au survol) ; `prefers-reduced-motion` : aucune
  animation (fiche, panneaux, points, aperçus figés).

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
| Bouclier de modération et point d'extension D4 : déjà dans le shell (branche locale) ; à embarquer avec le prochain ZIP de l'extension                                                                                                                   | extension                      | GO d'Antoni       |
| Crédits d'effets : tables, commandes, réservation atomique, journal                                                                                                                                                                                      | Core                           | lot 2+            |
| Capture du stream pour viser (scène de programme d'OBS, au plus toutes les 15 s, seulement fiche ouverte ; domaine d'images autorisé dans la console Twitch)                                                                                             | Studio + Core + console Twitch | après lot 2       |
| Pont local de test (§ 12)                                                                                                                                                                                                                                | Studio                         | GO d'Antoni       |
| Confettis, Pluie d'emotes (calques moteur visibles sur l'écran)                                                                                                                                                                                          | moteur + registre              | lot 3             |
| Charges « Un clignement » : état par viewer (`n`, `at`) et file `burst` en base, plafonds communs sous verrou ; reçus d'idempotence                                                                                                                      | Core                           | lot 2             |
| Déclenchement natif « un clignement » (sans les 1,6 s d'yeux ouverts autour) et limite de cadence propre au moteur (optionnel, plus sûr)                                                                                                                 | moteur + registre              | après lot 2       |
| Section FX enregistrée en production + read models `/moderation/v2/chaos/*` + commandes `chaos.*` (permissions, audit) ; même section dans Studio                                                                                                        | extension + Core + Studio      | lot 2             |
| « Ne plus demander confirmation » avec de vrais Jetons : à valider avant la Production                                                                                                                                                                   | Antoni                         | avant Production  |
| Miroir haut ↔ bas : essai en jeu                                                                                                                                                                                                                         | Antoni                         | —                 |

## 14. Responsive et tests

- Vérifié (Chromium) : 563 × 376, 651 × 434, 1053 × 702, Android 393 × 484 et 360 × 409, iPhone **simulé** 390 × 460
  (taille, toucher, densité 3, user agent iOS — pas Safari / WebKit, non installé ici), panneau 318 × 496 : catalogue,
  crédits avec historique ouvert, fiches (Paupières, Tunnel, Miroir), « Conditions » ouvertes, console de modération sur
  FX : 49 contrôles automatiques, aucun défilement horizontal, bouton d'achat toujours visible, rien de coupé. En-têtes
  modérateur (bouclier) à 318, 360, 563 : aucun chevauchement. Matrice v2 de l'extension : identique à avant ce lot.
- Parcours cliqués : crédits (détail, historique, Échap), Utiliser → fiche avec crédit, Conditions (clic à côté), achat
  en deux temps puis sans confirmation, double clic bloqué, charges 10 → 9 → 8, solde de l'en-tête à jour, fiche restée
  ouverte, rechargement de la page (achat en cours, crédits et solde retrouvés), bouclier → FX → Tout arrêter → retour à
  Interactions, Soundboard → section Soundboard → « Retour à Soundboard », Bonk → section Bonk, viewer sans bouclier,
  badge Tombola (Hub et modules) → vraie Tombola, badge absent une fois dedans.
- Tests : `test/interactions-model.test.js` (40 cas : fidélité au registre, durées, prix, file, crédits, modération,
  charges et cadence, deux viewers, idempotence, annulation pendant le démarrage, Tout arrêter, Chaos coupé / Studio
  interrompu / hors live, persistance, glissières Flou et Pixelisation) ; `test/module-host.test.js` (point d'extension
  de la console, source de démo jamais utilisée hors démo) ; suite de l'extension ; banc `test/responsive/lab-module.mjs`.
- **Non vérifié** : vrai téléphone (Android, iPhone) dans l'appli Twitch ; la console D4 sur un vrai Core avec la section
  FX (elle n'existe qu'en Lab).
- **Tombola en Lab** : l'état de la tombola vient de la session de démo (`shared/demo-data.js`), mais le badge, son
  apparition, sa disparition (inscrit, fermée) et le clic passent par le vrai code du shell (`app/panel.js`,
  `raffleShortcut` → `navigateTo('raffle_join')`), le même qu'en production.

## 15. Fichiers

`apps/twitch-extension/extension/lab-modules/interactions/` (jamais embarqués, `scripts/package.mjs` retire
`lab-modules/`) : `module.js`, `view.js` (fiche et catalogue génériques), `catalog.js` (13 effets + 2 à venir),
`registry.js` (extrait généré du registre), `model.js` (faux Core : file, crédits, charges, conditions), `store.js` (faux
Core partagé et persistant), `lab-moderation.js` (session de démo modérateur, lectures D4 fictives, section FX),
`moderation-fx.js` + `moderation-fx.css`, `preview.js`, `prefs.js`, `reorder.js`, `glyphs.js`, `interactions.css`,
`apercu.html` / `apercu.js`.

Shell (code embarqué, branche locale) : `shared/module-registry.js` (sections de modération ajoutées, source de démo),
`shared/moderation-v2.js` (sections ajoutées, ouverture sur une section, retour au module d'origine), `shared/api.js`
(source de démo, mode démo seulement), `app/panel.js` (bouclier, intention de navigation, badge Tombola),
`app/css/shell-base.css`, `modules/tombola/tombola.css`.

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
7. Charges du clignement : 10 et 6 s de recharge ? plafonds communs (10 en attente, 20 par minute) ? prix d'un clignement.
8. « Ne plus demander confirmation » avec de vrais Jetons (proposé désactivé par défaut).
