# Alertes Twitch — audit de parité legacy (A0, 16/10/2026)

> **Statut : audit et documentation uniquement.** Rien n'est implémenté ; aucune alerte legacy, source OBS, deck
> SAMMI, configuration StreamElements / Streamlabs ni abonnement EventSub n'a été modifié. Lecture seule des decks
> SAMMI (`decks_data.json`), des collections de scènes OBS (`%APPDATA%/obs-studio/basic/scenes/`), du dossier
> `C:\Users\Antoni\Videos\Alertes Twitch Pour Claude\Version webm\` et du code Raptoru 2.0. Aucun secret recopié
> (jetons d'URL masqués ; `streamelements.local.js` non lu).
>
> Légende : **[CODE]** confirmé dans le code / la configuration legacy lue · **[CONFIG]** configuration trouvée mais
> non vérifiée en fonctionnement · **[ND]** comportement non documenté · **[V2]** amélioration facultative proposée.

## 1. Inventaire des alertes réellement utilisées

**Moteur principal (Twitch) : SAMMI + page HTML locale.** SAMMI ne dessine rien : pour chaque événement, un bouton
du deck change l'URL de la source navigateur OBS **« Alerte Twitch »** (1920×1080) vers
`…/Version webm/Twitch_Alerts.html?alerte=<variante>&pseudo=…`, la rafraîchit, **attend un délai fixe**, puis remet
l'URL sans paramètre [CODE]. La page joue la vidéo webm, le son et place le texte en HTML/CSS.

**Affichage** : la scène **« Alerte complète »** est superposée à toutes les scènes par un **Downstream Keyer** OBS
(« DSK 1 », exclu de « Slow Mo FAIL ») [CODE, collection `Twitch_Dofus`]. Elle contient « Alerte Twitch » (SAMMI)
**et** des sources **Streamlabs encore visibles** : « Alerte bits », « Alerte don », « Alerte Raid » (« Alerte
abonnement » est masquée) [CODE]. Le registre (S0) déclare les alertes Streamlabs **OBSOLETE** : leur activité réelle
côté Streamlabs n'est pas vérifiable ici [ND] → décision n° 1.

| Variante (id legacy)     | Événement                  | Sélection             | Média (webm)                                           | Son                                                                                          | Texte (HTML)                                                                                                                 | Prio |
| ------------------------ | -------------------------- | --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- |
| `follow_dofus_ebene`     | follow                     | tirage pondéré **20** | `Dofus Ebène Son.webm` (4 674 ms, 4K)                  | intégré à la vidéo                                                                           | `{pseudo}` dans la bannière, 1 500 → 3 500 ms, top 31 %, ≤ 38 px                                                             | 10   |
| `follow_dofus_eliatrope` | follow                     | pondéré **20**        | `Dofus Eliatrope Son.webm` (4 716 ms, 4K)              | intégré                                                                                      | `{pseudo}`, 1 600 → 3 700 ms, top 29 %, ≤ 44 px                                                                              | 10   |
| `follow_dofus_emeraude`  | follow                     | pondéré **20**        | `Dofus Emeraude Son.webm` (4 299 ms, 4K)               | intégré                                                                                      | `{pseudo}`, 2 000 → 3 300 ms, top 29,8 %, ≤ 35 px                                                                            | 10   |
| `follow_eren`            | follow                     | pondéré **20**        | `Alerte follow Eren.webm` (6 292 ms, 4K)               | `son_follow_eren.mp3`                                                                        | « {pseudo} vient de follow ! », 800 → 4 500 ms                                                                               | 10   |
| `follow_discord`         | follow                     | pondéré **1** (rare)  | `Alerte follow Discord monsieur.webm` (6 299 ms, 4K)   | `son_follow_discord.mp3`                                                                     | « {pseudo} vient de follow ! », 800 → 4 500 ms                                                                               | 10   |
| `eren_sub`               | sub (resub ? voir § 4)     | unique                | `Eren Sub Glitch.webm` (4 417 ms)                      | `Eren Voiceline Sub.mp3` (le son continue après la vidéo, `keepAudio`)                       | sous-titres : « Qu'est-ce que tu fous ?! » 300 → 1 400 ms, puis « Remercie {pseudo} pour son abonnement ! » 1 500 → 4 300 ms | 30   |
| `subgift_1`              | cadeau communautaire 1–4   | seuil `count < 5`     | `Alerte Sub 1.webm` (6 341 ms)                         | intégré, volume 0,15                                                                         | « {gifter} × {N} » (compteur animé) zone 820,261 · 319×48, 2 279 → fondu 5 745 → 6 093 ms                                    | 30   |
| `subgift_5`              | cadeau communautaire 5–9   | seuil `≥ 5`           | `Alerte Sub 5.webm` (6 341 ms)                         | idem                                                                                         | idem                                                                                                                         | 35   |
| `subgift_10`             | cadeau communautaire 10–19 | seuil `≥ 10`          | `Alerte Sub 10.webm` (6 341 ms)                        | idem                                                                                         | idem                                                                                                                         | 40   |
| `subgift_20`             | cadeau communautaire ≥ 20  | seuil `≥ 20`          | `Alerte Sub 20.webm` (6 341 ms)                        | idem                                                                                         | idem                                                                                                                         | 50   |
| `subgift_targeted`       | sub offert ciblé           | événement distinct    | `Alerte Sub 1.webm`                                    | idem                                                                                         | « {gifter} offre un abonnement à {recipient} ! » ; anonyme → « Un généreux anonyme »                                         | 30   |
| `bits_default`           | bits ≥ **10**              | unique                | `Alerte Bits.webm` (boucle, durée imposée 3 850 ms)    | intégré, volume 0,5                                                                          | « {pseudo} a envoyé {amount} bits ! » zone 761,156 · 400×80, 800 → fondu 3 800 → 4 150 ms                                    | 20   |
| `don_moneytest`          | don (tip StreamElements)   | unique                | `MoneyTest.webm` (fondus 800 / 300 ms, durée 7 600 ms) | `Son Alerte Don.mp3` + **TTS navigateur** « {pseudo} a donné {montant}. Message du don : … » | nom + montant + message (3 lignes), zone 925,597 · 408×168, 2 660 → 6 800 ms                                                 | 40   |
| (Streamlabs)             | raid                       | —                     | alert-box Streamlabs                                   | Streamlabs                                                                                   | Streamlabs                                                                                                                   | —    |

Volume global de la page : 0,5 (sauf volumes par variante ci-dessus). Les durées de médias ont été mesurées dans
Chromium (Bits / MoneyTest : non chargées en headless ; durées imposées par la page).

**Texte intégré dans les médias** : les 12 webm échantillonnés (6 images chacun) **n'intègrent aucun texte** ; les
zones de texte sont vides dans la vidéo (barre noire des subs offerts, bannière Dofus) et remplies par la page
[CODE + vérification visuelle partielle]. Bits et MoneyTest non inspectés visuellement [ND]. Conséquence : la V2 doit
garder le texte en surimpression HTML, jamais en double, et prévoir un drapeau « texte intégré » par variante pour un
futur média qui en aurait.

Hors périmètre de ce document : `Alerte_system.html` (ancien Bonk + **roue des subs**, RET-ECO-007, économie),
« Ban Bits » (timeoutwithbits, modération), alertbox Twitch native « Point de chaîne pour emote animée » (masquée),
goals / boîtes de chat StreamElements.

## 2. Sources de déclenchement

| Événement            | Source legacy                                                                                                                                                                                                        | Détail                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Follow               | SAMMI, déclencheur Twitch follow (`trg 6`), bouton `ID_FOLLOW` « Alerte Follow Dofus » [CODE]                                                                                                                        | variante tirée par SAMMI dans une liste pondérée [CONFIG : pondération par la commande SAMMI, non exécutée ici]     |
| Sub / resub          | SAMMI, déclencheur sub (`trg 1`) du bouton `ID1` « Roue Sub » : normal, Prime, tiers 1–3, pas de gift, communauté exclue, filtre de mois `monthmax 2` [CONFIG]                                                       | après l'alerte (6 000 ms), le même bouton lance la **roue des subs** (crédit de Jetons StreamElements, RET-ECO-007) |
| Sub offert ciblé     | SAMMI, déclencheur sub (`trg 1`) avec `subgift` + `anonsubgift`, **communauté exclue** (`allowcommunity 0`), bouton `ID_SUBGIFT_TARGETED` [CODE]                                                                     | donateur, bénéficiaire, contexte, tier transmis à la page                                                           |
| Cadeau communautaire | SAMMI, déclencheur gift communautaire (`trg 2`, 1–999, tiers 1–3), bouton `ID39` « Animsubgift » [CODE]                                                                                                              | `subgift=N` → seuil 1 / 5 / 10 / 20 choisi par la page                                                              |
| Bits                 | SAMMI, déclencheur bits (`trg 5`, 10–99 999 999), bouton `ID_BITS_ALERT` [CODE] + alertbox Streamlabs bits visible [CONFIG]                                                                                          |                                                                                                                     |
| Raid                 | **Aucun bouton SAMMI** ; seule l'alertbox Streamlabs « Alerte Raid » (DSK) [CONFIG]                                                                                                                                  | absent du registre retenu                                                                                           |
| Don                  | **StreamElements realtime** (socket.io, JWT local) ouvert **dans** `Twitch_Alerts.html`, événements `tip` (+ tests SE acceptés) [CODE] + alertbox Streamlabs « Alerte don » (dons + Twitch Charity) visible [CONFIG] | fournisseur effectif → décision n° 1                                                                                |

Existe aussi un **bus local inutilisé** : `alertes_server.js` (port 3001 : `/api/alert`, SSE `/events`, dédoublonnage 60 s,
file de 100 en l'absence de client) et `recevoirAlerteBus` dans la page ; la page **ne s'y connecte pas** [CODE] → ne
pas le considérer comme actif.

## 3. Médias et sons (chemins)

Dossier : `C:\Users\Antoni\Videos\Alertes Twitch Pour Claude\Version webm\` (4,1 Go pour tout le dossier parent, dont
masters `.mov`). Utilisés par les alertes : `Alerte follow Discord monsieur.webm`, `Alerte follow Eren.webm`,
`Dofus Ebène Son.webm`, `Dofus Eliatrope Son.webm`, `Dofus Emeraude Son.webm`, `Eren Sub Glitch.webm`,
`Alerte Sub 1|5|10|20.webm`, `Alerte Bits.webm`, `MoneyTest.webm` ; sons `son_follow_discord.mp3`,
`son_follow_eren.mp3`, `Eren Voiceline Sub.mp3`, `Son Alerte Don.mp3`. Rendu : `Twitch_Alerts.html` (17/09/2026, avec
4 sauvegardes `.bak`), outil `Calibrer_Bits.html`. Les masters `.mov` (et `Alerte Sub *.mov`) ne sont pas utilisés par
la page. **Aucun asset à recréer.**

## 4. Comportements historiques (12 points par événement)

| Point                | Follow                                                                                                                                                                                                                                     | Sub / resub                                                    | Sub offert ciblé                                    | Cadeau communautaire                                        | Bits                                          | Raid                     | Don                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1. Source            | SAMMI follow [CODE]                                                                                                                                                                                                                        | SAMMI sub [CODE]                                               | SAMMI sub (gift) [CODE]                             | SAMMI gift communautaire [CODE]                             | SAMMI bits [CODE] + Streamlabs [CONFIG]       | Streamlabs [CONFIG]      | SE tip dans la page [CODE] + Streamlabs [CONFIG]                                                     |
| 2. Déclenchement     | tout follow                                                                                                                                                                                                                                | normal, Prime, T1–T3 ; resub : filtre de mois non élucidé [ND] | gift ciblé, anonyme inclus                          | 1–999 gifts                                                 | ≥ 10 bits                                     | [ND]                     | tout tip (tests SE inclus)                                                                           |
| 3. Données           | pseudo                                                                                                                                                                                                                                     | display name (tier / mois non affichés)                        | donateur, bénéficiaire, tier, contexte              | donateur, nombre                                            | pseudo, montant (message lu mais non affiché) | [ND]                     | nom, montant (EUR forcé), message                                                                    |
| 4. Texte             | § 1                                                                                                                                                                                                                                        | § 1 (sous-titres)                                              | § 1                                                 | § 1 (compteur animé 0 → N)                                  | § 1                                           | [ND]                     | § 1 + TTS                                                                                            |
| 5. Son               | intégré (Dofus) / mp3 (Eren, Discord)                                                                                                                                                                                                      | voix Eren                                                      | intégré                                             | intégré                                                     | intégré                                       | [ND]                     | mp3 + TTS                                                                                            |
| 6. Animation         | 5 variantes                                                                                                                                                                                                                                | 1                                                              | 1 (média Sub 1)                                     | 4 seuils                                                    | 1 (boucle)                                    | Streamlabs               | 1                                                                                                    |
| 7. Durée             | SAMMI attend **5 500 ms** (vidéos Eren / Discord : 6,3 s → coupées) [CODE]                                                                                                                                                                 | **6 000 ms** puis roue                                         | **6 500 ms**                                        | **6 500 ms**                                                | **4 500 ms**                                  | [ND]                     | 7 600 ms (page)                                                                                      |
| 8. File / priorités  | page : file triée par priorité puis ordre d'arrivée [CODE] **mais** chaque alerte SAMMI recharge la page (file perdue) ; SAMMI : boutons `queueable`, follow et gift ciblé `overlappable` → **une alerte peut en couper une autre** [CODE] | idem                                                           | idem                                                | idem                                                        | idem                                          | indépendant (Streamlabs) | dans la page (perdue au rechargement suivant)                                                        |
| 9. Regroupement      | non                                                                                                                                                                                                                                        | non                                                            | séparé du communautaire (`allowcommunity 0`) [CODE] | une alerte pour le lot ; pas d'alertes individuelles [CODE] | non                                           | —                        | non                                                                                                  |
| 10. Doublons         | aucun contrôle [CODE]                                                                                                                                                                                                                      | aucun                                                          | aucun                                               | aucun                                                       | risque double SAMMI + Streamlabs [CONFIG]     | —                        | tip id mémorisé dans la page (perdu au rechargement) [CODE] ; risque double SE + Streamlabs [CONFIG] |
| 11. Live / hors live | joué dès que SAMMI et OBS tournent [ND]                                                                                                                                                                                                    | idem                                                           | idem                                                | idem                                                        | idem                                          | idem                     | idem                                                                                                 |
| 12. Réglages Studio  | aucun (code HTML + outil de calibrage dans la page)                                                                                                                                                                                        | —                                                              | —                                                   | —                                                           | —                                             | —                        | —                                                                                                    |

**Outil existant** : `Twitch_Alerts.html?calib=1&grid=1&alerte=<id>` [CODE] — choix de la variante, pseudo de test,
lecture / pause / ±0,01 s / curseur, volume, grille 1920×1080, zone de texte déplaçable et redimensionnable, marques
« début du pseudo / début du fondu / disparition totale », **« Copier les réglages »** (le résultat est ensuite recopié
à la main dans le code). Couvre les subs offerts et les bits (zone) ; les follows Dofus utilisent un `pseudoTop` en %,
le don des variables CSS.

## 5. Risques de duplication et d'interruption

1. **SAMMI + Streamlabs** sur les bits et les dons (sources Streamlabs visibles dans le DSK) [CONFIG].
2. **SE tips + Streamlabs dons** si les deux plateformes reçoivent des dons [CONFIG].
3. **Interruptions** : chaque alerte SAMMI réécrit l'URL et recharge la page ; une alerte en cours (ou un don en
   cours de lecture) est coupée par la suivante ; le délai fixe SAMMI coupe les vidéos plus longues (follow Eren /
   Discord) [CODE]. C'est exactement RET-ALERT-007.
4. **Redélivrances** : aucun dédoublonnage côté Twitch ; un même événement redélivré rejoue l'alerte [ND côté SAMMI].
5. **Cadeau communautaire** : le legacy évite les alertes individuelles (`allowcommunity 0`) ; en EventSub, les
   `channel.subscribe` des bénéficiaires n'indiquent pas le donateur → corrélation nécessaire (voir § 7).
6. **Double consommateur EventSub** : un nouveau consommateur concurrent du Bot (P1-007) ; à éviter.
7. **Coexistence pendant les tests** : Raptoru et SAMMI / Streamlabs afficheraient la même alerte → tester en Lab sur
   une source OBS séparée, ou couper le legacy pendant le test réel.

## 6. Composants Raptoru 2.0 réutilisables

- **Bot Twitch (EventSub)** : un seul processus et une seule connexion EventSub ; abonnements broadcaster déjà codés
  (`channel.follow` v2, `channel.subscribe`, `channel.subscription.message`, `channel.subscription.gift`,
  `channel.cheer`, derrière `LOYALTY_TWITCH_EVENTS`, coupé ; jeton broadcaster `raptoru_` non autorisé) avec **outbox
  durable** et dédoublonnage Core par identifiant d'événement. L'adaptateur Lab (Studio) lit déjà `channel.chat.message`
  et l'état du stream avec le jeton de LeCroupier_. **Pas de `channel.raid`.**
- **Core** : files durables à états (Bonk / Soundboard / TTS : `queued → claimed → started → completed`, bail,
  `execution_unknown` sans rejeu, idempotence par clé), sessions de stream (live / hors live), routeur chat Lab.
- **Studio** : lecteurs OBS servis par Studio avec jeton, heartbeat, claim / ACK et journal durable (Soundboard / TTS) ;
  push SSE (son du Jeu des mots) ; obs-websocket en lecture (connexion, scène, sources) ; onglet **Simulation** (tests
  sans vrai événement) ; stockage des sons de la Tombola (copie dans le stockage Studio).
- **Rendu** : `Twitch_Alerts.html` lui-même (table des variantes, timings, file, compteur, outil de calibrage) est la
  meilleure base de parité : le porter plutôt que le réécrire.

## 7. Architecture V1 minimale

1. **Réception (Bot, un seul consommateur)** — option recommandée [à vérifier en réel] : `channel.chat.notification`
   (sub, resub, sub offert avec `community_gift_id`, cadeau communautaire avec total, raid, dons Twitch Charity) +
   bits via `channel.chat.message` (`cheer`) + `channel.follow` v2 (modérateur), **avec le jeton de LeCroupier_**, sans
   jeton broadcaster. Alternative : les abonnements broadcaster déjà codés (jeton `raptoru_` à autoriser) + `channel.raid`.
   Dons externes : adaptateur du fournisseur choisi (décision n° 1), hors EventSub.
2. **Core** : `POST` d'un événement normalisé (identifiant = message EventSub ou id du tip) → table d'événements
   (unique par source + id : une redélivrance ne crée rien) → **une alerte** en file avec sa variante choisie par Core
   (tirage pondéré du follow, seuil des gifts, ciblé / communautaire ; les `sub_gift` portant un `community_gift_id`
   sont absorbés par l'alerte du lot). États : `received → queued → claimed → playing → completed | failed | expired`
   (même bail / ACK / `execution_unknown` que Soundboard / TTS ; jamais rejouée après redémarrage).
3. **Studio** : un worker réclame **une alerte à la fois** (priorités legacy, pas d'interruption), la remet à la source
   OBS « Alertes Raptoru » (page portée de `Twitch_Alerts.html`, servie par Studio, jeton), reçoit les ACK
   (`started` / `completed`) ; supervision (en attente, en cours, OBS connecté), tests depuis l'onglet Simulation,
   activation / désactivation par type.
4. **Aperçu et calibrage V1** : porter l'outil `?calib=1` dans Studio — même page de rendu dans une iframe 1920×1080
   mise à l'échelle (fidélité OBS), choix de la variante, lecture / rejeu / curseur, zone de texte déplaçable,
   marques d'apparition / fondu / disparition, volume, variables simulées (pseudo, montant, nombre de gifts,
   bénéficiaire, message) ; **« Enregistrer »** dans la configuration (au lieu de « Copier les réglages »). Faisabilité
   **élevée** : l'outil existe déjà ; ce n'est pas un éditeur vidéo. Les modifications artistiques restent dans le code.

## 8. Décisions manquantes

Voir les questions en fin de document (seules celles qui bloquent l'implémentation).

## 9. Plan de migration (petits lots)

| Lot           | Contenu                                                                                                                                                                                                                        | Validation         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| **A0** (fait) | ce document                                                                                                                                                                                                                    | relecture d'Antoni |
| **A1**        | Core : événements d'alerte (dédoublonnage), file à états, choix de variante (follow pondéré, seuils, ciblé / communautaire, absorption des `sub_gift` d'un lot) ; tests (redélivrance, ordre, priorités, reprise, aucun rejeu) | tests auto         |
| **A2**        | Studio : page de rendu portée (assets legacy, mêmes timings), worker claim / ACK, source OBS « Alertes Raptoru », tests depuis Simulation (sans événement Twitch)                                                              | Antoni, OBS Lab    |
| **A3**        | Réception follow / sub / resub (Bot, voie choisie), événements simulés + réels en Lab                                                                                                                                          | Antoni             |
| **A4**        | Cadeaux ciblés et communautaires (corrélation, aucun doublon individuel / global)                                                                                                                                              | Antoni             |
| **A5**        | Bits (≥ 10) et raid (si retenu)                                                                                                                                                                                                | Antoni             |
| **A6**        | Dons : adaptateur du fournisseur retenu (dédoublonnage par id de don, TTS si conservé)                                                                                                                                         | Antoni             |
| **A7**        | Studio : panneau compact (file, en cours, activation par type, volume / durées existants), aperçu + calibrage enregistrés, non-régression Bot / OBS / transport, checkpoint                                                    | Antoni             |

## 10. Validation (Lab puis OBS)

1. Tests automatiques par lot (aucun vrai follow / sub / bits / raid / don émis).
2. Onglet Simulation : chaque type et chaque variante simulés ; redélivrance du même id ; rafale (ordre, priorités,
   aucune coupure) ; cadeau communautaire de 1 / 5 / 10 / 20 et sub offert ciblé.
3. OBS Lab : source « Alertes Raptoru » ajoutée à côté du legacy (DSK inchangé) ; coupure OBS / rechargement de la
   source pendant une alerte (reprise sans rejeu) ; redémarrage Studio.
4. Live simulé et hors live (comportement choisi).
5. Réel : avec le legacy coupé pour le type testé, vrais événements sur la chaîne (ou chaîne de test).

## 11. Questions à trancher avant A1

1. **Streamlabs et dons** : les alertbox Streamlabs (bits, don, raid) visibles dans le DSK sont-elles encore actives
   côté Streamlabs ? Où arrivent réellement les dons : tips **StreamElements** (écoutés par `Twitch_Alerts.html`),
   **Streamlabs**, ou les deux ?
2. **Raid** : absent du registre retenu et sans animation locale (Streamlabs seulement). Le garder en V2 ? Si oui,
   avec quel média ?
3. **Resub** : même alerte que le sub (`eren_sub`) ? Le filtre de mois du déclencheur SAMMI n'est pas lisible.
4. **Réception** : voie `channel.chat.notification` + follow avec le jeton de LeCroupier_ (recommandée, aucun jeton
   broadcaster), ou abonnements broadcaster déjà codés (autoriser le jeton `raptoru_`) ?
5. **Assets** : copier les 16 fichiers utilisés dans le stockage Studio (recommandé, legacy intact) ou les lire en place
   dans `Videos\Alertes Twitch Pour Claude\Version webm\` ?
6. **Hors live** : jouer les alertes hors live comme aujourd'hui, ou seulement pendant un live ?

## 12. Décisions d'Antoni (16/10/2026)

Streamlabs n'est plus le fournisseur d'alertes actif (les alertes personnalisées sont la référence ; sources OBS
Streamlabs laissées en place, à neutraliser avant la mise en service pour éviter les doublons) · **raid conservé**
(aucun média legacy : variante provisoire `raid_default` sans animation ni son, à définir) · **resub = animation Eren**
du sub, mais deux événements distincts · médias **copiés** dans un stockage géré par Studio au lot A2 (originaux
intacts) · alertes **hors live autorisées** (aucune dépendance à une session Twitch).

## 13. Lot A1 — fondation (16/10/2026, Lab, non validé manuellement)

- **Contrat** `@raptoru/schemas` `AlertEventInput` : `source` (`twitch` / `external` / `simulation`),
  `source_event_id` (clé d'idempotence), `type` (`follow`, `sub`, `resub`, `gift_targeted`, `gift_community`,
  `gift_recipient`, `bits`, `raid`, `donation`), acteur, anonymat, bénéficiaire, nombre de gifts,
  `community_gift_id`, tier / Prime, mois, bits, viewers, montant en unités mineures + devise, fournisseur, message
  (données non fiables : à échapper à l'affichage).
- **Variantes** (`apps/core-api/src/alerts/variants.ts`) : les 13 variantes legacy avec leurs valeurs exactes (média,
  son, zone, gabarit de texte, apparition / fondu / disparition, durée, volume, priorité) + `raid_default` provisoire ;
  poids du follow 20/20/20/20/1, seuils de gifts 1 / 5 / 10 / 20, bits ≥ 10. Règles pures (`rules.ts`), tirage
  injectable ; la variante est **figée dans l'alerte** (jamais retirée au sort après un redémarrage ou un nouvel essai).
- **File durable** (migration Lab `20261022120000_alerts_lab.sql`, `alerts/service.ts`) : `alert_events` (unique par
  chaîne + source + id : une redélivrance ne crée rien) et `alert_items` (`queued → claimed → playing → completed`,
  `failed`, `expired`). Réservation atomique sous verrou de chaîne, **une alerte en vol par chaîne** (index unique),
  priorité puis ordre d'arrivée. Politique : réclamée mais jamais commencée → reproposée (3 tentatives max) ;
  commencée sans fin dans son bail → `expired`, jamais rejouée ; échec du lecteur → `failed`. Une alerte transmise
  n'est jamais « terminée » sans le rapport du lecteur. Motif conservé pour le diagnostic.
- **Gifts communautaires** : un `sub_gift` qui porte un `community_gift_id` devient `gift_recipient`, absorbé (aucune
  alerte individuelle) ; corrélation exacte par identifiant Twitch, jamais par pseudo ou par délai.
- **API Lab** (Core Lab, secret Bearer, aucun endpoint public) : `POST /v1/lab/alerts/events` (injection, y compris
  `source: simulation`), `GET /v1/lab/alerts/:canal/state`, `GET /v1/lab/alerts/items/:id`,
  `POST /v1/lab/alerts/:canal/claim`, `POST /v1/lab/alerts/items/:id/ack` (`started` / `completed` / `failed`).
- **Bot** (`apps/twitch-bot/src/alert-events.ts`) : normaliseurs `channel.chat.notification` (sub, resub, sub_gift,
  community_sub_gift, raid, charity_donation ; `shared_chat_*` ignorés), `channel.chat.message` (`cheer.bits`),
  `channel.follow` v2, `channel.raid`. **Non branchés** : aucun abonnement créé.
- **Isolation** : aucune écriture Wallet, ledger ou Loyalty (testé) ; aucun drapeau économique activé.
- **Preuves** : Core `alerts-rules` + `alerts-service` (26), Bot `alert-events` (10) ; suites Core 674 (+ 22 ignorés),
  Bot 111 ; tests Studio adossés au Core 39 ; lint, format, types.

**Limites de la réception Twitch** : les noms de champs suivent la référence EventSub (vérifiée le 16/10/2026), pas
encore du trafic réel. Brancher la voie recommandée demande de **créer** les abonnements `channel.chat.notification`
et `channel.follow` (jeton de LeCroupier_ : `user:read:chat` déjà présent ; `moderator:read:followers` à vérifier) —
changement réel à faire sur accord. Un unfollow / refollow produit un nouveau follow (comme le legacy). Les dons
StreamElements (tips) n'ont pas encore d'adaptateur (point d'intégration : `source: external`).

**Reste pour A2** : copier les médias legacy dans le stockage Studio ; porter la page de rendu (`Twitch_Alerts.html`)
en source OBS servie par Studio, alimentée par la variante figée ; worker Studio claim / ACK ; tests depuis l'onglet
Simulation ; aperçu / calibrage (A7).

## 14. Lot A2 — médias, rendu OBS, aperçu Studio (16/10/2026, Lab, non validé manuellement)

- **Médias** (`apps/studio/server/src/alerts/media-store.ts`, `import-cli.ts`) : copies **exactes** dans le stockage
  Studio `<données>/apps/studio/server/.runtime/alerts/media` (hors Git, survit aux mises à jour), nommées par
  empreinte SHA-256, `manifest.json` par nom legacy. L'import ne fait que **lire** les originaux et vérifie l'empreinte
  de chaque copie. Import réel fait : 18 / 18 (16 legacy « Version webm » + raid) ; originaux revérifiés identiques.
- **Raid** : `Titan Avi 4.avi` (BGRA brut, alpha réel, 1920×1080, 12 i/s, 19,92 s) converti en `Raid Titan.webm`
  (VP9 `yuva420p`, CRF 28, sans audio, 5,8 Mo) ; alpha redécodé identique (±0,05/255), contrôle Chromium : ombre et
  transparence conservées, aucune incrustation. Le MP3 séparé (21,7 s) est copié tel quel et **prolonge** l'alerte
  (`keepAudio`). Texte / position / timings du raid **provisoires** (`provisional: true`).
- **Moteur unique** (`apps/studio/server/alerts-player/`) : `timeline.js` (pur : planning des textes, fin d'alerte,
  formats legacy) + `engine.js` (DOM, ids / classes du legacy, CSS legacy `alerts.css` portée telle quelle). Même
  code pour la source OBS (`player.html`) et l'aperçu (`preview.html`). Texte viewer **uniquement via textContent**.
- **Fin d'alerte** = cycle réel : durée imposée + 300 ms (legacy) sinon fin de la vidéo ; un son `keepAudio` repousse
  la fin jusqu'à sa dernière seconde ; délai de sécurité (média + 10 s) < bail Core → `failed timeout`.
- **Source OBS** : `http://127.0.0.1:4100/alerts/player.html#<jeton>` (jeton persistant), seule consommatrice de la
  file A1 : `POST /alerts/next` (claim Core avec son identifiant) → lecture → ACK `started` au vrai départ vidéo, puis
  `completed` ou `failed` (motif). Média absent au moment du claim → `failed media_missing` par Studio (jamais joué à
  moitié). Une alerte à la fois (verrou Core), pas de file parallèle en mémoire.
- **Onglet Studio « Alertes Lab »** : catégorie, variante (média manquant signalé, raid « provisoire »), fausses
  données (Normal, Pseudo long, HTML hostile, Anonyme), Lancer / Rejouer / Arrêter, volume de l'aperçu (vidéo, son,
  TTS), timeline image par image (±0,01 s, ±1 image, `fps` mesuré par variante), état des médias, file Core, URL OBS
  à copier, « Envoyer dans la file » (événement `simulation` par Core → joué par la source OBS). L'aperçu **ne réclame
  ni n'acquitte jamais** rien.
- **Preuves** : Studio `alerts-timeline` / `alerts-studio` / `alerts-view` (27), Playwright Chromium
  `e2e/alerts.e2e.ts` (7 : aperçu isolé de la file, Stop, raid prolongé par le son, HTML hostile, compteur de gifts,
  anonyme, Dofus long, claim / ACK, deux sources simultanées = une alerte à la fois, pas de rejeu après rechargement,
  média absent, vidéo cassée, redémarrage de Studio, timeline) ; Core 675 (+ 22 ignorés), Bot 111, Studio 381 ;
  captures Chromium de chaque variante avec les vrais médias.
- **Limites** : aucun test dans OBS réel ni Electron ; raid provisoire ; Bits / MoneyTest sont du VP8 + alpha (lus par
  Chromium, à confirmer dans OBS) ; les noms / montants longs du don sont tronqués comme dans le legacy (pas de boucle
  d'ajustement d'origine) ; Bot toujours non branché (aucun abonnement EventSub) ; calibrage persistant = A7.
