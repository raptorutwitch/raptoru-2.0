# Points de chaîne V1 — infrastructure officielle (17/10/2026)

**Statut (17/10/2026, soir)** : connecté à Twitch en Lab (jeton broadcaster réautorisé par Antoni : 36 récompenses lues).
**Validé par Antoni** : action OBS (« Tester »), réception d'une vraie récompense (compte LeCroupier\_), exécution réelle
Twitch → Core → Studio → OBS (« Test Lab » → scène « Waiting screen »), persistance après redémarrage. **Son : non
validé** (défaut corrigé, à revérifier, § 10). Non déployé ; SAMMI exécute toujours les récompenses de production.

## 1. Chaîne

Twitch EventSub `channel.channel_points_custom_reward_redemption.add` v1 → bot (connexion **broadcaster**) → Core
(`ChannelPointsService` : dédoublonnage, interrupteur, règle, actions figées) → sons : file du **Soundboard** (son
lecteur OBS, sa modération) · OBS : tâche reprise par **Studio** (seul à parler à OBS) → historique dans le Core.

| Couche     | Fichiers                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrat    | `packages/schemas/src/channel-points.ts` (actions autorisées, règle, redemption, liste des récompenses, ACK)                                                                                                                                                                                                                                                                                                                          |
| Core       | `apps/core-api/src/channel-points/service.ts` ; routes `apps/core-api/src/http/channel-points-routes.ts` (une fonction : Lab `/v1/lab/channel-points/*`, production `/v1/studio/channel-points/*` + bot `/v1/bot/channel-points/*`) ; câblage `bonk-lab/lab-core.ts`, `app.ts` (`createCore`), `http/server.ts`, `index.ts`                                                                                                           |
| Soundboard | `apps/core-api/src/sound-lab/sound-lab-service.ts` : `admitChannelPoints()` interne (payé par les points : aucun débit, jamais remboursable ; le schéma public de l'Extension n'accepte toujours que jetons / crédits)                                                                                                                                                                                                                |
| Bot        | `apps/twitch-bot/src/channel-points-events.ts` (normalisation, abonnement, liste des récompenses, renvoi au Core) ; bot de production `index.ts` (option `CHANNEL_POINTS_EVENTS`, sur la connexion broadcaster partagée avec loyalty) ; Lab `lab-chat-main.ts` (connexion broadcaster dédiée, ouverte seulement si le jeton a le droit) ; `twitch/helix.ts` (`getCustomRewards`), `config.ts` (`broadcasterScopes`), `core-client.ts` |
| Studio     | `apps/studio/server/src/channel-points/runtime.ts` (API de l'onglet, boucle d'exécution) et `obs-actions.ts` (exécuteur OBS typé) ; câblage `index.ts` ; `lab-moderation/proxy.ts` (préfixe Lab autorisé) ; `bonk-lab/obs.ts` (code d'erreur OBS conservé)                                                                                                                                                                            |
| Onglet     | `apps/studio/web/src/channel-points.ts`, `channel-points-view.ts`, `channel-points.css` (« Points de chaîne · Core »)                                                                                                                                                                                                                                                                                                                 |
| Schéma     | Lab `supabase/migrations/20261025120000_channel_points_lab.sql` ; production `20261025130000_channel_points.sql` (même schéma, testé ; additif, idempotent, **non appliqué** ; retour arrière dans l'en-tête)                                                                                                                                                                                                                         |

## 2. Contraintes Twitch (doc officielle, lue le 17/10/2026)

- Événement et liste (« Get Custom Reward ») : `channel:read:redemptions` **ou** `channel:manage:redemptions`, sur le
  **jeton broadcaster** (raptoru\_). La V1 ne demande que la lecture.
- « Update Redemption Status » : « The app used to create the reward is the only app that may update the redemption »
  → Raptoru **ne peut ni valider ni rembourser** les récompenses actuelles (créées par Antoni / SAMMI). Aucun appel
  d'écriture n'existe dans le code.
- Statuts reçus : `unfulfilled`, `fulfilled` (récompense qui saute la file), `canceled`, `unknown` ; conservés à titre
  informatif. Twitch ne rejoue pas les événements d'une session WebSocket perdue.

## 3. Règles et actions

- Une règle par récompense (clé = id Twitch, jamais le titre) : active / inactive, **1 à 5 actions** exécutées dans
  l'ordre, version (modification concurrente refusée), récompense connue seulement.
- Actions autorisées (liste fermée, validée par le Core) : `sound` (son du Soundboard), `obs_source` (afficher / masquer
  une source d'une scène, durée facultative), `obs_filter` (activer / désactiver un filtre, durée facultative),
  `obs_scene` (changer de scène). Aucun script, aucune commande système, aucune autre requête OBS.
- Actions figées à la réception : modifier une règle ne change jamais une redemption déjà reçue.
- Extensions prévues (non faites) : FX / Chaos Control, Creepy / NTM / BRB complets (couper le micro…), Spotify,
  Wallet / conversion, mini-jeux, modération ludique — nouveaux types d'action ajoutés à la liste.

## 4. Fiabilité

- Dédoublonnage persistant par (chaîne, source, id de redemption) : redélivrance, reconnexion, redémarrage du bot →
  `duplicate`, rien de nouveau.
- Statuts : `ignored` (raison : automatisations désactivées, aucune action, règle désactivée, reçue trop tard > 2 min)
  · `pending` · `done` · `partial` · `failed` ; résultat par action (`done` / `failed` + raison lisible / `unknown`).
- Sons : admis dans le Soundboard à la réception (son lecteur doit être prêt ; pause globale, blocages et cooldowns du
  Soundboard s'appliquent ; échec = raison du Soundboard). **Admis n'est pas joué** : l'action reste « en attente du
  lecteur Soundboard », puis « en cours de lecture », et n'est « faite » qu'au `completed` du lecteur (fin de l'audio dans
  la page du lecteur) ; échec (expiré après 2 min, erreur du lecteur, arrêt de modération) ou « lecture non confirmée ».
- OBS : une tâche par redemption, **une en vol par chaîne**, bail ; réservée mais jamais commencée → reproposée (3
  essais) puis échec « Studio absent » ; commencée sans rapport → `unknown`, **jamais rejouée**.
- Effets temporaires : annulés à l'échéance **seulement si** l'élément est toujours dans l'état posé (un changement fait
  entre-temps est conservé) ; deux redemptions qui se chevauchent prolongent l'effet ; annulations en attente
  enregistrées (`<runtimeDir>/channel-points/obs-reverts.json`) et reprises après un redémarrage de Studio quand OBS
  répond ; abandonnées après 1 h. Limite : un élément remis à la main dans l'état posé est indiscernable et sera
  annulé.
- Bot → Core : renvoi en mémoire avec le même id (90 s), 4xx non renvoyé ; pas de garantie « zéro perte ».
- Secrets : jetons Twitch seulement dans le bot ; Studio n'expose que des états (droit présent, adaptateur actif) ;
  rien vers OBS.

## 5. Modes et activation

- **Interrupteur principal** (Core, par chaîne, persistant, **OFF par défaut**, jamais activé par une migration ni un
  démarrage) : OFF = les vraies redemptions sont enregistrées « ignorées : automatisations désactivées » (observation),
  rien n'est exécuté ; ON = règles exécutées. Activation avec confirmation dans l'onglet.
- **Tester** (onglet) : exécute la règle enregistrée, interrupteur OFF compris (clic explicite, confirmation).
- Démarrage quotidien : la boucle Studio démarre avec Studio, la réception avec le bot / l'adaptateur ; une fois
  l'interrupteur ON, rien à réactiver.
- Réception Lab : connexion broadcaster dédiée de l'adaptateur chat Lab, ouverte **seulement** si le jeton broadcaster
  a `channel:read:redemptions` (droits lus dans le fichier, sans appel réseau ni rafraîchissement sinon). Production :
  option `CHANNEL_POINTS_EVENTS=true` du bot (même connexion broadcaster que loyalty). **Jamais les deux à la fois**
  (deux consommateurs du même jeton).

## 6. Autorisation à donner (non faite)

1. Dans `apps/twitch-bot/.env` : `CHANNEL_POINTS_EVENTS=true` (ne change que les droits demandés au broadcaster).
2. `npm run twitch:auth -w apps/twitch-bot -- --broadcaster`, connecté en **raptoru\_** ; la page doit demander
   `bits:read channel:read:subscriptions moderator:read:followers channel:read:redemptions` (lecture seule).
3. Relancer Studio (`npm run studio`) puis désactiver / réactiver « Ingestion chat Twitch » : l'onglet doit afficher
   « Twitch : réception active » et la liste des récompenses.

## 7. Récompenses SAMMI relevées (decks actifs, lecture seule du 17/10/2026)

| Récompense (déclencheur SAMMI)                               | Ce que fait SAMMI                      | Couverture V1                                                                 |
| ------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------- |
| Eren cri, Tiens bon !, Arrêteuh, Bzez, Skyzz, Seigneur Percé | joue un fichier son local              | **son** — à condition d'ajouter ces sons à la banque du Soundboard (non fait) |
| Creepy                                                       | source OBS « Prowler Effect » + son    | **source temporaire + son**                                                   |
| Be Right Back                                                | scène + coupe micro / musique          | **scène** (couper le son : plus tard)                                         |
| Couleur Overlay                                              | affiche une couleur, masque les autres | **sources** (jusqu'à 5 actions ; à valider)                                   |
| ntm                                                          | requête OBS websocket                  | à identifier (probablement source / filtre)                                   |
| Couleur Cam                                                  | règle la teinte d'un filtre            | plus tard (valeurs de filtre)                                                 |
| FX cam                                                       | service local 127.0.0.1:17371 + OBS    | plus tard (service inconnu)                                                   |
| Cash-In                                                      | conversion en jetons (StreamElements)  | plus tard (Wallet)                                                            |
| Skip la musique, Choisi la prochaine musique !               | Spotify (`sammi-bridge`, 9567)         | plus tard (Spotify)                                                           |
| Ban aléatoire                                                | timeout d'un viewer au hasard          | plus tard (modération ludique)                                                |
| Lucky Wheel                                                  | extension SAMMI tierce                 | décision (reconstruire ou abandonner)                                         |
| Blrt Tells a Dad Joke                                        | blague HTTP dans le chat               | décision                                                                      |

## 8. Avant le cutover

Autorisation (§ 6) ; banque du Soundboard complétée avec les sons des récompenses ; règles saisies et testées une par
une (« Tester » sur une scène de test) ; Core de production déployé avec `20261025130000_channel_points.sql` (accord
d'Antoni) ; bot de production avec `CHANNEL_POINTS_EVENTS=true` et adaptateur Lab arrêté ; puis, récompense par
récompense : désactiver son bouton SAMMI, configurer la règle Raptoru, interrupteur ON. Retour arrière : interrupteur
OFF (immédiat) et bouton SAMMI réactivé.

## 9. Preuves (17/10/2026)

Core 699 (+22 ignorés) dont `channel-points` (8 : OFF par défaut, dédoublonnage, aucune règle / règle désactivée / en
retard, son payé en points sans débit ni remboursement, règles typées et versionnées, tâches OBS avec résultats et une
en vol, Studio absent / tâche commencée jamais rejouée, routes production : bot sans configuration, Studio, refus) et
`channel-points-migration` (schéma prod = Lab, idempotence) ; Bot 130 dont `channel-points-events` (7 : exemple officiel
Twitch, rejets, abonnement refusé sans effet, redélivrance, Core indisponible / 4xx / expiration, droits en lecture
seule) ; Studio 433 dont `channel-points-studio` (4 : exécuteur sur OBS **simulé**, annulation conditionnelle, reprise
après redémarrage, chaîne complète avec le vrai Core Lab et le vrai client Studio) et `channel-points-view` (3) ;
lecteurs Playwright 5/5 (Soundboard) ; mutation sur l'interrupteur vérifiée ; onglet vérifié dans Chromium (OBS
simulé). **Aucune** récompense Twitch réelle reçue ni modifiée, **aucune** action sur le vrai OBS.

## 10. Correctif Soundboard (17/10/2026, soir)

Constat (base Lab) : le 1ᵉʳ son « Hello » admis a été rejeté par le worker Soundboard de Studio
(`foreign_session : admitted by another Studio session`) — en Lab le worker ne joue que les sons portant **sa** session
(protection contre le rejeu d'une session précédente) et un son de points de chaîne porte `lab_session_id =
channel_points` ; le 2ᵉ est resté en file (lecteur plus prêt, aucune expiration en Lab sans passage du worker). Pendant ce
temps l'historique affichait « Exécutée » dès l'admission. Correctifs : le worker joue les sons payés en points de chaîne
(`apps/studio/server/src/sound-lab/worker.ts`) ; l'historique suit le Soundboard jusqu'à la confirmation du lecteur et
applique son expiration (`apps/core-api/src/channel-points/service.ts`) ; libellés lisibles
(`apps/studio/web/src/channel-points-view.ts`). Tests : Core `channel-points` 9, Studio `sound-lab` (son de points de
chaîne remis au vrai worker puis au lecteur ; échoue sans le correctif), vues 4. Limite : `completed` prouve que la page
du lecteur a joué l'audio jusqu'au bout, pas que la sortie audio (OBS / Windows) était audible.
