# Migration des modules historiques vers le socle

Mise à jour : 05/11/2026, mission « Opération fondation totale ». Inventaire : sous-agent en lecture seule, recoupé dans le code.

## Stratégies

- **A — migration complète** : le module est réécrit sur l'hôte.
- **B — adaptateur** : le moteur reste, il expose les contrats communs (réglages bornés, état, interrupteur lu, journal le cas échéant).
- **C — intégration partielle** : seulement les réglages, l'état ou l'interface.
- **D — transversal** : ce n'est pas un module métier.
- **E — conservé** : la migration rapporterait trop peu.

**Règle.** Aucun ancien chemin n'est retiré avant que son remplaçant soit implémenté, testé et équivalent. Un adaptateur ne crée jamais un deuxième exécuteur : le moteur historique reste le seul à agir.

## Choix par module

| Module | Stratégie | État au 05/11 | Raison |
|---|---|---|---|
| Mini-jeux (Roulette, Slot, Duel) | B | **fait** (`e08d1a5`) | réglages H10 et supervision ; service inchangé |
| Votekick | B | **fait** (ce lot) | H10 « délais » ; l'interrupteur est un drapeau de déploiement (lecture seule) ; la durée du vote reste dans `votekick_settings` (son écran) |
| Caution | B | **fait** | H10 « prix » ; argent : tarifs lus dans la transaction du devis, le devis garde son prix ; interrupteur `CAUTION_CHAT` en lecture seule |
| Random Ban | B (état seulement) | **fait** | le prix est déjà un réglage ; la chance du streamer (2 %) est une probabilité : jamais réglable (H10) |
| Boutique Halloween | B (état) | **fait** | interrupteur en base et pouls persistant (`event_shop_studios`) |
| Jeu des mots | B (état) | **fait** | interrupteur et intervalle déjà en base (H8) ; « Prêt pour le live » le couvre déjà |
| Bonk, Soundboard, TTS | E pour l'instant | — | supervision Studio (`signals.ts`) et modération D4 complètes ; un adaptateur dupliquerait l'existant |
| Tombola | E pour l'instant | — | modération D4 complète, configuration propre (ordonnanceur) |
| Roue du Sub, Spotify, Points de chaîne, Alertes | C plus tard | — | moteurs riches avec leurs écrans ; candidats à un état commun seulement |
| Daily, Fidélité, Progression, Défis, Boutique cosmétique | D | — | systèmes économiques ou communautaires transversaux, pas des interactions |
| Commandes V2, Modération, Supervision, Lab, Simulation | D | — | l'outillage lui-même |

## Matrice de parité — Mini-jeux

| Capacité | Avant | Après | Preuve |
|---|---|---|---|
| Mise mini Roulette 20, délai 10 s | constantes `rules.ts` | réglages `mini_games.*` (défaut identique), lus dans la transaction | `mini-games-settings.test.ts` (défauts puis valeurs) |
| `!slots` mise 20, délai 2 s | constantes | réglages | idem |
| Plafond Duel 100 000, délai 30 s | constantes `duel-rules.ts` | réglages | idem (duel plafonné à 500) |
| Chances, gains, textes | constantes | **inchangés** | `mini-games-rules.test.ts`, `duel-rules.test.ts` sans modification |
| Interrupteur « Mini-jeux » | `mini_game_channels` (Simulation) | inchangé, lu par l'hôte | test supervision |
| Hors live | silence et notice | inchangé | `mini-games-service.test.ts` |
| Écran | Simulation | carte du module (état, réglages) ; interrupteur toujours sur Simulation | vu en navigateur |

## Matrice de parité — Votekick

| Capacité | Avant | Après | Preuve |
|---|---|---|---|
| Délai de relance 1 h | `VOTEKICK.initiatorCooldownMs` | réglage `votekick.initiator_cooldown_min` (défaut 60), enregistré à l'ouverture | `votekick-module.test.ts` (10 min appliquées) |
| Sanction 5-30 min, courbe `round(5 + (n−2)×25/18)` | constantes | réglages min / max, même courbe `round(min + (n−2)×(max−min)/18)` ; défaut identique | `votekick-module.test.ts`, `votekick-rules.test.ts` inchangé |
| Perfect et Backfire ×2, quorum 3, pile ou face à 4 | règles | **inchangées** (H10 : pas les probabilités) | `votekick-service.test.ts` (61 tests, inchangés) |
| Durée du vote 15-300 s | `votekick_settings` (son écran) | inchangée, au même endroit | `votekick-service.test.ts` |
| Interrupteur | `VOTEKICK_CHAT` (déploiement) | lu par l'hôte, jamais écrit | — |
| Sourdine du streamer, Caution | moteur | inchangés | `votekick-service.test.ts` |
| État | écran Votekick | en plus : « prêt » seulement si le bot s'est signalé depuis moins de 15 s | `votekick-module.test.ts` |
| Écran | Points de chaîne › Votekick | même section, avec le panneau « Délais et durées d'exclusion » (même API que Bonk) | build web |

Écart assumé : la plage de sanction est lue au verdict, pas à l'ouverture du vote. Un changement pendant un vote ouvert vaut donc pour ce vote. La durée du vote, elle, reste figée à l'ouverture.

## Matrice de parité — Caution

| Capacité | Avant | Après | Preuve |
|---|---|---|---|
| 1 000 Jetons par minute commencée | `CAUTION.pricePerMinute` | réglage `caution.price_per_minute` (défaut identique), lu à la création du devis | `caution-module.test.ts` |
| Sourdine du streamer : 300 Jetons par 10 s | `CAUTION.mutePricePer10s` (décision du 27/10) | réglage `caution.mute_price_per_10s` | idem |
| Le devis garde son prix ; un seul débit, au prix du devis | prix stocké dans `caution_requests` | inchangé | `caution-module.test.ts` (tarif changé avant « oui » : débit au prix du devis) |
| « Prolongé » : refus si le timeout a été rallongé | prix actuel supérieur au prix du devis (tarif constant) | **même règle, comptée en minutes** : un tarif changé dans Studio ne déclenche jamais « prolongé » ; l'heure du devis vient du même instant que son prix | `caution.test.ts` (« prolongé » et « raccourci », inchangés) |
| Oui / non, relecture, remboursement unique, incertain, concurrence, redémarrage | moteur | inchangés | `caution.test.ts` (tous verts, inchangés), `caution.integration.test.ts` sur PostgreSQL |
| Interrupteur | `CAUTION_CHAT` (bascule SAMMI pas encore faite) | lu, jamais écrit | — |
| État | écran Caution | en plus : « prêt » seulement si le bot s'est signalé depuis moins de 15 s | `caution-module.test.ts` |
| Écran | Points de chaîne › Caution | même section, avec le panneau « Tarifs » | build web |

## Adaptateurs d'état (Random Ban, Jeu des mots, Boutique d'événement)

Ils ne font que **lire**. Aucun réglage, aucun exécuteur ni interrupteur ne s'ajoute : rien ne change pour ces modules.

| Module | Intention | « Prêt » seulement si | Preuve |
|---|---|---|---|
| Random Ban | toujours « on » : `!rb` n'a pas d'interrupteur Core | l'exécuteur du bot s'est signalé depuis moins de 15 s, avec les droits recherche et exclusion | `status-adapters.test.ts` |
| Jeu des mots | son interrupteur durable (H8), lu par son service | un live est ouvert et le jeu tourne | idem |
| Boutique d'événement | `event_shop_settings.enabled` | un overlay de Studio prêt, vu depuis moins de 10 s | idem |

## Spotify : fin du live (H6), vérifiée le 05/11

| Scénario | Résultat | Preuve |
|---|---|---|
| Coupure plus courte que la grâce (10 min) | rien n'est annulé | `spotify-service.test.ts` « queued, never played… » (`grâce − 1 s`) |
| Nouveau live pendant la grâce (Twitch qui se reconnecte) | rien n'est annulé | « a new live within the grace » |
| Fin réelle | **seules** les demandes `QUEUED` (jamais jouées) sont annulées et remboursées, une fois ; une relance ne change rien | même test, et `closeAfterLive` (`spotify/service.ts`, `state = 'QUEUED'`) |
| Demande commencée (en lecture, jouée, interrompue, passée) | jamais touchée par la fin du live ni remboursée comme jamais jouée | requête limitée à `QUEUED` ; « accepted, queued, played, interrupted, skipped… never refunded » |
| Jamais en live | rien n'est touché | « never live » |

Pas d'adaptateur pour l'instant : Spotify a son écran, ses réglages (`spotify_settings`) et sa supervision. Un adaptateur
d'état seul n'apporterait que la tuile du socle.

## Extension : modules de session sortis de `ui.js` (`8a2f113`)

| Module | Avant | Après | Preuve |
|---|---|---|---|
| Commandes (liste publique) | 7 endroits dans `ui.js` | `registerSessionModule` dans `commands-public.js` | `commands-public.e2e.ts`, `session-modules.e2e.ts` |
| Roue du Sub (vue viewer) | 7 endroits | `sub-wheel-ext.js` | `session-modules.e2e.ts` (aller-retour sans rechargement) |
| Événements (boutique) | 7 endroits | `events-shop.js` | `events-shop.e2e.ts` (2) |

Les 7 endroits par module : constante, test de disponibilité, `moduleById`, injection dans le Hub, remise à zéro dans
`navigateTo`, branche de rendu, variable d'état.

Restent dans `ui.js` (raccord historique, couplé au chemin de rafraîchissement rapide) :
- TTS V2, Tombola V2, Soundboard, Bonk ;
- Modération D4 et Commandes V2 (côté modérateur) ;
- Actions.

Les extraire demande d'abord de généraliser la mise à jour sans re-rendu (`update(state)`, devise de paiement). C'est le
prochain obstacle.

## Extension : variantes sorties de `ui.js` (05/11, mission d'exécution)

| Module | Retiré de `ui.js` | Preuve |
|---|---|---|
| TTS V2 (`50e8601`) | variable de vue, règle de rafraîchissement rapide (`ttsV2Only`, `withoutTtsV2`), remise à zéro, `ttsV2Form`, branchement ; la monnaie passe par `paymentChoice` | `tts-tombola.e2e.ts` écrit **avant** l'extraction ; test du chemin rapide vérifié par mutation |
| Tombola V2 (`50e8601`) | variable, retour anticipé de `updateState`, remise à zéro, branche de rendu, `isTombolaV2` (3 usages) | `tts-tombola.e2e.ts` : manche lancée en son absence, `!join` du chat reçu en direct, Hub et retour |
| Console D4 et sa vue « Commandes » (`2d9f7b2`) | deux variables de vue, la bascule, la remise à zéro, la branche (environ 40 lignes), le retour anticipé, 2 imports | `commands-public.e2e.ts` (D4 › Commandes en modérateur), parcours modérateur de `tts-tombola.e2e.ts` |

`ui.js` passe de 6 289 à 6 214 lignes. Le compte de lignes n'est pas l'objectif : ce qui compte, c'est qu'une vue avec
mise à jour en direct n'écrive plus rien dans `ui.js`.

Pas fait :
- **Soundboard** (`soundboardForm`, environ 1 000 lignes) et **Bonk** (`bonkForm`, environ 450 lignes). Ils dépendent de
  nombreuses variables internes de `ui.js` (glisser, volume, aperçus, émotes, délais, en-tête) et du chemin rapide
  (Soundboard « inchangé », glisser en cours). Aucun E2E de l'extension ne les couvre.
- Lot suivant : E2E de parité d'abord, puis extraction avec un `ctx`, sur le modèle de TTS.

## Extension : Soundboard et Bonk (05/11, continuation)

Méthode : E2E de parité écrit et vert **avant** chaque extraction, puis extraction, puis le même E2E.

| Lot | Retiré de `ui.js` | Nouveau propriétaire | Preuve |
|---|---|---|---|
| Aperçu Soundboard (`295e59c`) | 8 fonctions, 4 variables, 1 constante | `soundboard-preview.js` (audio, son écouté, volume) | `soundboard.e2e.ts` (3 rôles) + 5 tests unitaires |
| Retour d'envoi Soundboard (`7cc951b`) | 3 variables, 3 fonctions, 1 branche morte | `soundboard-feedback.js` (résultat, minuterie) | toast vérifié avant/après + 4 tests unitaires |
| Vue Soundboard dessinée (`208791e`) | 7 variables globales, démontage manuel de `render()` | poignée `soundboardMount` | parcours volume / Échap / désélection / glisser ; mutation |
| Envoi Bonk (`725df10`, `d3e564a`) | 4 variables, 2 fonctions, `bonkFeedbackForResult` | `bonk-send.js` (requêtes en vol, message, emplacement, visite) | `bonk.e2e.ts` (4 parcours) + 6 tests unitaires |

`ui.js` : 6 214 → 6 005 lignes ; 18 variables de fermeture en moins. Ce qui reste volontairement dans `ui.js` :
- `soundboardForm` (≈ 950 lignes) : grille, recherche, tri, alias, favoris, glisser. Ses dépendances réelles sont
  maintenant explicites (état, brouillons, paiement, restrictions) ; l'extraire en fichier est le prochain lot, avec les
  mêmes E2E ;
- Bonk : le catalogue d'émotes et l'autorisation Twitch (14 variables). Non testable de bout en bout sans Twitch : à
  extraire seulement avec un simulateur Lab de l'autorisation ;
- changement de comportement assumé : un appui long pas encore devenu glisser est annulé par un nouveau dessin (avant, son
  minuteur lançait un glisser sur une grille détachée et retenait les états suivants).

## Extension : frontières Soundboard et Bonk (05/11, « terminer les découplages »)

| Lot | Ancien chemin | Nouveau chemin | Preuve |
|---|---|---|---|
| Soundboard (`9c45e91`) | `soundboardForm` (≈ 960 lignes) dans `ui.js` + branches de l'hôte (3 globales, brouillons, bouton de volume passé par l'en-tête, écouteurs Échap / clic sur la racine, règles « état identique » et « glisser » dans `updateState`, démontage dans `render` / `navigateTo`, 2 branches dans `run`, `selectedPaymentMethod`) | `soundboard-view.js` (variante), `soundboard-model.js` (règles pures), `stored-ids.js` | `soundboard.e2e.ts` 5/5 (dont paiement en crédit, persistance entre visites) ; mutation du glisser ; captures avant/après identiques |
| Scénario Bonk (`d163944`) | aucun Twitch, prix et délai figés, écrans étroits non vérifiés | Twitch fictif dans le Lab Core (OAuth, scope, catalogue) ; prix et délai depuis les réglages Studio ; panneau 320 et mobile 360 | `bonk.e2e.ts` 8/8 ; suite E2E complète 83/83 |
| Accès aux emotes (`ae85b0c`) | 17 variables, 10 fonctions, un écouteur `message`, 2 blocs de `updateState` dans `ui.js` | `emote-access.js`, service de l'hôte (son avis s'affiche sur tous les écrans ; le tutoriel global l'utilise aussi) | `bonk.e2e.ts` (liaison, refus, déliaison) |
| Bonk (`9a2c504`) | `bonkForm` + 5 aides, 6 globales + `drafts.bonk`, branches d'en-tête, de `navigateTo` et de fin de `render`, ≈ 400 lignes de règles | `bonk-view.js` (variante), `bonk-model.js`, `tutorial-prefs.js` | `bonk.e2e.ts` + E2E extension 26/26 ; captures avant/après identiques à l'œil |

`ui.js` : 6 005 → 3444 lignes (− 43 %). Ce que `ui.js` sait encore de ces deux modules :
- noms et couleurs dans le Hub, crédits Soundboard dans la console de modération V1, tutoriel global : connaissance
  légitime de l'hôte ;
- **le porte-monnaie de l'en-tête** reconnaît encore la Soundboard par son identifiant (monnaie affichée, solde de
  crédits) : environ 4 lignes, rarement modifiées. Les rendre déclaratives n'apporte pas assez pour le risque.

Développer Soundboard ou Bonk ne demande plus de toucher `ui.js` : écran, état, écouteurs, minuteries, persistance et
règles sont dans leurs fichiers ; seuls un nouveau service de l'hôte ou un nouvel emplacement d'en-tête le feraient.

## Extension : chemins V1 (05/11, « derniers couplages »)

Consommateurs réels vérifiés : le Core de Production envoie toujours `raffle_v2: true` et `moderation_v2: true`, et
`tts_v2` dès que sa configuration TTS répond (`ext-facade.ts`, identique dans 8a897a5). Les V1 restent donc l'écran :
- d'un Studio Lab dont le Lab Core n'est pas branché (`BONK_LAB_CORE_URL` absent) ou sans worker TTS ;
- du paquet de calibration (`build:calibration`, mode démo) ;
- du TTS de Production si `/v1/lab/tts/config` ne répond pas (repli).
Aucune n'est supprimée.

| Lot | Ancien chemin | Nouveau chemin | Preuve |
|---|---|---|---|
| Harnais (`6e0e4ae`) | aucun test des V1 (la pile E2E n'offre que les V2) | `v1-parity.e2e.ts` : l'extension en mode démo (fixtures `demo-data.js`, rien ne sort) | vert avant chaque déplacement |
| TTS V1 (`6e0e4ae`) | `ttsForm` + `drafts.tts` + `ttsActionError` dans `ui.js` | `tts-v1.js` (variante) | E2E V1 + TTS V2 |
| Tombola V1 (`2ad1bb1`) | `raffleForm`, 10 aides, minuterie, instantané, tiroir, confirmation d'inscription dans `updateState`, Échap, `navigateTo` | `tombola-v1.js` (variante) | E2E V1 + V2 + cycle de vie 13/13 |
| Modération V1 (`b27da6e`) | ≈ 1 150 lignes, 14 variables, branche de `render`, Échap | `moderation-v1.js` (instance persistante), `history-format.js` | E2E V1 6/6, D4 |
| Porte-monnaie (`9443ac1`) | `soundboardView` / `ttsView`, somme de crédits, compte TTS dans `render` | `wallet` déclaré par la variante | E2E 20/20 |

`ui.js` : 3 444 → 1 642 lignes (6 005 au début des frontières). Il ne nomme plus aucun module payant ; restent les
couleurs du Hub, la pastille « Ouverte / Fermée » de l'en-tête Tombola, le tutoriel global et l'Historique du viewer.

## Lab cible : le véritable Core en mode Lab (05/11)

| Lot | Contenu | Preuve |
|---|---|---|
| 1 (`67de267`) | `CORE_ENVIRONMENT=lab` : refus au démarrage d'une base non locale, d'une autre chaîne que la fictive 900100, d'une app Twitch réelle, de `OPS_TOKEN` ; écoute 127.0.0.1 seulement (Production : bind inchangé) ; noms des viewers par un annuaire fictif. `npm run lab` / `lab:reset` (`apps/core-api/.env.lab`, ignoré par git) | unitaires 4/4 ; essai sur la base Postgres jetable : 67 migrations, `/v1/ext/session` servi, jeton « lab. » refusé, vraie chaîne refusée |
| 2 (`356617d`) | `main-server.ts` (`createMainCore`, `createMainServer`) : l'assemblage unique de Production et du Lab ; `lab/fixtures.ts` ; Studio `extension-lab/core-frontier.ts` : signe le JWT Twitch du compte fictif et relaie `/ext-lab/api/*` → `/v1/ext/*` | E2E `core-lab` 4/4 ; JWT accepté par le vérificateur du Core |
| 3a (`6fe32e9`) | transport Production de Studio vers le Core Lab local : HTTP accepté sur loopback seulement et sur demande (`labLoopback`), identité liée à ce Core | E2E : TTS acheté dans l'extension → Core → worker TTS **de Production** de Studio → lecteur fictif → réglé, débité une fois ; aucune route `/v1/lab` |

| émotes (`f46e8fc`) | 7TV / BTTV / FFZ publics : option du Core `EMOTE_CATALOG_CHANNEL_ID` (lecture seule, sans jeton, coupée par défaut, identique Lab / Production : la Production ne la pose pas, rien n'y change). Twitch : fictif dans le Lab (en Production ce sont les émotes personnelles de chaque viewer : il faudrait un vrai compte et un secret d'app) | unitaires : coupé = catalogue vide et aucun appel ; activé = GET seulement, aucun en-tête d'identification |
| 3b (`2041804`) | `STUDIO_LAB_CORE=main npm run studio` (opt-in ; sans la variable : l'ancien Lab, inchangé). Le runtime prépare (`lab-prepare.ts` : base `raptoru_core_lab`, migrateur Production, fixtures la première fois, appairage) puis lance `dist/index.js` sur 4302 avec un environnement construit de zéro (aucune variable du processus Studio, secrets générés pour ce PC). Studio prend le chemin du profil Production (workers `/v1/studio`, cockpit) vers ce Core, Extension Lab sur son `/v1/ext` | runtime 35/35 ; Studio 893/894 (sound-lab : charge, 3/3 seul) ; essai réel sur la base jetable : préparation idempotente, session Studio, wallet de test |
| chat (`ac0263a`) | le simulateur de chat joue le bot sur la porte `/v1/bot/chat` du Core Lab ; le Core n'accepte `source: simulator` (et « récents ») qu'en `CORE_ENVIRONMENT=lab` ; Production : Twitch seulement, inchangé | unitaires lab / staging ; essai réel : « !tombola » simulé reçu par les modules |
| modules (`3abcb38`) | alertes, points de chaîne (effets, Votekick, **simulateur** Spotify), Random Ban, Roue, Dock, Halloween, Progression, Boutique, Défis en mode Lab vers les routes `/v1/studio/<module>` du Core Lab (`studioRoutesClient`), journaux sous `lab-main/` | essai réel : 8 familles de routes répondent |

| parité (`7a907dd`) | le cockpit porte toute la table Lab en `CORE_ENVIRONMENT=lab` (`lab/routes.ts`) : simulateurs Spotify / Roue, tests d'alertes, chat simulé ; Twitch fictif à la frontière (OAuth réel sur réponses fictives, page de consentement locale, comptes fictifs) ; portée de migrations `main-lab` ; Commandes et Roue dans la façade ; page Extension Lab sur le Core (`core-lab-panel.ts`) | toutes les specs E2E sur le Core principal (`E2E_STACK=main`) |
| verrous (`0748f3f`) | OBS fictif par défaut (reconnexion automatique d'Electron refusée, `LAB_OBS=real` pour le vrai OBS du PC) ; Test Lab (bot et Core sur les vrais `.env`) refusé ; autorisation de comptes Twitch refusée ; images locales des emotes fictives | recette `studio-lab.boot.ts` sur un vrai serveur Studio : 5/5 |

**Lancer le nouveau Lab :** `npm run studio:lab` (Studio installé fermé : même port 4100). Options : `LAB_EMOTES=83603689`
(7TV / BTTV / FFZ publics de la chaîne, lecture seule) ; `LAB_OBS=real` (OBS de ce PC).

**Résultats (06/11) :** toutes les specs E2E sur le Core principal 91/91 ; outils du Lab (`core-lab`) 9/9 ; recette sur un
vrai serveur Studio 5/5 ; Core 1 405 + intégration sur vrai Postgres 204/204 ; Studio 859 + 2 fichiers arrêtés par le crash Windows
0xC0000409 connu, 39/39 relancés seuls ; ancienne pile : échantillon extension 25/25. Rien n'a été essayé à la main par Antoni.

### Parité ancien Lab → Lab sur le véritable Core

| Fonction de l'ancien Lab | Nouveau Lab | Preuve |
|---|---|---|
| Extension (Hub, TTS, Soundboard, Bonk, Tombola, modération, rôles, identité) | `/v1/ext` réel, JWT signé par Studio | E2E complet |
| Lecteurs OBS (overlay Bonk, Soundboard, TTS) | vraies pages, workers de Production | recette sur vrai serveur |
| Page Extension Lab (wallets, modules, Tombola, journal) | `core-lab-panel.ts`, sans état | `core-lab` |
| Simulateur de chat, identités | même écran, routes Lab du cockpit | `core-lab` |
| Simulateur Spotify, simulateurs de la Roue | mêmes écrans | `core-lab` |
| Catalogue Bonk | fictif ; 7TV / BTTV / FFZ réels en option ; liaison Twitch fictive complète | `bonk.e2e`, `ext-emote-catalog` |
| Alertes, points de chaîne, Random Ban, Votekick, Caution, Dock, Halloween, Progression, Boutique, Défis | mode Lab, routes Lab du cockpit | E2E complet |
| Wallet de test | cockpit | E2E |

**Volontairement absent du nouveau Lab :** liaison Twitch d'un vrai compte et vraies emotes personnelles ; lecture du vrai
chat et des vrais événements Twitch ; vrais dons StreamElements ; Test Lab (bot réel). Un don se simule depuis Alertes.

### Proposition de bascule (à décider par Antoni)

1. Antoni essaie `npm run studio:lab` et valide les parcours.
2. Bascule : `npm run studio` lance le Core principal ; l'ancien Lab reste atteignable une version (`STUDIO_LAB_CORE=legacy`).
3. E2E : `core-lab-stack.ts` devient l'unique pile.
4. Retraits (≈ 4 000 lignes) : `lab-ebs.ts` (2 469) + 3 façades (308), `bonk-lab/lab-core.ts` et `local-server.ts` (509),
   `e2e/lab-stack.ts` (525), `scripts/bonk-lab.mjs` (210), clients `/v1/lab` directs ; puis, module par module, les
   migrations jumelles `_lab` quand plus rien ne les lit, et 23 fichiers de tests à porter vers l'assemblage principal.

