# Audit — module Mini-jeux et Random Ban V2

12/11/2026. **Audit en lecture seule**, complété le même jour après les décisions d'Antoni (§ 12). Ce document
garde les **constats** (ce qui existe, ce que permet Twitch, les risques) ; les règles en vigueur sont dans la
[SPEC](SPEC_RANDOM_BAN_V2.md), l'avancement dans le [PLAN](PLAN_IMPLEMENTATION.md). Les « Aucun code modifié » ci-dessous
valent pour la phase d'audit ; le développement a commencé ensuite dans le même worktree.
- Worktree `Raptoru 2.0 - Worktrees\mini-jeux-random-ban`, branche locale `audit/mini-jeux-random-ban`, partie
  d'`origin/main` `c1632825`.
- Le `main` local du checkout principal a **547 commits de retard** : il n'a pas servi.
- Aucun code modifié, aucune migration, aucun appel Twitch en écriture, aucune requête sur une base de Production.
- Le site a été lu dans le worktree `raptoru-fr-refonte` (`e33d697`).

**Légende :**
- **[code]** : lu dans le code ;
- **[test]** : couvert par un test automatisé ;
- **[réel]** : validé en réel par Antoni, avec une trace écrite ;
- **[doc Twitch]** : documentation officielle ;
- **[communauté]** : forum ou rapport non officiel ;
- **[hypothèse]**.

## 0. Synthèse

1. **Random Ban existe déjà et il est en Production** (V3, 27/10). Une seule logique, deux moyens de paiement :
   - la récompense de points de chaîne « Ban aléatoire » ;
   - `!rb`, à 25 000 Jetons par défaut, prix réglable dans Studio.

   La file, le tirage, le timeout, le remboursement, l'animation et l'historique existent.
   - **Ce qui manque :** l'achat depuis l'extension, la cible souhaitée (Sniper), une animation de tirage, l'anti-rafale,
     les actions de modération (annuler, rembourser, bloquer pour ce module) et les statistiques Sniper.
2. **Le tirage n'est pas fait par le Core, mais par l'exécuteur du bot** (`apps/twitch-bot/src/random-ban-executor.ts`).
   - Il lit les chatters, mélange au hasard cryptographique, puis prend le premier qui suit la chaîne.
   - Le Core enregistre la cible **avant** l'envoi du timeout, et tire lui-même le streamer (2 %).
   - Le serveur est donc bien l'autorité : bot et Core sont deux serveurs à nous. L'extension n'a aucun moyen d'influer.
   - **Mais le bot ne remonte au Core que des compteurs**, pas la liste des éligibles. Une animation qui montre les
     éligibles demande que le bot en remonte un échantillon.
3. **Twitch ne fournit pas la liste de ceux qui regardent la vidéo.** Il fournit seulement les comptes **connectés au
   chat** (« Get Chatters »), avec un délai de mise à jour [doc Twitch]. L'ensemble éligible doit être défini
   honnêtement à partir de là (§ 6).
4. **Timeout et extension :**
   - Twitch masque les extensions aux utilisateurs bannis depuis le 09/11/2020 [annonce Twitch sur le forum
     développeurs] ;
   - des développeurs rapportent la même chose pour les timeouts, sur ordinateur [communauté] ;
   - un développeur rapporte qu'elles restaient visibles sur l'application Android, et Twitch a transmis à son équipe
     sans suite connue [communauté] ;
   - c'est exactement ce que tu observes. **Cela relève de la plateforme, pas de notre code** (§ 8).
5. **Double-clic et plein écran :**
   - le script officiel de Twitch chargé dans notre iframe (`twitch-ext.min.js`) écoute `dblclick` sur le `document`, en
     phase de remontée, et le **relaie au lecteur** ;
   - un `stopPropagation()` sur nos contrôles empêche donc ce relais ;
   - Bonk le fait déjà depuis l'import de l'extension de Production. **Une correction ciblée et centralisée est possible**
     (§ 9). Son effet réel est à confirmer en Hosted Test.
6. **Le mot « mini-jeux » est déjà pris :**
   - dans le Core, `mini_games` désigne Roulette, Slot et Duel dans le chat (`modules/mini-games.ts`) ;
   - le nouveau conteneur de l'extension doit porter un identifiant distinct pour éviter toute confusion (UX § 1).
7. **Le socle existe :**
   - l'hôte de modules du Core (`modules/host.ts`) fournit le paiement idempotent avec `expected_price`, la pause
     globale, le blocage « partout », le journal `module_activity`, le remboursement de modération et la supervision ;
   - le shell v2 de l'extension fournit l'achat en deux temps (`purchase.js`) et le modèle « Coffre mystère ».

   **Limites :**
   - l'hôte ne gère que le blocage « partout », pas un blocage par module ;
   - les tables de blocage et de délai de la modération D4 ont une liste de modules figée par contrainte SQL ;
   - ajouter `random_ban` demande donc une **migration**.

## 1. Random Ban : ce qui existe

| Élément | Où | État |
| --- | --- | --- |
| Règles fixes (durées, raisons, délais, poids de l'acheteur, streamer, animations) | `packages/schemas/src/random-ban.ts` | [code] |
| Service : file, verrou par chaîne, états, cible, résultat, remboursement dû, animation, mute du streamer | `apps/core-api/src/random-ban/service.ts` (1 162 lignes), table `rb_requests` | [code] [test] (6 fichiers de tests Core, dont 3 sur un vrai PostgreSQL) |
| `!rb` : débit et demande dans **une** transaction, rejeu sans 2ᵉ débit, refus avant débit, remboursement automatique une fois, rattrapage toutes les 15 s | `apps/core-api/src/chat-interactions/random-ban-chat.ts` | [code] [test] |
| Points de chaîne « Ban aléatoire » (3 000 points) → même demande | `channel-points/service.ts` | [code] [test] ; validé en réel le 18/10 pour la V2 [réel] |
| Prix de `!rb` réglable (1 000 à 1 000 000, défaut 25 000) | `module-settings/service.ts` (`random_ban.price`) | [code] |
| Exécuteur Twitch (recherche, timeout unique, reprise après redémarrage par journal local) | `apps/twitch-bot/src/random-ban-executor.ts` | [code] [test] (600 lignes) |
| Animation sur le lecteur d'effets de Studio (9 variantes + CSC + flop) | `apps/studio/server/src/random-ban/runtime.ts`, `effects-player/player.js` | [code] [test] |
| Studio › Sanctions › Random Ban : règles, verrous, essais sans sanction, essais réels, suivi des demandes, fiche acheteur / cible | `apps/studio/web/src/pages/sanctions-random-ban.ts` | [code] |
| Mute du streamer (2 %), Caution du mute, micro partagé | `service.ts`, `caution/`, `channel-points/mute-holds.ts` | V3 livrée le 27/10, **non validée en réel** (`RANDOM_BAN_V2.md`) |
| Défis : `random_ban_sent`, `random_ban_landed`, `random_ban_received` | `challenges/metrics.ts` | [code] ; aucun défi créé |
| Statistiques par viewer : `sent / landed / backfired / flops / received` | `module-stats/service.ts`, site `api/modules.js`, `public/app/profile.js` | [code] ; visibles par le viewer seul |
| Historique SAMMI (avant le 20/10) | site `lib/random-ban-stats.js` | lu par le site, séparé |
| Supervision du Centre de contrôle | `modules/status-adapters.ts` (`randomBanModule`) | [code] |
| Dock OBS : demandes Random Ban dans le fil | `dock/service.ts` | [code] |

**Machine à états actuelle** (`rb_requests.status`) :

```text
queued ─(bot réclame)→ searching ─(cible annoncée)→ timeout_requested ─→ confirmed
   │                       │                              ├─→ failed (refusé : refund=needed)
   │                       ├─→ flop (aucun éligible, rien remboursé)  └─→ uncertain (refund=to_verify)
   │                       └─→ failed (lecture Twitch impossible, droit manquant : refund=needed)
   └─(non réclamé en 2 min)→ failed (refund=needed)
dry_run → simulated     ·     streamer tiré (2 %) → timeout_requested (reason streamer_mute) → confirmed / repart en tirage viewers
```

- **Animation :** `none → pending → playing → completed | failed | unknown`, ou `skipped` si le résultat arrive plus de
  2 min après la demande.
- **Remboursement :** `none | needed | to_verify`. Seuls les achats `chat` sont remboursés automatiquement, en Jetons ;
  les points de chaîne restent « nécessaire » à la main.

**Ce qui n'existe pas :**
- annulation (aucun état `canceled`) ;
- retrait de la file par un modérateur ;
- remboursement manuel d'un Random Ban `uncertain` depuis Studio ;
- blocage ou délai propres à Random Ban ;
- levée de timeout ;
- cible souhaitée ;
- prime ;
- source `extension` : la contrainte SQL n'accepte que `channel_points`, `chat` et `test`.

## 2. Tirage réel : ce que fait l'exécuteur

D'après `searchTarget()` [code] [test] :

1. Il lit **tous** les chatters (Get Chatters, pages de 1 000), sans le diffuseur.
2. Il exclut les **modérateurs**, dont LeCroupier_ et les bots modérateurs, et les **bannis ou en timeout**, par lots de
   100.
3. Il mélange avec Fisher–Yates et `crypto.randomInt`.
4. Il vérifie le follow dans l'ordre mélangé, 8 à la fois, et **le premier qui suit est tiré**. C'est un tirage uniforme
   parmi les éligibles, sans avoir à tous les vérifier.
5. **L'acheteur** rencontré dans cet ordre n'est gardé qu'avec une probabilité de 1/4 : sa chance vaut 1/4 de celle des
   autres. Seul éligible, il est tiré quand même.
6. **Le streamer** est tiré à part par le Core, 2 % des fois, seulement si Studio est prêt : c'est un mute OBS de 60 s,
   jamais un timeout Twitch.
7. Sanction : timeout de 3 min pour un abonné, 5 min sinon, par LeCroupier_. Jamais de ban permanent.

**Constats :**
- **Les comptes exclus de la fidélité** (`loyalty_exclusions` : bots, tests) **ne sont pas exclus du Random Ban**. Un bot
  non modérateur qui suit la chaîne est tirable. Exclusion retenue (SPEC § 6), pas encore codée.
- **Le nombre d'éligibles exact n'est jamais connu :** `candidates` compte les chatters avant la vérification du follow.
  On sait seulement que la cible suit.
- **Aucune exclusion temporaire de la cible :** un viewer qui sort de son timeout est de nouveau tirable aussitôt.
  C'était la décision « aucun cooldown par cible ».
- Le délai entre l'achat et le timeout n'est pas mesuré dans les données lues : il n'y a pas de durée de recherche
  dans `stats`. Estimation [hypothèse] :
  - réclamation par le bot : il interroge toutes les 1 s ;
  - chatters et filtres : 2 à 4 appels ;
  - un ou deux tours de vérification du follow, l'abonnement, le timeout ;
  - **environ 1 à 4 s** au total.

## 3. Économie

- `EconomyPort` (`economy/economy.ts`), en vigueur dans le Wallet canonique de Production :
  - `debit` dans la transaction d'admission ;
  - `refund(interactionId)`, une seule fois ;
  - `move` : un mouvement signé, **avec une clé**, donc jamais payé deux fois au rejeu ;
  - `adjust` : correction de modération.
- **La prime Sniper** peut passer par `move`, avec la clé `rb:sniper:<request_id>` : idempotente par construction. Le
  type de mouvement est à choisir : `mini_game` existe déjà ; un type propre demanderait une migration. Voir PLAN § 2.
- **Ordres de grandeur** (docs du dépôt) : Daily de 500 à 2 000 Jetons ; présence 10 ou 20 Jetons toutes les 6 min ;
  `!rb` à 25 000 Jetons.

## 4. Extension Twitch

- **Deux shells :**
  - `legacy`, publié, présumé `0bf7907` (fichier `PUBLISHED`) ;
  - `v2`, en Hosted Test, emballé sur l'inventaire validé par Antoni.

  Les vues sont communes aux deux. Un nouveau module doit être écrit pour **v2** (guide `docs/extension/SOCLE.md`), et
  n'existera dans le legacy que si on l'y importe.
- **Modèle à suivre :**
  - « module du module host » (`/modules/v3`) ;
  - `registerViewerModule` et `createPurchaseButton` (`shared/purchase.js`) : une clé d'idempotence par intention,
    deux temps (prix puis confirmation), `expected_price` refusé si le prix a changé ;
  - modèle concret : `shared/coffre-mystere.js`, Lab.
- **Identité :** l'achat demande l'identité partagée (`requestIdShare`). Le JWT porte alors `user_id`, l'identifiant
  Twitch stable. Le Core n'a jamais affaire aux pseudos pour identifier quelqu'un.
- **Restrictions :** `shared/viewer-restrictions.js` sait afficher les blocages et délais de TTS, Soundboard, Bonk et
  Tombola. Random Ban n'y figure pas.
- **Modération dans l'extension :** `shared/moderation-v2.js` et `module-moderation.js` (historique, retrait,
  remboursement), pour les modules connus.
- **Mise en page :**
  - le composant vidéo est un panneau plein-iframe (565×376 dans le Lab), pas un tiroir ;
  - la composition de référence est 651×434, avec des échelles et des planchers de texte ;
  - le mobile et le panneau sont étroits (318 px).
- **Contraintes :** aucune dépendance externe (CSP Twitch, tout est dans le zip), pas de `setInterval` à soi, pas de
  mesure de fenêtre.

## 5. Studio, overlays, statistiques

- **Studio :**
  - la page Sanctions › Random Ban sert au réglage, aux essais et au suivi ;
  - la modération D4 a ses permissions (`PERMISSIONS`, `GRANTS`) et son audit ;
  - Random Ban n'est pas dans ses listes d'actions (`block_viewer`, `set_cooldown`, `refund`).
- **Overlay :**
  - c'est le lecteur d'effets de Studio, une source navigateur OBS ;
  - Studio interroge le Core toutes les 500 ms et ne joue une animation qu'**après** le timeout confirmé ;
  - aucune source OBS n'est rechargée ;
  - une animation non jouée dans les 2 min est abandonnée.
- **Défis :**
  - le Core **recompte** chaque métrique depuis sa table source, donc sans doublon possible ;
  - un remboursement sort du compte au passage suivant ;
  - défis publics ou secrets, récompense en objet ou en Jetons, idempotente ;
  - un défi Sniper n'a besoin que d'une **métrique de plus** lue dans `rb_requests` ; pas de second gestionnaire.
- **Statistiques :**
  - Core : `module-stats` (route du site, viewer connecté seulement) ;
  - site : profil personnel. Aucune statistique Random Ban n'est publique ; c'est à Antoni de décider ce qui le devient
    (MODULE_STATS § Décisions).

## 6. Twitch : ce qui est possible

| Besoin | Réalité | Source |
| --- | --- | --- |
| Liste exhaustive des spectateurs de la vidéo | **impossible** : aucun endpoint | [doc Twitch], index de l'API |
| Comptes connectés au chat | Get Chatters : « users that are connected to the broadcaster's chat session », avec un délai de mise à jour ; jeton de modérateur `moderator:read:chatters` ; 1 000 par page | [doc Twitch] |
| Spectateurs anonymes | non listés : ils n'ont pas de compte connecté au chat | déduction de la définition ci-dessus |
| Lurkers | listés seulement s'ils sont connectés au chat ; la doc ne le précise pas | [hypothèse] |
| Avatars | Get Users : 100 identifiants par appel, `profile_image_url` | [doc Twitch] |
| Timeout | Ban User avec `duration` de 1 s à 1 209 600 s ; `moderator:manage:banned_users` ; 409 si un autre modifie l'état au même moment | [doc Twitch] |
| Changer un timeout en cours | possible : un nouvel appel change la durée, d'où le risque d'écraser le timeout d'un modérateur | [doc Twitch] |
| Lever un timeout | Unban User (`DELETE /moderation/bans`) : « Removes the ban or timeout » | [doc Twitch] |
| Extension pour un utilisateur banni | masquée depuis le 09/11/2020 | annonce sur le forum développeurs (jbulava, 30/01/2021) |
| Extension pendant un timeout | masquée selon des développeurs, sans texte officiel | [communauté] (BarryCarlyon, 05/12/2020) |
| Extension bannie sur mobile | encore visible sur Android en mars 2021 ; « passed along to the Extensions team », sans suite | [communauté] et réponse Twitch |
| Empêcher le plein écran au double-clic | relayé par le helper **seulement si `dblclick` atteint le `document`** (lu dans `twitch-ext.min.js`) ; Bonk l'empêche déjà sur son chargeur | script officiel ; code du dépôt |
| Revue Twitch et double-clic | un membre du forum affirme qu'intervenir sur les raccourcis du lecteur fait « très probablement » échouer la revue ; mais la protection Bonk est dans la version publiée | [communauté] (2021) ; [code] |
| Mobile | `isFullScreen` et `arePlayerControlsVisible` ne sont pas envoyés sur mobile | [doc Twitch] |

## 7. Faisabilité par demande

| Demande | Faisable | Condition, ou ce qu'il faut |
| --- | --- | --- |
| Lancer depuis l'extension | **oui** | nouvelle source `extension` (migration) et une action du module host qui crée la même demande |
| Prix, solde, état, historique dans l'extension | **oui** | état de la demande exposé au viewer (route de façade) |
| Tirage autoritaire | **déjà** | bot et Core ; à garder |
| Animation des éligibles | **oui, sous forme d'échantillon** | le bot remonte un échantillon d'éligibles vérifiés et leurs avatars |
| Synchronisation parfaite pour tous | **non** | la latence vidéo varie selon le spectateur ; on garantit l'ordre, pas l'instant (SPEC § 5) |
| Cible souhaitée sans influence | **oui** | enregistrée à la demande, jamais transmise à la recherche du bot |
| Vérifier l'éligibilité de la cible souhaitée | **oui, au tirage** | le bot vérifie aussi la cible souhaitée : chat, modérateur, banni, follow (1 à 2 appels) |
| Liste de choix des cibles | **oui** | le dernier relevé de présence du Core (toutes les 120 s) ; aucun appel Twitch en plus |
| Prime idempotente | **oui** | `economy.move` avec clé |
| Anti-rafale | **oui** | prix progressif calculé par le Core sous le verrou de la chaîne |
| Blocage, délai, timeout du module | **oui** | migration des contraintes D4, permissions existantes |
| Annuler tant que la demande est en file | **oui** | état `canceled`, remboursement une fois, sous le verrou |
| Annuler après le timeout | **non** | seule une **levée** (Unban) est possible ; ce n'est pas une annulation |
| Levée de timeout | **oui** | nouvelle commande de l'exécuteur, même droit Twitch |
| Extension accessible pendant un timeout sur PC | **non garanti, pas de notre ressort** | comportement de la plateforme (§ 8) |
| Plus de plein écran involontaire | **probablement** | correctif central (§ 9), à confirmer en Hosted Test |
| Défi Sniper | **oui** | une métrique de plus, dans le système existant |

## 8. Diagnostic : timeout et accessibilité de l'extension

| Couche | Qui contrôle | Constat |
| --- | --- | --- |
| Affichage ou masquage de l'extension pour un utilisateur sanctionné | **Twitch** (lecteur et site) | bannis masqués depuis 2020 ; timeouts selon la communauté ; mobile différent et non documenté |
| Contenu reçu par l'extension (JWT, rôle) | Twitch | les rôles sont `broadcaster`, `moderator`, `viewer`, `external` ; **aucun indicateur de timeout** dans le JWT [doc Twitch] |
| Notre code | nous | il ne lit nulle part l'état de timeout Twitch pour refuser une action ; `timeout-debug.js` sert seulement à tracer (éteint en Production) |
| Règles du Core | nous | aucune action ne vérifie un timeout Twitch : un viewer en timeout qui voit l'extension (mobile) peut l'utiliser |

**Conclusion :**
- On **ne peut pas** rendre l'extension accessible sur PC pendant un timeout : c'est Twitch qui la retire. Tout
  contournement, comme une autre surface déguisée ou une injection, serait contraire aux règles.
- On peut **garantir une politique cohérente côté serveur**, quel que soit l'appareil. Elle est décrite dans SPEC § 10.
- Il faut **mesurer** le comportement réel, avec un compte de test et le traçage `timeout-debug` déjà prévu (PLAN,
  lot 0).

## 9. Diagnostic : double-clic et plein écran

- **Mécanisme**, lu dans le script officiel chargé par nos pages :
  - le helper écoute `click` et `mousemove` sur le `document` **en capture** : il les reçoit avant nous ;
  - il écoute `dblclick` **en remontée** ;
  - il envoie chacun au lecteur parent (`postMessage`, action « TwitchExtUserAction ») ;
  - le lecteur décide alors du plein écran.
- **Ce que nous contrôlons :**
  - le `dblclick` n'arrive au `document` que s'il remonte depuis l'élément cliqué ;
  - un `stopPropagation()` posé sur le contrôle, ou sur notre conteneur racine, **pour les seuls contrôles**, l'empêche
    de partir ;
  - les `click` restent relayés : impossible de les arrêter, et inutile.
- **Existant :** seul le chargeur Bonk est protégé (`preventBonkDoubleClick`), depuis l'import de la version de
  Production. Les autres boutons (TTS, Soundboard, Tombola, Hub, modération) ne le sont pas, d'où le problème.
- **Inconnu :** il faut vérifier que le lecteur ne déduit pas aussi un double-clic de **deux `click` relayés**. Si
  c'était le cas, rien ne serait possible côté extension. Le seul test qui tranche est en Hosted Test, sur le vrai
  lecteur. La protection Bonk n'a pas de trace de validation.
- **Correction proposée :** PLAN, lot 1. Un seul écouteur, sur les contrôles seulement, dans les deux shells, avec un
  test de non-régression.

## 10. Risques de régression

| Zone | Risque | Mesure |
| --- | --- | --- |
| `rb_requests`, utilisé par les défis, les statistiques, le Dock et la supervision | une nouvelle source ou un nouvel état casse un compte | migrations additives ; métriques testées avec `source = 'extension'` et `canceled` |
| Exécuteur du bot (Production, bail unique) | toute modification touche le Random Ban réel | changements bornés : échantillon et cible souhaitée en lecture seule, jamais l'ordre du tirage ; tests existants (600 lignes) gardés |
| Achat `!rb` | le prix progressif change ce que paie le chat | le même calcul pour les trois sources Jetons ; message de prix dans le chat |
| Points de chaîne | hors Jetons : pas de prix progressif possible | réglages Twitch de la récompense (cooldown, maximum par stream) |
| Extension legacy publiée | un correctif partagé change le legacy | double-clic : correctif dans les vues communes, testé dans les deux shells |
| Studio | la page Sanctions gagne des actions sensibles | permissions D4, audit, confirmation |
| Économie | la prime est payée deux fois | clé d'idempotence, test de concurrence sur un vrai PostgreSQL (règle CLAUDE.md) |
| Mute du streamer (V3, non validé) | interactions avec les nouveaux états | ne rien changer à ce chemin ; Sniper sur le streamer exclu en V1 |

## 11. Points bloquants

Aucun blocage technique. **Les décisions métier sont prises** (message d'Antoni du 12/11, appliqué dans la SPEC).

**À confirmer en réel :**
- la validation de Random Ban V3 en Production (`RANDOM_BAN_V2.md` : non validée) ;
- les 6 anciennes rédemptions non régularisées (ROADMAP) ;
- les mesures timeout, double-clic et latence du lot 0 ;
- une lecture Twitch (GET) pour clore le § 12.1, sur GO.

## 12. Audit complémentaire (12/11, après les décisions)

### 12.1 La récompense « Ban aléatoire » peut-elle être remboursée par Raptoru ?

**Réponse : B. Il faut une nouvelle récompense créée par Raptoru 2.0, puis migrer.** Une lecture Twitch (point 4) la
confirmera ; elle ne la renverserait que dans un cas très improbable.

1. **Règle Twitch [doc Twitch] :** « Update Redemption Status » (`CANCELED` = points rendus) n'est permis que pour une
   récompense créée **par le même Client ID**.
2. **La récompense actuelle n'a pas été créée par Raptoru [code + doc] :**
   - elle figurait déjà dans l'instantané de Production du 20/10 (`docs/studio-refonte/PARITE_RECOMPENSES.md`) et vient
     de l'époque SAMMI (`RANDOM_BAN_V2.md` : reprise des boutons SAMMI ID56, ID74, ID63) ;
   - Raptoru ne sait créer une récompense que depuis Spotify V2 (08/11 : `reward_create`,
     `cp_rewards.managed_by_raptoru`) ;
   - la synchronisation ne marque **jamais** une récompense existante comme gérée ;
   - `SPOTIFY_V2.md` § 7 a fait le même constat pour la récompense musique de SAMMI.
3. **Ce que Raptoru a déjà pour une récompense à lui [code + test] :**
   - création par le bot (`createCustomReward`, jeton `raptoru_`, droit `channel:manage:redemptions`) ;
   - file `cp_twitch_actions` : un seul changement de statut par rédemption (clé `status:<canal>:<rédemption>`), jamais
     un second remboursement, jamais de remboursement après une validation ; une action réclamée sans réponse devient
     « inconnue » et n'est jamais rejouée ;
   - `onResult` : un message « points remboursés » ne part qu'**après** la réponse de Twitch ;
   - Twitch crée la récompense avec `should_redemptions_skip_request_queue = false` par défaut : les rédemptions restent
     « en attente », donc annulables. À garder ainsi.
4. **Vérification restante :**
   - « Get Custom Reward » avec `only_manageable_rewards=true`, avec le jeton du streamer ;
   - le jeton local a expiré le 31/10 ; celui de Production est sur le VPS. C'est une lecture, mais avec un jeton de
     Production : **sur ton GO**, au lot 0 ;
   - elle donne aussi l'identifiant actuel de la récompense et ses rédemptions encore « en attente » ;
   - seule surprise possible : SAMMI configuré avec le Client ID de Raptoru. La récompense serait alors gérable
     (réponse A).
5. **Traitement actuel :** une rédemption Random Ban ratée est marquée « à rembourser », sans remboursement possible
   par Raptoru. C'est l'origine des 6 rédemptions non régularisées.

**Migration proposée (sans interruption, rien supprimé) :**
1. Lab : la nouvelle récompense est simulée (simulateur de rédemptions existant) ; toute la chaîne est testée.
2. Production, sur GO : « Créer la récompense Raptoru » (bouton existant de Studio → Points de chaîne), titre distinct
   (Twitch exige un titre unique), 3 000 points, même description.
3. Règle « Interaction native → Random Ban » posée sur la **nouvelle** récompense ; test réel hors live.
4. L'ancienne est **mise en pause** sur Twitch (ta décision), jamais supprimée : ses rédemptions restantes se
   régularisent à la main dans la file Twitch.
5. Retour arrière : réactiver l'ancienne, mettre la nouvelle en pause.

### 12.2 Solde de Jetons « qui ne se met pas à jour »

| Maillon | Constat | Source |
| --- | --- | --- |
| Gains passifs | crédités **à chaque tranche** de présence validée (6 min, 10 Jetons de base × multiplicateurs), clé unique | `loyalty/engine.ts`, `loyalty/config.ts` [code] |
| Récompenses, dépenses, remboursements, mini-jeux | écrits dans le Wallet dans la transaction de l'action | `economy/economy.ts` [code + test] |
| Lecture par l'extension | `economy.balances`, lu **en base à chaque requête**, sans cache | `ext-facade.ts` → `lab-moderation/service.ts` [code] |
| Extension ouverte | relecture de `/state` toutes les **5 s** (panneau visible), 15 s sinon ou après une erreur ; un `broadcast` Twitch relit tout de suite | `overlay.js`, `mobile.js`, `app/main.js` [code] |
| Retour après inactivité | relecture sur `visibilitychange`, `pageshow`, `focus`, `onVisibilityChanged` ; sur mobile, pas de relecture en arrière-plan, puis relecture au retour | idem [code] |
| État local | `lastSession` fusionné avec `/state` ; un écran qui « absorbe » les mises à jour ne redessine pas l'en-tête | `shared/api.js`, `ui.js`, `app/panel.js` [code] |
| Affichage | solde **abrégé**, dans une case de 40 px | `ui-primitives.js` [code] |

**Diagnostic :**
1. **Cause principale : l'abrégé cache les petits gains.** Un gain passif vaut de 10 à quelques dizaines de Jetons.
   « 125K » ne bouge qu'à 1 000 Jetons près, « 6M » à 100 000 près, « 12M » à 1 000 000 près. Le solde est à jour, mais
   rien ne change à l'écran.
2. **Cause secondaire (shell v2, pas encore publié) :** le module Musique (Lab) absorbe toutes les mises à jour tant
   qu'il est ouvert, solde compris. Modération : son en-tête n'a pas de solde. Tombola V2 : son en-tête suit.
3. **Aucun défaut côté Core**, ni cache, ni événement perdu : rien à changer dans l'économie.
4. **Pas mesurable ici :** le comportement réel sur l'application mobile Twitch (iframe mise en veille). À vérifier au
   lot 0 avec la build `timeout-debug`, qui trace déjà chaque relecture.

**Correction (faite dans le worktree, testée, non commitée) :**
- une pastille « +40 » apparaît 2,6 s à côté du solde quand il augmente entre deux lectures, avec le montant exact sous
  1 000 (`ui-primitives.js`, `currency-switch.css`) ; mouvement réduit respecté ;
- le module Musique laisse passer un nouveau solde (`modules/music/module.js`) ;
- le solde exact reste dans l'infobulle et l'`aria-label`.
- Pas de nouvelle synchronisation : 5 s suffit pour un gain passif, et un achat relit déjà l'état tout de suite.

### 12.3 « 6000 K » au lieu de « 6 M »

- **Origine :** la Tombola V2 avait son propre formateur (`tombola-v2.js`, `compact`), limité aux milliers :
  6 000 000 → « 6 000K ».
- Deux autres formateurs existaient : `formatWalletValue` arrondissait au plus proche (donc parfois **au-dessus** du
  solde réel) avec une décimale anglaise (« 6.1M ») ; `formatCompactBalance` était juste, sans espace.
- **Correction (faite, testée) :** un seul formateur, `formatCompactAmount` (`shared/currency.js`), utilisé par les
  trois : 6 K · 125 K · 1 M · 6,1 M · 6,25 M.
  - Virgule française, espace fine insécable avant l'unité.
  - **Tronqué**, jamais au-dessus du solde réel.
  - 3 chiffres significatifs ; 2 dans la case de 40 px de l'en-tête (6,2 M).
- Test : `apps/twitch-extension/test/compact-amount.test.js` (tes exemples, piège des flottants, 999 999 → 999 K).
- raptoru.fr n'est pas touché : il affiche les montants en entier.

### 12.4 Prix progressif et points de chaîne

- `!rb` : une transaction pour la demande et le débit ; le prix venait de `random_ban.price`
  (`chat-interactions/prices.ts`) [code]. Un prix par viewer demande de le calculer sous un verrou par acheteur, dans
  cette même transaction. **Fait depuis** (SPEC § 13) : `RandomBanService.buy`, verrou `random_ban:buyer:…`.
- Le module host refuse déjà un achat d'extension dont le prix a changé (`expected_price`) [code + test].
- Twitch n'offre pas de cooldown **par viewer** sur une récompense (cooldown global et maximum par stream seulement)
  [doc Twitch] : le cooldown individuel de 10 min doit être tenu par le Core. **Fait depuis** (SPEC § 13).
