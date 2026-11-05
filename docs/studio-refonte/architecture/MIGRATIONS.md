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

