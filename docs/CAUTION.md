# Caution (`!caution`)

**Statut (23/10/2026) : DÉVELOPPÉE (Core + bot + Studio), TESTS AUTOMATISÉS RÉUSSIS (dont PostgreSQL réel et la chaîne
complète Core ↔ bot sur Twitch simulé) / NON VALIDÉE PAR ANTONI / NON DÉPLOYÉE / OFF PAR DÉFAUT EN PRODUCTION.**
Branche locale `feat/votekick-v2` (worktree isolé). **SAMMI a été débranché volontairement à la bascule du 20/10**
(décision de migration) : aucune Caution n'existe aujourd'hui en Production, ni SAMMI ni Raptoru ; c'est une fonction
historique **à reprendre** ici. SAMMI ne doit jamais être réactivé (ses boutons débiteraient les points StreamElements
gelés). `CAUTION_CHAT` (Core) et `CAUTION` (bot) restent à `false` jusqu'à l'activation décidée par Antoni.

Reprise des boutons SAMMI `CAUTION_START`, `CAUTION_CONFIRM`, `CAUTION_FINISH`, `CAUTION_RESET`, `ID7` (deck « Points
de chaine », lu le 22/10/2026).

## 1. Règles (historiques SAMMI, conservées)

- `!caution pseudo` (`@` accepté, casse ignorée) ; `!caution` seul : aide (au plus une fois par viewer toutes les 30 s).
- Lève un **timeout Twitch actif** ; un **ban permanent n'est pas rachetable** ; aucun timeout → refus ; timeout déjà
  fini → refus ; jamais sa propre caution ; tout viewer peut payer pour un autre.
- Prix : **1 000 Jetons par minute restante entamée** (`ceil(secondes / 60) × 1000`), au moment du devis.
- Devis valable **30 s** ; seul le **payeur** répond `oui` / `non` (message entier, casse ignorée) ; `oui` / `non` de
  quelqu'un d'autre ou sans devis : silence (pas de spam) ; devis expiré sans réponse : silencieux ; `oui` tardif :
  « Cette proposition de caution a expiré… ».
- **Une caution ouverte à la fois** par chaîne (devis en attente → « Une caution pour X attend déjà la réponse de Y »).
- Streamer : impossible à timeout ; sa caution lève le **mute Votekick** (prix sur les secondes restantes). Sans Votekick
  V2 en service, le streamer n'est jamais « réduit au silence » pour Raptoru.
- Textes du chat : ceux de SAMMI (ex. « viewer1 paie 8 000 jetons : viewer2 est libéré ! »).

Écarts V2 (sécurité, documentés) : la sanction est **relue sur Twitch après le `oui` et avant tout débit** ; si le
timeout a été **prolongé** depuis le devis (prix plus élevé), un nouveau devis est demandé (SAMMI facturait l'ancien
prix) ; s'il est devenu permanent ou a disparu, rien n'est débité ; résultat incertain jamais remboursé automatiquement.

## 2. Sanctions éligibles — limites connues

- **Éligible** : tout timeout de la chaîne listé par Twitch « Get Banned Users » avec une date de fin (Votekick, Random
  Ban, modérateurs, LeCroupier\_, AutoMod de timeout…), comme SAMMI (« presque tout timeout »). ⚠ Cela inclut les
  timeouts **donnés à la main par la modération** : décision à confirmer (§ 8).
- **Non éligible** : ban permanent (pas de date de fin) ; restrictions Twitch qui ne sont pas des bans de la chaîne
  (« utilisateur suspect / restreint », avertissements, suspension Twitch globale, Shared Chat d'une autre chaîne) ;
  le mode followers / sub-only.
- Un timeout de plus de 14 jours n'existe pas sur Twitch (max 1 209 600 s).
- Les listes Twitch ont un léger retard : après un 204 de « Unban User », la liste est relue jusqu'à 3 fois ; encore
  listé → « incertain » (jamais un remboursement sur une liste en retard).

## 3. Architecture (une seule logique, mêmes mécanismes que Random Ban)

`Chat Twitch → bot (CHAT_GAMES, /v1/bot/chat) → Core : routeur chat → CautionService → exécuteur Twitch du bot
(/v1/bot/caution) → Core`. Le Lab : même service, `/v1/lab/caution`, l'adaptateur Twitch du Lab comme exécuteur.

- **Core** `apps/core-api/src/caution/service.ts`, table `caution_requests`. États : `checking → quoting → quoted →
confirmed → rechecking → releasing → released`, ou `refused / cancelled / expired / failed / uncertain`. Colonne
  `money` : `none` (rien débité) · `debited` · `refunded` (une seule fois) · `to_verify`.
- **Débit** : le port économique existant (`EconomyPort`, Wallet du Lab ou Wallet canonique Jetons), module `caution`,
  référence = l'id de la caution (débit et remboursement idempotents par construction).
- **Exécuteur** `apps/twitch-bot/src/caution-executor.ts` : utilisateur par login (jeton LeCroupier\_), liste des
  bannis (jeton raptoru\_ `moderation:read`), « Unban User » (LeCroupier\_ `moderator:manage:banned_users`). Journal
  local écrit **avant** chaque levée (`.caution-journal.json` / `.lab-caution-journal.json`).
- **Studio** : section « Caution » de l'onglet Points de chaîne, lecture seule (droits de l'exécuteur, dernières
  cautions, Jetons débités / remboursés / **à vérifier**). Aucun bouton ne déplace de Jetons.
- **Mute du streamer** : interface `CautionMutes` (active / end) fournie par Votekick V2 ; la restauration OBS est faite
  par le `MuteController` de Studio (docs/VOTEKICK_V2.md). Non raccordée tant que Votekick V2 n'est pas en service.

## 4. Garanties (testées)

| Garantie                                   | Comment                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Jamais de débit sans relecture Twitch      | le débit n'a lieu que dans `recheck`, avec la sanction relue par l'exécuteur juste avant                                           |
| Jamais de levée avant le débit validé      | l'exécuteur ne lève que sur « proceed », renvoyé après le commit du débit + `releasing`                                            |
| Une seule caution ouverte                  | verrou consultatif par chaîne + **index unique partiel** en base (même entre deux Cores)                                           |
| Double `oui` / message rejoué              | ligne verrouillée, transition `quoted → confirmed` unique, id du message mémorisé                                                  |
| Un débit au plus                           | clé = id de la caution (Wallet Lab : une ligne `debit` ; canonique : opération idempotente)                                        |
| Remboursement exactement une fois          | dans la **même transaction** que l'échec certain (`not_applied` / `not_banned`), idempotent                                        |
| Incertain jamais remboursé automatiquement | 5xx, pas de réponse, liste illisible ou contradictoire, bot perdu après débit → `to_verify`                                        |
| Redémarrage du bot pendant la levée        | journal : entrée sans issue → relue sur Twitch (libre → libéré ; listé / illisible → incertain)                                    |
| Core injoignable au moment du rapport      | l'issue reste au journal et est livrée au retour du Core                                                                           |
| Redémarrage du Core                        | tout l'état est en base ; une lecture perdue est reproposée (rien n'était débité) ; une levée sans réponse expire en « incertain » |
| Simulateur Studio                          | `dry_run` : vraies lectures, débit du Wallet du Lab, **levée simulée par le Core**, jamais d'unban                                 |

## 5. Tests

- Core (PGlite) `test/caution.test.ts` (23) : paiement normal, aide / silences, refus au devis, solde insuffisant,
  timeout fini / levé / devenu permanent / prolongé / raccourci, devis expiré, deux cautions simultanées, double
  confirmation et rapports en double, tentative périmée, refus Twitch remboursé une fois, timeout fini à la levée,
  incertain puis réglé par le journal, exécuteur disparu après débit, Twitch illisible, bot absent, lecture perdue 3 fois,
  redémarrage du Core au milieu, droit de levée manquant, simulateur, mute du streamer (prix, fin, mute terminé avant le
  `oui`), routeur chat (`CAUTION_CHAT`).
- Chaîne complète `test/caution-chain.test.ts` (15) : vraies routes HTTP + vrai exécuteur du bot + Twitch simulé, sur
  le **Wallet du Lab et le Wallet canonique** : levée, 403, 500 encore listé / levé, 400 « pas banni », Twitch
  injoignable, timeout levé par un modo entre devis et `oui`, liste illisible, bot mort pendant l'unban (levé / encore
  listé), Core injoignable au rapport, mute du streamer.
- PostgreSQL réel `test/caution.integration.test.ts` (4, deux Cores, deux pools) : livraison ×4, deux payeurs au même
  instant, `oui` ×4 + rapports concurrents (un débit, un remboursement, un message), Wallet canonique.
- Bot `test/caution-executor.test.ts` (11) ; migrations `test/caution-migration.test.ts` (2) ; Studio
  `test/caution-view.test.js` (3).
- **Non testé** : un vrai Twitch (jamais appelé), un vrai OBS, la Production.

## 6. Migrations

- Lab : `supabase/migrations/20261105120000_caution_lab.sql` (appliquée par Studio au démarrage du Lab).
- Production : `supabase/migrations/20261105130000_caution.sql` (additive, ré-exécutable, même schéma vérifié par test) —
  **non appliquée**. Sur la base Production actuelle (41 fichiers), le migrateur n'appliquera que ce fichier (testé).

## 7. Déploiement contrôlé (chaque étape avec l'accord explicite d'Antoni)

1. Validation Lab : `npm run studio` (Lab), adaptateur Twitch du Lab ON ; section Caution : exécuteur « prêt ».
   Simulateur de chat Studio : `!caution <pseudo réellement en timeout>` → devis → `oui` → « [test] … serait libéré »
   (aucun unban, Jetons de test). Puis un vrai test contrôlé avec un compte de test timeout par un modo :
   `!caution` depuis le vrai chat → vraie levée → contrôle dans Twitch.
2. Sauvegarde Production → déploiement Core (avec la migration `20261105130000_caution.sql`) **flag OFF**
   (`CAUTION_CHAT=false`) → contrôles `/health`, `/ready`, migration présente.
3. Déploiement bot **flag OFF** (`CAUTION=false`).
4. Activation (hors live) : `CAUTION=true` (bot) et `CAUTION_CHAT=true` (Core), redémarrer ; Studio : section
   Caution « prête ». Rien à couper côté SAMMI (débranché depuis le 20/10, à laisser éteint).
5. Premier test réel avec un compte de test ; surveiller la colonne « Jetons » (aucune ligne « à vérifier »).
6. Retour arrière : flags à `false` (le code reste, la table aussi). **Jamais** de retour à SAMMI.

Prérequis : économie canonique en Production (sinon la Caution de Production débiterait le Wallet de test du Core) ;
droits Twitch LeCroupier\_ `moderator:manage:banned_users` et raptoru\_ `moderation:read` (accordés pour Random Ban).

## 8. Décisions d'Antoni (23/10/2026)

1. **Tous les timeouts actifs restent rachetables**, y compris ceux posés à la main par la modération (comportement
   SAMMI) — déjà le comportement codé.
2. **Timeout prolongé après le devis : nouveau devis** (rien n'est débité, relancer `!caution`) — déjà codé.
3. **Activation en Production avec la bascule économique** (Jetons sur le Wallet Raptoru) : d'ici là, déployée
   mais OFF (`CAUTION_CHAT=false`, `CAUTION=false`). Révision du 23/10 : SAMMI est débranché depuis la bascule, aucune
   Caution n'est active en attendant. Prochaine étape : validation Lab (§ 7.1).
