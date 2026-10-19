# Roue du Sub

**Statut (18/10/2026) : migration technique DÉVELOPPÉE / TESTS AUTOMATISÉS RÉUSSIS / rendu OBS et test complet simulé VALIDÉS par Antoni (19/10/2026) /
DÉSACTIVÉE (interrupteur OFF) / gains raccordés au Wallet canonique (19/10, local, jamais activé — § 3) / NON DÉPLOYÉE.** En live, SAMMI garde la roue
tant qu'Antoni n'a pas validé le rendu et décidé du raccordement économique.

## 1. Fonctionnement historique (SAMMI + `Alerte_system.html`, lecture seule)

- **Bouton SAMMI ID1 « Roue Sub »** (Deck Principal), déclencheur sub : sub normal, resub, Prime, tiers 1–3 ; **pas** de
  sub offert (destinataire ou donneur), **pas** de gift communautaire, ni anonyme. Le filtre de mois (`monthmin 1`,
  `monthmax 2`) est inactif (`monthrange 0`) — confirmé par la page, qui a des paliers 4, 12 et 20 mois.
- Déroulé SAMMI : alerte `eren_sub` (`Twitch_Alerts.html`, source « Alerte Twitch »), **6 s**, puis
  `Alerte_system.html?wheel=resub&pseudo&tier&months` dans la source « Alerte (Sammi) » ; la page tire, anime, puis
  renvoie le montant à SAMMI (`setVariable` sur 127.0.0.1:9450) ; SAMMI crédite les **Jetons StreamElements**
  (`PUT …/kappa/v2/points/…/<pseudo>/<montant>`) et écrit « X remporte N jetons sur la roue ! ».
- **Roue** (`Alerte_system.html`, `Version webm`, 14/08 — la version servie à OBS ; les autres fichiers trouvés sont
  une copie de travail de juillet et la Lucky Wheel, sans rapport) : 4 paliers selon les mois (1–3 : 8 segments
  200…5000 ; 4–11 : 10 segments ; 12–19 : 12 segments ; 20+ : 12 segments jusqu'à 50 000), segment tiré
  **uniformément**, gain = valeur × multiplicateur du segment × tier (T1 ×1, T2 ×2, T3 ×3 ; Prime = T1). Gains de 200 à
  150 000 jetons. Sons : WebAudio (ticks, arrêt, victoire / jackpot) + `Incrémentation Son.mp3` (0,425) et
  `Fin casino son.mp3` (0,45) pour le compteur des tiers 2 et 3. File interne dans la page.
- Contournements SAMMI retirés : rechargement de la source OBS par URL, attente fixe de 6 s, aller-retour du montant
  par l'API de SAMMI, tirage dans la page (non enregistré), crédit sans protection contre le double crédit.

## 2. Dans Raptoru

`Twitch (channel.chat.notification) → bot (alertes, existant) → Core : alerte + roue → Studio : lecteur d'effets`

- **Une seule source d'événements** : l'adaptateur Twitch du Lab ne lit que `channel.chat.notification` (pas
  `channel.subscribe`), déjà normalisé et dédoublonné par les Alertes V1 (identifiant du message EventSub : une
  redélivrance est le même événement). La roue est demandée par la réception des alertes, **une fois par événement
  logique** (clé `alert:twitch:<id du message>`) ; une redélivrance renvoie la même roue (et répare une roue manquée).
- **Core** (`apps/core-api/src/sub-wheel/service.ts`, tables `sw_settings` / `sw_spins`, migrations Lab
  `20261027120000_sub_wheel_lab.sql` et production `20261027130000_sub_wheel.sql` **non appliquée**) : sub / resub
  Twitch seulement ; sub = 1er mois, resub = mois cumulés ; tirage crypto uniforme et gain calculés et **enregistrés
  avant l'animation** ; roue proposée à Studio **après la fin de son alerte de sub** (ou 20 s au plus tard si la source
  des alertes manque) ; une à la fois, dans l'ordre ; jamais retirée ; animation non confirmée → « non affichée »,
  trop tard (10 min) → « non affichée (trop tard) », le gain restant enregistré.
- **Rendu** : la roue historique copiée telle quelle dans le lecteur d'effets (`effects-player/wheel.js` + CSS de
  `player.html`, chargée seulement pour une roue) : bandeau, SVG, rotation, sons, compteur, « +N jetons ». Elle reçoit
  le segment et le montant de Core, ne tire jamais, et refuse de s'afficher si son calcul ne donne pas le montant
  enregistré. Les deux mp3 sont des copies (empreintes des originaux identiques avant / après l'import).
- **Interrupteur OFF par défaut** : un vrai sub est alors seulement noté « Roue désactivée » (rien tiré, rien dû).

## 3. Gains en attente d'attribution

- Chaque roue Twitch enregistre son gain une fois : viewer (id, login, nom), événement d'origine, tier, mois, segment,
  montant, date, statut, identifiant unique (`spin_id`). Statuts : **en attente** · **crédité** (par un adaptateur,
  avec sa référence) · **crédité à la main** (note obligatoire) · **annulé** (note obligatoire) · **test** (jamais
  attribuable).
- **Crédit automatique sur le Wallet canonique seulement** (décision d'Antoni, 19/10/2026, phase 2 lot 5) : quand
  le runtime a choisi le Wallet canonique, le gain d'une roue décidée à partir de là est crédité **dans la même
  transaction** que la roue (clé `move:sub_wheel:<spin_id>`) — redélivrance, redémarrage, réponse perdue ou deux Core
  ne créditent jamais deux fois. Crédit refusé (Jetons indisponibles) ou viewer sans Twitch ID : le gain reste « en
  attente » avec sa raison, jamais « crédité » sans mouvement. Gain nul : « crédité » sans mouvement.
- **Jamais de crédit automatique d'un gain en attente d'avant** (époque StreamElements) : le rapprocher (« annulé »),
  ou le payer par un appel explicite `award(spin_id)` (même clé, ligne verrouillée).
- **Règlement manuel** : sur le Wallet canonique, « crédité à la main » est refusé (`manual_settlement_disabled`) — un
  seul chemin de paiement ; « annulé » reste possible tant que le gain est en attente ; un gain crédité répond
  `already_awarded`. Hors Wallet canonique (Lab, production actuelle) : rien n'est crédité par Raptoru, le
  rapprochement manuel est inchangé. `WheelAwardPort` / `attribute()` (jamais branchés) sont remplacés par le port
  économique.

## 4. Studio

Onglet « Points de chaîne », section **Roue du Sub** : interrupteur (OFF ; l'activer demande une confirmation
rappelant que les gains ne sont pas crédités), lecteur d'effets, médias, roues en attente, total des gains à attribuer,
« Tester l'animation » (pseudo, tier, mois — aucun gain), « Test complet simulé » (alerte de sub simulée puis la roue —
aucun gain), 20 dernières roues (viewer, sub / resub, tier, mois, état, montant et segment, gain), boutons « Crédité à
la main… » / « Annuler… » sur les gains en attente.

## 5. Validation (à faire, avec accord)

1. `npm run studio` (applique la migration Lab), source du lecteur d'effets ouverte dans OBS (elle se recharge seule).
2. Section Roue du Sub → « Tester l'animation » avec T1 / 1 mois, T2 / 14 mois, T3 / 22 mois : comparer à la roue
   SAMMI (position en bas à droite, bandeau, couleurs, rotation, sons, compteur, « +N jetons »).
3. « Test complet simulé » : l'alerte de sub joue d'abord (onglet Alertes, source des alertes), la roue ensuite.
4. Plus tard (décision économique, `docs/ECONOMY_MIGRATION.md`) : interrupteur ON, vrai sub, puis attribution du gain.

Étapes 1 à 3 validées par Antoni le 19/10/2026.

## 6. Ce qui reste chez SAMMI

Tant que l'interrupteur est OFF : la roue réelle (bouton ID1) et son crédit StreamElements. Au basculement : désactiver
le bouton ID1 **avant** d'activer la roue Raptoru (sinon deux roues et deux gains).
