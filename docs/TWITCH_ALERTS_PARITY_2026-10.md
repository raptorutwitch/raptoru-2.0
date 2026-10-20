# Alertes Twitch — audit de parité legacy (A0, 16/10/2026)

> **Statut courant (17/10/2026, voir § 23)** : **ALERTES V1 — DÉVELOPPEMENT TERMINÉ / PRÊT POUR CUTOVER / NON
> DÉPLOYÉ**. Production : SAMMI / StreamElements legacy. Niveaux de preuve, architecture, checklist du cutover et
> retour arrière : § 23 (les §§ 13 à 22 décrivent chaque lot dans son état du moment).
>
> **Statut du 16/10/2026 (historique, § 16)** : A0 audit **terminé** · A1 fondation (contrat, variantes, file durable)
> **implémentée, validée techniquement** (`5d86e2b`) · A2 rendu OBS + aperçu Studio **implémenté, testé
> automatiquement et examiné visuellement par Antoni** (`b942b58`, `166e7ed`) — validation visuelle globale, pas
> pixel-perfect. **Non branché** aux vrais événements Twitch, **non testé dans OBS**, **pas en production** (SAMMI
> sert toujours les alertes).
>
> **Statut d'origine (A0) : audit et documentation uniquement.** Rien n'est implémenté ; aucune alerte legacy, source OBS, deck
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

## 15. Consolidation A2 (16/10/2026) — synchronisation et timeline

**Réglages** : les 14 variantes du catalogue Core reprennent à l'identique `Twitch_Alerts.html` (vidéo, son,
gabarit, `showAt` / `fadeOutAt` / `hideAt`, durée, zone, position et taille Dofus, volume, priorité). Comme le legacy,
les timings comptent depuis le lancement de l'alerte (pas depuis le départ vidéo). Seul écart voulu : la fin
d'alerte attend la fin du son `keepAudio` (le legacy libérait la file à la fin de la vidéo).

**Mesures sur les vrais médias** (canal alpha image par image, ffmpeg) + images figées Chromium par la timeline :

| Variante                      | Constat                                                                                                                                                     | Classement                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gifts 1 / 5 / 10 / 20 + ciblé | barre opaque à 2,125 s, texte à 2,279 s ; fondu barre 5,708 → 6,083 s ≈ fondu texte 5,745 → 6,093 s ; compteur 0 → N conforme                               | **Concordant**                                                                                                                                                    |
| Dofus Éliatrope               | bandeau plein ~1,58 s, texte 1,60 s ; sortie bandeau 4,25 → 4,6 s, texte parti à 3,7 s                                                                      | **Concordant**                                                                                                                                                    |
| Dofus Émeraude                | bandeau plein ~1,75–1,92 s, texte 2,00 s                                                                                                                    | **Concordant**                                                                                                                                                    |
| Dofus Ébène                   | bandeau qui s'ouvre de 1,42 à 1,67 s ; texte lancé à 1,50 s (≈ 20 % d'opacité à 1,58 s sur un bandeau pas encore plein), lisible une fois le bandeau ouvert | **Incertain** (réglage legacy conservé ; à juger à l'œil, piste : ~1,65 s)                                                                                        |
| Follows Eren / Discord        | élément principal ~1,0 s, texte 0,8 → 4,5 s, son jusqu'à 5,1–5,2 s                                                                                          | **Concordant**                                                                                                                                                    |
| Eren Sub                      | voix continue de 0 à 4,67 s, aucun silence mesurable entre les deux phrases (niveau ~ −23 dB vers 1,4–1,5 s) ; sous-titres 0,3–1,4 s puis 1,5–4,3 s         | **Incertain** (à l'oreille)                                                                                                                                       |
| Bits                          | VP8 + alpha, 1,67 s en boucle, durée imposée 4,15 s ; lu et figé correctement dans Chromium ; texte petit (zone legacy 400×80)                              | **Concordant** (à confirmer dans OBS)                                                                                                                             |
| MoneyTest (don)               | VP8 + alpha 7,2 s ; la vidéo dessine elle-même un panneau gris à ~2,6 s, recouvert par l'encadré à 2,66 s ; fondus 800 / 300 ms conformes                   | **Concordant** ; **écart d'affichage probable** : un pseudo de 8 lettres est coupé (« Donat… ») car le montant se réserve 42 % de la ligne (CSS legacy identique) |
| Raid Titan                    | vidéo 19,92 s (transparente vers 19,0 s), son audible jusqu'à 21,04 s (fichier 21,71 s) ; texte provisoire 1,5 → 8,0 s en haut                              | **Provisoire** (à calibrer)                                                                                                                                       |

**Bugs démontrés et corrigés (aperçu Studio uniquement ; OBS et lecture inchangés)** :

1. Timeline sur Bits / MoneyTest : ces WebM VP8 + alpha n'ont qu'une image clé ; un saut Chromium y échoue
   (`PIPELINE_ERROR_DECODE`) ou, après un saut précédent, affiche **sans erreur** une image corrompue (vérifié contre
   les images décodées par ffmpeg). L'aperçu lit l'en-tête WebM (4 Ko) : VP8 → décodage depuis l'image 0 jusqu'à
   l'instant voulu (précision ± 1 image) ; VP9 → saut direct. La lecture normale (chemin OBS) est propre, y compris
   un don juste après des bits.
2. Timeline sur un fondu vidéo commencé après un autre (MoneyTest à 6,9 s) : le fondu de sortie partait d'une
   opacité fausse (0 au lieu de 0,67). Les animations sont maintenant avancées au temps virtuel avant chaque étape.

**Fiabilité** : file A1 (claim / ACK, une alerte à la fois, pas de rejeu, média manquant → `failed media_missing`,
vidéo cassée → `failed video-error`, redémarrage de Studio) couverte par Playwright ; source OBS disparue en cours de
lecture → `expired` sans rejeu (tests Core). Marges : raid 21,7 s < sécurité 29,9 s < bail 34,9 s.

**Non vérifié** : rendu dans OBS / CEF et dans la fenêtre Electron ; son réel (les tests navigateur sont muets) ;
la petite fixture VP8 des tests ne reproduit pas la corruption (vérifiée sur les vrais fichiers).

## 16. Checkpoint A0 / A1 / A2 (16/10/2026)

| Lot                            | État                                                                   | Preuve                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A0 — audit de parité           | **terminé**                                                            | §§ 1–12 (variantes, médias, sons, textes, timings, sélection, priorités)                    |
| A1 — fondation                 | **implémentée, validée techniquement** (tests auto)                    | `5d86e2b`, § 13 ; réception Twitch réelle **non branchée** (aucun abonnement EventSub créé) |
| A2 — rendu OBS + aperçu Studio | **implémenté, testé automatiquement, examiné visuellement par Antoni** | `b942b58` (§ 14), `166e7ed` (§ 15)                                                          |

**Niveaux de preuve, à ne pas confondre :**

1. **Tests automatiques** (166e7ed) : Core 675 (+ 22 ignorés : PostgreSQL réel absent), Bot 111, Studio 381,
   Playwright 13/13 (dont 7 alertes, Chromium) ; typecheck, lint, build verts.
2. **Vrais médias dans Chromium** (agent) : captures de chaque variante et images figées par la timeline ; mesures du
   canal alpha et des sons (§ 15).
3. **Validation visuelle manuelle d'Antoni** (onglet Alertes du Studio) : « le texte est globalement bien placé,
   certaines alertes présentent des erreurs mineures de formatage et de petites imperfections d'animation, mais le
   résultat général est satisfaisant » — **validation visuelle globale**, pas une validation de chaque variante.
4. **Non testé** : rendu dans une vraie source OBS, son sur la machine de diffusion, enchaînement réel de la file par
   la source OBS, vrais événements Twitch, dons StreamElements.
5. **Production** : rien ; SAMMI / StreamElements servent les alertes.

**Réserves UX / visuelles** (passe ultérieure, aucune corrigée dans ce checkpoint) :

- formats de texte incorrects sur certaines variantes — **à identifier précisément avec Antoni** ;
- petits défauts d'animation (à lister avec Antoni) ;
- Follow Dofus Ébène : texte possiblement un peu précoce (lancé à 1,50 s, bandeau plein à ~1,67 s) ;
- Eren Sub : synchronisation des sous-titres à confirmer à l'oreille si nécessaire ;
- Don MoneyTest : troncature des pseudos longs (CSS legacy identique) ;
- Raid Titan : position, message et timings provisoires.

**Suite proposée (rien n'est lancé sans accord)** :

1. corrections de formatage et d'animation, listées avec Antoni ;
2. test du rendu et du son dans une source OBS de test, hors live ;
3. calibrage persistant dans Studio (inspiré du mode legacy `?calib=1`, A7) ;
4. ensuite : raccordement progressif des événements Twitch réels (déduplication, droits du jeton, consommateur
   EventSub unique), adaptateur des dons StreamElements, neutralisation des sources d'alerte legacy uniquement lors
   d'une bascule contrôlée.

## 17. Finitions et calibrage visuel (17/10/2026, Lab, non validé manuellement)

**Finitions A2** (`f3557f6`, `4a5c14a`), demandées par Antoni après son examen : pseudo coloré par une petite palette
tirée à chaque alerte (follows, Eren Sub, raid, bits, sub offert ciblé ; gifts 1 / 5 / 10 / 20 et MoneyTest
inchangés) ; follows Discord / Eren : entrée / sortie adoucies ; Dofus : texte immobile dans le bandeau (plus de
montée de 30 px ni de saut de 10 px), balayage doré sans grossissement des lettres ; sub offert ciblé : destinataire
seul, une ligne ; bits : entrée animée sur la vidéo elle-même, « [gemme] × N » au-dessus, « {pseudo} me permet de
manger ! » en dessous ; raid : « {pseudo} débarque avec {viewers} titans ! ».

**Calibrage persistant (lot A7, partie placement)** — une seule source OBS 1920×1080, chaque variante placée
indépendamment :

- **Modèle** : par variante, `media` (l'animation entière, textes compris) et `text` (les textes, relatifs à
  l'animation), chacun = décalage (px de la scène) + échelle uniforme depuis le coin haut-gauche. Absent = rendu
  inchangé. Aucune donnée Core ni média modifié.
- **Moteur commun** (`alerts-player/engine.js`) : deux conteneurs `#alertPlace` (vidéo + textes) et `#textPlace`
  (textes) reçoivent seuls la transformation ; les animations CSS validées restent sur les éléments internes
  (centrage, fondus, Dofus, entrée bits).
- **Stockage** : Studio, `<runtime>/alerts/placement.json` (à côté du jeton OBS, hors dépôt et hors paquet, survit
  aux mises à jour) ; écriture atomique ; valeurs validées (décalage ±3 840 px, échelle 10–500 %) ; fichier absent,
  corrompu ou partiellement invalide → entrées valides seulement, sinon rendu d'origine
  (`server/src/alerts/placement-store.ts`).
- **OBS** : `/alerts/next` joint le placement **enregistré** de la variante à chaque alerte réservée ; il est figé
  pour toute l'alerte (une sauvegarde pendant la lecture ne la déplace pas, elle vaut dès la suivante). Aucun cadre
  d'édition dans la page OBS.
- **Éditeur Studio** (onglet Alertes › Calibrage, `web/src/alerts-calibrate.ts` + `alerts-calib.ts`) : cadres et
  poignées dessinés **au-dessus** de l'iframe d'aperçu, en coordonnées scène 1920×1080 (échelle relue à chaque
  mouvement : exact après redimensionnement de la fenêtre) ; éléments « Animation entière » / « Textes » ; glisser,
  poignées d'angle (proportions gardées, angle opposé fixe), champs X / Y / Échelle, flèches 10 px (Maj : 1 px),
  repères centraux, « Masquer les cadres », « Enregistrer », « Annuler les modifications », « Valeurs d'origine »,
  indicateur de modifications non enregistrées. L'aperçu montre le brouillon ; la source OBS, l'enregistré.
- **Preuves** : Studio server 393 (dont `alerts-calib` 6, store / API 3) ; Playwright `e2e/alerts.e2e.ts` 9/9 (dont
  placement enregistré appliqué par la source OBS, inchangé pendant une alerte en cours, appliqué à la suivante,
  aucun cadre en OBS, même transformation dans l'aperçu) ; pilotage de l'onglet réel dans Chromium avec les vrais
  médias (glisser, poignée, texte, sauvegarde, rechargement, fenêtre redimensionnée, flèches, indépendance des
  variantes, Dofus stable une fois calibré, réinitialisation) — **pas** de test dans OBS ni dans Electron.
- **Blocs de texte séparés** (même jour) : une variante peut exposer des blocs calibrables à part (`parts`, dans la
  couche texte, transformés autour de leur centre, appliqués **après** l'ajustement de taille). **Bits** : « Animation
  entière », « Badge Bits » (gemme + « × N ») et « Phrase » ; les autres variantes gardent « Animation entière » +
  « Textes ». Liste par style de texte : `TEXT_PARTS` (`web/src/alerts-calib.ts`), blocs marqués `data-part` par le
  moteur — extensible au raid ou aux sous-titres Eren sans changer le stockage.
- **Limites** : le cadre « Animation entière » est celui de la vidéo (zones transparentes comprises : plein écran
  pour la plupart, 60 % pour Dofus) ; les textes d'une variante bougent ensemble, sauf les blocs déclarés (don :
  l'encadré ; raid : la phrase) ; pas de copie de réglages entre variantes ; les timings (`showAt`…) ne se calibrent
  pas ici.

**Toujours vrai** : réception Twitch réelle non branchée (aucun abonnement EventSub) ; production = SAMMI /
StreamElements.

## 18. Files par famille et lectures simultanées (17/10/2026, Lab, validé manuellement dans OBS le 17/10/2026)

Remplace la règle A1 « une alerte en vol par chaîne » (§ 13) : **une alerte en vol par chaîne et par famille**,
plusieurs familles jouent ensemble dans la même source OBS.

| Famille        | Événements                                       | Couche OBS (bas → haut) |
| -------------- | ------------------------------------------------ | ----------------------- |
| `follow`       | follow (Dofus ×3, Eren, Discord)                 | 1                       |
| `subscription` | sub, resub, sub offert ciblé, gift communautaire | 2                       |
| `bits`         | bits                                             | 3                       |
| `donation`     | don                                              | 4                       |
| `raid`         | raid                                             | 5                       |

- **Core** : colonne `family` (déduite du **type d'événement**, `alertFamilyOf` dans `@raptoru/schemas`), index unique
  « en vol » sur (chaîne, famille), FIFO **par ordre d'arrivée** dans une famille (la priorité legacy reste sur la ligne
  mais ne fait plus doubler une alerte plus ancienne). Le claim rend la plus ancienne alerte en attente parmi les
  familles libres ; le lecteur rappelle tant qu'il en reçoit. Déduplication, variante figée, 3 tentatives avant
  démarrage, jamais de rejeu après démarrage, baux : inchangés. L'ACK peut porter `family` (refus `family_mismatch`).
  Migration Lab additionnelle `20261023120000_alerts_lab_families.sql` (lignes existantes classées depuis leur type),
  ajoutée aux listes Lab (`migration-scopes.ts`, runtime local Studio, `bonk-lab.mjs`, `stage.mjs`).
- **Source OBS** (`alerts-player/player.js`) : chaque alerte a **sa propre instance du moteur** dans sa propre couche
  (vidéo, son, textes, minuteries, couleur du pseudo, placement enregistré), détruite à sa fin ; aucune alerte ne
  touche une autre. Couleurs : une alerte évite la précédente et celles à l'écran. Si la source recevait quand même deux
  alertes d'une famille (bail perdu en pleine lecture), la seconde attend la première. Polling inchangé (1 s), réveil
  immédiat quand une famille se libère.
- **Son** : aucun verrou audio ; chaque alerte garde son volume ; `keepAudio` (Eren Sub, raid) inchangé. **TTS du don** :
  la synthèse vocale de Chromium est **unique par page** (non isolable) ; seule la famille `donation` parle, un don à la
  fois, donc un nouveau don coupe seulement le TTS du don précédent (comportement legacy) ; la fin ou l'arrêt d'une
  autre famille ne coupe plus le TTS (seule l'instance qui a parlé peut l'arrêter).
- **Calibrage** : inchangé (`media` / `text` / `parts`, repère 1920×1080 commun, placement figé par alerte, le suivant
  prend le nouveau) ; la superposition de familles au même endroit est permise.
- **Aperçu Studio** : l'alerte éditée a sa couche (empilée selon sa famille) ; bouton « Superposer les autres
  familles » = un Follow, un Sub, des Bits, un Don, un Raid (hors famille éditée) à leurs positions, dans l'aperçu
  seulement (jamais la file). Éditeur de calibrage, timeline, blocs Bits : inchangés.
- **Preuves** : Core 683 (+22 ignorés) dont familles 7 (10 follows FIFO, sub / gift jamais ensemble, follow + sub
  ensemble, 5 familles en vol, follow suivant pendant un raid, crash par famille, ACK de mauvaise famille / tentative,
  rafale dédoublonnée) et migration depuis une base A1 (1) ; Studio server 392 ; Desktop 24 ; Playwright alertes 12/12
  (dont 3 familles simultanées dans une vraie page OBS, jamais deux d'une famille, z-index, son du raid jamais coupé,
  nettoyage des couches ; superposition dans l'aperçu sans toucher la file) ; vraie page OBS + vrai Core Lab en mémoire
  - **vrais médias** dans Chromium : Follow, Sub, Bits, Don et Raid ensemble (5 couches), positions calibrées, tout
    `completed`. **Pas** de test dans OBS ni Electron.
- **Limites** : les ids DOM du moteur (`#alertVideo`…) se répètent d'une couche à l'autre (le CSS legacy est par id) ;
  un média plein écran opaque (brume du raid) recouvre les familles du dessous, c'est l'ordre voulu ; deux sources OBS
  ouvertes se partageraient les familles (une seule source attendue).

## 19. Source OBS périmée : rechargement automatique sans couper une alerte (17/10/2026, Lab, non validé manuellement)

Constat (diagnostic du 17/10) : une source OBS restée ouverte pendant une mise à jour du lecteur garde l'ancien
JavaScript (le redémarrage de Studio ne la recharge pas, le jeton persistant la laisse fonctionner) ; l'ancien lecteur
jouait une alerte à la fois alors que Core et la base étaient à jour.

- **Version** : Studio calcule une empreinte des fichiers de la source (`player.html`, `player.js`, `engine.js`,
  `timeline.js`, `alerts.css`) **sur disque, à chaque demande** ; `player.html` est servi avec cette version
  (`<meta name="alerts-player-version">`) ; les autres fichiers sont chargés après, donc au moins aussi récents.
- **Contrôle** : chaque demande d'alerte (`/alerts/next`, toutes les secondes au plus) envoie la version de la page ;
  Studio répond toujours avec la version servie. Version différente : **Studio ne réserve rien dans Core** pour cette
  page (aucune alerte réservée sans lecteur pendant la transition). Une page plus ancienne sans version réserve comme
  avant (elle se recharge une fois à la main).
- **Rechargement** : la page ne demande plus rien, attend que **toutes ses alertes** soient finies **et leurs ACK
  envoyés** (y compris les nouvelles tentatives d'ACK) **et** que le TTS du don ait fini de parler, puis
  `location.reload()` (même URL, jeton conservé ; fichiers servis `no-store`). Les autres familles en attente reprennent
  juste après, sur la nouvelle page (rechargement entre deux lectures, sans attendre que la file durable soit vide).
- **Anti-boucle** : une seule tentative par nouvelle version (`sessionStorage`) ; si la page revient encore ancienne
  (cache), elle continue de jouer avec son code (`stale_ok`), sans recharger à nouveau ; sans `sessionStorage`, pas de
  rechargement automatique. Studio / Core injoignable : aucune version reçue, donc aucun rechargement.
- Une demande dont la connexion est déjà coupée (Studio qui s'arrête, page fermée) ne réserve plus rien.
- Aucun changement Core / SQL / calibrage / règles de file.
- **Preuves** : Studio server 398 (dont version servie = version des fichiers, refus de réserver pour une autre
  version, `stale_ok`, version qui suit les fichiers) ; Playwright alertes 14/14 répétés 3 fois (version différente
  pendant raid + follow + gift : rechargement unique après la fin et les ACK de toutes, alerte arrivée pendant la
  transition jouée une fois par la nouvelle page ; page revenue ancienne : un seul rechargement puis elle joue ;
  redémarrage de Studio : aucun rechargement) ; mutations vérifiées (sans attente → échec ; sans garde → 298
  rechargements). Vrais médias, vrai Core Lab en mémoire, Chromium : rechargement 0,09 s après la fin du raid, puis les
  5 familles ensemble aux positions enregistrées. **Pas** de test dans OBS.
- **Limites** : pendant la transition, une famille libre attend la fin des autres (au pire la durée d'un raid, ~20 s) ;
  un TTS bloqué « en train de parler » dans le navigateur retarderait le rechargement (jamais de coupure) ; l'aperçu
  Studio n'est pas concerné (il se recharge avec l'onglet).

## 20. Raccordement des vrais événements Twitch (17/10/2026, Lab, non validé manuellement, rien d'activé)

**Chaîne** : Twitch EventSub (WebSocket) → **adaptateur chat Lab du bot** (`lab-chat-main`, jeton de LeCroupier_, lancé par
Studio quand « Ingestion chat Twitch » est ON) → `lab-alerts-ingest.ts` (normalisation `alert-events.ts`) →
`POST /v1/lab/alerts/events` du **Core Lab** (secret Bearer, base Lab) → déduplication + variante figée + file de la
famille → Studio (`/alerts/next`) → source OBS. **Aucune nouvelle connexion EventSub, aucun nouveau jeton, aucun
nouveau processus** : les abonnements d'alerte s'ajoutent à la connexion Lab existante. Le bot de production
(`index.ts`, désactivé) et le Core de production n'ont aucun code d'alerte (test de garde).

| Événement               | Source EventSub (v)                                                                   | Droit                                            | Statut                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Sub, Prime              | `channel.chat.notification` (1) `sub`                                                 | `user:read:chat` (présent)                       | raccordé                                                                                                               |
| Resub (message partagé) | idem `resub`                                                                          | idem                                             | raccordé (type distinct, animation Eren)                                                                               |
| Gift ciblé              | idem `sub_gift` sans `community_gift_id`                                              | idem                                             | raccordé                                                                                                               |
| Gift communautaire      | idem `community_sub_gift` (+ un `sub_gift` par bénéficiaire avec `community_gift_id`) | idem                                             | raccordé, **une** alerte                                                                                               |
| Bits                    | `channel.chat.message` (1), champ `cheer.bits` (déjà abonné)                          | idem                                             | raccordé                                                                                                               |
| Raid entrant            | `channel.chat.notification` `raid`                                                    | idem                                             | raccordé                                                                                                               |
| Follow                  | `channel.follow` (2), `moderator_user_id` = LeCroupier_                               | **`moderator:read:followers`** (absent du jeton) | prêt, **non reçu** tant que le jeton n'est pas réautorisé (historique : réautorisé le 17/10, vrai follow reçu en TEST) |
| Don                     | StreamElements (hors EventSub)                                                        | JWT SE                                           | **non raccordé** (voir plus bas ; historique : raccordé au § 21)                                                       |

**Déduplication** : clé = identifiant Twitch stable (`message_id` de la notification ou du message de chat ; follow :
`message_id` EventSub, identique sur une redélivrance), unique en base Lab par (chaîne, source, id) : une redélivrance,
une reconnexion ou un redémarrage du bot qui renvoie le même événement donne `duplicate`, sans nouvelle alerte. Le
routeur EventSub ignore aussi les messages déjà vus (mémoire, 500). Gift communautaire : l'alerte vient de
`community_sub_gift` ; chaque `sub_gift` portant son `community_gift_id` devient `gift_recipient`, **absorbé**
(corrélation exacte par id, jamais par pseudo ni délai). Pas de `channel.subscribe` (qui produirait une alerte par
bénéficiaire). Chat partagé : tout événement dont `source_broadcaster_user_id` désigne une autre chaîne est ignoré.
Anonymes : gift (`chatter_is_anonymous`) → « Un généreux anonyme » ; cheer de `ananonymouscheerer` → anonyme (convention
IRC, non observée en réel). Variante tirée une fois à l'admission (inchangé).

**Mode « Événements Twitch réels »** (onglet Alertes, stockage Studio `alerts/twitch-mode.json`, **OFF par défaut** et
si le fichier est illisible ; lu par l'adaptateur à son démarrage, un changement le redémarre) :

- **OFF** : aucun abonnement d'alerte créé, rien n'est lu pour les alertes (le chat continue).
- **TEST** : abonnements créés, événements normalisés et écrits dans le journal de l'ingestion (onglet Simulation),
  **jamais envoyés au Core** : rien en file, rien dans OBS.
- **ACTIVE (Lab)** (confirmation) : envoyés au Core Lab et mis en file ; **la source OBS de ce Studio les joue**, y compris
  si elle est dans une scène de live, en plus des alertes legacy.
- Sans « Ingestion chat Twitch » ON, rien n'arrive, quel que soit le mode. Profil Production : pas d'alertes.

**Résilience** : un abonnement refusé (droit manquant, pas modérateur) est journalisé sans couper l'ingestion du chat ;
Core indisponible → nouvel envoi en mémoire avec le **même id** (1, 2, 4, 8, 15, 30 s ; abandon après 90 s, journalisé),
4xx non réessayé ; arrêt de l'adaptateur → envois en attente abandonnés (journalisés). Charge utile invalide ou
incomplète → ignorée. Reconnexion EventSub : abonnements recréés, et dédoublonnage Core. Jeton refusé : comportement
existant de l'adaptateur (arrêt, motif affiché dans Studio). Aucun jeton dans les journaux.
**Limite** : livraison **non durable** entre le bot et le Core (mémoire seulement), et Twitch ne rejoue pas les
événements d'une session WebSocket perdue : un événement reçu pendant une coupure longue du Core, ou émis pendant une
déconnexion, peut être perdu. Aucune garantie « zéro perte ».

**Dons (StreamElements)** : Raptoru 2.0 n'a aucune intégration StreamElements (seul le legacy `Twitch_Alerts.html`
écoute le socket SE avec un JWT local). Non raccordé. Contrat d'admission prévu : `POST /v1/lab/alerts/events` avec
`source: external`, `source_event_id` = id du tip SE, `type: donation`, `actor.display_name`, `amount` (unités mineures,
`decimal_place`, devise ISO), `provider: streamelements`, `message` ; nécessite une décision (JWT / canal SE) avant tout
adaptateur.

**Preuves** : Bot 122 (dont 10 : modes OFF / TEST / ACTIVE, trames complètes au format de la référence Twitch, anonymes,
Prime, chat partagé, charges invalides, follow sans droit, abonnement refusé, redélivrance, redémarrage, Core
indisponible puis rétabli, 4xx, expiration, arrêt ; garde « jamais en production ») ; Studio server 401 (dont chaîne
complète trames → routeur → adaptateur → **vrai Core Lab** : une alerte par événement, gift communautaire unique,
bits < 10 sous le seuil, familles indépendantes ; rejeu après redémarrage = `duplicate` ; mode OFF / TEST / ACTIVE
enregistré, redémarrage de l'adaptateur, valeur invalide refusée) ; mutations vérifiées. Panneau vérifié dans Chromium.
**Aucun** événement Twitch réel reçu, **aucun** abonnement réel créé (état au commit ; ensuite mode TEST choisi par
Antoni, abonnements créés, vrai follow reçu — § 23).

**Toujours vrai** : production = SAMMI / StreamElements ; rien n'est activé tant qu'Antoni ne choisit pas TEST puis ACTIVE.

## 21. Dons réels StreamElements (17/10/2026, Lab ; aucune connexion réelle au commit, ensuite connecté en TEST par Antoni, § 23)

**Documentation suivie** (docs.streamelements.com, lue le 17/10/2026, pages mises à jour le 14/10/2026) : passerelle
WebSocket **Astro** `wss://astro.streamelements.com/` (`/websockets`), topics `channel.tips` (scope `tips:read`, « un
don une fois terminé ») et `channel.tips.moderation` (`tips:moderation`, états `pending` / `allowed` / `rejected`).
Jetons acceptés : `jwt`, `apikey` (Overlay Token), `oauth2`. **Aucune procédure publique** pour obtenir des
identifiants OAuth2 StreamElements n'est documentée : seuls le JWT et l'Overlay Token (dashboard) sont utilisables.
Les droits exacts de l'Overlay Token sur `channel.tips` ne sont **pas** documentés (à vérifier à la connexion :
Studio affiche le refus éventuel). Astro ne documente **aucune** retransmission des événements manqués pendant une
coupure ; la reconnexion propre passe par `reconnect_token` (abonnements restaurés). Ping / pong : géré par le client
WebSocket (Node / Electron).

**Chaîne** : Astro → `apps/studio/server/src/alerts/se-tips.ts` (serveur Studio, profil Lab) → `POST /v1/lab/alerts/events`
du Core Lab (`source: external`, `source_event_id` = `streamelements-tip-<_id>`, `type: donation`) → dédoublonnage,
variante `don_moneytest` figée → file **donation** → source OBS existante (médias et calibrage du Studio). Aucun
nouveau moteur, aucune nouvelle source OBS, aucun paiement, aucun appel à l'historique (REST) : seul ce qu'Astro pousse
pendant la connexion.

**Normalisation** : nom = `data.donation.user.username` **exactement** (casse, espaces internes, accents, emoji, noms
absurdes ; seuls les espaces de début / fin partent, 64 caractères max, jamais coupé au milieu d'un caractère) ;
« Anonyme » seulement si le nom est vraiment absent ; jamais l'e-mail, le pays ou un autre identifiant (non lus).
Montant : chiffres exacts tels qu'envoyés (`4.2` → 42 × 10⁻¹, `19.99` → 1999 × 10⁻², aucun arrondi flottant), devise
ISO en majuscules ; message ≤ 500 caractères ; date = `createdAt`. Données non fiables : affichées avec
`textContent` (moteur) / échappées (Studio). **Admission** : seulement `status` = `success` **et** `approved` =
`allowed` quand ces champs sont présents (un champ absent n'est pas deviné) ; `pending` → ignoré (le passage à
`allowed` arrive par `channel.tips.moderation`, admis une fois) ; `rejected` / autre statut → ignoré. Le même `_id`
reçu par les deux topics, une reconnexion ou un redémarrage = **une** alerte (base Lab).

**Modes** (indépendants des événements Twitch ; `alerts/se-mode.json`, **OFF** par défaut) : **OFF** = aucune connexion ;
**TEST** = connecté, chaque don dans le journal, **jamais** envoyé au Core ; **ACTIVE (Lab)** (confirmation) = dons
admis mis en file, joués par la source OBS de ce Studio (en plus des alertes StreamElements legacy). TEST ↔ ACTIVE
garde la connexion.

**Secret** : saisi dans l'onglet Alertes (champ masqué, vidé aussitôt) → Electron main → chiffré par Windows
(`safeStorage` / DPAPI, `userData/se-connection.json`, comme le mot de passe OBS) → remis au serveur à chaque démarrage
(mémoire seulement ; route `/api/alerts/se/connect` réservée à main, `x-raptoru-main`). Jamais renvoyé par une API,
jamais écrit par le serveur, jamais dans un journal ni dans une URL OBS.

**Studio** (onglet Alertes, « Dons StreamElements ») : compte (jeton enregistré, type, chaîne SE), état de connexion
(connecté / reconnexion / jeton refusé), état de chaque topic (abonné / refusé + raison), erreur lisible, dernier don,
**journal conservé** (`alerts/se-journal.json`, 200 derniers, 50 affichés, rafraîchi toutes les 2 s) : heure, décision
(TEST · reçu / mis en file / doublon / ignoré + raison / erreur), nom affiché, montant, message, statut, id.

**Résilience** : coupure → reconnexion 2 / 5 / 15 / 30 / 60 s ; message `reconnect` → reconnexion immédiate avec son
jeton, sans réabonnement ; topic des dons refusé (`err_unauthorized` / `err_bad_request`) → « jeton refusé », plus
de tentative jusqu'à un nouveau jeton ; refus du seul topic de modération → noté, les dons continuent ; Core
indisponible → nouvel envoi en mémoire avec le même id (90 s), refus 4xx → ligne « erreur ». Messages malformés :
ignorés, jamais d'arrêt.

**Affichage du nom** (moteur, famille don) : un nom long rétrécit sur sa ligne ; sous 24 px il passe sur sa propre
ligne au-dessus du montant (cadre agrandi vers le bas) et rétrécit encore ; coupé (…) seulement sous 12 px (≈ 60
caractères). Noms courts : mise en page legacy inchangée.

**Preuves** : Studio server 420 (dont `alerts-se` 15 : exemple officiel verbatim, noms, messages, montants exacts,
statuts / modération, messages malformés, JWT, modes OFF / TEST / ACTIVE, secret jamais exposé, accès main seul, refus
du jeton sans boucle, reconnexions, Core indisponible / refus, persistance ; chaîne avec le **vrai Core Lab** : TEST
sans file, ACTIVE = 2 dons MoneyTest exacts, écho de modération / rejeu après redémarrage = doublons, familles
indépendantes ; vues échappées) ; Desktop 26 (stockage chiffré) ; Playwright alertes 15/15 (dont nom long / hostile) ;
mutation vérifiée ; rendu du vrai MoneyTest et de la section Studio vérifiés dans Chromium. **Non testé** : vraie
connexion StreamElements, vrai don, IPC Electron réelle.

**Limites** : pas de garantie « zéro perte » (Astro ne rejoue rien après une coupure, renvoi au Core en mémoire 90 s) ;
si l'Overlay Token n'a pas `tips:moderation`, un don mis en attente puis accepté ne sera pas vu ; valeurs de `status`
autres que `success` non documentées (toutes refusées) ; montant affiché tel qu'envoyé (« 4.2$ » comme le legacy).

## 22. Alertes V1 : module officiel, prêt pour une future mise en service (17/10/2026, local, non déployé)

Décision d'Antoni (17/10/2026) : développement fonctionnel validé ; préparer le module officiel **sans** aucune bascule
(SAMMI, StreamElements legacy et sources OBS actuelles restent seuls en production).

**Dépendances au Lab constatées avant cette passe** : schéma (migrations dans le seul périmètre Lab), routes Core
(`/v1/lab/alerts`, Core Lab seulement), runtime Studio créé en profil Lab seulement, réception Twitch par l'adaptateur
chat Lab (`lab-chat-main`), StreamElements dans le serveur Studio Lab. **Déjà indépendants du profil** : médias,
calibrages, jeton de la source OBS (`runtimeDir/alerts`), moteur OBS, règles de file (service unique). Le mot « Lab »
dans `AlertsService` / `alerts-routes` ne désigne pas un second système : c'est l'implémentation canonique, comme
`BonkLabService` / `SoundLabService` / `TtsLabService`, que le Core de production sert déjà.

**Architecture officielle (une seule implémentation)** :

| Couche         | Profil Lab                                                                  | Profil Production (préparé, non actif)                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schéma         | `20261022…_alerts_lab.sql` + `20261023…_alerts_lab_families.sql` (base Lab) | `20261024120000_alerts.sql` (périmètre prod, additif, idempotent ; schéma identique, testé)                                                                                                                                                                               |
| Core           | `alertsRoutes(alerts)` → `/v1/lab/alerts/*` (secret Studio)                 | **même fonction** `alertsRoutes(alerts, { channelId })` → `/v1/studio/alerts/*` (identifiant d'installation Studio, chaîne du Core seulement, événements `twitch` refusés depuis Studio) ; `AlertsService` dans `createCore`, monté si installations + chaîne configurées |
| Studio         | `AlertsRuntime` (environnement `lab`)                                       | **même runtime** (environnement `production`, client d'installation `prodCoreClient`) ; mêmes médias, calibrages et URL OBS                                                                                                                                               |
| StreamElements | `SeTipsLink` → Core Lab                                                     | même lien → Core de production ; mode / journal séparés (`runtimeDir/production/alerts`)                                                                                                                                                                                  |
| Twitch         | adaptateur chat Lab (connexion EventSub Lab existante)                      | **non raccordé** : le bot de production n'a aucun code d'alerte (voir blocages)                                                                                                                                                                                           |

**Cycle de vie** : aucun mode réel n'est repris automatiquement — un ACTIVE enregistré (Twitch ou StreamElements)
redémarre en **TEST** (observation), signalé dans l'onglet jusqu'à un nouveau choix. Files et historiques dans la base
du Core (survivent aux redémarrages ; bail / reprise / jamais de rejeu après démarrage, § 13 / § 18) ; paramètres et
journal SE dans le stockage Studio ; jeton SE chiffré par Electron (DPAPI). Reconnexions : EventSub (adaptateur Lab),
Astro (2 → 60 s, `reconnect_token`), source OBS (interrogation 1 s, rechargement si périmée, § 19), Core indisponible
(nouvel envoi en mémoire 90 s). Pas de garantie « zéro perte » : ni Twitch ni StreamElements ne rejouent une
déconnexion. Aucun processus ajouté : SE vit dans le serveur Studio, Twitch dans l'adaptateur existant ; l'état de la
source OBS se déduit de son interrogation (aucun polling en plus).

**Studio** : onglet « Alertes · Core » (en-tête « Core Lab » / « Core production » selon le profil réel) ; Aperçu
(local, sans file) / **Simulation (file réelle)** / événements réels **OFF · TEST · ACTIVE · Core Lab|production**
(confirmation pour ACTIVE) ; état de la source OBS (connectée, à jour, ancienne version, silencieuse) ; Twitch
« indisponible dans ce profil » en Production ; StreamElements : compte, connexion, topics, erreur, dernier don,
journal conservé.

**Checklist de la future bascule OBS (à faire avec Antoni, rien de fait aujourd'hui)** :

1. Prérequis : Core de production déployé avec la migration `20261024120000_alerts.sql` et `TWITCH_CHANNEL_ID`
   (accord d'Antoni) ; Studio apparié (profil Production) ; médias importés (18/18, « Médias » dans l'onglet) ;
   réception Twitch de production décidée (voir blocages).
2. Source : celle déjà créée dans la collection de scènes, URL copiée de l'onglet (`http://127.0.0.1:4100/alerts/player.html#<jeton>`,
   jeton local, inchangé entre les profils), 1920 × 1080, fond transparent ; **ne pas** cocher « Arrêter la source quand
   elle n'est pas visible » (elle doit interroger la file en continu) ; une seule source par file.
3. Répétition hors live : Simulation (file réelle) de chaque famille, son, calibrage ; puis événements réels en TEST.
4. Bascule par type, legacy coupé **pour ce type seulement** (sinon double alerte) : Twitch (follow, subs / gifts,
   bits, raid) → ACTIVE ; dons → ACTIVE StreamElements après avoir coupé l'alerte de don legacy (SE / page
   `Twitch_Alerts.html`) ; Streamlabs : sources visibles à neutraliser.
5. Retour arrière (immédiat) : mode OFF dans l'onglet (Twitch et/ou StreamElements) **et** réactiver la source legacy
   du type ; la source Raptoru peut rester dans la scène (sans alerte, elle n'affiche rien). Aucune donnée legacy
   n'est modifiée par Raptoru.

**Bilan** — A. **Terminé** : moteur, files par famille, calibrage, rechargement des sources périmées, réception Twitch
(Lab) et StreamElements, schéma + routes de production, runtime Studio multi-profil, garde de démarrage ; **validé
manuellement** : animations, calibrages, files simultanées dans OBS, vrai follow reçu en TEST, connexion
StreamElements (abonnements créés). B. **Prêt mais inactif** : routes `/v1/studio/alerts` (Core non déployé),
migration de production (non appliquée), profil Production des alertes (aucun Studio apparié en production), modes
réels OFF / TEST. C. **À valider** : vrai don, chaque sous-type Twitch réel, bascule OBS, stabilité en live. D.
**Blocages avant mise en service** : (1) le bot Twitch de production n'envoie aucun événement d'alerte au Core de
production — choix à faire (bot de production + route `bot`, ou adaptateur Studio en profil Production) et
modification du bot à autoriser ; (2) déploiement du Core de production + migration (accord) ; (3) appairage Studio
production ; (4) ne pas lancer deux consommateurs EventSub avec le même jeton (garde existante côté Studio).

**Preuves** : Core 689 (+22 ignorés) dont `alerts-prod-migration` (schéma prod = schéma Lab : colonnes, contraintes,
index ; service sur la base prod ; idempotence) et `alerts-production-routes` (cycle complet par identifiant
d'installation, refus : sans identifiant, autre chaîne, événement `twitch`, routes Lab absentes, routes non servies
sans chaîne) ; Studio server 426 (`--maxWorkers=4` ; en parallélisme par défaut, des fichiers sans rapport dépassent
leur délai sous charge sur ce PC, limite connue) dont `alerts-production` (runtime + SE + source OBS sur le **vrai**
`createApp` de production : tout passe par `/v1/studio/alerts`, Twitch « indisponible ») et la garde « ACTIVE jamais
repris » (Twitch et SE) ; Bot 123 ; Desktop 26 ; Playwright alertes 15/15 ; onglet vérifié dans Chromium. Rien
déployé, aucune base distante touchée, aucun mode réel changé, OBS non modifié.

## 23. Statut officiel et dossier de reprise du cutover (17/10/2026)

**ALERTES V1 — DÉVELOPPEMENT TERMINÉ / PRÊT POUR CUTOVER / NON DÉPLOYÉ** (décision d'Antoni, 17/10/2026 : chantier
clôturé ; les derniers raccordements se feront pendant la migration globale de Raptoru 2.0). Ce statut ne veut **pas**
dire que les alertes Raptoru 2.0 sont actives : la production reste SAMMI / StreamElements legacy. Code : HEAD
`beb42b1` (local, non poussé ; `origin` = `c7f20de`).

### 23.1 Niveaux de preuve (ne pas les confondre)

| Élément                                                                         | Implémenté | Testé auto                 | Validé par Antoni                                                                                       | Connecté en réel                                                          | En production |
| ------------------------------------------------------------------------------- | ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| Moteur OBS, 18 médias, sons, animations                                         | oui        | oui                        | **oui** (OBS)                                                                                           | —                                                                         | non           |
| Calibrage persistant (média, texte, blocs Bits)                                 | oui        | oui                        | **oui** (enregistré : `bits_default` ; autres variantes aux valeurs d'origine, validées telles quelles) | —                                                                         | non           |
| 5 familles, FIFO, dédoublonnage, ACK, bail                                      | oui        | oui                        | **oui** (files simultanées dans OBS)                                                                    | —                                                                         | non           |
| Rechargement des sources OBS périmées                                           | oui        | oui                        | non                                                                                                     | —                                                                         | non           |
| Twitch EventSub (adaptateur Lab, LeCroupier\_)                                  | oui        | oui                        | **vrai follow reçu en TEST**                                                                            | oui, Lab, mode TEST (`channel.chat.notification`, `channel.follow` créés) | non           |
| Sub, resub, gifts, Bits, raid réels                                             | oui        | oui (fixtures Twitch)      | non                                                                                                     | reçus seulement si l'événement survient (TEST)                            | non           |
| StreamElements Astro (`channel.tips`, `channel.tips.moderation`)                | oui        | oui (fixtures officielles) | connexion établie, abonnements créés                                                                    | oui, Lab, mode TEST (jeton chiffré par Electron)                          | non           |
| Vrai don StreamElements                                                         | —          | —                          | **non** (aucun don reçu à ce jour)                                                                      | —                                                                         | non           |
| Core de production (`/v1/studio/alerts`, migration `20261024120000_alerts.sql`) | oui        | oui                        | non                                                                                                     | **non** (Core non déployé, migration non appliquée)                       | non           |
| Profil Production de Studio pour les alertes                                    | oui        | oui                        | non                                                                                                     | non (aucun Studio apparié en production)                                  | non           |

Réglages relevés le 17/10/2026 (non modifiés) : événements Twitch **TEST**, dons StreamElements **TEST**, ingestion
chat ON ; jeton de LeCroupier\_ avec `moderator:read:followers` mais **sans** `user:write:chat` /
`moderator:manage:announcements` depuis la réautorisation (la « Sortie chat réelle » des Commands V2 ne peut plus
écrire : ajouter `LAB_CHAT_OUTPUT=true` à côté de `LAB_ALERTS_FOLLOW=true` avant toute nouvelle réautorisation).

### 23.2 Architecture canonique (fichiers)

- **Contrat** : `packages/schemas/src/alerts.ts` (`AlertEventInput`, `ALERT_FAMILIES`, `alertFamilyOf`).
- **Core** : `apps/core-api/src/alerts/` (`service.ts` file durable, `rules.ts` décision / variante, `variants.ts`
  catalogue). Routes `apps/core-api/src/http/alerts-routes.ts` : **une** fonction servie deux fois — Lab
  `/v1/lab/alerts/*` (secret Studio, `bonk-lab/lab-core.ts`) et production `/v1/studio/alerts/*` (identifiant
  d'installation, chaîne du Core ; montée par `http/server.ts` si `studioInstallations` + chaîne ; service créé dans
  `app.ts` → `createCore`).
- **Routes** (mêmes sous-chemins) : `GET catalog`, `POST events`, `GET {canal}/state`, `GET items/{id}`,
  `POST {canal}/claim`, `POST items/{id}/ack` (`started` / `completed` / `failed`, `family` vérifiée). En production,
  un événement `source: twitch` venant de Studio est refusé (réservé au bot).
- **Schéma** : Lab `20261022120000_alerts_lab.sql` + `20261023120000_alerts_lab_families.sql` ; production
  `20261024120000_alerts.sql` (même schéma, testé ; additif, idempotent ; retour arrière dans l'en-tête du fichier).
- **Studio** : `apps/studio/server/src/alerts/runtime.ts` (source OBS, médias, calibrage, relais claim / ACK,
  environnement `lab` | `production`), `placement-store.ts`, `media-store.ts`, `se-tips.ts` (Astro) ; lecteur
  `apps/studio/server/alerts-player/` (`player.js`, `engine.js`, `timeline.js`, `alerts.css`) ; onglet
  `apps/studio/web/src/alerts-*.ts` ; câblage `apps/studio/server/src/index.ts` ; jeton SE
  `apps/studio/desktop/src/se-credentials.ts` + `main.ts` (`studio:se:*`).
- **Twitch** : normalisation `apps/twitch-bot/src/alert-events.ts` ; adaptateur `lab-alerts-ingest.ts`, branché dans
  `lab-chat-ingest.ts` / `lab-chat-main.ts` (connexion EventSub Lab de LeCroupier\_, lancée par Studio).
- **Stockage local** : `<runtimeDir>/alerts/` (médias + `manifest.json`, `placement.json`, `player-token`,
  `twitch-mode.json`, `se-mode.json`, `se-journal.json`), commun aux deux profils sauf StreamElements en Production
  (`<runtimeDir>/production/alerts/`) ; jeton SE : `%APPDATA%/Raptoru Studio/se-connection.json` (DPAPI).
- **Source OBS** : `http://127.0.0.1:4100/alerts/player.html#<jeton>` (jeton local, inchangé entre les profils).

### 23.3 Modes actuels (provisoires) et dépendances encore propres au Lab

- Modes séparés Twitch / StreamElements : **OFF** (aucune connexion ni abonnement) · **TEST** (reçu, journalisé,
  jamais mis en file) · **ACTIVE · Core Lab | Core production** (mis en file, avec confirmation). Un ACTIVE enregistré
  redémarre en TEST : **comportement provisoire**, à remplacer au cutover (23.4, points 6 et 7).
- Encore propres au Lab : la réception Twitch (adaptateur chat Lab, profil Lab seulement) et son mode (lu par
  l'adaptateur à son démarrage) ; le journal TEST Twitch (journal de l'ingestion, onglet Simulation). Tout le reste
  (moteur, files, Core, StreamElements, Studio) existe déjà pour le profil Production.

### 23.4 Checklist du cutover des alertes (pendant la migration globale)

**Raccordement Twitch officiel — réserve principale : un lot de développement, pas un interrupteur.** Le bot de
production (`apps/twitch-bot/src/index.ts`, désactivé) a déjà **deux** connexions EventSub : principale (jeton
LeCroupier\_ : `stream.online` / `stream.offline`, `channel.chat.message`) et « loyalty » (jeton broadcaster
`raptoru_` : `channel.subscribe`, `channel.subscription.message`, `channel.subscription.gift`, `channel.cheer`,
`channel.follow`). Sans troisième connexion ni abonnement en double :

1. Choisir la source des alertes : soit `channel.chat.notification` + cheers de `channel.chat.message` sur la
   connexion principale (choix du Lab : un gift communautaire = une alerte, corrélation `community_gift_id`), soit les
   abonnements broadcaster existants (mais `channel.subscribe` arrive aussi pour chaque bénéficiaire d'un gift :
   corrélation à écrire). Follow : un seul abonnement `channel.follow` qui alimente loyalty et alertes.
2. Core : route bot `POST /v1/bot/alerts/events` (auth `bot`, chaîne du Core) — **n'existe pas encore**.
3. Bot : réutiliser `alert-events.ts` / `lab-alerts-ingest.ts` (chemin d'envoi à paramétrer) dans la connexion choisie.
4. Arrêter l'adaptateur chat Lab en production (un seul consommateur par jeton ; la garde Studio « bot déjà
   connecté » existe) — lié à la migration de l'ingestion chat des autres modules (P1-007).
5. Autorisations : `user:read:chat` et `moderator:read:followers` présents sur LeCroupier\_ (broadcaster : idem pour
   le follow) ; ne réautoriser qu'avec la liste complète des options du `.env` (voir 23.1).

**Activation définitive** (remplace les modes provisoires) :

6. Un contrôle principal « Alertes activées » (Twitch, dons), état **persistant côté Core** (lu par le bot et par
   Studio : le mode ne peut plus vivre seulement dans le stockage Studio, puisque le bot de production n'est pas lancé
   par Studio). Démarrage automatique avec Studio après l'activation initiale, reconnexions automatiques, plus de
   réactivation à chaque lancement : **retirer** alors la règle ACTIVE → TEST au démarrage (et ses tests).
7. Garder séparés l'aperçu, la simulation (file réelle) et l'observation (TEST) dans l'onglet.

**Core et données** :

8. Appliquer `20261024120000_alerts.sql` au Core de production au moment voulu, avec le déploiement du Core qui sert
   `/v1/studio/alerts` ; vérifier `TWITCH_CHANNEL_ID`, l'identité Studio appariée, `GET /v1/studio/alerts/catalog`.
9. Conserver `<runtimeDir>/alerts/` (médias, calibrages, jeton OBS) : rien à migrer, commun aux profils. En profil
   Production, vérifier le jeton SE (rendu par Electron à chaque démarrage) et le mode SE de ce profil (OFF au premier
   lancement).

**OBS et legacy** :

10. Source officielle : la source existante (URL de l'onglet), 1920 × 1080, fond transparent, « Arrêter la source
    quand elle n'est pas visible » **décoché** ; l'onglet doit afficher « Source OBS connectée, à jour ».
11. Identifier précisément les sources legacy au moment du cutover (lecture OBS et SAMMI) : page
    `Twitch_Alerts.html` (déclenchée par SAMMI pour follow, subs, gifts, bits ; dons par le socket StreamElements de la
    page), sources Streamlabs encore visibles (bits, don, raid), alertes StreamElements éventuelles.
12. Coexistence : basculer **type par type**, le legacy coupé pour ce type seulement (sinon double alerte) ; ne
    désactiver un système legacy qu'après la validation du type.
13. Retour arrière immédiat : couper la source dans l'onglet (OFF, puis « Alertes activées » coupé) et réactiver la
    source legacy du type ; Raptoru ne modifie aucune donnée legacy.

**Validations différées** (ne bloquent pas la clôture du développement ; nécessaires pour déclarer le cutover
réussi) : vrai don StreamElements ; subs, resubs, gifts (ciblés, communautaires, anonymes), Bits, raids réels ;
parcours complet événement réel → Core de production → file → OBS ; stabilité pendant un vrai stream (reconnexions,
aucune alerte en double, source OBS stable).

**Vérifications automatiques à relancer au cutover** : Core (`alerts-*`, `alerts-production-routes`,
`alerts-prod-migration`, `migration-scopes`), Studio server (`alerts-*`, `alerts-production`, `alerts-twitch-chain`,
`alerts-se*` ; `--maxWorkers=4` sur ce PC), Bot (`alert-events`, `lab-alerts-ingest`), Desktop (`se-credentials`),
Playwright `e2e/alerts.e2e.ts`.

## 23. Bot de production raccordé ; réception et fraîcheur dans Studio (lots 8–9, 20/10/2026, local, non déployé)

Le blocage « Twitch : non raccordé » du § 22 est levé côté code : le bot de production transmet les vraies alertes au
Core principal (`POST /v1/bot/alerts/events`, outbox durable, drapeau `ALERTS_MODE` OFF par défaut, lot 8) et rapporte sa
réception (`POST /v1/bot/alerts/status`, lot 9). En profil Production, « Événements Twitch réels » affiche ce rapport en
lecture seule (actif / test / inactif / indisponible / sans nouvelles) ; Studio ne crée aucun abonnement. Fraîcheur des
animations : `ALERTS_MAX_AGE_SECONDS` sur le Core, désactivée par défaut. Détails et preuves : `docs/ECONOMY_MIGRATION.md`
§§ 16–17. À ajouter aux vérifications du cutover : `lot9-main-core` (Studio), `economy-lot9.integration` (Core, PG).
