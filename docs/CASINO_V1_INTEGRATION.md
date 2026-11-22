# Casino V1 — intégration finale et mise en Production (journal de reprise)

Mandat d'Antoni du 20/11/2026 : « CASINO V1 : INTÉGRATION FINALE ET MISE EN PRODUCTION » (GO pour préparer et
déployer le Casino complet si tous les contrôles passent ; arrêter seulement une étape qui exige une autorisation
extérieure). Branche locale `feat/casino` (worktree `agent`).

## État

| Étape                                                         | État     | Preuve                                                                                                               |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| Archive des prototypes                                        | fait     | `Documents\Sauvegarde Raptoru 2.06-11-20-prototypes-casino` (593 fichiers, manifeste SHA-256 vérifié par extraction) |
| Prototypes versionnés                                         | fait     | `b04b39d1` (`prototypes/casino-blackjack`, `prototypes/casino-emotes`, lançables seuls)                              |
| Core : blackjack + machine à émotes                           | fait     | `d9d42006` ; `test/casino-blackjack.test.ts` (12)                                                                    |
| Core : concurrence sur vrai Postgres (deux Cores)             | fait     | `ac28bbad` ; `test/casino-blackjack.integration.test.ts` (3)                                                         |
| Extension : blackjack, machine à émotes, spectateurs, annonce | fait     | `298e9402` ; contrôle Chromium sur le vrai Core local (ci-dessous)                                                   |
| Studio : réglages, ouverture par jeu, tables                  | fait     | `298e9402` (`pages/casino.ts`, relais `/api/casino/bj`)                                                              |
| Docs, CI, PR, déploiement                                     | en cours | § Livraison                                                                                                          |

## Décisions techniques

- **Blackjack au Core** (`apps/core-api/src/casino/blackjack/`) : `rules.ts` et `paytable.ts` = le prototype à
  l'identique (test de parité sur 20 000 mains) ; `engine.ts` = la machine de table, pure ; `service.ts` = Postgres.
- **Une ligne par table** (`casino_bj_tables.state`), modifiée seulement sous le verrou de la ligne, dans la même
  transaction que les mouvements du Wallet (clés `casino:bj:<bet|unbet|double|split|ins|insp|pay|side>:…`).
- **Timers** : l'étape en attente est enregistrée avec la table (`next_at`) ; le Core la joue (tick 250 ms). Après un
  redémarrage, elle joue en retard avec son défaut sûr (RESTER, pas d'assurance, donne avec les prêts). Table vide :
  aucune étape.
- **Création des tables** sous le verrou du salon (`casino:bj:lobby:<chaîne>`) + unicité `(channel_id, table_no)`.
  Une table pleine (10) ouvre la suivante, au plus 8 tables.
- **Présence** : en mémoire (un seul processus Core en Production) ; un joueur non vu depuis 25 s est « déconnecté »
  (ne bloque jamais la donne, assurance refusée pour lui) ; 90 s hors manche = place libérée.
- **Annonce** : seulement le créateur de la table, sur clic, une fois, dans les 10 min ; au plus une annonce de table
  par chaîne toutes les `casino.bj_announce_gap_s` (600 s). File de messages existante (`cmd_steps`, `module:casino`).
- **Machine à émotes** : jeu `book` du service existant, tour entier tiré au spin (comme le Coffre) ; parité exacte avec
  le moteur du prototype (3 000 tours). Mise 20–1 000 par défaut (plafond de gain : § 13 de CASINO.md).
- **Historique** : une ligne `casino_rounds` (jeu `blackjack`) par joueur et manche réglée.

## RTP et plafond (machine à émotes)

Simulation du moteur du Core, 2 000 000 de tours : RTP 95,4 % (exact : 95,23 %), plus gros tour ×1 569. Effet d'un
plafond de gain par tour : ×1 000 (mise max 1 000, gain max 1 000 000, réglages par défaut) −0,03 point ; ×500
−0,36 ; ×100 −7,6. Garder `book_max_bet` ≤ `max_win` ÷ 1 000.

## Livraison (20/11/2026)

- **PR #90** fusionnée : `main` = `18a4b048`. CI verte. Un correctif hors Casino en passant : la liste « À traiter »
  des points de chaîne regardait 7 jours en arrière avec l'horloge de la base au lieu de celle du Core (un test figé au
  12/11 échouait seul depuis le 19/11).
- **Sauvegarde** Production 06:28 UTC (`success`, 12 291 170 octets), hors live.
- **Core** : 1ᵉʳ déploiement de `18a4b048` (06:29) noté ÉCHEC par le script — la sortie du migrateur n'était pas dans
  le journal (Coolify l'envoie au journal de débogage) et le ticker du blackjack signalait la table absente pendant
  quelques minutes. Retour à `2c04a5db` (DÉPLOYÉ), puis `18a4b048` avec `--migrations-approved` : DÉPLOYÉ, migrateur
  « database already up to date » (les 4 migrations Casino avaient été appliquées par la commande post-déploiement du
  premier essai), journaux sans erreur, `/health` et `/ready` 200. Bot inchangé (`2c04a5db`, actif).
- **Studio 0.1.41** publié (Latest), workflow `44689178516`.
- **Casino fermé** après ce déploiement (`CASINO_EXTENSION = off`, `casino.open = 0`), puis, le 20/11 (GO d'Antoni) :
  inventaire `298e940290ab` validé (PR #93), ZIP `2e2eaf3ae34a` construit et téléversé en Hosted Test,
  `CASINO_EXTENSION=on`, `casino.open=1`, les 4 jeux ouverts. Le Core refuse hors live (`stream_offline`). Inchangé
  après le déploiement des correctifs niveaux (Core `1f05b97c`).

## Post-live et mise en service finale (21–22/11/2026)

- **21/11** : passes post-live sur les retours d'Antoni (PR #99, #100, #102, #103, #105, #107, #109, #110, #112,
  #114) : Split en pile, gains explorés sur les rouleaux, téléphone et paysage, 7 réactions, banc interactif dans le vrai
  cadre de l'extension. Détail : [CASINO.md](CASINO.md) § 14–18.
- **22/11** : dernière passe (PR #115 : plus de pastilles sous les machines, réactions « hélium », bulle qui reste
  ouverte, croupier en émote seule, ruban BUST, doubles-clics vérifiés) ; Core des nouvelles tables et réactions
  (PR #111, anti-spam 5 puis 1 toutes les 2 s, aucune migration) **déployé** : `a94d1081`, 00:39 UTC, GO d'Antoni,
  sain, bot `2c04a5db` inchangé ; retour arrière `1f05b97c`.
- **ZIP prêt à publier, non téléversé** : `raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip`,
  SHA-256 `1ec79c2adc15c242f66da51d226726fd9ef9abd381d6b753f8734d8b66d76039`, inventaire `2411c992b26b` validé par
  Antoni (PR #113, `main` `302db793`).
- **Le développement du Casino V1 est terminé.** Reste la publication et l'essai réel : [ROADMAP.md](ROADMAP.md) § 0.4.

## Restent (gestes d'Antoni)

**État au 22/11** : points 1 à 4 faits (Studio 0.1.42 installé). L'extension publique (`be1744e75f63`) ne contient pas
le Casino ; la suite (téléversement du ZIP `d09fd03aa844`, essai hors live en Hosted Test, choix de `CASINO_EXTENSION`
avant la publication, revue Twitch, essai réel en live) est dans [REPRISE.md](REPRISE.md) § 5.4 B. Liste d'origine :

1. Installer Studio 0.1.41 (« Rechercher une mise à jour »).
2. Extension : relire `apps/twitch-extension/release-inventory/INVENTAIRE-298e940290ab.md`, y écrire la ligne
   « Validé par Antoni : oui », puis `npm run package:production -w @raptoru/twitch-extension -- --shell v2` (le
   `--check` est déjà OK : 2 202 fichiers, 16,6 Mo). Ce ZIP remplace celui du 16/11 (`be1744e75f63`, mini-profil).
3. Variable du Core `CASINO_EXTENSION = testers:<ton id Twitch>` (Coolify, redémarrage du Core), Hosted Test hors live,
   puis revue Twitch ; après approbation : `CASINO_EXTENSION = on`.
4. Studio › Casino : choisir le gain max d'un ALL-IN (0 = désactivé), vérifier les limites, puis « Ouvert ».
