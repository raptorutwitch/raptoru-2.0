# Random Ban V2 (M1.1)

## V3 (27/10/2026) — développée, testée automatiquement, **non validée, non déployée**

Décisions d'Antoni (GO du 26–27/10) : tirage toujours aléatoire, acheteur plus rare, streamer cible exceptionnelle.

- **Acheteur** : rencontré dans l'ordre mélangé, il est gardé avec la probabilité `buyerWeight` = 1/4, sinon le suivant
  qui suit la chaîne ; seul éligible, il est tiré quand même. Sa chance est **w / N** (N éligibles), les autres se
  partagent le reste à parts égales : N = 2 → 12,5 % (au lieu de 50 %), 5 → 5 % (20 %), 10 → 2,5 % (10 %), 20 →
  1,25 % (5 %). Bot : `searchTarget` (`buyerId`).
- **Streamer** : à la réclamation par le bot, le Core tire le streamer **20 ‰ (2 %)** des fois — seulement pour une vraie
  demande, si Studio a dit dans les 10 s « OBS connecté, micro tenu par personne » et qu'aucun mute Votekick ni Random
  Ban du streamer n'est en cours. Jamais de timeout Twitch : Studio coupe « Micro » **60 s**, une ligne de chat
  « 🔇 {acheteur} a coupé le micro de raptoru_ pendant 60 s ! », l'animation de ban habituelle. Studio n'a pas confirmé
  dans les 15 s (OBS perdu, Studio fermé) ou a échoué → la demande repart en tirage viewers (rien de perdu). Pas de
  nouvelle colonne : `reason` = `streamer_mute` (`streamer_mute_caution` après une caution), `lease_expires_at` = fin du
  mute une fois confirmé. Studio : « Tester le mute du streamer » = **le micro seulement** (60 s dans OBS) : jamais d'appel Twitch (jamais rendu au bot, même si Studio échoue), aucun jeton, aucun point, aucune ligne de chat, aucune animation, aucune caution possible.
- **Micro partagé** (`apps/studio/server/src/channel-points/mute-holds.ts`) : Votekick, BRB et le mute Random Ban
  « tiennent » le micro sous leur nom ; la voix ne revient qu'à la fin du **dernier**, jamais s'il était coupé avant,
  jamais par-dessus un changement manuel ; enregistré sur disque (redémarrage de Studio, OBS absent : repris). Corrige
  aussi le défaut existant BRB pendant un mute Votekick (voix rendue au milieu du mute, puis micro laissé coupé).
- **Caution** sur le mute : voir [CAUTION.md](CAUTION.md) (300 Jetons / 10 s, choix explicite si deux mutes).
- Prix, débits, remboursements, sérialisation, journal du bot : inchangés. Aucune migration.

**OAuth, complément du 18/10 :** correctifs locaux et procédure de réautorisation groupée dans
[`TWITCH_OAUTH.md`](TWITCH_OAUTH.md). Le lot approuvé comprend le droit de timeout de LeCroupier_ et les lectures
de raptoru_, indépendamment des flags de demande de scopes. Aucune autorisation réelle ni sanction réelle n'a été
effectuée pendant ce développement ; la validation de Random Ban reste distincte et à faire avec Antoni.

**Statut : DÉVELOPPEMENT TERMINÉ / TESTS AUTOMATISÉS RÉUSSIS / VALIDÉ EN RÉEL PAR ANTONI (18/10/2026) / NON DÉPLOYÉ.**
Après la réautorisation groupée (`TWITCH_OAUTH.md`), vraie redemption « Ban aléatoire » (trace Lab : 18/10 15:28 UTC,
acheteur VieweruMobilu tiré lui-même → **CSC**, abonné → timeout **3 min** confirmé par Twitch via LeCroupier_,
animation CSC affichée, aucun remboursement dû). Les sections ci-dessous gardent l'historique du développement.

Reprise du « Ban aléatoire » de SAMMI (boutons ID56 « RB PDC », ID74 « RB Jetons », ID63 « Random Anim Ban ») selon les
décisions d'Antoni du 18/10/2026 : même esprit, même rendu, sans les bricolages SAMMI.

## 1. Règles (fixes, dans le code : `packages/schemas/src/random-ban.ts`)

- Déclencheur : récompense « Ban aléatoire » (3 000 points) — règle Points de chaîne « Interaction native → Random
  Ban ». `!rb` (25 000 Jetons) : même logique, raccordée avec l'économie (jamais un deuxième Random Ban).
- Un Random Ban à la fois (Core sérialise), dans l'ordre d'arrivée.
- Cible : un chatter de la liste Twitch « Get Chatters » (lurkers compris), qui **suit** la chaîne, n'est **ni le
  streamer, ni modérateur, ni banni / en timeout** ; VIP éligibles ; l'acheteur peut être tiré (« CSC ») ; aucun
  cooldown par cible.
- Sanction : **timeout** par **LeCroupier\_** — 3 min abonné (« Pas de chance fdp »), 5 min sinon (« Pas de chance gros
  fdp ») ; jamais de bannissement permanent (une durée est toujours envoyée, 1 s ≤ durée ≤ 2 semaines).
- Animation seulement **après** confirmation du timeout par Twitch. Aucun message chat.
- Aucun éligible : **flop** (trompette + « X a flop cheh ! »), rien n'est remboursé.

## 2. Ressources historiques retrouvées (copies dans le stockage Studio, originaux intacts)

| Ressource                                                | Provenance (référencée par)                                                | Empreinte (SHA-256, 16) |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------- |
| `RandomBan Classic.webm` (3,51 s)                        | `…\Videos\Alertes Twitch Pour Claude\Version webm\` (`alerte_system.html`) | `a0872996bedc11ae`      |
| `Alerte R&M RB 1.webm` (4,97 s)                          | idem                                                                       | `6d62090653ddbc9e`      |
| `Nuage Complet Bruité.webm` (5,72 s)                     | idem                                                                       | `e33a324c58d47262`      |
| `Waterbending bruité v_2.webm` (6,76 s)                  | idem                                                                       | `82e9cb0228935776`      |
| `Nuage 2 bruité v2.webm` (8,34 s)                        | idem                                                                       | `b2653dac99db4557`      |
| `CSC bruité Fix.webm` (9,81 s)                           | idem                                                                       | `5d7c9c918812b230`      |
| `Fail Trumpet Sound Effect [TubeRipper.cc].ogg` (5,13 s) | `…\Downloads\` (SAMMI ID56 / ID74, « Play Sound » 0,5)                     | `7daa8574ea6f8dd8`      |

Toutes en 1920×1080, son intégré. Version en production : `Version webm\alerte_system.html` (source OBS « Alerte
(Sammi) », présente dans Fullscreen, Alerte complète, Just Chatting, Dessin, Overlay navigateur) — la page reçoit
`?alerte=…&trigger=…&banned=…`. Import : `npx tsx apps/studio/server/src/effects/import-cli.ts` (fait le 18/10 : 7
copies, empreintes des originaux identiques avant / après). Polices : aucune fournie (CSS « Helvetica Neue / Helvetica
/ Arial », comme la page). Images : aucune.

- **Variantes** (entrées `ban_*` de la page, copiées telles quelles) : classique, Rick & Morty, nuage complet, waterbending,
  nuage 2, chacune avec sa version miroir (sauf classique) → 9 ; plus **CSC** (acheteur = cible).
- **Tirage de la variante** : SAMMI ID63 tirait au hasard **uniforme** parmi les 9 (sa liste de poids 40 / 5… n'est
  lue par aucune commande) ; conservé (tirage crypto par Core).
- **Phrases** : les 5 listes de la page (« {banned} s'est fait découper par {trigger} », « La foudre de {trigger}
  s'abat sur {banned} »…, CSC : « {trigger} est une grosse merde »), une au hasard par la page, pseudos en couleur
  (#4da6ff / #ff4d4d), 42 px gras, contour noir — affichée à `showAt`, masquée à `hideAt` (glissement 0,3 s).
- **Timings** : ceux de la page ; fin à la fin de la vidéo **ou** au chien de garde `duration + 800 ms` (le premier
  des deux, comme la page) — R&M est donc coupé 0,17 s avant sa fin, comme en production. Volume vidéo 0,5
  (`VOLUME_GLOBAL` × 1).
- **Flop** : la source texte OBS « randomban » n'existe **plus** dans la collection active (en production, seul le son
  jouait encore). Son apparence vient de la dernière collection qui l'avait (`24_Halloween.json.bak`) : texte GDI+
  aux valeurs par défaut d'OBS (Arial 256 px, blanc), échelle 0,2769 × 0,2765 en (647, 316), fondu 500 ms / 2 s / 500 ms
  — **reconstitué** (rendu GDI+ ≈ CSS, à comparer dans OBS).

## 3. Architecture (une seule logique)

`Twitch (récompense) → bot (EventSub, existant) → Core : Points de chaîne → RandomBanService → exécuteur Twitch du bot →
Core → Studio (lecteur d'effets)`

- **Core** (`apps/core-api/src/random-ban/service.ts`, table `rb_requests`, migrations Lab
  `20261026120000_random_ban_lab.sql` / prod `20261026130000_random_ban.sql` **non appliquée**) : une demande par
  déclencheur (dédoublonnage), états `queued → searching → timeout_requested → confirmed | flop | failed | uncertain |
simulated`, remboursement dû (`needed` / `to_verify`, jamais « fait »), animation (en attente / en cours / affichée /
  non affichée / trop tard). Points de chaîne : l'action `random_ban` crée la demande (jamais une tâche OBS Studio) et
  l'historique affiche le résultat.
- **Exécuteur Twitch** (`apps/twitch-bot/src/random-ban-executor.ts`, dans l'adaptateur Twitch du Lab) :
  1. réclame une demande (Core : une à la fois) en déclarant ses droits ;
  2. **recherche** : liste des chatters (pages de 1 000), modérateurs et bans / timeouts **par lots de 100 ids**
     (2 appels / 100 chatters), mélange crypto (Fisher–Yates), puis **le premier qui suit** dans cet ordre (« Get
     Channel Followers » n'accepte qu'un id : 8 vérifications en parallèle) = tirage **uniforme** parmi les éligibles
     sans tout vérifier ; statut abonné de la seule cible ;
  3. annonce la **cible à Core avant tout envoi** (Core répond la durée) ;
  4. écrit « timeout en cours » dans son journal local, appelle **Ban User une seule fois**, écrit l'issue, la rapporte.
- **Studio** (`apps/studio/server/src/random-ban/runtime.ts`, porté par le runtime Points de chaîne) : prend les
  animations prêtes une par une et les joue sur le **lecteur d'effets** existant (couches `ban` et `flop` ajoutées à
  `effects-player/player.js` + CSS de la page historique) — aucune source OBS rechargée, nettoyage automatique.

## 4. Robustesse

- Lecture Twitch en échec (réseau, 5xx, 429 : 3 essais ; 4xx : immédiat) → **échec** (« recherche impossible »),
  jamais un faux flop.
- Ban User : 409, 429 et requête jamais partie → réessayés (rien d'appliqué) ; 4xx → **refusé** (rien d'appliqué,
  remboursement dû) ; réponse ambiguë (délai, 5xx) → **jamais renvoyé** : vérifié dans la liste des bannis (confirmé /
  pas appliqué) ou **incertain** si Twitch est illisible (remboursement « à vérifier »).
- Exécuteur perdu pendant la recherche (rien d'envoyé) → redonné (3 fois max) ; perdu après l'annonce de la cible →
  **incertain**, jamais redonné ; redémarrage du bot → son journal règle l'entrée depuis Twitch, sans renvoi.
- Demande non prise en 2 min (bot absent) → échec, jamais un ban tardif. Animation non jouée dans les 2 min → abandonnée.
- Lecteur d'effets absent → le timeout confirmé reste confirmé ; « animation non affichée ».
- Tests Studio : **jamais** de timeout (« Tester » de la règle et « Tirage à blanc » = vraie recherche sans timeout ;
  « Tester l'animation » = aucun appel Twitch).
- **Remboursement** : impossible tant que la récompense appartient à SAMMI (décision D7) — enregistré « nécessaire » ou
  « à vérifier », jamais prétendu fait.

## 5. Studio

Onglet « Points de chaîne », section **Random Ban** : exécuteur (recherche prête ?, timeouts autorisés ?, droits
manquants), lecteur d'effets, médias manquants, règles fixes, « Tester l'animation » (ban au hasard / CSC / flop),
« Tirage à blanc », 15 derniers Random Ban (acheteur, cible, durée, abonné, animation, chatters / candidats / follows
vérifiés, erreur, remboursement dû). Activation : la règle « Ban aléatoire » + l'interrupteur des automatisations.

## 6. Droits Twitch (non accordés — décision d'Antoni)

Relevé du 18/10 : LeCroupier\_ a `moderator:read:chatters`, `moderator:read:followers` mais **pas**
`moderator:manage:banned_users` ; raptoru\_ a `channel:read:subscriptions` mais **pas** `moderation:read` (seul le
jeton du streamer peut lire la liste des modérateurs et des bannis). Sans eux, la section l'affiche, une vraie
redemption échoue proprement (« droit manquant », remboursement dû) et même le tirage à blanc est refusé (pas de
recherche sans `moderation:read`). Pour les ajouter (quand Antoni le décide) : `RANDOM_BAN=true` dans
`apps/twitch-bot/.env`, puis `npm run twitch:auth -w apps/twitch-bot` (connecté en LeCroupier\_) et
`npm run twitch:auth -w apps/twitch-bot -- --broadcaster` (connecté en raptoru\_), puis relancer l'adaptateur Twitch
du Lab (« Ingestion chat Twitch » OFF / ON).

## 7. Écarts avec SAMMI

- Animation **après** le timeout confirmé (SAMMI l'affichait avant, sans vérifier) ; un ban refusé n'affiche rien.
- Tirage uniforme parmi tous les éligibles (SAMMI : 20 essais au hasard, pouvait « flopper » malgré des éligibles).
- Liste des bannis lue complètement pour les chatters (SAMMI : 20 premiers seulement).
- Flop visible à nouveau (source texte disparue d'OBS) ; `!rb` attendait 10 s avant le flop : à reprendre avec `!rb`.
- Plus de journal vers `raptoru.fr/api/sammi/event` (historique Core à la place).
- Pseudos insérés comme texte (la page historique les insérait en HTML).

## 8. Validation (à faire, avec accord)

1. Sans risque : `npm run studio` → onglet Points de chaîne → « Ban aléatoire » → Interaction native « Random Ban » →
   Enregistrer ; section Random Ban → « Tester l'animation » (ban, CSC, flop) : rendu dans OBS comparé à SAMMI.
2. Après les réautorisations (§ 6) : « Tirage à blanc » → l'historique montre un vrai chatter éligible, **aucun
   timeout**.
3. Test réel contrôlé (accord explicite, SAMMI fermé ou son bouton ID56 désactivé) : automatisations ON, un compte de
   test présent dans le chat et qui suit la chaîne, seul éligible si possible (ou accepter le hasard) ; une vraie
   redemption « Ban aléatoire » → timeout confirmé dans l'historique et dans le chat Twitch (message de modération),
   animation dans OBS ; automatisations OFF ensuite.
