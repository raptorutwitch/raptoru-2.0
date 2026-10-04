# Audit global Raptoru 2.0 — référence de consolidation

**Document :** `docs/ASTRA_GLOBAL_AUDIT_2026-10.md`  
**Date de l'audit initial :** 4 octobre 2026  
**Référence auditée :** `main@cac8d5480b849261b2aca7a0639d186715d8b649`  
**Nature :** transcription documentaire d'un audit statique, sans correction du projet.  
**Statut de départ de chaque finding :** **OUVERT**.

Ce document fige les constats, preuves, raisonnements et réserves de l'audit initial. Il constitue le registre de départ pour la correction et la consolidation. Il ne certifie ni l'état du déploiement réel, ni le fonctionnement d'une installation Windows, ni la fermeture de points modifiés après l'audit.

## Résumé exécutif

**Raptoru 2.0 reste sur une base adaptée à son objectif. La recommandation initiale est de continuer avec Core et PostgreSQL, après une passe ciblée de consolidation avant le prochain gros module.**

Le Core traite sérieusement les transactions, verrous, idempotence économique, permissions et historique. Les principales fragilités sont dans la livraison entre composants : retry de mutation sans clé conservée jusqu'à Core, arrêt audio consommé sans confirmation, ingestion Lab sans rattrapage suffisant, supervision locale et données persistantes incomplètement alignées. L'Extension et la façade centrale deviennent coûteuses à modifier ; les E2E de session ne forment pas encore un filet reproductible depuis le dépôt.

Le Lab contient des moteurs métier réutilisables. Le raccordement à la production reste substantiel : Wallet, session, identité, EBS public, transport distant et redemptions Channel Points demandent encore des frontières explicites. Une qualité fonctionnelle élevée dans le Lab ne prouve pas que le cutover est presque terminé.

**Aucun P0 identifié dans le périmètre inspecté.** La dette est importante, localisée et récupérable. Les défauts économiques démontrés ici concernent actuellement le wallet fictif Lab ; cette portée ne supprime pas leur obligation de correction avant raccordement.

| Sévérité | Nombre | Lecture |
| -- | --: | -- |
| P0 | 0 | Aucun problème critique établi par l'audit initial |
| P1 | 19 | Consolidation importante avant de continuer trop loin |
| P2 | 29 | Améliorations rentables, parfois conditionnées à une mesure ou au cutover |
| P3 | 6 | Faible priorité ou décision produit préalable |
| **Total** | **54** | Causes distinctes issues des constats initiaux |

Les neuf groupes P1 de la réponse initiale contenaient plusieurs problèmes indépendants. Le registre les sépare lorsque l'action et la cause diffèrent : délai DB/readiness/recovery, lifecycle des processus, ou raccordements économiques/session/public/paiements/transport. Les manifestations d'une même cause, comme les stops TTS/Soundboard ou les retries additifs sans clé, restent groupées. Les observations transversales P2/P3 sont enregistrées sans augmenter leur priorité.

## Architecture observée

Le monorepo est dimensionné pour un streamer. Le découpage global reste cohérent avec le remplacement progressif de SAMMI, StreamElements et des bridges existants, sans recréer un moteur universel de workflows.

| Workspace | Responsabilité observée | Autorité et limites |
| -- | -- | -- |
| Core API | Daily, Presence, Wallet, Loyalty, Commands, Bonk, Soundboard, TTS, Tombola, modération | Décisions métier, permissions, prix, cooldowns, files, états et historique en PostgreSQL ; modèle Lab spécifique à raccorder |
| Twitch Bot | OAuth/Helix, EventSub, chat, snapshots Presence, forwarding, sortie chat | Adaptateur majoritairement fin ; Loyalty durable, entrée Lab moins robuste, exécution chat journalisée |
| Studio Server | Cockpit API local, proxies, Test Lab, runtime, workers, lecteurs, overlays, OBS | Exécution locale et orchestration ; accès DB surtout pour préparer le runtime/migrations, pas de seconde économie persistante identifiée |
| Studio Web | Configuration et administration streamer | Surface de cockpit ; écran Commands volumineux, pas de suite dédiée identifiée au HEAD audité |
| Studio Desktop | Electron, serveur enfant, page de recovery, updater | Instance unique, sandbox, recovery et reprise bornée ; identité de processus à compléter |
| Twitch Extension | Interfaces viewer/modération sur plusieurs surfaces | Legacy Live et V2 coexistent ; intentions/projections Core pour V2, rendu/lifecycle centraux trop concentrés |
| Viewer Web | Placeholder | Pas de frontend fonctionnel identifié ; ne pas le compter comme prêt au cutover |
| Schemas | Types et contrats Zod partagés | Package sobre et utile ; bonnes frontières d'entrée, sorties moins validées |

Les huit workspaces sont déclarés dans [package.json](<C:/Users/Antoni/Documents/Raptoru 2.0/package.json:9>). Aucun cycle runtime évident n'a été identifié dans les imports inspectés ; il ne s'agit pas d'une preuve exhaustive d'absence de cycle.

Flux représentatif : **Viewer → Extension → façade EBS Lab/ancienne API Live → Core Lab → PostgreSQL → worker Studio → lecteur/OBS → ACK → Core**. Les acteurs du Lab, le wallet fictif et la session simulée ne constituent pas l'authentification, l'économie ou le contexte canonique de la future production.

| État | Autorité actuelle |
| -- | -- |
| Wallet central, Daily, Presence, Loyalty | Core et PostgreSQL |
| Wallet des interactions Lab | Core Lab et tables Lab |
| Admission, permissions, queues et cooldowns V2 | Core Lab |
| Configuration métier | Core, avec projections Studio/Extension |
| Effet réellement en cours | Lecteur local, preuve dans journal worker et état Core |
| Navigation/préférences UI | Frontend local |
| État Twitch | Twitch → Bot → Core ; rattrapage Lab incomplet |
| Processus, ports et dépendances | Electron, LocalRuntime, TestLab, Ingress ; ownership à aligner |

Un journal d'exécution local a une responsabilité légitime : conserver une preuve que Core ne connaît pas directement. Le problème apparaît quand une remise préparée est assimilée à une exécution confirmée.

L'implémentation utilise surtout HTTP, polling et états durables par domaine. Bus `events`, curseurs de replay, Supabase Realtime et génération de clients OpenAPI sont des éléments de cible documentaire, pas des garanties identifiées dans l'implémentation actuelle. Pour un streamer, cela ne justifie ni microservices, ni bus généralisé, ni refonte de framework.

## Hypothèses / limites de l'audit

### Référence historique et état Git

| Élément | État pendant l'audit initial |
| -- | -- |
| Dépôt | `C:\Users\Antoni\Documents\Raptoru 2.0` |
| Branche | `main` |
| HEAD | `cac8d5480b849261b2aca7a0639d186715d8b649` |
| Dernier commit | `feat: Commands V2 — team right « rename » (rename a command)` |
| Date du commit | 04/10/2026 à 13:44:06, UTC+02 |
| Working tree | Propre au début et à la fin de l'inspection |
| Diff index/working tree | Vide |
| Non suivis hors exclusions | Aucun |
| Fichiers suivis | 2 340 |
| Remotes / tags locaux | Aucun / aucun |

L'absence de remote/tag ne prouve pas l'absence de release ailleurs. Les fichiers exclus — .env, tokens, runtime, builds, caches, packages locaux et journaux — signifient également que Git propre ne décrit pas tout l'état opérationnel. Les prototypes exclus localement restent des références produit, pas des fichiers morts démontrés.

L'audit a confronté HANDOFF, État projet, Infrastructure Spec, README, CLAUDE, parités, manifests, Turbo, schemas, migrations, tests et code réel. Les documents constituent du contexte ; **Git et code réel priment**. L'inventaire du monorepo n'est pas une prétention de lecture exhaustive de chacun des 2 340 fichiers.

### Méthode et portée des preuves

- **Aucun test, build, migration, service, installation, release ou accès DB n'a été exécuté pendant l'audit initial.** Pour les comportements d'exécution : **non vérifié dynamiquement pendant cet audit lecture seule**.
- La présente tâche crée uniquement ce Markdown. Elle n'apporte pas de résultats de tests ni de validation des correctifs potentiels.
- Les liens et numéros de ligne du registre se rapportent au **HEAD audité**, sauf mention explicite d'un commit ultérieur. Les fichiers ouverts dans le checkout actuel peuvent avoir d'autres lignes. Pour retrouver une preuve : `git show cac8d5480b849261b2aca7a0639d186715d8b649:<chemin>`.
- Un **fait statique** peut suffire à établir une rupture de protocole. Le scénario décrit son impact déduit ; il ne signifie pas qu'un incident a été reproduit.
- **À VÉRIFIER** distingue une hypothèse, un impact non mesuré ou un paramètre opérationnel inconnu. Le détail du champ de réserve indique exactement ce qui manque.
- **À REVALIDER SUR CODE ACTUEL** conserve un constat historique potentiellement modifié. Ce marquage n'est ni une diminution de sévérité ni une fermeture.
- Les dépendances entre findings indiquent liens, points communs et validations croisées ; elles ne constituent pas toutes des prérequis bloquants ou un graphe de commits à suivre mécaniquement.
- Les efforts sont des ordres relatifs : XS < 30 min, S quelques heures, M environ une journée, L plusieurs jours, XL chantier architectural.
- Les tailles de fichiers et cadences sont historiques. Les projections de charge ne sont pas des benchmarks.
- Aucun exploit distant, fuite effective de secret, état actuel de signature, absence de CVE, release distante ou installation Windows n'a été démontré/vérifié. Aucun P0 ne peut être déduit de ces inconnues.

### Évolution depuis la référence auditée

Le checkout a avancé pendant la préparation documentaire. Dernier HEAD relu à ce stade : `b54ad46d226a2a1f4629379f2c25d050246fa792`. Les constats ne sont pas remplacés par un nouvel audit du code courant.

| Commit après l'audit | Évolution observée dans Git | Conséquence documentaire |
| -- | -- | -- |
| `6b0386c` | Phase F Commands : liste publique viewer Extension | Tailles, surfaces, façade et tests historiques à revalider |
| `75c9ea0` | Règle streamer commune Commands/Tombola | [ASTRA-P2-012](#astra-p2-012) conserve sa preuve historique ; correction candidate à valider |
| `a9b80ea` | Dépendance Schemas déclarée par Studio Web | Contexte d'évolution ; **aucun nouveau finding ajouté**, car absent de l'audit initial |
| `28d7052` | Zod déclaré par Schemas | [ASTRA-P2-001](#astra-p2-001) à revalider, y compris staging |
| `c714f70` | Formatage test du modèle Commands Extension | Résultats de test non déduits du commit |
| `0b9a9f5` | Actualisation Commands V2 Status | [ASTRA-P2-009](#astra-p2-009) à revalider |
| `b54ad46` | Acteur Lab Extension unifié pour les chemins de modération | Identité/façade à revalider ; ne prouve pas la fermeture de l'idempotence |

Tous les findings et toutes les lignes de checklist commencent à **OUVERT**, y compris lorsqu'un commit candidat existe. Ce dernier figure dans la réserve/les notes, jamais comme commit de fermeture validé.

## Top risques prioritaires

| Rang | Risque et impact | Findings |
| --: | -- | -- |
| 1 | Répétition d'une mutation additive après réponse perdue : double effet wallet/notes/temps Lab | [ASTRA-P1-009](#astra-p1-009), [ASTRA-P2-003](#astra-p2-003), [ASTRA-P2-010](#astra-p2-010) |
| 2 | Annulation Core sans silence confirmé : stop audio perdu, risque de modération | [ASTRA-P1-017](#astra-p1-017), [ASTRA-P2-028](#astra-p2-028) |
| 3 | État stream divergent et commandes abandonnées pendant une panne Core | [ASTRA-P1-002](#astra-p1-002), [ASTRA-P1-003](#astra-p1-003), [ASTRA-P1-015](#astra-p1-015) |
| 4 | Runtime indisponible malgré état trompeur : DB/health/recovery/ownership | [ASTRA-P1-004](#astra-p1-004), [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-011](#astra-p1-011), [ASTRA-P1-012](#astra-p1-012), [ASTRA-P1-013](#astra-p1-013), [ASTRA-P1-014](#astra-p1-014) |
| 5 | Journal chat sous code installé : persistance dépendant des droits/update | [ASTRA-P1-016](#astra-p1-016) |
| 6 | Coût de cutover grossissant à chaque nouveau module utilisant les concepts Lab | [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-007](#astra-p1-007), [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-010](#astra-p1-010), [ASTRA-P1-019](#astra-p1-019) |
| 7 | Régressions de frontières non détectées et coût de modification UI croissant | [ASTRA-P1-018](#astra-p1-018), [ASTRA-P1-008](#astra-p1-008), [ASTRA-P2-011](#astra-p2-011), [ASTRA-P2-029](#astra-p2-029) |

Ce classement reprend les risques initiaux ; il n'affirme pas que tous se produisent aujourd'hui. Le fait qu'une chaîne semble fonctionner ne dispense pas de prouver les comportements sous perte de réponse, arrêt et reprise.

## Ordre recommandé de correction

### Avant le prochain gros module

1. **Revalider les entrées modifiées depuis l'audit**, en particulier identité et Zod. Conserver les IDs ; relier toute fermeture au HEAD, aux preuves et aux tests.
2. **Fermer l'idempotence de bout en bout** ([ASTRA-P1-009](#astra-p1-009)) : restriction provisoire des retries puis clé stable, hash et résultat durable dans Core. La protection client seule n'est pas une fermeture complète.
3. **Confirmer les stops lecteurs** ([ASTRA-P1-017](#astra-p1-017)) : stop reproposé jusqu'à ACK de la bonne tentative, sans rendre `play` rejouable.
4. **Consolider les chemins et le lifecycle local** : journal dans DATA_ROOT ([ASTRA-P1-016](#astra-p1-016)), shutdown attendu ([ASTRA-P1-014](#astra-p1-014)), garde PostgreSQL ([ASTRA-P1-012](#astra-p1-012)), identité/adoption sûre ([ASTRA-P2-026](#astra-p2-026), puis adoption et supervision labchat ([ASTRA-P1-013](#astra-p1-013), [ASTRA-P1-015](#astra-p1-015)).
5. **Rattraper l'état Twitch et l'entrée chat** ([ASTRA-P1-003](#astra-p1-003), [ASTRA-P1-002](#astra-p1-002)) avec réconciliation et TTL décidés.
6. **Distinguer liveness/readiness, borner les attentes et récupérer les blocages** ([ASTRA-P1-004](#astra-p1-004), [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-011](#astra-p1-011)), sans redémarrer aveuglément lors d'une panne DB extérieure.
7. **Versionner les premiers E2E critiques** ([ASTRA-P1-018](#astra-p1-018)) et isoler le harnais PG ([ASTRA-P2-029](#astra-p2-029)) : retry économique, stop perdu, crash/reprise, puis sessions/permissions/packaging.
8. **Décider les frontières du premier parcours de future production isolé** : Wallet, session, identité, paiements, transport et compatibilité. Prouver une chaîne représentative en test avant de raccorder tous les modules ; préserver la production SAMMI/StreamElements.
9. Appliquer les quick wins indépendants : timeout du corps HTTP, avatars, logs nettoyés, lint progressif, documentation et éventuelles corrections candidates revalidées.

### Progressivement, guidé par les changements et mesures

Découper les écrans centraux et expliciter leur lifecycle ; valider les sorties critiques et capacités ; rendre les diagnostics corrélés ; limiter les écritures de journal à l'état modifié ; ralentir les claims vides ; grouper les cooldowns ; mesurer croissance des quotas, logs et outbox. Partager chemins/journaux/identités de tentative sans fusionner les politiques Bonk/TTS/Soundboard.

### À repousser ou à décider

Viewer Web complet sans besoin immédiat, achievements/cosmétiques/statistiques générales, bus Realtime global, codegen exhaustif, historique avancé des catégories, harmonisation visuelle exhaustive et infrastructure sophistiquée avant un premier parcours distant éprouvé.

### À conserver comme fondements

Ledger et Wallet central, calculs Daily/Presence/Loyalty, moteur Tombola, historique des migrations, séparation Core/Bot/Studio, release/updater explicites et legacy encore nécessaire. Les cinq choix de meilleur rendement restent : garanties des effets, runtime fiable, E2E versionnés, premier parcours canonique isolé et découpage progressif des surfaces.


## Registre des findings

Tri : sévérité, puis domaine, puis ID. Les IDs sont permanents ; ne pas renuméroter après fermeture. Les marquages portent sur la preuve ou l'actualité du constat, jamais sur le statut de suivi.

### Index

| ID | Sévérité | Domaine | Titre court | Marquages |
| -- | -- | -- | -- | -- |
| [ASTRA-P1-001](#astra-p1-001) | P1 | Architecture | Économie des interactions encore couplée au wallet Lab | Constat statique historique |
| [ASTRA-P1-002](#astra-p1-002) | P1 | Bot | Commandes chat Lab perdues lors d'un échec de forwarding | Constat statique historique |
| [ASTRA-P1-003](#astra-p1-003) | P1 | Bot | État de stream Lab sans réconciliation périodique | Constat statique historique |
| [ASTRA-P1-004](#astra-p1-004) | P1 | Core | Délais PostgreSQL non explicitement bornés dans le client | À VÉRIFIER |
| [ASTRA-P1-005](#astra-p1-005) | P1 | Core | Health vert sans preuve de disponibilité métier | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P1-006](#astra-p1-006) | P1 | EBS | Frontière publique des fonctionnalités V2 encore incomplète | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P1-007](#astra-p1-007) | P1 | État | Deux modèles persistants de session de stream à raccorder | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P1-008](#astra-p1-008) | P1 | Extension | Responsabilités frontend et façade trop concentrées | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P1-009](#astra-p1-009) | P1 | Idempotence | Clé d'intention perdue avant Modération V2 Core | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P1-010](#astra-p1-010) | P1 | Paiements | Cycle réel Channel Points non raccordé aux interactions V2 | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P1-011](#astra-p1-011) | P1 | Studio | Core Lab vivant mais figé sans récupération automatique | Constat statique historique |
| [ASTRA-P1-012](#astra-p1-012) | P1 | Studio | Arrêt PostgreSQL sans garde du Core Lab actif | Constat statique historique |
| [ASTRA-P1-013](#astra-p1-013) | P1 | Studio | Ancienne ingestion labchat non reprise au démarrage | À VÉRIFIER |
| [ASTRA-P1-014](#astra-p1-014) | P1 | Studio | Shutdown sans attente de l'arrêt labchat | Constat statique historique |
| [ASTRA-P1-015](#astra-p1-015) | P1 | Studio | Ingestion activée sans supervision continue du processus | Constat statique historique |
| [ASTRA-P1-016](#astra-p1-016) | P1 | Studio | Journal chat écrit dans la racine de code packagée | Constat statique historique |
| [ASTRA-P1-017](#astra-p1-017) | P1 | Studio | Ordre d'arrêt consommé avant confirmation du lecteur | Constat statique historique |
| [ASTRA-P1-018](#astra-p1-018) | P1 | Tests | Parcours E2E critiques non reproductibles depuis le dépôt | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P1-019](#astra-p1-019) | P1 | Transport | Clients et lecteurs V2 spécialisés pour le Core local Lab | Constat statique historique |
| [ASTRA-P2-001](#astra-p2-001) | P2 | Build | Dépendance Zod absente du manifeste Schemas | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-002](#astra-p2-002) | P2 | Config | Garde économique Test Lab incomplète pour Daily | À VÉRIFIER |
| [ASTRA-P2-003](#astra-p2-003) | P2 | Contrats | Réponses critiques consommées sans validation structurelle | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-004](#astra-p2-004) | P2 | Contrats | Compatibilité intercomposants sans contrat explicite | Constat statique historique |
| [ASTRA-P2-005](#astra-p2-005) | P2 | Core | Cache avatars sans timeout ni exécution unique | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-006](#astra-p2-006) | P2 | Core | Remboursement Lab intégral dans le ledger mais plafonné en solde | Constat statique historique |
| [ASTRA-P2-007](#astra-p2-007) | P2 | Database | Migrateur sans verrou global d'exécution concurrente | Constat statique historique |
| [ASTRA-P2-008](#astra-p2-008) | P2 | Database | Historique des migrations identifié par nom seul | Constat statique historique |
| [ASTRA-P2-009](#astra-p2-009) | P2 | Documentation | Documents de reprise et commentaires décrivant un état dépassé | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-010](#astra-p2-010) | P2 | Extension | Timeout interrompu avant lecture du corps HTTP | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-011](#astra-p2-011) | P2 | Extension | Extension entièrement exclue du lint | Constat statique historique |
| [ASTRA-P2-012](#astra-p2-012) | P2 | Identité | Broadcaster chat Tombola comparé au channel simulé | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-013](#astra-p2-013) | P2 | Observabilité | Erreurs inattendues Core Lab sans cause journalisée | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-014](#astra-p2-014) | P2 | Observabilité | Stacks Studio écrites avant redaction | À VÉRIFIER |
| [ASTRA-P2-015](#astra-p2-015) | P2 | Observabilité | Dernière preuve d'exécution difficile à suivre entre composants | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-016](#astra-p2-016) | P2 | Performance | Journaux des trois workers réécrits à vide | À VÉRIFIER |
| [ASTRA-P2-017](#astra-p2-017) | P2 | Performance | Claims des workers à cadence courte même sans travail | À VÉRIFIER |
| [ASTRA-P2-018](#astra-p2-018) | P2 | Performance | Lecteur Soundboard pollant toutes les 120 ms | À VÉRIFIER |
| [ASTRA-P2-019](#astra-p2-019) | P2 | Performance | Planificateur Tombola inspectant l'état quatre fois par seconde | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-020](#astra-p2-020) | P2 | Performance | Cooldowns Soundboard random lus séquentiellement | À VÉRIFIER |
| [ASTRA-P2-021](#astra-p2-021) | P2 | Performance | Quotas Commands calculés sur un historique croissant | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-022](#astra-p2-022) | P2 | Performance | Redactor relisant plusieurs fichiers synchroniquement par ligne | À VÉRIFIER |
| [ASTRA-P2-023](#astra-p2-023) | P2 | Performance | Fichier courant de logs Electron non borné pendant la session | À VÉRIFIER |
| [ASTRA-P2-024](#astra-p2-024) | P2 | Performance | Outbox Loyalty croissante et réécrite intégralement | À VÉRIFIER |
| [ASTRA-P2-025](#astra-p2-025) | P2 | Performance | Polling viewer pouvant multiplier les lectures à grande audience | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-026](#astra-p2-026) | P2 | Restart/replay | Adoption PID basée principalement sur le nom d'exécutable | À VÉRIFIER |
| [ASTRA-P2-027](#astra-p2-027) | P2 | Sécurité | Frontière IPC Electron sans contrôle explicite de l'émetteur | À VÉRIFIER |
| [ASTRA-P2-028](#astra-p2-028) | P2 | Studio | Lecteurs sans garde de fin après démarrage | À VÉRIFIER |
| [ASTRA-P2-029](#astra-p2-029) | P2 | Tests | Deux suites PostgreSQL détruisant le même schéma en parallèle | Constat statique historique |
| [ASTRA-P3-001](#astra-p3-001) | P3 | Build | Provenance des binaires à enrichir pour une diffusion large | À VÉRIFIER |
| [ASTRA-P3-002](#astra-p3-002) | P3 | Config | Nommage BonkLab utilisé pour un runtime transversal | Constat statique historique |
| [ASTRA-P3-003](#astra-p3-003) | P3 | Config | Ports par défaut répétés dans plusieurs couches | Constat statique historique |
| [ASTRA-P3-004](#astra-p3-004) | P3 | État | Catégories Commands éditées sans version concurrente | Constat statique historique |
| [ASTRA-P3-005](#astra-p3-005) | P3 | Observabilité | Catégories Commands sans historique propre | Constat statique historique |
| [ASTRA-P3-006](#astra-p3-006) | P3 | UX | Harmonisation visuelle entre modules à cadrer | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |

### P1

#### Architecture

<a id="astra-p1-001"></a>

##### ASTRA-P1-001 — Économie des interactions encore couplée au wallet Lab

**ID :** `ASTRA-P1-001`

**Sévérité :** P1

**Domaine :** Architecture

**Titre court :** Économie des interactions encore couplée au wallet Lab

**Statut initial :** **OUVERT**

**Statut actuel :** **BLOQUÉ — décision de cutover**

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `47b71bd` : les interactions Lab (modération, Tombola, TTS, Bonk/Soundboard via le store) débitent/créditent `lab_wallets`/`lab_wallet_ledger` ; aucun module Lab n'utilise `WalletService`. Constat toujours exact, mais il ne s'agit pas d'un défaut du Lab (wallet de test volontairement isolé) : c'est la frontière économique du futur raccordement. **Options :** (A) adaptateur « économie » unique côté Core, implémenté par le wallet Lab aujourd'hui et par `WalletService` au cutover, débit + admission dans la même transaction — L ; (B) protocole réservation/compensation entre l'admission Lab et le Wallet central — L/XL, plus de cas d'échec ; (C) migrer chaque module isolément au cutover — coût répété et risque de dissociation débit/admission. **Recommandation :** A, décidée avec le modèle de monnaies (jetons/crédits) et le point de coupure ; à faire avant d'ajouter un nouveau module payant. Aucune modification sans décision (modèle de monnaies = décision produit).

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Les interactions récentes débitent/créditent lab_wallets et lab_wallet_ledger, alors que WalletService possède une économie centrale distincte. Le Lab fonctionne avec ses propres monnaies et plafonds ; le raccordement ne consiste pas à désactiver test_mode.

**Preuve précise :**

- [apps/core-api/src/lab-moderation/store.ts:689](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/lab-moderation/store.ts:689>) et :769 — refundDebit() et adminAdjust(), opérations sur le wallet Lab.
- [supabase/migrations/20261005120000_lab_moderation.sql:9](<C:/Users/Antoni/Documents/Raptoru 2.0/supabase/migrations/20261005120000_lab_moderation.sql:9>) — lab_wallets et lab_wallet_ledger.
- [apps/core-api/src/wallet/wallet-service.ts:311](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/wallet/wallet-service.ts:311>) — opération économique centrale transactionnelle et idempotente.

**Cause racine :** Le Lab a été développé avec un modèle économique autonome, directement utilisé par les services d'interaction.

**Risque concret :** Chaque nouveau module peut reproduire un raccordement économique spécifique ; un branchement naïf peut dissocier débit et admission.

**Scénario de panne / impact utilisateur :** Au cutover, un appel Wallet.spend() séparé de l'enqueue réussit alors que l'admission échoue, ou inversement ; un remboursement peut viser le mauvais ledger.

**Recommandation :** Définir une frontière économique canonique et composer admission/opération wallet dans une transaction cohérente, ou un protocole explicite de réservation et compensation. Conserver les garanties de WalletService.

**Portée probable de la correction :** Core, admissions des interactions, monnaies, ledger et futures migrations de raccordement ; conserver un adaptateur simulé pour le Lab.

**Effort indicatif :** L ; raccordement global XL.

**Tests à prévoir :**

- Échec d'admission après tentative de débit : aucune perte de solde.
- Retries, appels concurrents et remboursement unique sur le Wallet canonique de test.
- Réconciliation solde/ledger et références d'interaction entre les deux modes.

**Dépendances avec d'autres findings :** [ASTRA-P1-009](#astra-p1-009), [ASTRA-P1-010](#astra-p1-010), [ASTRA-P2-006](#astra-p2-006), [ASTRA-P2-003](#astra-p2-003).

**Traçabilité de l'audit initial :** Audit initial §5 P1-07, §8 Database et §10 Lab → Production.

**Décision préalable :** Le modèle de monnaies, le point de coupure et le protocole d'import nécessitent une décision architecture/produit.

---

#### Bot

<a id="astra-p1-002"></a>

##### ASTRA-P1-002 — Commandes chat Lab perdues lors d'un échec de forwarding

**ID :** `ASTRA-P1-002`

**Sévérité :** P1

**Domaine :** Bot

**Titre court :** Commandes chat Lab perdues lors d'un échec de forwarding

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `dcfdf3d`

**Résolution (passe P1, 2026-10-04) :** Décision produit d'Antoni (2026-10-04) : reprise en mémoire bornée à 15 s. Hypothèses revérifiées sur `f3be247` avant correction : le relais chat abandonnait toute commande au premier échec (`lab-chat-ingest.ts`) ; Core déduplique par `message_id` avec contrainte d'unicité (Commands : `unique (channel_id, source, source_message_id)` → `duplicate_message` ; Tombola : `lab_raffle_chat` clé primaire + adhésion idempotente `chat:<message_id>`) et décide à réception (une adhésion après clôture → `raffle_closed`). Correction : sur erreur transitoire (Core injoignable, timeout, 5xx, 408, 429) la même commande, même `message_id`, est renvoyée après 1 / 2 / 4 / 8 s ; aucun envoi ne démarre plus de 15 s après réception, puis abandon journalisé (« dropped: Core unreachable for 15 s ») ; un 4xx est définitif (« refused by Core ») ; les reprises tournent en arrière-plan (la boucle EventSub n'est jamais bloquée), ne sont jamais persistées et sont abandonnées explicitement à l'arrêt de l'adaptateur (SIGINT/SIGTERM, `close()`). Limite assumée : le dernier essai démarre au plus tard à 15 s ; sa réponse peut arriver jusqu'au timeout HTTP de 5 s — Core en reste juge (horloge de réception).

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** notification() attrape une erreur de POST /v1/lab/chat, la journalise et abandonne le message. L'entrée ne dispose pas d'outbox ; le routeur EventSub mémorise l'identifiant avant le traitement.

**Preuve précise :**

- [apps/twitch-bot/src/lab-chat-ingest.ts:77](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-ingest.ts:77>) — createLabChatIngest().handlers.notification(), catch de forwarding.
- [apps/twitch-bot/src/twitch/eventsub.ts:52](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/twitch/eventsub.ts:52>) — createEventSubRouter(), seen.push(id) avant handlers.notification().
- [apps/twitch-bot/src/lab-chat-main.ts:61](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-main.ts:61>) — POST local borné, sans reprise durable de l'entrée.

**Cause racine :** Le chemin d'ingestion Lab est un forwarding ponctuel, contrairement à l'outbox utilisée par Loyalty.

**Risque concret :** Une indisponibilité brève de Core peut supprimer une intention chat sans possibilité de rattrapage par la déduplication locale.

**Scénario de panne / impact utilisateur :** Un viewer envoie !join ou une commande pendant un redémarrage Core ; sa commande est perdue alors que Twitch et le Bot restent connectés.

**Recommandation :** Prévoir une reprise bornée par TTL et identifiant Twitch, adaptée aux intentions chat. Ne pas rejouer indéfiniment de vieilles commandes de jeu.

**Portée probable de la correction :** Bot ingress, contrat d'entrée Core, politique d'expiration et diagnostics de refus/abandon.

**Effort indicatif :** M.

**Tests à prévoir :**

- Core indisponible au premier POST puis disponible dans le TTL : une seule admission.
- Même message reçu plusieurs fois : effet unique.
- Message expiré : abandon explicite, aucun effet tardif.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018), [ASTRA-P1-015](#astra-p1-015), [ASTRA-P2-015](#astra-p2-015).

**Traçabilité de l'audit initial :** Audit initial §5 P1-03 et §8 Twitch Bot.

**Décision préalable :** La durée de validité et les commandes admissibles à une reprise demandent une politique métier explicite.

---

<a id="astra-p1-003"></a>

##### ASTRA-P1-003 — État de stream Lab sans réconciliation périodique

**ID :** `ASTRA-P1-003`

**Sévérité :** P1

**Domaine :** Bot

**Titre court :** État de stream Lab sans réconciliation périodique

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `47b71bd`

**Résolution (passe P1, 2026-10-04) :** Confirmé sur `a32a389` : l'adaptateur Lab ne synchronisait l'état du stream qu'à la (re)connexion EventSub ; un `stream.offline/online` dont le relais échouait (Core arrêté) était journalisé puis perdu. Correction : l'ingestion mémorise le dernier état effectivement reçu par Core et, toutes les `STREAM_SYNC_INTERVAL_MS` (60 s, même réglage que le bot principal, minuteries chaînées sans chevauchement), relaie l'état Helix uniquement s'il diffère. Choix délibéré : un état stable n'envoie rien — une session simulée ouverte dans Studio (Lab) n'est donc jamais fermée par la réparation (renvoyer `offline` à chaque cycle l'aurait fermée toutes les 60 s, changement de comportement refusé). Helix injoignable : rien n'est confirmé (erreur journalisée). Non fait : affichage de l'âge de la dernière confirmation (observabilité, [ASTRA-P2-015](#astra-p2-015)).

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** La synchronisation Helix du stream est appelée lors des connexions fraîches. Il n'existe pas de réconciliation périodique dans ce chemin Lab ; un échec de forwarding stream.online/offline est journalisé puis abandonné.

**Preuve précise :**

- [apps/twitch-bot/src/lab-chat-ingest.ts:77](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-ingest.ts:77>) — forwarding des événements de stream.
- [apps/twitch-bot/src/lab-chat-ingest.ts:117](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-ingest.ts:117>) — syncStream().
- [apps/twitch-bot/src/lab-chat-main.ts:107](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-main.ts:107>) — appel syncStream() dans subscribe(), sans minuterie périodique équivalente au stream-watch principal.

**Cause racine :** L'état Lab repose sur les notifications et une synchronisation de connexion, sans rattrapage continu de l'état désiré.

**Risque concret :** La session Core Lab peut diverger durablement de Twitch malgré un socket EventSub encore connecté.

**Scénario de panne / impact utilisateur :** stream.offline arrive pendant une panne Core ; le stream est terminé, mais la session Lab reste ouverte et le planificateur Tombola peut continuer.

**Recommandation :** Réconcilier périodiquement le stream avec Helix, exposer l'âge de la dernière confirmation et conserver une politique claire pour un état inconnu.

**Portée probable de la correction :** Bot Lab, état de session Core et diagnostics Studio ; réutiliser les principes du chemin principal sans ajouter une seconde connexion chat.

**Effort indicatif :** M.

**Tests à prévoir :**

- Perte d'offline pendant panne Core puis rattrapage sans reconnexion Twitch.
- Démarrage alors que le stream est déjà en ligne/hors ligne.
- Panne Helix : état inconnu visible, aucune fausse confirmation fraîche.

**Dépendances avec d'autres findings :** [ASTRA-P1-007](#astra-p1-007), [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-018](#astra-p1-018).

**Traçabilité de l'audit initial :** Audit initial §5 P1-03 et §9 état Twitch.

---

#### Core

<a id="astra-p1-004"></a>

##### ASTRA-P1-004 — Délais PostgreSQL non explicitement bornés dans le client

**ID :** `ASTRA-P1-004`

**Sévérité :** P1

**Domaine :** Core

**Titre court :** Délais PostgreSQL non explicitement bornés dans le client

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `ccc8e5d`

**Résolution (passe P1, 2026-10-04) :** Vérifié (réserve levée) : sur le conteneur local `raptoru2-pg`, `statement_timeout`, `lock_timeout` et `idle_in_transaction_session_timeout` valent 0 (illimité), `deadlock_timeout` 1 s, aucun réglage par base/rôle ; `createPgDb()` créait le pool sans `connectionTimeoutMillis` (attente infinie de node-pg). Correction : `createPgDb(url, limits?)` et `SERVER_DB_LIMITS` (connexion 5 s, requête 30 s, verrou 10 s, inactif en transaction 60 s) appliqués aux deux processus serveur (Core principal `index.ts`, Core Lab `local-server.ts`) ; les scripts (migrations, import, rapports) restent sans limite, leurs traitements longs étant légitimes. Un dépassement échoue (57014 / 55P03), la transaction est annulée et le client rendu au pool. Traduction HTTP : erreur 500 explicite existante (les clients retentent avec leur clé d'idempotence, cf. P1-009). Le budget de la base de production réelle (VPS) reste à vérifier au cutover.

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Absence de timeouts explicites dans le code établie ; paramètres actifs de PostgreSQL et comportement réel du driver/système À VÉRIFIER.

**Problème constaté :** createPgDb() crée le pool sans timeouts explicites de connexion, requête ou verrou. La politique PostgreSQL effective n'a pas été inspectée.

**Preuve précise :**

- [apps/core-api/src/db/db.ts:37](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/db/db.ts:37>) — new pg.Pool({ connectionString, types: pgTypes }).
- [apps/core-api/src/db/db.ts:47](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/db/db.ts:47>) — transaction utilisant pool.connect() et target.query(), sans délai métier explicite.

**Cause racine :** Les délais d'exécution dépendent des valeurs du driver, du système et de PostgreSQL plutôt que d'un budget applicatif documenté.

**Risque concret :** Une requête bloquée peut conserver connexion/verrous et empêcher les files de progresser, même après expiration de la requête HTTP cliente.

**Scénario de panne / impact utilisateur :** Pendant un stream, une dépendance DB se bloque ; des opérations continuent d'attendre et les interactions ne progressent plus.

**Recommandation :** Vérifier d'abord la configuration DB effective, puis définir des délais de connexion, statement/lock et une traduction d'erreur cohérente. Ne pas casser les migrations ou traitements longs légitimes.

**Portée probable de la correction :** Client DB Core, configuration PostgreSQL et budgets par catégorie d'opération.

**Effort indicatif :** M.

**Tests à prévoir :**

- Verrou concurrent dépassant le budget : erreur bornée et rollback.
- Connexion impossible : réponse dans un délai connu.
- Libération des clients du pool après timeout et absence de mutation tardive non maîtrisée.

**Dépendances avec d'autres findings :** [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-011](#astra-p1-011), [ASTRA-P2-013](#astra-p2-013).

**Traçabilité de l'audit initial :** Audit initial §5 P1-04.

---

<a id="astra-p1-005"></a>

##### ASTRA-P1-005 — Health vert sans preuve de disponibilité métier

**ID :** `ASTRA-P1-005`

**Sévérité :** P1

**Domaine :** Core

**Titre court :** Health vert sans preuve de disponibilité métier

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `ccc8e5d`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `3a8c004` : `/health` du Core Lab (local-server.ts) et du Core principal (server.ts) répondent sans toucher la base ; `LocalRuntime` marquait le Core Lab « ready » sur ce seul signal. Correction : `GET /ready` (requête `select 1` bornée à 1,5 s, 503 `db_unavailable` sinon) sur les deux Cores, `/health` reste la liveness (supervision Electron et séquences inchangées) ; la surveillance du runtime lit `/ready` : Core vivant mais base injoignable → « dégradé » avec la raison, jamais redémarré, « prêt » au retour de la base. Le panneau Test Lab du Core principal reste étiqueté `/health` (liveness affichée comme telle, aucune modification UI).

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** local-server.ts a changé après le HEAD audité ; les preuves et le contrat du health doivent être relus avant correction.

**Problème constaté :** Les endpoints /health du Core principal et du Core Lab renvoient un succès constant sans interroger la DB ni la progression des dépendances.

**Preuve précise :**

- [apps/core-api/src/bonk-lab/local-server.ts:85](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:85>) — GET /health retourne service/test_mode.
- [apps/core-api/src/http/server.ts:158](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/http/server.ts:158>) — GET /health retourne service/status ok.
- [apps/studio/server/src/runtime/local-runtime.ts:246](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/runtime/local-runtime.ts:246>) — labCoreHealth() utilise ce succès HTTP.

**Cause racine :** La liveness du serveur HTTP est utilisée comme signal de readiness métier.

**Risque concret :** Studio peut présenter Core comme prêt alors que PostgreSQL est inutilisable ou que les interactions sont bloquées.

**Scénario de panne / impact utilisateur :** Le serveur répond à /health pendant une panne DB ; l'opérateur voit un statut vert et les achats/files échouent.

**Recommandation :** Séparer liveness, readiness DB bornée et état des workers/lecteurs. Afficher la dépendance défaillante et l'âge de la preuve.

**Portée probable de la correction :** Endpoints Core, statut LocalRuntime et diagnostic Studio.

**Effort indicatif :** M.

**Tests à prévoir :**

- HTTP vivant et DB indisponible : liveness distincte de readiness.
- Retour de DB : readiness actualisée.
- Probe lent : délai borné sans surcharge récurrente.

**Dépendances avec d'autres findings :** [ASTRA-P1-004](#astra-p1-004), [ASTRA-P1-011](#astra-p1-011), [ASTRA-P2-015](#astra-p2-015).

**Traçabilité de l'audit initial :** Audit initial §5 P1-04 et §9 observabilité.

---

#### EBS

<a id="astra-p1-006"></a>

##### ASTRA-P1-006 — Frontière publique des fonctionnalités V2 encore incomplète

**ID :** `ASTRA-P1-006`

**Sévérité :** P1

**Domaine :** EBS

**Titre court :** Frontière publique des fonctionnalités V2 encore incomplète

**Statut initial :** **OUVERT**

**Statut actuel :** **BLOQUÉ — décision de cutover**

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `47b71bd` : le bootstrap du Core principal (`apps/core-api/src/index.ts`) n'expose que Bonk/Soundboard/TTS Lab, pas Modération V2, Tombola ni Commands ; l'Extension connectée vise toujours `https://raptoru.fr/api` (`runtime-config.js`) ; les surfaces V2 passent par la façade Lab locale (jeton Lab non signé, Lab uniquement). Les invariants côté Core sont en place et testés (acteur dérivé du jeton, refus de forgerie de rôle — ex. `commands-studio.test.ts` « evil » —, droits réévalués par Core à chaque action, projection publique Commands sans donnée interne), mais la chaîne publique JWT Twitch → EBS → Core V2 n'existe pas. **Options :** (A) EBS public dans le Core (vérification JWT Extension, canal, `opaque_user_id`/identité partagée) réutilisant les façades actuelles comme contrat — L ; (B) EBS séparé devant le Core — L, un service de plus à exploiter ; (C) porter module par module sur l'API Live existante — coût répété. **Recommandation :** A, en raccordant d'abord un parcours isolé (ex. Commandes publiques, lecture seule) avant les mutations. Aucune publication autorisée par ce finding.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** Phase F et acteurs EBS ont évolué après l'audit ; cela ne vaut pas validation de la future chaîne publique.

**Problème constaté :** La façade EBS Lab utilise des identités locales et des acteurs de simulation. Le bootstrap Core principal ne raccorde pas l'ensemble des routes récentes. L'Extension connectée pointe encore vers l'API Live existante ; la future chaîne publique JWT → Core V2 n'est pas démontrée par ce dépôt.

**Preuve précise :**

- [apps/studio/server/src/extension-lab/lab-ebs.ts:1012](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/extension-lab/lab-ebs.ts:1012>) — handle(), identité Lab et projections/commandes.
- [apps/core-api/src/index.ts:48](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/index.ts:48>) — bootstrap principal ; Modération, Tombola et Commands récents ne sont pas tous exposés par ce chemin.
- [apps/twitch-extension/extension/shared/runtime-config.js:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/runtime-config.js:1>) — apiBase https://raptoru.fr/api.
- Raptoru Studio — Infrastructure Spec.md:624 — cible d'authentification Extension JWT.

**Cause racine :** Les surfaces V2 ont été intégrées via une façade locale conservant les contrats historiques ; la frontière publique de production reste un raccordement futur.

**Risque concret :** Réutiliser les raccourcis d'acteur Lab sur une API publique créerait une confiance excessive dans identité, rôle ou canal fournis par le client.

**Scénario de panne / impact utilisateur :** Le cutover est tenté par changement d'URL ; les viewers ne disposent pas des bons endpoints ou des décisions d'identité/permission vérifiées.

**Recommandation :** Définir les intentions publiques, vérifier le JWT et le canal côté serveur, dériver l'acteur et réévaluer les droits dans Core. Raccorder un parcours isolé avant de porter tous les modules.

**Portée probable de la correction :** Core/EBS public, adaptateurs d'identité, facade, contrats Extension et protections de la frontière publique.

**Effort indicatif :** L.

**Tests à prévoir :**

- JWT invalide/expiré, mauvais canal et identité non partagée.
- Actor/role forgery et accès à la cible d'un autre viewer.
- Droit retiré après ouverture de l'interface : action refusée côté Core.

**Dépendances avec d'autres findings :** [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-007](#astra-p1-007), [ASTRA-P1-009](#astra-p1-009), [ASTRA-P1-019](#astra-p1-019), [ASTRA-P2-004](#astra-p2-004).

**Traçabilité de l'audit initial :** Audit initial §5 P1-07, §10 et §12.

**Décision préalable :** Les choix d'authentification, de publication, de compatibilité et le périmètre du premier cutover nécessitent une décision architecture/produit. Aucune publication autorisée par ce finding.

---

#### État

<a id="astra-p1-007"></a>

##### ASTRA-P1-007 — Deux modèles persistants de session de stream à raccorder

**ID :** `ASTRA-P1-007`

**Sévérité :** P1

**Domaine :** État

**Titre court :** Deux modèles persistants de session de stream à raccorder

**Statut initial :** **OUVERT**

**Statut actuel :** **BLOQUÉ — décision de cutover**

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `47b71bd` : `stream_sessions` (Daily/Presence/Loyalty, `stream-sessions.ts`) et `lab_stream_sessions` (Tombola, et désormais Commands V2 pour la fenêtre « pendant le live » et les quotas, `admission.ts`) restent deux autorités distinctes ; la session Lab a une origine `simulated`/`twitch`. Le correctif P1-003 garde volontairement cette séparation (les sessions simulées restent explicites). **Options :** (A) session canonique unique (identifiant Twitch, débuts/fins, réconciliation) consommée par tous les modules, les simulations Lab en marquant l'origine — M/L ; (B) garder deux modèles et une table de correspondance au cutover — M, divergences possibles ; (C) aligner seulement les règles de fin — S, laisse deux sources. **Recommandation :** A, après décision métier sur « stream », « stream-day » et activités hors stream ; migration additive uniquement.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** Le service Tombola et le bootstrap Lab ont évolué ; préserver la preuve historique et revalider le modèle actuel.

**Problème constaté :** Daily/Presence/Loyalty et les fonctionnalités Lab utilisent des modèles de session distincts : stream_sessions et lab_stream_sessions. La session Lab possède un identifiant interne et une origine simulated/twitch.

**Preuve précise :**

- [apps/core-api/src/stream/stream-sessions.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/stream/stream-sessions.ts>) — StreamSessions, modèle principal.
- [apps/core-api/src/raffle-lab/raffle-lab-service.ts:266](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/raffle-lab-service.ts:266>) et :632 — liveSession() et streamEvent(), modèle Lab.
- [supabase/migrations/20261008120000_raffle_v2.sql:46](<C:/Users/Antoni/Documents/Raptoru 2.0/supabase/migrations/20261008120000_raffle_v2.sql:46>) — lab_stream_sessions et unicité de session ouverte.

**Cause racine :** L'environnement Lab possède sa propre autorité de session plutôt qu'une adaptation d'un contexte canonique partagé.

**Risque concret :** Des modules peuvent parler de ce stream en utilisant des fenêtres, identifiants et règles de fin différents.

**Scénario de panne / impact utilisateur :** Historique, quota de commande, fidélité et planificateur ne clôturent pas le même stream au cutover ou après reconnect.

**Recommandation :** Définir un contexte canonique de session, le lien à l'identifiant Twitch, les débuts/fins, la réconciliation et les règles hors stream. Garder les simulations explicites.

**Portée probable de la correction :** Core sessions, domaines consommateurs et migrations/adaptateurs de raccordement.

**Effort indicatif :** M–L.

**Tests à prévoir :**

- Même Twitch stream reçu plusieurs fois : même session canonique.
- Offline perdu/reconnect/restart : clôture cohérente.
- Manche manuelle hors stream : aucune ouverture implicite d'une session réelle.

**Dépendances avec d'autres findings :** [ASTRA-P1-003](#astra-p1-003), [ASTRA-P1-001](#astra-p1-001), [ASTRA-P2-012](#astra-p2-012).

**Traçabilité de l'audit initial :** Audit initial §5 P1-07, §9 ownership et §10.

**Décision préalable :** La définition métier de stream, stream-day et activités hors stream doit être décidée avant migration.

---

#### Extension

<a id="astra-p1-008"></a>

##### ASTRA-P1-008 — Responsabilités frontend et façade trop concentrées

**ID :** `ASTRA-P1-008`

**Sévérité :** P1

**Domaine :** Extension

**Titre court :** Responsabilités frontend et façade trop concentrées

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — décision adoptée** — commit `2c0020e`

**Résolution (passe P1, 2026-10-04) :** Décision d'architecture d'Antoni (2026-10-04) : pas de grand refactor de l'Extension ni de Studio ; stratégie progressive — tout nouveau module/écran significatif dans son propre fichier, ne pas faire grossir volontairement `ui.js`, `base.css`, `lab-ebs.ts` ni les gros écrans centraux quand une extraction locale est raisonnable, extraire l'existant seulement quand il doit réellement être modifié, UX validées strictement préservées, aucune migration de framework, aucun découpage « pour faire propre », aucune suppression du legacy utilisé. Justification de la fermeture : le finding ne décrit pas un comportement fautif mais un coût de modification, et il exigeait une « décision préalable » (legacy et UX validées à ne pas toucher automatiquement) ; sa recommandation est elle-même « extraire progressivement ». La décision est désormais une règle de travail versionnée dans `CLAUDE.md` (section « Central files », lue par chaque session de code) avec la ligne de base mesurée sur `f3be247` : `ui.js` 6 206 lignes, `base.css` 16 477, `lab-ebs.ts` 2 255, `studio/web/src/commands.ts` 2 066 — ce qui permet de constater une dérive. Aucune modification de code (aucun risque UX). La dette elle-même reste ouverte et se résorbe au fil des modifications ; le filet de non-régression navigateur dépend de [ASTRA-P1-018](#astra-p1-018). Option non retenue (non nécessaire à ce stade) : un test plafonnant la taille de ces fichiers.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** ui.js, le client et les écrans Commands ont évolué ; les tailles sont des mesures historiques du HEAD audité.

**Problème constaté :** L'audit a relevé ui.js à 6 173 lignes, base.css à 16 477 lignes, LabEbs à 2 242 lignes et commands.ts Studio à 2 066 lignes. Plusieurs écrans, navigation, rendu, polling, styles et branches legacy restent concentrés.

**Preuve précise :**

- [apps/twitch-extension/extension/shared/ui.js:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/ui.js:1>) — createModulePanel() et modules/branches historiques.
- [apps/twitch-extension/extension/base.css:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/base.css:1>) — feuille centrale volumineuse.
- [apps/studio/server/src/extension-lab/lab-ebs.ts:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/extension-lab/lab-ebs.ts:1>) — projections Core et simulation historique.
- [apps/studio/web/src/commands.ts:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/web/src/commands.ts:1>) — écran Commands Studio.

**Cause racine :** Accrétion de fonctionnalités et portages successifs dans des points d'entrée centraux, avec coexistence nécessaire du legacy.

**Risque concret :** Les modifications locales exigent une connaissance de plusieurs modules ; les erreurs de lifecycle et de styles se propagent plus facilement.

**Scénario de panne / impact utilisateur :** Un nouveau module modifie le rendu global ou un timer et casse une surface mobile ou un écran existant sans test de chaîne.

**Recommandation :** Extraire progressivement les écrans, définir mount/update/destroy, ownership des timers et conventions d'erreur. Rendre les modes simulation/projection explicites sans supprimer le legacy utilisé.

**Portée probable de la correction :** Extension, Studio Web et façade EBS ; extractions incrémentales sans changement de framework imposé.

**Effort indicatif :** L réparti sur plusieurs évolutions.

**Tests à prévoir :**

- Navigation répétée : pas de timers/listeners empilés.
- Refresh conservant saisie, scroll et animations nécessaires.
- Non-régression des branches legacy et V2 sur Panel/Mobile/Vidéo.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-011](#astra-p2-011), [ASTRA-P2-003](#astra-p2-003), [ASTRA-P3-006](#astra-p3-006).

**Traçabilité de l'audit initial :** Audit initial §5 P1-09, §8 Studio/Extension et §14 legacy.

**Décision préalable :** Le legacy encore connecté à la production et les UX validées ne doivent pas être supprimés ou redessinés automatiquement.

---

#### Idempotence

<a id="astra-p1-009"></a>

##### ASTRA-P1-009 — Clé d'intention perdue avant Modération V2 Core

**ID :** `ASTRA-P1-009`

**Sévérité :** P1

**Domaine :** Idempotence

**Titre court :** Clé d'intention perdue avant Modération V2 Core

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `6caa2e6`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `2c41b89` (après `b54ad46`, qui ne touchait que l'acteur) : `modV2Act()` envoie une Idempotency-Key réutilisée par le retry de `call()` (erreur réseau ou 408/425/429/5xx), mais `LabEbs.moderationV2()` ne transmettait que `actor`/`command`, `LabModerationRequest` n'avait pas de clé et `LabModerationService.act()` appliquait chaque appel ; le cache `replies` de l'EBS ne couvre pas les routes relayées au Core (retour anticipé) et ne survit pas à un redémarrage. Commandes additives concernées : `wallet_adjust`, `add_note`, `raffle_open` (conflit après succès). Correction : `idempotency_key` optionnel dans `LabModerationRequest` ; l'EBS transmet la clé de l'en-tête ; `act()` passe par `txOnce()` qui réserve la clé puis enregistre le résultat dans la MÊME transaction que l'effet (rejeu = même réponse ; même clé + autre payload = 409 `idempotency_conflict` ; action refusée = rien d'enregistré ; doublon concurrent = attend la ligne puis relit le résultat ; purge 24 h). Migration additive Lab `20261015120000_lab_moderation_idempotency.sql` (scope `lab`, listes runtime/bonk-lab/packaging). Sans clé (console Studio) : comportement inchangé. Hors périmètre volontaire : les anciennes routes de modération de l'Extension n'envoient que des commandes d'état (pause/reprise, stop/purge, `module_state`, blocage/déblocage) et les actions Tombola de la console sont des transitions d'état — un rejeu donne un conflit ou le même état, jamais un double effet.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** api.js et lab-ebs.ts ont changé après l'audit, dont un commit sur les acteurs EBS ; ne pas présumer que l'idempotence est corrigée.

**Problème constaté :** Le client retente les erreurs réseau/HTTP transitoires. modV2Act() fournit une Idempotency-Key, mais LabEbs.moderationV2() transmet seulement actor et command. LabModerationRequest ne porte pas cette clé ; adminAdjust() applique chaque delta.

**Preuve précise :**

- [apps/twitch-extension/extension/shared/api.js:95](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/api.js:95>) et :456 — call() et modV2Act().
- [apps/studio/server/src/extension-lab/lab-ebs.ts:599](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/extension-lab/lab-ebs.ts:599>) et :1143 — POST actions et relais sans clé.
- [packages/schemas/src/lab-moderation.ts:202](<C:/Users/Antoni/Documents/Raptoru 2.0/packages/schemas/src/lab-moderation.ts:202>) — contrat actor/command.
- [apps/core-api/src/lab-moderation/store.ts:769](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/lab-moderation/store.ts:769>) — adminAdjust(), nouvelle écriture à chaque invocation.

**Cause racine :** L'idempotence supposée par le client n'est pas conservée/garantie par toutes les routes de mutation.

**Risque concret :** Double effet additif ou conflit UI après une première écriture pourtant réussie.

**Scénario de panne / impact utilisateur :** Crédit Lab +100 validé par Core, réponse perdue, retry : +100 appliqué une seconde fois. Notes/+temps peuvent aussi être répétés ; Commands versionné peut retourner un conflit après succès initial.

**Recommandation :** Une clé stable par intention jusqu'à Core, hash du payload et résultat mémorisé dans la transaction. En protection provisoire, retenter seulement lectures et mutations effectivement idempotentes.

**Portée probable de la correction :** Client Extension, façade EBS, contrat partagé, réception/idempotence Core et tests de la chaîne.

**Effort indicatif :** M ; protection provisoire S.

**Tests à prévoir :**

- Perdre la réponse après commit d'un wallet_adjust : delta et ledger uniques.
- Même clé/payload : résultat initial ; même clé/payload différent : conflit.
- Reprise d'action additive et erreur UI après une mutation versionnée déjà appliquée.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-003](#astra-p2-003), [ASTRA-P2-010](#astra-p2-010).

**Traçabilité de l'audit initial :** Audit initial §5 P1-01.

---

#### Paiements

<a id="astra-p1-010"></a>

##### ASTRA-P1-010 — Cycle réel Channel Points non raccordé aux interactions V2

**ID :** `ASTRA-P1-010`

**Sévérité :** P1

**Domaine :** Paiements

**Titre court :** Cycle réel Channel Points non raccordé aux interactions V2

**Statut initial :** **OUVERT**

**Statut actuel :** **BLOQUÉ — décision de cutover**

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `47b71bd` : les lecteurs Soundboard et TTS refusent toute interaction qui n'est pas `test_mode: true` / `payment_mode: 'simulated'` (sound-player/player.js:119, tts-player/player.js:255) ; aucun flux de redemption Channel Points n'existe dans le bot (aucun abonnement `channel.channel_points_custom_reward_redemption.*`). Les garanties disponibles côté Core (idempotence d'admission, exécution ambiguë jamais rejouée/remboursée d'office, stop prouvé — P1-017) seront réutilisées, mais le cycle externe reste à concevoir. **Options :** (A) redemption Twitch = moyen de paiement d'une interaction Core (référence stable `redemption_id`, transitions reçue → admise → exécutée → fulfil/cancel, reprise après crash) — L ; (B) redemptions converties en crédits du wallet canonique, l'interaction restant payée en crédits — M/L, découple Twitch de l'exécution ; (C) garder StreamElements/SAMMI pour les redemptions — pas de travail, pas de cutover. **Recommandation :** B (un seul chemin de paiement dans Core, décision fulfil/cancel limitée à la conversion), à valider avec le modèle produit des crédits. Aucun accès ni changement Twitch/production autorisé par ce finding.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** Les façades Extension/EBS ont évolué ; absence de validation du cycle réel maintenue comme constat historique.

**Problème constaté :** Les crédits/paiements des interactions récentes sont simulés. L'audit n'a pas établi de chaîne V2 de redemption Twitch réelle avec exécution, fulfil/cancel et reprise. C'est un prérequis de cutover distinct du wallet à jetons.

**Preuve précise :**

- [apps/studio/server/src/extension-lab/lab-ebs.ts:1096](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/extension-lab/lab-ebs.ts:1096>) et :1335 — actions/redemption relayées dans le Lab.
- [apps/studio/server/sound-player/player.js:125](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/sound-player/player.js:125>) — test_mode true/payment_mode simulated requis.
- [apps/studio/server/tts-player/player.js:253](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/tts-player/player.js:253>) — même garde Lab.
- [apps/core-api/src/index.ts:48](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/index.ts:48>) — bootstrap principal incomplet pour les fonctionnalités récentes.

**Cause racine :** Le Lab émule des moyens de paiement sans intégrer encore le cycle externe des redemptions aux états d'interaction.

**Risque concret :** La migration peut perdre la correspondance entre paiement Twitch, crédit consommable, interaction et décision de remboursement/annulation.

**Scénario de panne / impact utilisateur :** Une redemption réelle est reçue puis le processus redémarre : la décision de fulfil/cancel ou l'exécution ne peut pas être rapprochée proprement.

**Recommandation :** Définir le cycle des redemptions, ses références stables, ses transitions et ses reprises ; faire fonctionner ce raccordement dans un environnement de test prévu avant la production.

**Portée probable de la correction :** Adaptateur Twitch, Core paiements/interactions, contrats d'exécution et affichage des preuves.

**Effort indicatif :** L.

**Tests à prévoir :**

- Redelivery de redemption : un seul effet/consommable.
- Crash entre réception, admission, exécution et fulfil/cancel.
- Résultat d'exécution ambigu : politique explicite, jamais remboursement/rejeu supposé certain.

**Dépendances avec d'autres findings :** [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-017](#astra-p1-017), [ASTRA-P1-018](#astra-p1-018).

**Traçabilité de l'audit initial :** Audit initial §5 P1-07 et §10, ligne Paiements Channel Points.

**Décision préalable :** Le modèle produit de crédits/redemptions et le cutover nécessitent une décision. Aucun accès ou changement Twitch/production autorisé par cette entrée.

---

#### Studio

<a id="astra-p1-011"></a>

##### ASTRA-P1-011 — Core Lab vivant mais figé sans récupération automatique

**ID :** `ASTRA-P1-011`

**Sévérité :** P1

**Domaine :** Studio

**Titre court :** Core Lab vivant mais figé sans récupération automatique

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `ccc8e5d`

**Résolution (passe P1, 2026-10-04) :** Confirmé : `LocalRuntime.watch()` relançait sur sortie du processus mais laissait un Core vivant au `/health` muet en « degraded » indéfiniment. Correction : `/health` muet pendant 20 s alors que le processus vit → Core figé : arrêt (kill forcé après 5 s par `ManagedProcess.stop`) puis politique de relance existante (3 en 5 min, puis « Réessayer » manuel, identité/secret de session conservés). Panne DB extérieure distinguée (P1-005) : jamais de redémarrage pour elle. Un `/health` revenu avant le seuil remet le compteur à zéro ; « Redémarrer »/« Réessayer » ne multiplient pas les watches (`clearTimeout` existant).

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** LocalRuntime.watch() classe un Core vivant dont /health ne répond plus comme degraded. Le redémarrage borné est déclenché quand le processus n'est plus vivant, pas pour le cas vivant mais figé.

**Preuve précise :**

- [apps/studio/server/src/runtime/local-runtime.ts:357](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/runtime/local-runtime.ts:357>) — watch(), branches !alive et !health.ok.
- [apps/studio/desktop/src/server-supervisor.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/server-supervisor.ts>) — supervision Electron plus complète du serveur Studio.

**Cause racine :** La politique de recovery du Core Lab couvre les exits mais pas le blocage d'un processus vivant.

**Risque concret :** Le système reste dégradé jusqu'à intervention manuelle, même si une reprise bornée serait pertinente.

**Scénario de panne / impact utilisateur :** Core Lab ne répond plus, son PID existe encore ; Studio affiche degraded et les files ne repartent pas automatiquement.

**Recommandation :** Ajouter une politique bornée pour les blocages persistants, différencier dépendance DB en panne et processus figé, et conserver l'identité des tentatives lors de la reprise.

**Portée probable de la correction :** LocalRuntime, budgets de reprise et diagnostics ; ne pas remplacer la supervision Electron.

**Effort indicatif :** M.

**Tests à prévoir :**

- Processus vivant/health muet : dégradation puis reprise bornée.
- Panne DB extérieure : raison visible, pas de crash loop inutile.
- Retour de santé avant seuil et restart manuel sans multiplication des watches.

**Dépendances avec d'autres findings :** [ASTRA-P1-004](#astra-p1-004), [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-018](#astra-p1-018).

**Traçabilité de l'audit initial :** Audit initial §5 P1-04 et §8 Electron/runtime.

---

<a id="astra-p1-012"></a>

##### ASTRA-P1-012 — Arrêt PostgreSQL sans garde du Core Lab actif

**ID :** `ASTRA-P1-012`

**Sévérité :** P1

**Domaine :** Studio

**Titre court :** Arrêt PostgreSQL sans garde du Core Lab actif

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `2c617d1`

**Résolution (passe P1, 2026-10-04) :** Confirmé : `TestLab.stopPostgres()` ne vérifiait que son Core et son bot ; `LocalRuntime.watch()` ne surveille que le processus et `/health` du Core Lab, donc PG arrêté laissait le Core Lab « prêt » sans base. Correction : dépendance optionnelle `postgresUsers` du Test Lab, renseignée par le serveur Studio avec le Core Lab du runtime ; arrêt refusé avec la raison tant qu'il tourne. Test : `test-lab.test.ts` (refus sous Core Lab, autorisé une fois arrêté). Course start/stop simultanés : le runtime relance de toute façon le conteneur à son prochain démarrage (`ensurePostgres`).

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** TestLab.stopPostgres() vérifie ses processus core et bot, mais pas le Core Lab lancé séparément par LocalRuntime.

**Preuve précise :**

- [apps/studio/server/src/test-lab/test-lab.ts:393](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/test-lab.ts:393>) — stopPostgres().
- [apps/studio/server/src/index.ts:434](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:434>) — création de LocalRuntime distinct du TestLab.
- [apps/studio/server/src/runtime/local-runtime.ts:142](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/runtime/local-runtime.ts:142>) — statut/ready du Core Lab.

**Cause racine :** Deux contrôleurs utilisent la même dépendance PostgreSQL sans inventaire partagé de ses consommateurs.

**Risque concret :** Une action administrative locale peut couper une dépendance utilisée par les fonctionnalités Lab.

**Scénario de panne / impact utilisateur :** Core principal et Bot Test Lab sont arrêtés ; Core Lab fonctionne ; POST postgres/stop passe et les achats/lecteurs cessent de progresser.

**Recommandation :** Partager les dépendances actives et refuser l'arrêt tant qu'un consommateur géré utilise PostgreSQL, avec une raison claire.

**Portée probable de la correction :** Garde TestLab, inventaire runtime et contrôle Studio de l'action.

**Effort indicatif :** S.

**Tests à prévoir :**

- Core Lab actif seul : arrêt PostgreSQL refusé.
- Tous consommateurs arrêtés : action permise.
- Transitions start/stop concurrentes : décision cohérente.

**Dépendances avec d'autres findings :** [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-011](#astra-p1-011).

**Traçabilité de l'audit initial :** Audit initial §5 P1-05 et §15 quick wins.

---

<a id="astra-p1-013"></a>

##### ASTRA-P1-013 — Ancienne ingestion labchat non reprise au démarrage

**ID :** `ASTRA-P1-013`

**Sévérité :** P1

**Domaine :** Studio

**Titre court :** Ancienne ingestion labchat non reprise au démarrage

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `2c617d1`

**Résolution (passe P1, 2026-10-04) :** Vérifié : le PID labchat est écrit dans `processes.json` mais jamais relu ; un crash du serveur Studio (`uncaughtException` → `process.exit(1)`, enfants conservés sous Windows) ou un lancement dev laisse l'adaptateur vivant (Electron tue l'arbre par `taskkill /T` seulement lors de son propre arrêt forcé). Correction : `LabChatIngress.create()` appelle `adoptPrevious()` puis `stop()` avant tout démarrage — même règle que le Core Lab (adopté puis remplacé), adoption limitée aux processus node du PID enregistré. Test : `lab-chat.test.ts` « an adapter orphaned by a previous Studio session is stopped before anything starts ». Limite connue partagée avec core/bot/labcore : identification par nom d'image ([ASTRA-P2-026](#astra-p2-026), non traité ici).

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Absence d'adoption constatée ; occurrence réelle d'un orphelin sous Windows/Electron et conséquences de la coexistence À VÉRIFIER. Le scénario exclut explicitement une destruction complète de l'arbre.

**Problème constaté :** L'adoption d'anciens processus concerne core/bot et labcore. Le nouveau ManagedProcess labchat n'appelle pas adoptPrevious() avant le démarrage de l'ingestion.

**Preuve précise :**

- [apps/studio/server/src/index.ts:444](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:444>) — adoption de core/bot.
- [apps/studio/server/src/runtime/local-runtime.ts:163](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/runtime/local-runtime.ts:163>) — adoption de labcore.
- [apps/studio/server/src/index.ts:557](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:557>) — création de labchat sans adoption préalable.
- [apps/studio/server/src/test-lab/managed-process.ts:129](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/managed-process.ts:129>) — adoptPrevious() disponible.

**Cause racine :** labchat a été ajouté sans intégrer complètement le mécanisme d'ownership/recovery existant.

**Risque concret :** Après terminaison du parent laissant ses enfants vivants, ancien et nouveau labchat peuvent coexister ; l'ancien utilise un secret de session périmé.

**Scénario de panne / impact utilisateur :** Le serveur Studio est tué sans destruction de son arbre ; au relancement une nouvelle ingestion démarre, l'ancienne demeure oubliée et continue éventuellement à lire Twitch/rafraîchir son token.

**Recommandation :** Identifier de manière sûre l'ancien processus, le reprendre/arrêter, puis démarrer l'instance de la nouvelle session.

**Portée probable de la correction :** Startup Studio, ManagedProcess et preuve d'ownership ; éviter toute adoption basée uniquement sur le nom de l'image.

**Effort indicatif :** M.

**Tests à prévoir :**

- Terminaison brutale du parent laissant l'enfant vivant : une seule ingestion après reprise.
- PID disparu/réutilisé : aucune adoption ou terminaison étrangère.
- Secret renouvelé : ancien exécuteur inutilisable et arrêté.

**Dépendances avec d'autres findings :** [ASTRA-P2-026](#astra-p2-026), [ASTRA-P1-014](#astra-p1-014), [ASTRA-P1-015](#astra-p1-015).

**Traçabilité de l'audit initial :** Audit initial §5 P1-05.

---

<a id="astra-p1-014"></a>

##### ASTRA-P1-014 — Shutdown sans attente de l'arrêt labchat

**ID :** `ASTRA-P1-014`

**Sévérité :** P1

**Domaine :** Studio

**Titre court :** Shutdown sans attente de l'arrêt labchat

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `2c617d1`

**Résolution (passe P1, 2026-10-04) :** Confirmé : `shutdown()` faisait `void labChatRef?.stop()` puis `process.exit` après `lab.shutdown()`/`runtime.stop()` seulement (et sortie immédiate en mode `BONK_LAB_ONLY`). Correction : barrière `stopAll()` exportée par apps/studio/server/src/index.ts — tous les arrêts (ingestion labchat, Test Lab, runtime) sont attendus, un échec est journalisé sans bloquer les autres ; chaque `ManagedProcess.stop()` force déjà le kill après 5 s. Le mode `BONK_LAB_ONLY` garde son périmètre (pas de Test Lab/runtime) mais attend l'ingestion. Fermetures répétées : garde `stopping` existante. Test : `test-lab.test.ts` « shutdown barrier ».

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** shutdown() appelle void labChatRef?.stop(), mais attend seulement lab.shutdown() et runtime.stop() avant process.exit().

**Preuve précise :**

- [apps/studio/server/src/index.ts:467](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:467>) — shutdown(), lignes 473 et 480.
- [apps/studio/server/src/lab-chat/ingress.ts:116](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/lab-chat/ingress.ts:116>) — stop() retourne une promesse d'arrêt.

**Cause racine :** L'ingestion n'a pas été incluse dans la barrière de fermeture du serveur.

**Risque concret :** Le serveur peut sortir avant la fin confirmée du cleanup de ce processus.

**Scénario de panne / impact utilisateur :** Fermeture/restart/update termine Studio alors que l'arrêt d'ingestion est encore en cours ; ses ressources et son PID peuvent ne pas être correctement nettoyés.

**Recommandation :** Inclure son arrêt dans la promesse attendue, avec une durée maximale cohérente et une stratégie de forçage sûre.

**Portée probable de la correction :** Shutdown Studio et tests de l'ordre d'arrêt.

**Effort indicatif :** XS–S.

**Tests à prévoir :**

- Stop différé : process.exit seulement après résolution ou timeout géré.
- Erreur d'arrêt : diagnostic et cleanup des autres services conservés.
- Fermetures répétées : aucune reprise ni double arrêt parasite.

**Dépendances avec d'autres findings :** [ASTRA-P1-013](#astra-p1-013), [ASTRA-P1-016](#astra-p1-016).

**Traçabilité de l'audit initial :** Audit initial §5 P1-05 et §15 quick wins.

---

<a id="astra-p1-015"></a>

##### ASTRA-P1-015 — Ingestion activée sans supervision continue du processus

**ID :** `ASTRA-P1-015`

**Sévérité :** P1

**Domaine :** Studio

**Titre court :** Ingestion activée sans supervision continue du processus

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `2c617d1`

**Résolution (passe P1, 2026-10-04) :** Confirmé : `LabChatIngress` ne lançait l'adaptateur qu'au démarrage et sur le switch ; une sortie (toutes en code 1 : jeton inutilisable, validation horaire échouée, crash) laissait `enabled: true, running: false` sans reprise. Correction : supervision dans l'ingress (contrôle toutes les 5 s) — sortie spontanée relancée, budget 3 relances / 10 min puis état « crash_loop » affiché ; le bot sort désormais en code 78 (`EXIT_AUTH`) quand TwitchAuth déclare le jeton en échec (Twitch injoignable reste en code 1, donc relancé), affiché « auth_failed » sans relance. OFF utilisateur et arrêt Studio ne relancent jamais ; OFF/ON réarme la supervision. La raison passe par le champ `blocked` déjà affiché par Studio (aucune modification UI ; le switch reste actionnable). Tests : `lab-chat.test.ts` (2 cas de supervision).

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** LabChatIngress.start() est appelé au démarrage/activation et certains changements de sortie. Si le processus quitte ensuite, enabled peut rester true et running false sans reprise automatique bornée.

**Preuve précise :**

- [apps/studio/server/src/lab-chat/ingress.ts:110](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/lab-chat/ingress.ts:110>) — start(), status() et setEnabled().
- [apps/studio/server/src/index.ts:592](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:592>) — start() initial de l'ingestion.
- [apps/twitch-bot/src/lab-chat-main.ts:137](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-main.ts:137>) — une erreur d'auth peut terminer le processus.

**Cause racine :** Un interrupteur persistant gère le lancement, mais aucune boucle de supervision du processus n'accompagne son état désiré.

**Risque concret :** Un socket/processus absent est confondu avec une fonctionnalité toujours activée ; le stream perd ses commandes jusqu'à intervention.

**Scénario de panne / impact utilisateur :** labchat quitte après échec d'authentification ; l'interrupteur reste ON, mais plus aucune commande ne rejoint Core.

**Recommandation :** Exposer l'exit et superviser les arrêts récupérables avec backoff/budget ; traiter les erreurs d'autorisation comme bloquées nécessitant une action utilisateur.

**Portée probable de la correction :** Ingress Studio, raison de blocage, statut d'exécuteur et tests de recovery.

**Effort indicatif :** M.

**Tests à prévoir :**

- Exit récupérable : reprise bornée.
- Scope/token invalide : raison explicite, pas de boucle aveugle.
- OFF utilisateur : aucun redémarrage automatique.

**Dépendances avec d'autres findings :** [ASTRA-P1-013](#astra-p1-013), [ASTRA-P1-014](#astra-p1-014), [ASTRA-P1-002](#astra-p1-002), [ASTRA-P2-015](#astra-p2-015).

**Traçabilité de l'audit initial :** Audit initial §5 P1-05 et §8 Twitch Bot.

---

<a id="astra-p1-016"></a>

##### ASTRA-P1-016 — Journal chat écrit dans la racine de code packagée

**ID :** `ASTRA-P1-016`

**Sévérité :** P1

**Domaine :** Studio

**Titre court :** Journal chat écrit dans la racine de code packagée

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `2c617d1`

**Résolution (passe P1, 2026-10-04) :** Confirmé sur `9098150` : `applyDataRootEnv()` (apps/studio/server/src/test-lab/local-env.ts) redirigeait jetons et outbox Loyalty vers DATA_ROOT, pas `LAB_CHAT_JOURNAL_FILE` (défaut relatif `.lab-chat-journal.json`, cwd `paths.botDir` sous REPO_ROOT). Correction : `paths.labChatJournal` dans DATA_ROOT et `LAB_CHAT_JOURNAL_FILE` posé comme l'outbox (un réglage explicite du `.env` bot reste prioritaire) ; un journal laissé à côté du code par une version antérieure est copié une fois, jamais écrasé. Packaging : `stage.mjs` ne copie que `dist` et `package.json` du bot, aucun journal ne peut être embarqué (pas de changement nécessaire). Tests : `apps/studio/server/test/local-env.test.ts` (REPO_ROOT ≠ DATA_ROOT → journal dans DATA_ROOT ; reprise unique ; réglage explicite prioritaire).

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** LAB_CHAT_JOURNAL_FILE vaut par défaut .lab-chat-journal.json. Le cwd de labchat est paths.botDir basé sur REPO_ROOT ; applyDataRootEnv() redirige tokens/outbox Loyalty, mais pas ce journal. Aucun override local n'avait été relevé.

**Preuve précise :**

- [apps/twitch-bot/src/config.ts:59](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/config.ts:59>) — valeur par défaut du journal.
- [apps/studio/server/src/index.ts:557](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:557>) — cwd paths.botDir.
- [apps/studio/server/src/test-lab/local-env.ts:18](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/local-env.ts:18>) et :42 — REPO_ROOT/DATA_ROOT et redirections.
- [apps/twitch-bot/src/lab-chat-output.ts:76](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-output.ts:76>) — fileJournal().

**Cause racine :** Un nouveau fichier durable n'a pas été intégré au modèle de séparation code/données de Studio installé.

**Risque concret :** Journal perdu lors de réinstallation/update ou échec d'écriture selon les droits du dossier d'installation.

**Scénario de panne / impact utilisateur :** L'exécuteur doit journaliser avant Helix, mais le dossier est non accessible en écriture ; il ne fonctionne pas. Un update peut aussi perdre ses preuves d'ACK.

**Recommandation :** Chemin explicite dans DATA_ROOT, migration prudente des éventuels journaux existants et exclusions des fichiers journal/tmp dans stage/release.

**Portée probable de la correction :** Chemins/config Bot et Studio, packaging et tests installés ; conserver la protection Core contre le rejeu ambigu.

**Effort indicatif :** S.

**Tests à prévoir :**

- REPO_ROOT et DATA_ROOT distincts : seule la racine de données reçoit le journal.
- Restart/update simulé : preuves conservées.
- Dossier de code non accessible en écriture et journal illisible : erreur sûre et visible.

**Dépendances avec d'autres findings :** [ASTRA-P1-014](#astra-p1-014), [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-016](#astra-p2-016).

**Traçabilité de l'audit initial :** Audit initial §5 P1-06 et §15 quick wins.

---

<a id="astra-p1-017"></a>

##### ASTRA-P1-017 — Ordre d'arrêt consommé avant confirmation du lecteur

**ID :** `ASTRA-P1-017`

**Sévérité :** P1

**Domaine :** Studio

**Titre court :** Ordre d'arrêt consommé avant confirmation du lecteur

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `2aba120`

**Résolution (passe P1, 2026-10-04) :** Confirmé sur `8895ed7` : TTS — `TtsWorker.command()` marquait `reported: failed` en remettant `{stop}` puis l'entrée était retirée au tick suivant, et le lecteur ne confirmait pas ; Soundboard — `stopOrders()` posait `stopSent` avant la réponse HTTP (le lecteur envoyait bien `stopped`, mais une réponse perdue n'était jamais reproposée). Correction : les deux workers reproposent l'ordre d'arrêt (au plus une fois par seconde, `stopSentAt`) jusqu'à l'ACK `stopped` du bon lecteur/tentative ; le lecteur TTS confirme désormais `stopped` (l'ordre porte `attempt_id`) et son arrêt est idempotent (déjà silencieux : il ne fait que confirmer). Un `play` n'est toujours jamais remis deux fois ; un ACK tardif `completed` reste ignoré ; remboursement unique par Core inchangé. Le test historique « stop once » (tts-lab.test.ts) imposait la mauvaise garantie : remplacé par « reproposé jusqu'à preuve ». Hors périmètre : P2-028 (garde de fin des lecteurs). **Validation manuelle (Antoni, 2026-10-04) : STOP TTS et STOP Soundboard coupent correctement en conditions réelles.**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** TTS ajoute failed à reported avant réponse stop, puis retire l'entrée ; son lecteur ne fait pas d'ACK d'arrêt. Soundboard positionne stopSent avant réponse ; même si son lecteur possède stopped, une réponse perdue empêche une nouvelle remise.

**Preuve précise :**

- [apps/studio/server/src/tts-lab/worker.ts:232](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/worker.ts:232>) et :371 — command() puis nettoyage.
- [apps/studio/server/tts-player/player.js:373](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/tts-player/player.js:373>) — stop() sans ACK.
- [apps/studio/server/src/sound-lab/worker.ts:218](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/sound-lab/worker.ts:218>) — stopOrders(), stopSent avant réponse.
- [apps/studio/server/sound-player/player.js:159](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/sound-player/player.js:159>) et :186 — confirmation stopped.
- [apps/studio/server/test/tts-lab.test.ts:298](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/test/tts-lab.test.ts:298>) — test imposant stop once.

**Cause racine :** La remise HTTP d'un ordre est assimilée à sa réception/exécution avant preuve du lecteur.

**Risque concret :** Core affiche annulation/remboursement alors que le contenu sonore peut continuer.

**Scénario de panne / impact utilisateur :** La réponse portant stop se perd après sa consommation par le worker ; le lecteur ne coupe pas l'audio et l'ordre n'est plus proposé.

**Recommandation :** Répéter un stop idempotent jusqu'à confirmation du bon lecteur/tentative. Distinguer annulation décidée et arrêt confirmé. Ne pas rendre les ordres play rejouables.

**Portée probable de la correction :** Protocole workers/lecteurs TTS et Soundboard, persistance locale, état/diagnostics Core et tests.

**Effort indicatif :** M–L.

**Tests à prévoir :**

- Perdre la première réponse stop : ordre reproposé puis silence confirmé.
- ACK d'arrêt perdu : aucun replay audio, confirmation retentée.
- ACK tardif/ancien lecteur : aucun changement illégitime ; refund unique.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-028](#astra-p2-028), [ASTRA-P2-015](#astra-p2-015).

**Traçabilité de l'audit initial :** Audit initial §5 P1-02 et §11 test stop once.

---

#### Tests

<a id="astra-p1-018"></a>

##### ASTRA-P1-018 — Parcours E2E critiques non reproductibles depuis le dépôt

**ID :** `ASTRA-P1-018`

**Sévérité :** P1

**Domaine :** Tests

**Titre court :** Parcours E2E critiques non reproductibles depuis le dépôt

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `fd365dd`

**Résolution (passe P1, 2026-10-04) :** Décision d'Antoni (2026-10-04) : Playwright, quelques parcours critiques seulement. Revalidé sur `329764d` : aucun outillage navigateur dans le dépôt (seul `@vitest/browser-playwright` apparaissait comme pair optionnel dans le lockfile). Réalisé : (1) `93f07db` — l'assemblage du Core Lab (services, routes, serveur HTTP) passe tel quel de `local-server.ts` à `createLabCore()` (`apps/core-api/src/bonk-lab/lab-core.ts`), partagé par le processus et l'E2E, pour que l'E2E exerce exactement ce que Studio exécute (processus compilé vérifié sur base jetable créée puis supprimée : `/health`, `/ready`, 401 sans secret) ; (2) `fd365dd` — `@playwright/test` (devDependency de `@raptoru/studio-server`), `apps/studio/server/playwright.config.ts`, pile isolée `e2e/lab-stack.ts` (vrai Core Lab sur PostgreSQL en mémoire PGlite + vraies routes EBS Lab/Studio, secret aléatoire, port 4399 ; aucune Twitch, aucun Docker, aucune donnée réelle, rien de persistant ; port occupé = erreur explicite), premier parcours `e2e/commands-public.e2e.ts` : un viewer ouvre l'Extension réelle (surface mobile) → Hub → « Commandes » et lit la commande depuis la projection publique Core ; un modérateur désactive la commande dans Modération › Commandes (Extension → EBS → Core, droits du modérateur) ; le viewer ne la voit plus. Assertions fonctionnelles/ARIA (switch `checked`), aucun snapshot visuel ; un échec conserve capture + trace dans `.e2e-results/` (ignoré par git). (3) `a120335` — `npm run e2e` construit `@raptoru/schemas` d'abord. Preuves : 3 exécutions vertes (≈15–26 s) ; mutation volontaire (projection publique sans filtre `enabled`) → échec au bon endroit avec diagnostic lisible ; exécution réussie depuis un worktree neuf (`npm ci` + `npm run e2e`). Commande documentée dans le README (« Browser E2E »). Hors `npm run check` (déclenchement manuel, comme recommandé). Prochains parcours possibles (non requis pour fermer) : stop modération avec pages lecteurs réelles, Tombola, Studio packagé.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** Des tests et fonctionnalités ont changé après l'audit ; ni nouveaux résultats ni nouveaux parcours ne sont validés par cette retranscription.

**Problème constaté :** Les documents rapportent des suites E2E de session non versionnées. Aucun harnais navigateur correspondant n'avait été identifié dans les fichiers suivis. Studio Web n'avait pas de suite déclarée ; l'Extension testait surtout des helpers.

**Preuve précise :**

- Raptoru-2.0-HANDOFF.md:20, :79 et :140 — scripts E2E hors repo et résultats sur ed781f6.
- [apps/studio/web/package.json:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/web/package.json:1>) — absence de script test à la référence.
- [apps/twitch-extension/test/](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/test/>) — quatre fichiers helpers au HEAD audité.
- Inventaire git ls-files initial — pas de harnais Playwright/E2E suivi identifié.

**Cause racine :** La validation de chaîne a été exécutée dans des sessions dont la recette et les assertions ne sont pas conservées.

**Risque concret :** Les tests de composants restent verts alors qu'une frontière réelle perd une garantie ; les anciens résultats ne se reproduisent pas sur un nouveau HEAD.

**Scénario de panne / impact utilisateur :** Un changement du client, de la façade ou d'un lecteur casse la chaîne d'achat/arrêt, sans filet automatique commun.

**Recommandation :** Versionner quelques parcours critiques isolés : réponse économique perdue, stop perdu, crash/reprise, offline rattrapé, Tombola/payment, permissions et données packagées.

**Portée probable de la correction :** Harnais, fixtures, bases dédiées, navigateur/lecteurs et recette documentée ; aucune exigence de snapshots de tous les écrans.

**Effort indicatif :** L ; premier parcours M.

**Tests à prévoir :**

- Exécuter chaque parcours à partir d'un checkout propre avec une seule recette explicite.
- Vérifier effet final, ledger et dernière preuve d'exécution.
- Nettoyage sûr et échecs diagnostiquables sans toucher une base réelle.

**Dépendances avec d'autres findings :** [ASTRA-P1-009](#astra-p1-009), [ASTRA-P1-017](#astra-p1-017), [ASTRA-P1-003](#astra-p1-003), [ASTRA-P1-016](#astra-p1-016), [ASTRA-P2-029](#astra-p2-029).

**Traçabilité de l'audit initial :** Audit initial §5 P1-08 et §11.

---

#### Transport

<a id="astra-p1-019"></a>

##### ASTRA-P1-019 — Clients et lecteurs V2 spécialisés pour le Core local Lab

**ID :** `ASTRA-P1-019`

**Sévérité :** P1

**Domaine :** Transport

**Titre court :** Clients et lecteurs V2 spécialisés pour le Core local Lab

**Statut initial :** **OUVERT**

**Statut actuel :** **BLOQUÉ — décision de cutover**

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `47b71bd` : `localLabCoreClient()` (proxy.ts) n'accepte que `http://127.0.0.1|localhost` et les préfixes `/v1/lab/*` ; `LAB_CHAT_CORE_URL` est limité au loopback (lab-chat-main.ts) ; les lecteurs exigent `simulated` (cf. P1-010). Ces gardes sont des protections Lab voulues : les lever reviendrait à exposer le Lab. **Options :** (A) client « production » distinct (HTTPS, authentification Studio par instance, timeouts, compatibilité de versions) à côté des clients Lab inchangés — L ; (B) tunnel/VPN vers le Core distant en réutilisant les clients loopback — M, sécurité et diagnostics déportés hors de l'app ; (C) Core local dans Studio en production aussi — supprime le besoin de transport mais change l'architecture cible (Infrastructure Spec : Core VPS). **Recommandation :** A, validé sur un parcours distant isolé (reconnexion, ACK perdu, mauvaise instance refusée) avant tout cutover ; ne jamais assouplir les gardes Lab.

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Les clients Studio limitent le Core à HTTP localhost/127.0.0.1 et à des préfixes /v1/lab ; les lecteurs Sound/TTS refusent les interactions non simulées. La topologie Core VPS → Studio local n'est pas un simple changement d'URL.

**Preuve précise :**

- [apps/studio/server/src/lab-moderation/proxy.ts:31](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/lab-moderation/proxy.ts:31>) — localLabCoreClient(), protocole et préfixes autorisés.
- [apps/twitch-bot/src/lab-chat-main.ts:21](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-main.ts:21>) — LAB_CHAT_CORE_URL limité au loopback HTTP.
- apps/studio/server/sound-player/player.js:125 et apps/studio/server/tts-player/player.js:253 — gardes test_mode/payment_mode.
- Raptoru Studio — Infrastructure Spec.md:110 — topologie cible VPS/PC.

**Cause racine :** Le transport et les contrats d'exécution ont été volontairement conçus autour de l'isolement Lab.

**Risque concret :** Chaque nouveau module accroît le travail de raccordement et la gestion du réseau distant reste tardive.

**Scénario de panne / impact utilisateur :** Studio installé est pointé vers un Core HTTPS distant ; le client refuse l'adresse ou le lecteur refuse les interactions.

**Recommandation :** Conserver les gardes Lab et introduire un chemin de transport/exécution production explicite, authentifié, borné et compatible. Valider un parcours distant isolé.

**Portée probable de la correction :** Clients Studio/Bot, auth transport, contrats lecteurs, diagnostic et compatibilité de versions.

**Effort indicatif :** L.

**Tests à prévoir :**

- Transport HTTPS prévu, déconnexion et retour réseau.
- Interaction d'une mauvaise session/instance refusée.
- Timeout/ACK perdu/restart sans rejeu d'un effet potentiellement exécuté.

**Dépendances avec d'autres findings :** [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-017](#astra-p1-017), [ASTRA-P2-004](#astra-p2-004).

**Traçabilité de l'audit initial :** Audit initial §5 P1-07 et §10.

**Décision préalable :** Transport de production, autorisation Studio et stratégie de compatibility/cutover doivent être décidés ; ne pas simplement lever les restrictions Lab.

---

### P2

#### Build

<a id="astra-p2-001"></a>

##### ASTRA-P2-001 — Dépendance Zod absente du manifeste Schemas

**ID :** `ASTRA-P2-001`

**Sévérité :** P2

**Domaine :** Build

**Titre court :** Dépendance Zod absente du manifeste Schemas

**Statut initial :** **OUVERT**

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** 28d7052 déclare Zod après l'audit ; correction candidate à vérifier, notamment dans stage.mjs. Finding conservé OUVERT tant que sa fermeture n'est pas démontrée.

**Problème constaté :** Schemas importe Zod au runtime sans le déclarer dans son propre package.json à la référence auditée. Le staging recrée un manifeste vide puis fournit Zod via le package racine packagé.

**Preuve précise :**

- [packages/schemas/package.json:1](<C:/Users/Antoni/Documents/Raptoru 2.0/packages/schemas/package.json:1>) — manifeste sans dépendance Zod malgré les imports du package.
- [apps/studio/desktop/scripts/stage.mjs:95](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/scripts/stage.mjs:95>) — copie de Schemas avec dependencies vide, compensée par le package racine.

**Cause racine :** Résolution implicitement fondée sur le hoisting du monorepo et une compensation du packaging.

**Risque concret :** Le package partagé ne décrit pas ses besoins réels ; une installation isolée ou un changement de stage peut casser le chargement.

**Scénario de panne / impact utilisateur :** Schemas est copié hors de l'arbre hoisté ; l'import de Zod échoue alors que le développement source fonctionnait.

**Recommandation :** Déclarer Zod au bon niveau et préserver cette dépendance dans le staging ; vérifier les deux chemins au lieu de considérer le seul manifeste source comme fermeture.

**Portée probable de la correction :** Manifeste Schemas, lockfile et staging Desktop.

**Effort indicatif :** XS–S.

**Tests à prévoir :**

- Résolution de Zod depuis le package partagé isolé.
- Chargement de Schemas dans la structure packagée, sans dépendre du node_modules du repo.

**Dépendances avec d'autres findings :** [ASTRA-P2-004](#astra-p2-004).

**Traçabilité de l'audit initial :** Audit initial §6 P2-07, §8 Packages partagés, §12 Dépendances et §15.

---

#### Config

<a id="astra-p2-002"></a>

##### ASTRA-P2-002 — Garde économique Test Lab incomplète pour Daily

**ID :** `ASTRA-P2-002`

**Sévérité :** P2

**Domaine :** Config

**Titre court :** Garde économique Test Lab incomplète pour Daily

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `0e4c040`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `ce3ebfc` : `coreGuard()` et le démarrage forcé du Core par le Test Lab (`test-lab.ts`) couvraient `LOYALTY_PASSIVE_CREDITS`/`LOYALTY_EVENT_CREDITS` mais pas `DAILY_WALLET_CREDITS` (Core : `WalletCreditProvider` si `true`, sinon aucun écrit Wallet). Daily n'écrit qu'à une réclamation (`POST /v1/bot/daily/claim`, seul chemin, venant du `!daily` du bot) : le `botGuard` existant refuse `DAILY_CHAT_COMMANDS=true`, donc aucun crédit Daily n'était démontrable, mais la garantie était indirecte. Politique fixée par Antoni (passe P2, 2026-10-04) : aucun crédit économique automatique quand le Test Lab tourne. Correction : `DAILY_WALLET_CREDITS` rejoint les drapeaux refusés (`CREDIT_FLAGS`) et est forcé à `false` au démarrage comme ceux de Loyalty ; la raison est affichée par le panneau Test Lab existant (`creditsGuard`). Règles Daily inchangées ; aucun effet externe (le Wallet Core est local, aucune écriture StreamElements). Dette : un Core lancé hors Studio (« not managed ») reste hors de cette garde, comme avant.

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** La lacune du contrôle est constatée ; la politique attendue « zéro écriture économique » et l'effet d'un flag activé sont À VÉRIFIER. Aucun crédit réel observé.

**Problème constaté :** coreGuard() et ensureCore() imposent des flags Loyalty OFF mais ne couvrent pas DAILY_WALLET_CREDITS. Le flag local inspecté était désactivé : aucune distribution réelle de crédits n'est démontrée.

**Preuve précise :**

- [apps/studio/server/src/test-lab/test-lab.ts:76](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/test-lab.ts:76>) — coreGuard(), contrôle des flags Loyalty.
- [apps/studio/server/src/test-lab/test-lab.ts:444](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/test-lab.ts:444>) — ensureCore(), overrides des crédits passifs/événementiels.

**Cause racine :** Le garde-fou ne définit pas explicitement s'il vise Loyalty seul ou toute écriture économique.

**Risque concret :** Une configuration future peut autoriser des crédits Daily alors que l'opérateur suppose le Test Lab sans effet économique.

**Scénario de panne / impact utilisateur :** DAILY_WALLET_CREDITS est activé plus tard ; les contrôles existants passent et un claim Daily peut créditer le wallet central de l'environnement utilisé.

**Recommandation :** Clarifier la garantie produit du Test Lab. Si elle signifie zéro crédit économique, inclure Daily et rendre l'état effectif visible ; conserver les flags actuels tant que cette politique n'est pas décidée.

**Portée probable de la correction :** Politique de sécurité Test Lab, validation des flags et diagnostics.

**Effort indicatif :** XS–S.

**Tests à prévoir :**

- Toutes les combinaisons Loyalty/Daily pertinentes face à la politique choisie.
- Flag non conforme : lancement refusé ou override explicite, état effectif affiché.

**Dépendances avec d'autres findings :** [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-005](#astra-p1-005).

**Traçabilité de l'audit initial :** Audit initial §6 P2-09.

**Décision préalable :** Décider si Test Lab interdit toutes les écritures économiques ou uniquement celles de Loyalty avant de modifier les flags.

---

#### Contrats

<a id="astra-p2-003"></a>

##### ASTRA-P2-003 — Réponses critiques consommées sans validation structurelle

**ID :** `ASTRA-P2-003`

**Sévérité :** P2

**Domaine :** Contrats

**Titre court :** Réponses critiques consommées sans validation structurelle

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `52591d0`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `b7b5809` : seul chemin de remplacement silencieux restant, le client Extension (`api.js`) qui transformait un JSON invalide en `{}` sur une réponse 2xx (succès annoncé sans contenu). Correction : un 2xx sans objet JSON valide (corps vide, tronqué, non-objet) est une erreur explicite `invalid_response` (204 reste un succès vide) ; les refus HTTP gardent leur contrat (`code`, `details`). Côté Studio/Bot, `localLabCoreClient`, les clients des workers et le bot utilisent `res.json()` qui lève sur un corps invalide (erreur explicite, pas de cast silencieux) ; le lecteur TTS garde `.catch(() => ({}))` sans enjeu : un 200 signifie que Studio a déjà traité l'ACK ou la remise. Dette résiduelle assumée : les réponses du Core Lab sont typées par `as T` sans validation de forme ; Core Lab et Studio sont livrés dans le même paquet (même build), un écart de forme relève de la compatibilité de versions ([ASTRA-P2-004](#astra-p2-004), hors périmètre).

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** api.js et lab-ebs.ts ont évolué après le HEAD audité ; relire les frontières critiques actuelles avant correction.

**Problème constaté :** Les entrées Core sont souvent validées par Zod, mais des consommateurs castent les sorties en as T ou Record<string, unknown>. Le client Extension peut remplacer un JSON invalide par {} sur une réponse réussie.

**Preuve précise :**

- [apps/studio/server/src/lab-moderation/proxy.ts:62](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/lab-moderation/proxy.ts:62>) — localLabCoreClient(), cast de réponse sans parse Zod.
- [apps/studio/server/src/extension-lab/lab-ebs.ts:519](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/extension-lab/lab-ebs.ts:519>) — projections de réponses Core.
- [apps/twitch-extension/extension/shared/api.js:181](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/api.js:181>) — parsing JSON et remplacement silencieux en objet vide.

**Cause racine :** Le type statique ou le succès HTTP tient lieu de contrat de sortie vérifié au runtime.

**Risque concret :** Une évolution d'API ou une réponse malformée produit un état UI incorrect au lieu d'une incompatibilité identifiable.

**Scénario de panne / impact utilisateur :** Une admission ou un ACK renvoie une forme inattendue ; le client affiche un succès ou perd l'identifiant nécessaire à la reprise.

**Recommandation :** Valider d'abord les réponses d'admission, ACK, wallet et état d'interaction ; distinguer erreur de protocole, refus métier et indisponibilité. Étendre progressivement.

**Portée probable de la correction :** Schemas de sortie et consommateurs Studio/Extension, sans codegen exhaustif imposé.

**Effort indicatif :** M, progressif.

**Tests à prévoir :**

- Réponse HTTP 2xx avec JSON invalide, champ critique absent ou type erroné : erreur de protocole explicite.
- Réponse métier valide : comportement conservé.
- État économique déjà commité : aucune mutation de rattrapage non idempotente après erreur de parsing.

**Dépendances avec d'autres findings :** [ASTRA-P1-009](#astra-p1-009), [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-004](#astra-p2-004), [ASTRA-P2-010](#astra-p2-010).

**Traçabilité de l'audit initial :** Audit initial §6 P2-01 (JSON invalide), §8 Core et §9 Contrats.

---

<a id="astra-p2-004"></a>

##### ASTRA-P2-004 — Compatibilité intercomposants sans contrat explicite

**ID :** `ASTRA-P2-004`

**Sévérité :** P2

**Domaine :** Contrats

**Titre court :** Compatibilité intercomposants sans contrat explicite

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Le monorepo permet un co-développement, mais l'audit n'a pas identifié de négociation globale de version/capacités pour Studio installé, Core distant et Extension. expected_version de Commands protège une édition, pas la compatibilité API.

**Preuve précise :**

- [apps/core-api/src/commands/service.ts:465](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/service.ts:465>) et :867 — version de configuration Commands.
- [packages/schemas/src/index.ts:1](<C:/Users/Antoni/Documents/Raptoru 2.0/packages/schemas/src/index.ts:1>) — exports des contrats partagés, sans handshake global identifié.
- [apps/studio/server/src/lab-moderation/proxy.ts:62](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/lab-moderation/proxy.ts:62>) — consommation typée des réponses.
- [apps/core-api/src/http/server.ts:158](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/http/server.ts:158>) — health sans inventaire de capacités.
- [apps/studio/desktop/src/updater.ts:31](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/updater.ts:31>) — mise à jour indépendante de Studio.
- Raptoru Studio — Infrastructure Spec.md:695 — clients OpenAPI dans la cible documentée.

**Cause racine :** Les versions déployées séparément ne sont pas encore traitées comme une frontière de compatibilité.

**Risque concret :** Une mise à jour indépendante peut casser silencieusement un autre composant ou empêcher le diagnostic de la combinaison présente.

**Scénario de panne / impact utilisateur :** Core change un état ou un endpoint ; Studio installé et l'Extension continuent avec leur ancien contrat.

**Recommandation :** Exposer version/capacités et définir une politique minimale de compatibilité, avec refus explicite des combinaisons impossibles. Ne pas confondre version de configuration et version de protocole.

**Portée probable de la correction :** Contrats transversaux, diagnostics, clients et stratégie de release.

**Effort indicatif :** M.

**Tests à prévoir :**

- Ancien client/nouveau Core et inversement selon la matrice supportée.
- Capacité absente : action indisponible avec explication.
- Versions réellement utilisées visibles dans un diagnostic de chaîne.

**Dépendances avec d'autres findings :** [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-019](#astra-p1-019), [ASTRA-P2-003](#astra-p2-003), [ASTRA-P2-015](#astra-p2-015).

**Traçabilité de l'audit initial :** Audit initial §8 Release/update, §9 Contrats, §10 Versions et §19.

**Décision préalable :** Définir les versions supportées et le niveau de handshake avant toute rupture d'API ; codegen intégral non requis.

---

#### Core

<a id="astra-p2-005"></a>

##### ASTRA-P2-005 — Cache avatars sans timeout ni exécution unique

**ID :** `ASTRA-P2-005`

**Sévérité :** P2

**Domaine :** Core

**Titre court :** Cache avatars sans timeout ni exécution unique

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `28e9fd3`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `3699063` : dans `apps/core-api/src/raffle-lab/avatars.ts`, `twitchAppUserLookup()` appelait OAuth (`id.twitch.tv/oauth2/token`) et Helix (`helix/users`) sans délai, et la minuterie de 5 s de `local-server.ts` relançait `AvatarCache.refresh()` sans garde : un appel bloqué pouvait empiler des lots concurrents. Correction : budget de 10 s par appel Twitch (`AbortSignal.timeout`, corps compris, `TWITCH_CALL_TIMEOUT_MS`) ; `refresh()` à exécution unique (un tick pendant un lot en cours rejoint ce lot). Inchangés et déjà testés : les lectures n'appellent jamais Twitch (Tombola jamais bloquée), un échec pose `status = 'error'` et retombe sur les initiales, nouvel essai après 1 h, puis récupération normale.

**Marquages :** **À VÉRIFIER** ; **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Absence de garde/délai établie ; accumulation et impact en charge non mesurés, À VÉRIFIER.

**Réserve — À REVALIDER SUR CODE ACTUEL :** Le caller local-server.ts a évolué après l'audit ; cadence et garde actuelles à relire.

**Problème constaté :** Les appels OAuth/Helix du cache avatars n'ont pas de timeout explicite. Le tick appelé toutes les cinq secondes ne possède pas la garde de superposition du tick Tombola.

**Preuve précise :**

- [apps/core-api/src/raffle-lab/avatars.ts:100](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/avatars.ts:100>) — twitchAppUserLookup(), appels fetch OAuth/Helix.
- [apps/core-api/src/bonk-lab/local-server.ts:139](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:139>) — avatarTick périodique sans garde de traitement en cours.

**Cause racine :** Le polling externe suppose que chaque traitement termine avant la prochaine échéance.

**Risque concret :** Accumulation de requêtes/promesses et traitements redondants lors d'un réseau lent ou bloqué.

**Scénario de panne / impact utilisateur :** Helix ne répond plus ; les ticks suivants lancent d'autres requêtes pendant que les précédentes restent pendantes.

**Recommandation :** Ajouter des délais réseau bornés et une seule exécution en cours, avec état de fraîcheur et retry raisonnable. Conserver le caractère non bloquant des avatars pour le jeu.

**Portée probable de la correction :** Lookup Twitch et ordonnanceur du cache avatars.

**Effort indicatif :** S.

**Tests à prévoir :**

- Lookup suspendu au-delà du budget : annulation et absence de chevauchement.
- Retour réseau : rafraîchissement possible.
- Avatar manquant/erreur Twitch : flux Tombola toujours utilisable.

**Dépendances avec d'autres findings :** [ASTRA-P2-019](#astra-p2-019), [ASTRA-P1-018](#astra-p1-018).

**Traçabilité de l'audit initial :** Audit initial §6 P2-02, §13 Avatars et §15.

---

<a id="astra-p2-006"></a>

##### ASTRA-P2-006 — Remboursement Lab intégral dans le ledger mais plafonné en solde

**ID :** `ASTRA-P2-006`

**Sévérité :** P2

**Domaine :** Core

**Titre court :** Remboursement Lab intégral dans le ledger mais plafonné en solde

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `5ff2519`

**Résolution (passe P1, 2026-10-04) :** Décision d'Antoni (2026-10-04) : option A — le ledger n'enregistre que le montant réellement recrédité au solde après application du plafond, et les surfaces reçoivent ce montant appliqué. Constat revalidé sur `906d643` : `refundDebit()` (`apps/core-api/src/lab-moderation/store.ts`) inscrivait et retournait le montant intégral puis plafonnait le solde (`LAB_WALLET_MAX`, contraintes `check` de `lab_wallets`). Correction minimale, sans migration : verrouillage du wallet d'abord, calcul du crédit réellement appliqué (`min(plafond, solde + débit) − solde`, éventuellement 0), insertion de ce montant comme ligne `refund` (toujours unique par interaction via `lab_wallet_ledger_once` ; un rejeu n'insère rien et ne touche pas le solde), écriture du solde, retour du montant appliqué. Surfaces : les trois services (TTS, Soundboard, Bonk) reportent ce montant dans l'audit (`after.amount`), et la vue ledger lit le ledger ; même règle que `adminAdjust()`. L'interaction reste « remboursée » ; l'écart avec le débit (part non recréditée au plafond) est visible en comparant les lignes `debit` et `refund`. Wallet production non concerné.

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** refundDebit() enregistre et annonce le montant intégral, puis plafonne le nouveau solde avec Math.min(). Le montant réellement ajouté peut être inférieur au mouvement annoncé.

**Preuve précise :**

- [apps/core-api/src/lab-moderation/store.ts:689](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/lab-moderation/store.ts:689>) — refundDebit(), ledger de remboursement, solde plafonné et résultat retourné.

**Cause racine :** Le plafond de wallet est appliqué après détermination du remboursement sans représenter la fraction non créditée.

**Risque concret :** Divergence entre remboursement annoncé, ledger et solde ; perte fictive masquée au viewer/admin.

**Scénario de panne / impact utilisateur :** Entre achat et remboursement, un admin remplit le wallet. Un remboursement de 100 est journalisé, mais le solde déjà au plafond ne reçoit pas ces 100.

**Recommandation :** Choisir une règle explicite de dépassement : refus/attente, dépassement autorisé ou crédit appliqué et reste dû représentés. Ne pas conserver un statut remboursé intégral avec crédit tronqué.

**Portée probable de la correction :** Wallet Lab, résultat de remboursement, ledger et affichage ; le Wallet central n'est pas accusé de ce défaut.

**Effort indicatif :** S–M.

**Tests à prévoir :**

- Remboursement sans plafond atteint : delta exact.
- Wallet rempli entre débit/refund : comportement cohérent avec la politique choisie.
- Retry de refund et admin concurrent : un mouvement unique, ledger/solde/résultat cohérents.

**Dépendances avec d'autres findings :** [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-009](#astra-p1-009).

**Traçabilité de l'audit initial :** Audit initial §6 P2-11.

**Décision préalable :** La règle produit de remboursement au-delà du plafond doit être choisie avant correction.

---

#### Database

<a id="astra-p2-007"></a>

##### ASTRA-P2-007 — Migrateur sans verrou global d'exécution concurrente

**ID :** `ASTRA-P2-007`

**Sévérité :** P2

**Domaine :** Database

**Titre court :** Migrateur sans verrou global d'exécution concurrente

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Le migrateur lit les noms appliqués puis exécute les migrations individuellement, sans verrou global empêchant deux lanceurs de décider simultanément qu'un fichier manque.

**Preuve précise :**

- [apps/core-api/src/db/migrate.ts:23](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/db/migrate.ts:23>) — migrate(), lecture des noms et boucle d'application en transactions.

**Cause racine :** L'ownership d'une exécution complète de migration n'est pas sérialisé.

**Risque concret :** Collisions DDL, rollback et démarrage incomplet si des déploiements/lanceurs concurrents sont introduits.

**Scénario de panne / impact utilisateur :** Deux processus lisent le même état initial et tentent la même création ou insertion de nom appliqué.

**Recommandation :** Sérialiser les exécutions avec un verrou PostgreSQL approprié, une attente bornée et un diagnostic. Prioriser avant des déploiements automatisés concurrents.

**Portée probable de la correction :** Migrateur et convention de lancement ; faible urgence avec un seul lanceur local.

**Effort indicatif :** S.

**Tests à prévoir :**

- Deux migrateurs concurrents sur une base de test dédiée : application unique.
- Lanceur interrompu : verrou libéré et reprise possible.
- Attente trop longue : erreur lisible, aucune exécution partielle hors transaction.

**Dépendances avec d'autres findings :** [ASTRA-P2-008](#astra-p2-008), [ASTRA-P1-019](#astra-p1-019).

**Traçabilité de l'audit initial :** Audit initial §8 Database : P2/S avant déploiements concurrents.

---

<a id="astra-p2-008"></a>

##### ASTRA-P2-008 — Historique des migrations identifié par nom seul

**ID :** `ASTRA-P2-008`

**Sévérité :** P2

**Domaine :** Database

**Titre court :** Historique des migrations identifié par nom seul

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** schema_migrations mémorise les noms appliqués, sans empreinte du contenu. Une modification ultérieure d'un fichier historique n'est pas détectée par le migrateur.

**Preuve précise :**

- [apps/core-api/src/db/migrate.ts:23](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/db/migrate.ts:23>) — schema_migrations et enregistrement du nom de fichier.
- [supabase/migrations/](<C:/Users/Antoni/Documents/Raptoru 2.0/supabase/migrations/>) — fichiers SQL historiques, dont transformations destructrices déjà appliquées.

**Cause racine :** La convention d'immutabilité de l'historique ne possède pas de preuve de contenu persistée.

**Risque concret :** Deux bases peuvent afficher les mêmes migrations appliquées tout en ayant reçu des contenus différents.

**Scénario de panne / impact utilisateur :** Un SQL historique est édité ; une installation existante le saute et une nouvelle installation l'applique avec un autre contenu.

**Recommandation :** Protéger l'immutabilité des fichiers appliqués et ajouter une empreinte vérifiable pour l'avenir. Définir comment initialiser les empreintes des bases existantes sans inventer leur historique.

**Portée probable de la correction :** Migrateur, métadonnées et contrôle documentaire/CI de l'historique ; aucune réécriture de migration appliquée.

**Effort indicatif :** S.

**Tests à prévoir :**

- Fichier nouveau : nom et empreinte enregistrés ensemble.
- Fichier déjà appliqué modifié : divergence détectée.
- Base historique sans empreintes : procédure explicite, non destructive.

**Dépendances avec d'autres findings :** [ASTRA-P2-007](#astra-p2-007).

**Traçabilité de l'audit initial :** Audit initial §8 Database, §16 et §19 migrations appliquées.

**Décision préalable :** L'enrôlement des historiques existants dans une vérification par empreinte doit partir d'une référence approuvée ; ne pas remplir des preuves rétroactives automatiquement.

---

#### Documentation

<a id="astra-p2-009"></a>

##### ASTRA-P2-009 — Documents de reprise et commentaires décrivant un état dépassé

**ID :** `ASTRA-P2-009`

**Sévérité :** P2

**Domaine :** Documentation

**Titre court :** Documents de reprise et commentaires décrivant un état dépassé

**Statut initial :** **OUVERT**

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** COMMANDS_V2_STATUS a été actualisé dans 0b9a9f5 et la phase F livrée après l'audit. Conserver les contradictions historiques, revalider la liste encore pertinente.

**Problème constaté :** HANDOFF/État projet restent au checkpoint ed781f6 du 03/10, README décrit des placeholders et un wallet en mémoire, et plusieurs documents/commentaires excluent des signaux ou sorties chat désormais présents. Les résultats de tests historiques ne valident pas le HEAD audité.

**Preuve précise :**

- Raptoru-2.0-HANDOFF.md:3 et :140 — ancien HEAD et résultats historiques.
- Raptoru-2.0-ETAT-PROJET.md:3 — checkpoint Tombola.
- README.md:7 et :144 — Daily seul, placeholders, wallet mémoire et absence d'écriture Twitch.
- [docs/bonk-lab.md:1](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/bonk-lab.md:1>) — slice historique en attente OBS.
- [docs/moderation-v2-d4-parity.md:254](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/moderation-v2-d4-parity.md:254>) — absence de signal de fin de stream.
- [docs/tombola-v2-parity.md:183](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/tombola-v2-parity.md:183>) — formulation jamais activé automatiquement.
- [apps/studio/server/src/lab-chat/ingress.ts:110](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/lab-chat/ingress.ts:110>) — restauration du choix ON enregistré.
- [apps/studio/server/src/extension-lab/lab-ebs.ts:846](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/extension-lab/lab-ebs.ts:846>) — snapshot Lab et contexte des sorties Commands.
- [docs/COMMANDS_V2_STATUS.md:7](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/COMMANDS_V2_STATUS.md:7>) — document plus proche du HEAD audité, A0–E, F suivante.

**Cause racine :** Les documents historiques et les résumés courants ne distinguent pas clairement date, référence et cible.

**Risque concret :** Reprise de développement ou préparation de release fondée sur une architecture ou une validation périmée.

**Scénario de panne / impact utilisateur :** Une nouvelle session suppose qu'aucun chat Twitch n'est écrit ou que Commands F manque, puis prend une décision inadaptée au code présent.

**Recommandation :** Actualiser le résumé courant avec HEAD/périmètre, garder l'historique daté et distinguer code observé, validation rapportée et cible. Formuler OFF par défaut et restauration d'un ON explicite avec précision.

**Portée probable de la correction :** Documents de reprise, README, parités et commentaires de sécurité/fonctionnement ; pas de modification de runtime.

**Effort indicatif :** S.

**Tests à prévoir :**

- Relecture croisée documents/code au HEAD de fermeture.
- Aucun résultat ancien présenté comme test exécuté sur le HEAD courant.
- Vérification de la distinction activation utilisateur/restauration automatique.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018), [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-015](#astra-p1-015).

**Traçabilité de l'audit initial :** Audit initial §2 Contradictions documentaires, §6 P2-10, §14 et §15.

---

#### Extension

<a id="astra-p2-010"></a>

##### ASTRA-P2-010 — Timeout interrompu avant lecture du corps HTTP

**ID :** `ASTRA-P2-010`

**Sévérité :** P2

**Domaine :** Extension

**Titre court :** Timeout interrompu avant lecture du corps HTTP

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `52591d0`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `b7b5809` : `call()` (`apps/twitch-extension/extension/shared/api.js`) faisait `clearTimeout` dès les en-têtes reçus puis attendait `response.json()` sans limite ; les gardes `refreshInFlight` d'`overlay.js`/`mobile.js` (libérées en `finally`) restaient donc occupées tant que le corps ne finissait pas. Correction : le budget de 8 s de la tentative lue couvre désormais le corps (`readBody()` en course avec le signal d'abandon, minuterie effacée après lecture) ; corps bloqué → `network_error` (cause `response_timeout`), sans retry, car le résultat est inconnu ; les retries P1-009 (une seule reprise sur erreur réseau ou statut transitoire, même Idempotency-Key, avant lecture du corps) sont inchangés.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** api.js a changé après l'audit ; ordre effectif de cleanup à revalider.

**Problème constaté :** call() retire son timer dès réception des headers, puis attend response.json(). Un corps non terminé peut dépasser indéfiniment le budget prévu et conserver un refreshInFlight.

**Preuve précise :**

- [apps/twitch-extension/extension/shared/api.js:160](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/api.js:160>) — clearTimeout avant parsing du corps.
- [apps/twitch-extension/extension/shared/api.js:181](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/api.js:181>) — attente response.json().
- [apps/twitch-extension/extension/overlay.js:69](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/overlay.js:69>) et :100 — garde refreshInFlight.
- [apps/twitch-extension/extension/mobile.js:35](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/mobile.js:35>) et :53 — garde équivalente de refresh.

**Cause racine :** Le délai réseau ne couvre pas toute l'opération fetch + lecture/décodage de réponse.

**Risque concret :** Une surface cesse de rafraîchir son état malgré des timers toujours actifs.

**Scénario de panne / impact utilisateur :** Le serveur envoie les headers puis bloque son JSON ; le refresh courant ne se termine pas et les suivants sont ignorés.

**Recommandation :** Garder l'AbortController et le délai jusqu'à la fin de la lecture, libérer les gardes dans tous les cas et distinguer l'erreur de parsing. Ne pas élargir les retries de mutations non idempotentes.

**Portée probable de la correction :** Client HTTP partagé et garanties de cleanup des surfaces.

**Effort indicatif :** S.

**Tests à prévoir :**

- Headers reçus, corps suspendu : abort au budget et refresh suivant possible.
- JSON malformé : erreur explicite selon ASTRA-P2-003.
- Succès, erreur et timeout : aucun timer/garde résiduel.

**Dépendances avec d'autres findings :** [ASTRA-P2-003](#astra-p2-003), [ASTRA-P1-009](#astra-p1-009).

**Traçabilité de l'audit initial :** Audit initial §6 P2-01 et §15.

---

<a id="astra-p2-011"></a>

##### ASTRA-P2-011 — Extension entièrement exclue du lint

**ID :** `ASTRA-P2-011`

**Sévérité :** P2

**Domaine :** Extension

**Titre court :** Extension entièrement exclue du lint

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** eslint.config.js exclut l'ensemble du code Extension, y compris les nouveaux modules. Les quelques tests helpers ne compensent pas un contrôle absent sur les fichiers de surface.

**Preuve précise :**

- eslint.config.js:12 — exclusion apps/twitch-extension.
- [apps/twitch-extension/test/](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/test/>) — quatre fichiers de helpers identifiés au HEAD audité.

**Cause racine :** Une exception qualité héritée est restée globale pendant l'ajout de code nouveau.

**Risque concret :** Erreurs simples et régressions de lifecycle plus coûteuses à détecter lors de l'intégration.

**Scénario de panne / impact utilisateur :** Un nouveau module ajoute un listener/timer ou un accès erroné ; aucun lint du fichier ne le signale avant les essais UI.

**Recommandation :** Réintégrer progressivement les nouveaux fichiers et ceux modifiés, avec règles adaptées au JS/browser. Ne pas imposer une remise en forme de tout le legacy.

**Portée probable de la correction :** Périmètre ESLint et nouveaux modules Extension.

**Effort indicatif :** S.

**Tests à prévoir :**

- Lint des fichiers réintégrés via la recette du repo, sans exclusion globale cachée.
- Chargement navigateur des surfaces concernées ; E2E critique traité séparément par ASTRA-P1-018.

**Dépendances avec d'autres findings :** [ASTRA-P1-008](#astra-p1-008), [ASTRA-P1-018](#astra-p1-018).

**Traçabilité de l'audit initial :** Audit initial §5 P1-09 et §15 quick win P2 lint.

---

#### Identité

<a id="astra-p2-012"></a>

##### ASTRA-P2-012 — Broadcaster chat Tombola comparé au channel simulé

**ID :** `ASTRA-P2-012`

**Sévérité :** P2

**Domaine :** Identité

**Titre court :** Broadcaster chat Tombola comparé au channel simulé

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `c8284c6`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `906d643` par le comportement, pas par le nom du helper. `75c9ea0` (passe de consolidation) avait déjà donné à Tombola et Commands la même règle (`lab-chat/broadcaster.ts`) : le vrai broadcaster Twitch configuré (`BONK_LAB_CHANNEL_TWITCH_ID`) est reconnu dans les deux modules (tests existants), un badge/rôle revendiqué ne suffit jamais. Défaut résiduel confirmé : la règle acceptait aussi l'identifiant du canal Lab simulé (900100) comme streamer pour **tout** message, y compris un vrai message Twitch — un compte Twitch réel portant cet identifiant numérique aurait été streamer. Correction : un message Twitch réel ne fait streamer que l'identifiant Twitch du broadcaster du canal (celui configuré, sinon l'identifiant du canal lui-même — cas d'un canal dont l'id est son id Twitch, comme en production) ; un message simulé (simulateur de chat Studio, « Tester ») accepte en plus l'identité propre du canal Lab. Les deux modules passent la source du message (Tombola : `msg.source` ; Commands : présence de l'id de message Twitch). Inchangés : vrai streamer, simulateur, refus des badges forgés, droits modérateur/viewer.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** 75c9ea0 introduit une règle streamer partagée Commands/Tombola ; b54ad46 unifie les acteurs Extension Lab. Corrections candidates à valider, pas fermeture automatique.

**Problème constaté :** Tombola compare encore l'identifiant du chatter au channel Lab au lieu de résoudre le vrai streamer. Commands possédait déjà une résolution différente corrigée au HEAD audité.

**Preuve précise :**

- [apps/core-api/src/raffle-lab/raffle-lab-service.ts:1093](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/raffle-lab-service.ts:1093>) — traitement chat et comparaison à l'identité du channel Lab.
- [apps/core-api/src/commands/admission.ts:426](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/admission.ts:426>) — broadcasterOf(), résolution Commands corrigée.
- [docs/COMMANDS_V2_STATUS.md:46](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/COMMANDS_V2_STATUS.md:46>) — dette de reconnaissance streamer Tombola identifiée.

**Cause racine :** Deux modules interprètent séparément les identifiants Twitch et la simulation de canal.

**Risque concret :** Droits broadcaster incohérents selon le module.

**Scénario de panne / impact utilisateur :** Le vrai streamer tente une annulation Tombola par chat ; il n'est pas reconnu comme broadcaster alors que la même identité est reconnue par Commands.

**Recommandation :** Partager une résolution de l'identité broadcaster, explicite pour le Lab et dérivée de données Twitch vérifiées en production. Ne pas élargir les permissions sur la seule base d'une donnée client.

**Portée probable de la correction :** Mapping d'identité chat Core et adaptateurs Lab.

**Effort indicatif :** S.

**Tests à prévoir :**

- Vrai streamer avec channel Lab simulé : reconnaissance identique dans Commands/Tombola.
- Viewer et modérateur : absence de promotion broadcaster.
- Identité absente/ambiguë : refus ou politique explicite.

**Dépendances avec d'autres findings :** [ASTRA-P1-007](#astra-p1-007), [ASTRA-P1-006](#astra-p1-006).

**Traçabilité de l'audit initial :** Audit initial §6 P2-05 et §15.

---

#### Observabilité

<a id="astra-p2-013"></a>

##### ASTRA-P2-013 — Erreurs inattendues Core Lab sans cause journalisée

**ID :** `ASTRA-P2-013`

**Sévérité :** P2

**Domaine :** Observabilité

**Titre court :** Erreurs inattendues Core Lab sans cause journalisée

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `87465b7`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `b01ff3d` : le serveur HTTP du Core Lab (désormais `createLabCore()` dans `apps/core-api/src/bonk-lab/lab-core.ts`, extrait tel quel de `local-server.ts` en `93f07db`) transformait toute exception inattendue en `500 bonk_core_error` sans aucune trace (le Core principal journalise déjà `[core-api] request failed`). Correction minimale : une ligne `console.error` « `[bonk-lab-core] <MÉTHODE> <chemin> failed: <erreur + pile>` » — chemin sans query ni corps, secret Bearer et identifiants d'URL de connexion masqués (`redact()`) ; Studio la reçoit dans ses journaux via la sortie du processus (sa propre redaction s'applique en plus). Réponse client inchangée ; les `HttpError` (refus métier, validation 400/403/404/409) gardent leur contrat et ne sont pas journalisées comme pannes. Pas de refonte du logging.

**Marquages :** **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Réserve — À REVALIDER SUR CODE ACTUEL :** local-server.ts a changé après l'audit ; traitement courant des exceptions à revalider.

**Problème constaté :** Le catch HTTP du Core Lab convertit les exceptions inattendues en erreur générique sans enregistrer leur cause. Le comportement des erreurs métier connues doit rester distinct.

**Preuve précise :**

- [apps/core-api/src/bonk-lab/local-server.ts:112](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:112>) — catch du serveur HTTP Lab et réponse générique.

**Cause racine :** La réponse publique sûre n'est pas accompagnée d'un diagnostic interne nettoyé.

**Risque concret :** Impossible de retrouver rapidement la route, l'étape ou la cause d'un 500 pendant le stream.

**Scénario de panne / impact utilisateur :** Une opération DB inattendue échoue ; l'UI reçoit une erreur générique et aucun log ne permet de rapprocher l'échec de l'interaction.

**Recommandation :** Journaliser une erreur redacted avec route, identifiant de requête/interactions et étape. Conserver une réponse client sobre et ne pas logger secrets/payloads bruts.

**Portée probable de la correction :** Frontière HTTP Lab et convention de log.

**Effort indicatif :** S.

**Tests à prévoir :**

- Exception inattendue : réponse générique et diagnostic utile sans secret.
- Erreur métier connue : statut/message conservés.
- Identifiant commun au log et à la réponse/diagnostic lorsque prévu.

**Dépendances avec d'autres findings :** [ASTRA-P2-014](#astra-p2-014), [ASTRA-P2-015](#astra-p2-015), [ASTRA-P1-005](#astra-p1-005).

**Traçabilité de l'audit initial :** Audit initial §6 P2-03, §9 Observabilité et §15.

---

<a id="astra-p2-014"></a>

##### ASTRA-P2-014 — Stacks Studio écrites avant redaction

**ID :** `ASTRA-P2-014`

**Sévérité :** P2

**Domaine :** Observabilité

**Titre court :** Stacks Studio écrites avant redaction

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Chemin brut constaté ; aucune fuite réelle de secret démontrée. Exploitabilité et contenu des erreurs réelles À VÉRIFIER.

**Problème constaté :** Les handlers unhandledRejection/uncaughtException écrivent des erreurs brutes dans stderr avant le chemin redacted de Lab.logs. Electron peut conserver cette sortie dans son log.

**Preuve précise :**

- [apps/studio/server/src/index.ts:416](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:416>) — handlers globaux et console.error.
- [apps/studio/desktop/src/main.ts:84](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:84>) — serverLog(), persistance des sorties du serveur.

**Cause racine :** Plusieurs sorties de diagnostic n'utilisent pas une frontière commune de redaction.

**Risque concret :** Une valeur sensible contenue dans une exception peut être conservée puis partagée dans un diagnostic.

**Scénario de panne / impact utilisateur :** Une erreur inclut une URL/token dans son message ; stderr est persisté avant nettoyage.

**Recommandation :** Nettoyer stderr, messages et stacks avant toute sortie persistée. Maintenir un diagnostic exploitable sans recopier des valeurs secrètes.

**Portée probable de la correction :** Handlers d'erreurs Studio et chaîne de logs Desktop.

**Effort indicatif :** S.

**Tests à prévoir :**

- Erreur synthétique contenant un secret de fixture : absent de stderr/logs ; cause et stack utiles.
- Unhandled rejection et exception : même politique de redaction.
- Rotation/cache du redactor ne laisse pas passer un token fraîchement renouvelé.

**Dépendances avec d'autres findings :** [ASTRA-P2-022](#astra-p2-022), [ASTRA-P2-023](#astra-p2-023).

**Traçabilité de l'audit initial :** Audit initial §6 P2-08, §12 et §15.

---

<a id="astra-p2-015"></a>

##### ASTRA-P2-015 — Dernière preuve d'exécution difficile à suivre entre composants

**ID :** `ASTRA-P2-015`

**Sévérité :** P2

**Domaine :** Observabilité

**Titre court :** Dernière preuve d'exécution difficile à suivre entre composants

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER** ; **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** L'absence de corrélation systématique est un constat statique ; la rapidité réelle de diagnostic et les gaps de chaque parcours sont À VÉRIFIER par incident contrôlé.

**Réserve — À REVALIDER SUR CODE ACTUEL :** Façade et bootstrap Lab ont évolué ; revalider les informations actuellement disponibles.

**Problème constaté :** Interaction, tentative, ledger et logs existent, mais la corrélation requête → Core → worker → lecteur → ACK n'est pas systématique. Un socket connecté, un ordre préparé ou un health vert ne prouvent pas la dernière étape exécutée.

**Preuve précise :**

- [apps/studio/server/src/extension-lab/lab-ebs.ts:519](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/extension-lab/lab-ebs.ts:519>) et :1143 — projections/actions passant par la façade.
- [apps/core-api/src/bonk-lab/local-server.ts:112](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:112>) — frontière HTTP des erreurs.
- [apps/studio/server/src/tts-lab/worker.ts:232](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/worker.ts:232>) — remise d'ordre au lecteur.
- [apps/core-api/src/tts-lab/tts-lab-service.ts:687](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/tts-lab/tts-lab-service.ts:687>) — ACK lié à la tentative.
- [apps/twitch-bot/src/lab-chat-output.ts:342](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-output.ts:342>) — journal et exécution chat.
- [apps/studio/server/src/test-lab/log-buffer.ts:26](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/log-buffer.ts:26>) — diagnostics bornés, distincts des preuves métier.

**Cause racine :** Les diagnostics sont organisés par composant/domaine sans une vue commune de la chaîne de preuves.

**Risque concret :** L'opérateur identifie l'interaction, mais pas rapidement l'endroit où la livraison ou la recovery s'est interrompue.

**Scénario de panne / impact utilisateur :** TTS semble annulé dans Core et le lecteur reste sonore ; les informations d'arrêt demandé, remise et confirmation sont dispersées.

**Recommandation :** Relier intention, interaction, tentative, worker et lecteur ; afficher dernière preuve, son âge, résultat ambigu et versions. Distinguer socket et subscriptions utilisables, annulation et silence confirmé. Une plateforme de tracing lourde n'est pas nécessaire.

**Portée probable de la correction :** Conventions de corrélation et vue diagnostic Studio des chaînes critiques.

**Effort indicatif :** M.

**Tests à prévoir :**

- Incident injecté à chaque frontière dans un environnement isolé : dernière étape confirmée identifiable.
- Request/interaction/attempt/reader IDs reliés sans exposition de secret.
- Versions et état bloqué visibles ; absence de confirmation jamais rendue comme un succès.

**Dépendances avec d'autres findings :** [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-017](#astra-p1-017), [ASTRA-P1-015](#astra-p1-015), [ASTRA-P2-013](#astra-p2-013), [ASTRA-P2-004](#astra-p2-004).

**Traçabilité de l'audit initial :** Audit initial §9 Observabilité, §11 et §17.

---

#### Performance

<a id="astra-p2-016"></a>

##### ASTRA-P2-016 — Journaux des trois workers réécrits à vide

**ID :** `ASTRA-P2-016`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Journaux des trois workers réécrits à vide

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Cadence et sauvegardes observées dans le code ; coût disque/CPU et maximum réel non mesurés. 20/s est une borne théorique approximative, pas un benchmark.

**Problème constaté :** Bonk, Soundboard et TTS sauvegardent leur journal dans la boucle de 150 ms même sans changement. Les écritures atomiques peuvent représenter jusqu'à environ 20 réécritures/s pour les trois workers selon la durée des ticks.

**Preuve précise :**

- [apps/studio/server/src/bonk-lab/runtime.ts:62](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/bonk-lab/runtime.ts:62>) — cadence du worker.
- [apps/studio/server/src/sound-lab/runtime.ts:36](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/sound-lab/runtime.ts:36>) — cadence du worker.
- [apps/studio/server/src/tts-lab/runtime.ts:46](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/runtime.ts:46>) — cadence du worker.
- [apps/studio/server/src/bonk-lab/worker.ts:294](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/bonk-lab/worker.ts:294>) — tick et sauvegarde.
- [apps/studio/server/src/sound-lab/worker.ts:365](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/sound-lab/worker.ts:365>) — tick et sauvegarde.
- [apps/studio/server/src/tts-lab/worker.ts:378](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/worker.ts:378>) — sauvegarde dans le tick.

**Cause racine :** La périodicité du worker déclenche la persistance sans distinguer état modifié et état inchangé.

**Risque concret :** IO inutile pendant les longues sessions, davantage de blocage sur stockage lent et coût multiplié par les nouveaux modules.

**Scénario de panne / impact utilisateur :** Un stream sans achats conserve les workers actifs ; les mêmes journaux sont réécrits en continu.

**Recommandation :** Persister sur changement avec mécanisme commun léger, en conservant absolument l'écriture durable avant remise d'un effet et les preuves de résultat/ACK.

**Portée probable de la correction :** Journalisation des trois workers, dirty state et flush/cleanup.

**Effort indicatif :** S–M.

**Tests à prévoir :**

- Worker à vide : aucune réécriture quand l'état est identique.
- Transition critique : journal écrit avant remise de l'effet.
- Crash à chaque frontière : preuves de reprise conservées ; mesure du nombre d'écritures.

**Dépendances avec d'autres findings :** [ASTRA-P1-016](#astra-p1-016), [ASTRA-P1-017](#astra-p1-017), [ASTRA-P2-017](#astra-p2-017).

**Traçabilité de l'audit initial :** Audit initial §13 Journaux et §19.

---

<a id="astra-p2-017"></a>

##### ASTRA-P2-017 — Claims des workers à cadence courte même sans travail

**ID :** `ASTRA-P2-017`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Claims des workers à cadence courte même sans travail

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Le polling à vide est statique ; coût DB/HTTP et latence acceptable À VÉRIFIER. Aucune saturation observée.

**Problème constaté :** Les boucles de 150 ms continuent à demander des claims quand les files sont vides. Le coût HTTP/transactions DB existe indépendamment de l'écriture de journal.

**Preuve précise :**

- [apps/studio/server/src/bonk-lab/runtime.ts:62](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/bonk-lab/runtime.ts:62>) — boucle périodique.
- [apps/studio/server/src/sound-lab/runtime.ts:36](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/sound-lab/runtime.ts:36>) — boucle périodique.
- [apps/studio/server/src/tts-lab/runtime.ts:46](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/runtime.ts:46>) — boucle périodique.
- [apps/studio/server/src/tts-lab/worker.ts:378](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/worker.ts:378>) — tick et claim Core.

**Cause racine :** Aucun ralentissement à vide proportionné à l'activité des files.

**Risque concret :** Charge permanente devenant disproportionnée avec davantage de modules ou un Core distant.

**Scénario de panne / impact utilisateur :** Dix nouveaux workers reprennent cette cadence ; le Core reçoit de nombreux claims vides et transactions sans interaction.

**Recommandation :** Backoff à vide, cadence courte en activité et reprise rapide sur signal pertinent. Ne pas rallonger aveuglément les leases/heartbeats nécessaires aux effets en cours.

**Portée probable de la correction :** Politique de polling des workers et compteurs d'activité.

**Effort indicatif :** M.

**Tests à prévoir :**

- Longue période vide : baisse mesurée des claims.
- Arrivée d'une interaction : latence acceptable selon objectif explicite.
- Lecteur actif/recovery : heartbeats et budgets conservés.

**Dépendances avec d'autres findings :** [ASTRA-P2-016](#astra-p2-016), [ASTRA-P2-019](#astra-p2-019), [ASTRA-P1-019](#astra-p1-019), [ASTRA-P1-005](#astra-p1-005).

**Traçabilité de l'audit initial :** Audit initial §13 Claims et §19.

---

<a id="astra-p2-018"></a>

##### ASTRA-P2-018 — Lecteur Soundboard pollant toutes les 120 ms

**ID :** `ASTRA-P2-018`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Lecteur Soundboard pollant toutes les 120 ms

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Cadence déduite du code ; coût visible et nécessité d'optimisation À VÉRIFIER, principalement dans le contexte local.

**Problème constaté :** Le lecteur prêt interroge sa commande toutes les 120 ms, soit environ huit requêtes/s par lecteur, même lorsqu'aucun son n'attend.

**Preuve précise :**

- [apps/studio/server/sound-player/player.js:224](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/sound-player/player.js:224>) — fin de boucle de polling : await sleep(120).

**Cause racine :** La même cadence sert à l'attente à vide et à la réactivité du lecteur.

**Risque concret :** Charge locale inutile, plus visible avec plusieurs lecteurs ou erreurs répétées.

**Scénario de panne / impact utilisateur :** Plusieurs lecteurs restent prêts sans activité et multiplient les demandes de commande.

**Recommandation :** Mesurer puis adapter le polling à l'état idle/actif et aux erreurs, en conservant une réactivité appropriée aux arrêts. Ne pas imposer WebSocket pour ce seul point.

**Portée probable de la correction :** Lecteur Soundboard et objectifs de latence.

**Effort indicatif :** S.

**Tests à prévoir :**

- Nombre de requêtes en attente à vide avec un et plusieurs lecteurs.
- Latence de démarrage et de stop sous la cadence retenue.
- Retour de visibilité/reconnexion : aucune boucle dupliquée.

**Dépendances avec d'autres findings :** [ASTRA-P2-017](#astra-p2-017), [ASTRA-P1-017](#astra-p1-017).

**Traçabilité de l'audit initial :** Audit initial §13 Lecteur Soundboard.

---

<a id="astra-p2-019"></a>

##### ASTRA-P2-019 — Planificateur Tombola inspectant l'état quatre fois par seconde

**ID :** `ASTRA-P2-019`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Planificateur Tombola inspectant l'état quatre fois par seconde

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER** ; **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Quatre ticks/s sont déduits des constantes ; coût DB réel non mesuré, À VÉRIFIER.

**Réserve — À REVALIDER SUR CODE ACTUEL :** Le service Tombola et local-server.ts ont changé après l'audit ; boucle et accès actuels à revalider.

**Problème constaté :** Le tick Core Tombola est appelé toutes les 250 ms : recherches de canaux répétées puis transactions pour les canaux actifs. La garde empêchant la superposition existe et doit être conservée.

**Preuve précise :**

- [apps/core-api/src/bonk-lab/local-server.ts:126](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:126>) — tick Tombola à 250 ms avec garde.
- [apps/core-api/src/raffle-lab/raffle-lab-service.ts:684](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/raffle-lab-service.ts:684>) — tick/avance des états et transactions des canaux actifs.

**Cause racine :** La recherche de transitions temporelles est réalisée à cadence fixe plutôt qu'en fonction de la prochaine échéance/activité.

**Risque concret :** Charge DB évitable et multiplication de schedulers similaires avec de nouveaux modules.

**Scénario de panne / impact utilisateur :** Chaque futur jeu copie un tick fréquent recherchant ses propres canaux et états, y compris sans échéance proche.

**Recommandation :** Mesurer les accès puis utiliser les échéances connues ou un ralentissement à vide. Maintenir l'autorité du temps Core, la persistance des transitions, la garde et l'anti-spoil.

**Portée probable de la correction :** Ordonnancement Tombola, sans réécriture de son moteur.

**Effort indicatif :** M.

**Tests à prévoir :**

- Aucune échéance : diminution des scans.
- Échéances simultanées et restart : transitions uniques et ponctuelles.
- Projection overlay/viewer : anti-spoil et temps Core conservés.

**Dépendances avec d'autres findings :** [ASTRA-P2-017](#astra-p2-017), [ASTRA-P2-005](#astra-p2-005).

**Traçabilité de l'audit initial :** Audit initial §13 Tombola Core et §16 moteur Tombola.

---

<a id="astra-p2-020"></a>

##### ASTRA-P2-020 — Cooldowns Soundboard random lus séquentiellement

**ID :** `ASTRA-P2-020`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Cooldowns Soundboard random lus séquentiellement

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Accès séquentiels établis ; volume configuré et coût perceptible À VÉRIFIER. Le cas par défaut sans cooldown ne démontre pas un problème de charge.

**Problème constaté :** La sélection random vérifie successivement les cooldowns des candidats. Les sons avec cooldown nul ont un chemin rapide ; le coût concerne surtout de nombreux cooldowns non nuls.

**Preuve précise :**

- [apps/core-api/src/sound-lab/sound-lab-service.ts:520](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/sound-lab/sound-lab-service.ts:520>) — sélection random et boucle des candidats.
- [apps/core-api/src/sound-lab/sound-lab-service.ts:624](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/sound-lab/sound-lab-service.ts:624>) — cooldownRemaining(), lecture de l'état cooldown.

**Cause racine :** Une vérification DB par candidat au lieu d'une lecture groupée du même contexte.

**Risque concret :** Latence et occupation du verrou de canal augmentant avec le nombre de sons admissibles.

**Scénario de panne / impact utilisateur :** Catalogue important, cooldowns configurés et demandes random fréquentes : plusieurs requêtes sont exécutées sous le verrou.

**Recommandation :** Grouper les lectures nécessaires et garder la sélection/écriture dans la même protection concurrente. Ne pas ajouter d'index sans accès justifiant son utilité.

**Portée probable de la correction :** Lecture des cooldowns et sélection random Soundboard.

**Effort indicatif :** S–M.

**Tests à prévoir :**

- Cooldowns nuls et non nuls : sélection et refus identiques.
- Candidats en cooldown : jamais sélectionnés.
- Demandes concurrentes : limites respectées ; comparaison du nombre de requêtes.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018).

**Traçabilité de l'audit initial :** Audit initial §13 Soundboard random.

---

<a id="astra-p2-021"></a>

##### ASTRA-P2-021 — Quotas Commands calculés sur un historique croissant

**ID :** `ASTRA-P2-021`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Quotas Commands calculés sur un historique croissant

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER** ; **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Agrégats sur historique constatés ; dégradation réelle et besoin de compteur À VÉRIFIER, aucun benchmark exécuté.

**Réserve — À REVALIDER SUR CODE ACTUEL :** admission.ts et ses tests ont évolué après l'audit ; requêtes et garanties actuelles à revalider.

**Problème constaté :** L'admission calcule des agrégats sur l'historique accepté d'une commande sous les protections concurrentes. Le volume consulté peut croître sur plusieurs mois malgré les indexes existants.

**Preuve précise :**

- [apps/core-api/src/commands/admission.ts:470](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/admission.ts:470>) — usage/agrégats de quotas.
- [supabase/migrations/20261012120000_commands_v2_invocations.sql:43](<C:/Users/Antoni/Documents/Raptoru 2.0/supabase/migrations/20261012120000_commands_v2_invocations.sql:43>) — indexes de l'historique des invocations Commands.

**Cause racine :** La lecture de quota repose sur un historique conservé plutôt que sur une fenêtre/counter strictement adapté à chaque règle.

**Risque concret :** Coût d'admission et durée des verrous croissant avec les commandes très utilisées.

**Scénario de panne / impact utilisateur :** Une commande populaire possède plusieurs mois d'invocations ; les agrégats ralentissent les nouvelles admissions.

**Recommandation :** Mesurer les requêtes réelles, borner les lectures quand la sémantique le permet, ou introduire des compteurs prouvés corrects sous concurrence. Préserver les quotas et les indexes existants.

**Portée probable de la correction :** Lecture d'usage Commands et éventuelle projection de quota, uniquement après mesure.

**Effort indicatif :** M.

**Tests à prévoir :**

- Historique volumineux : plan et latence mesurés.
- Même règle de quota avant/après optimisation, y compris fenêtres/stream.
- Admissions concurrentes sur plusieurs connexions : aucun dépassement.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-029](#astra-p2-029).

**Traçabilité de l'audit initial :** Audit initial §13 Quotas Commands.

---

<a id="astra-p2-022"></a>

##### ASTRA-P2-022 — Redactor relisant plusieurs fichiers synchroniquement par ligne

**ID :** `ASTRA-P2-022`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Redactor relisant plusieurs fichiers synchroniquement par ligne

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Lectures synchrones observées ; impact visible sur l'event loop À VÉRIFIER par mesure.

**Problème constaté :** collectSecrets() relit deux fichiers .env et deux JSON de tokens à chaque redaction. Plusieurs chemins peuvent nettoyer la même ligne plusieurs fois.

**Preuve précise :**

- [apps/studio/server/src/test-lab/test-lab.ts:39](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/test-lab.ts:39>) — redactor().
- [apps/studio/server/src/test-lab/test-lab.ts:151](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/test-lab.ts:151>) — traitement des lignes de logs.
- [apps/studio/server/src/test-lab/local-env.ts:107](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/local-env.ts:107>) — collectSecrets(), lectures synchrones des sources de secrets.

**Cause racine :** Fraîcheur des secrets obtenue par relecture synchrone systématique plutôt que cache invalidable.

**Risque concret :** Bursts de logs/reconnexions bloquant la boucle Node, alors que le diagnostic doit rester réactif.

**Scénario de panne / impact utilisateur :** Un processus émet beaucoup d'erreurs ; le serveur relit plusieurs fichiers pour chaque ligne et retarde d'autres requêtes.

**Recommandation :** Cache invalidé par changement de fichiers/tokens, avec traitement explicite des secrets récemment renouvelés. Éviter une optimisation qui dégraderait la redaction.

**Portée probable de la correction :** Collecte des secrets, redactor et pipeline de logs.

**Effort indicatif :** S.

**Tests à prévoir :**

- Burst de logs : lectures de fichiers et latence mesurées.
- Token renouvelé : aucune fuite pendant/après invalidation.
- Fichier manquant/illisible : comportement sûr et diagnostic borné.

**Dépendances avec d'autres findings :** [ASTRA-P2-014](#astra-p2-014).

**Traçabilité de l'audit initial :** Audit initial §6 P2-06 et §13 Redaction logs.

---

<a id="astra-p2-023"></a>

##### ASTRA-P2-023 — Fichier courant de logs Electron non borné pendant la session

**ID :** `ASTRA-P2-023`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Fichier courant de logs Electron non borné pendant la session

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Absence de limite continue dans le chemin inspecté ; croissance réelle et volume actuel À VÉRIFIER.

**Problème constaté :** serverLog() fait une rotation au début de la session, puis append le fichier courant sans budget de taille continu. Les buffers mémoire Studio sont bornés et ne sont pas concernés par cette critique.

**Preuve précise :**

- [apps/studio/desktop/src/main.ts:84](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:84>) — serverLog(), rotation initiale puis append.
- [apps/studio/server/src/test-lab/log-buffer.ts:26](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/log-buffer.ts:26>) — buffer mémoire borné, contre-exemple à une généralisation des logs non bornés.

**Cause racine :** La rétention est gérée à l'ouverture de session, pas à mesure que le fichier actif croît.

**Risque concret :** Croissance disque et diagnostics lourds durant une longue session ou une boucle d'erreurs.

**Scénario de panne / impact utilisateur :** Studio reste ouvert plusieurs jours avec erreurs répétées ; le fichier actif grossit sans rotation.

**Recommandation :** Borner la taille pendant la session et le nombre/taille des fichiers conservés, avec diagnostic de rotation. Préserver les dernières erreurs utiles.

**Portée probable de la correction :** Logs Desktop persistés, sans refonte de tous les historiques.

**Effort indicatif :** S.

**Tests à prévoir :**

- Dépasser le budget de fixture : rotation et rétention correctes.
- Plusieurs append/rotation : logs lisibles et erreurs récentes conservées.
- Disque indisponible : logging ne provoque pas une boucle de crash.

**Dépendances avec d'autres findings :** [ASTRA-P2-013](#astra-p2-013), [ASTRA-P2-014](#astra-p2-014).

**Traçabilité de l'audit initial :** Audit initial §13 Logs Electron.

---

<a id="astra-p2-024"></a>

##### ASTRA-P2-024 — Outbox Loyalty croissante et réécrite intégralement

**ID :** `ASTRA-P2-024`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Outbox Loyalty croissante et réécrite intégralement

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Croissance potentielle et réécriture constatées ; volume effectif et seuils d'alerte À VÉRIFIER.

**Problème constaté :** Les événements pending sont conservés jusqu'à résolution et le fichier JSON est réécrit synchroniquement au changement. La rétention bornée des événements rejetés ne borne pas le backlog pending.

**Preuve précise :**

- [apps/twitch-bot/src/loyalty-outbox.ts:40](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/loyalty-outbox.ts:40>) — createOutbox(), cycle des événements pending.
- [apps/twitch-bot/src/loyalty-outbox.ts:84](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/loyalty-outbox.ts:84>) — fileOutbox(), lecture/écriture JSON durable.

**Cause racine :** Un stockage fichier simple conserve tout le backlog économique dans une seule représentation réécrite.

**Risque concret :** Croissance mémoire/disque et coût de sauvegarde pendant une longue panne Core avec événements entrants.

**Scénario de panne / impact utilisateur :** Core reste inaccessible tandis que Twitch envoie des événements de fidélité ; chaque modification persiste une outbox de plus en plus grande.

**Recommandation :** Exposer taille/âge du backlog, alerter, puis adapter batching/persistence selon mesure sans perdre les événements économiques. Ne pas jeter des pending pour borner arbitrairement le fichier.

**Portée probable de la correction :** Outbox Bot, diagnostics et stratégie de stockage durable.

**Effort indicatif :** M.

**Tests à prévoir :**

- Panne prolongée avec événements : comptage, âge et alerte fiables.
- Crash lors de sauvegarde/reprise : aucun événement perdu ou crédit doublé.
- Backlog important : coût d'IO mesuré ; rejeu idempotent après retour Core.

**Dépendances avec d'autres findings :** [ASTRA-P2-022](#astra-p2-022), [ASTRA-P1-005](#astra-p1-005).

**Traçabilité de l'audit initial :** Audit initial §13 Outbox Loyalty et améliorations rentables.

**Décision préalable :** Toute expiration, suppression ou perte assumée d'événements économiques nécessite une politique explicite ; ne pas purger automatiquement.

---

<a id="astra-p2-025"></a>

##### ASTRA-P2-025 — Polling viewer pouvant multiplier les lectures à grande audience

**ID :** `ASTRA-P2-025`

**Sévérité :** P2

**Domaine :** Performance

**Titre court :** Polling viewer pouvant multiplier les lectures à grande audience

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER** ; **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Fréquences statiques ; audience, charge et pertinence d'un changement de transport À VÉRIFIER. Aucun test de charge exécuté.

**Réserve — À REVALIDER SUR CODE ACTUEL :** UI, API et phase F Extension ont évolué ; projections et pollings actuels à revalider.

**Problème constaté :** Le host poll toutes les 5/15 secondes, TTS toutes les deux secondes et une Tombola active toutes les secondes. Visibilité et protections de refresh existent ; le coût futur dépend du nombre de surfaces réellement actives.

**Preuve précise :**

- [apps/twitch-extension/extension/overlay.js:28](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/overlay.js:28>) — cadence du host.
- [apps/twitch-extension/extension/mobile.js:9](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/mobile.js:9>) — cadence de surface.
- [apps/twitch-extension/extension/shared/tts-v2.js:23](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/tts-v2.js:23>) — polling TTS.
- [apps/twitch-extension/extension/shared/tombola-v2.js:16](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/tombola-v2.js:16>) — cadence Tombola.

**Cause racine :** Chaque viewer/surface relit des états métier sans mutualisation publique ou push démontré pour la future topologie.

**Risque concret :** Charge multipliée par l'audience même si les états changent peu.

**Scénario de panne / impact utilisateur :** Projection : 1 000 viewers consultant une Tombola active produisent environ 1 000 lectures/s de ce module, plus celles du host. Ce n'est pas un trafic mesuré.

**Recommandation :** Mesurer l'audience active et les requêtes, définir états publics cachables ou push ciblé si nécessaire. Conserver les gardes de visibilité et les permissions des projections privées.

**Portée probable de la correction :** Projection publique Core/EBS, cache éventuel et lifecycle de polling Extension.

**Effort indicatif :** M, selon besoin réel.

**Tests à prévoir :**

- Charge représentative mesurée et budget explicite.
- Surface cachée/reload/navigation : timers correctement suspendus et nettoyés.
- Cache/push public : aucune donnée privée, fraîcheur et anti-spoil respectés.

**Dépendances avec d'autres findings :** [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-019](#astra-p1-019), [ASTRA-P2-004](#astra-p2-004).

**Traçabilité de l'audit initial :** Audit initial §9 Communication, §13 Charge viewer future et §19.

**Décision préalable :** Choisir une stratégie selon les besoins d'audience/réactivité ; ne pas déployer un bus Realtime global pour cette projection seule.

---

#### Restart/replay

<a id="astra-p2-026"></a>

##### ASTRA-P2-026 — Adoption PID basée principalement sur le nom d'exécutable

**ID :** `ASTRA-P2-026`

**Sévérité :** P2

**Domaine :** Restart/replay

**Titre court :** Adoption PID basée principalement sur le nom d'exécutable

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `0e235fb`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `bf30427` : `PidStore` (`apps/studio/server/src/test-lab/managed-process.ts`) ne gardait qu'un PID ; `adoptPrevious()` et l'arrêt d'un processus adopté se fondaient sur `isNodeProcess()` (processus vivant dont l'image est `node.exe` ou l'exécutable Studio) : un PID réutilisé par un autre programme Node aurait été adopté, puis tué. Correction minimale, sans nouveau superviseur : l'identité du processus est enregistrée au lancement (`{ pid, entry, started_at }`, `entry` = script lancé) ; adoption et arrêt d'un adopté exigent que le processus vivant porte cette entrée dans sa ligne de commande et ait été créé à ±10 s de l'heure enregistrée (Windows : `Get-CimInstance Win32_Process` ; ailleurs : `ps`), contrôle refait juste avant le kill ; doute → pas d'ownership, enregistrement effacé. Compatibilité : un enregistrement d'une version précédente (PID nu) garde l'ancienne règle, pour qu'une mise à jour de Studio n'abandonne pas ses enfants. Packaging Windows : les enfants tournent sous l'exécutable Studio (ELECTRON_RUN_AS_NODE) avec les mêmes arguments, l'entrée figure dans la ligne de commande. Dette : les enregistrements « PID nu » existants restent sous l'ancienne règle jusqu'au prochain lancement de chaque service (alors réécrits avec identité).

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Critère de nom constaté ; réutilisation PID et adoption/kill effectifs non observés. Risque local conditionnel, pas incident démontré.

**Problème constaté :** PidStore conserve un PID. isNodeProcess() vérifie surtout node.exe ou le nom de l'exécutable packagé ; cette vérification ne démontre pas qu'il s'agit de l'ancien processus appartenant à Studio.

**Preuve précise :**

- [apps/studio/server/src/test-lab/managed-process.ts:15](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/managed-process.ts:15>) — PidStore().
- [apps/studio/server/src/test-lab/managed-process.ts:51](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/managed-process.ts:51>) — isNodeProcess().
- [apps/studio/server/src/test-lab/managed-process.ts:129](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/managed-process.ts:129>) — adoptPrevious() et vérification du PID.

**Cause racine :** Identité/ownership d'un processus réduits à un identifiant réutilisable et un nom partagé.

**Risque concret :** Adoption ou terminaison d'un autre processus Node local si le PID a été réutilisé.

**Scénario de panne / impact utilisateur :** Le processus précédent est mort ; son PID est attribué à un autre Node avant la reprise de Studio.

**Recommandation :** Persister puis vérifier chemin d'exécutable, entrée, heure de création et session avant adoption/arrêt ; en cas de doute, refuser l'ownership et diagnostiquer.

**Portée probable de la correction :** ManagedProcess et métadonnées de PID ; essentiel avant de généraliser l'adoption labchat.

**Effort indicatif :** M.

**Tests à prévoir :**

- PID disparu et PID réutilisé par un exécuteur de fixture : aucune adoption/terminaison étrangère.
- Ancien processus authentifié par ses métadonnées : reprise correcte.
- Informations d'identité inaccessibles : refus sûr et visible.

**Dépendances avec d'autres findings :** [ASTRA-P1-013](#astra-p1-013).

**Traçabilité de l'audit initial :** Audit initial §6 P2-13 et §12.

---

#### Sécurité

<a id="astra-p2-027"></a>

##### ASTRA-P2-027 — Frontière IPC Electron sans contrôle explicite de l'émetteur

**ID :** `ASTRA-P2-027`

**Sévérité :** P2

**Domaine :** Sécurité

**Titre court :** Frontière IPC Electron sans contrôle explicite de l'émetteur

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `6df7cf6`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `f31bc42` : les handlers IPC privilégiés (`studio:server:restart`, `studio:app:relaunch`, `studio:update:check/download/install`, états) ne vérifiaient pas l'émetteur, et aucune politique ne retenait la fenêtre sur Studio : ni `will-navigate`, ni `setWindowOpenHandler` (une fenêtre ouverte par `window.open` hérite par défaut des `webPreferences` du parent, preload compris). Une page étrangère atteinte par navigation aurait donc disposé du pont `raptoruStudio`. Correction (`apps/studio/desktop/src/ipc-guard.ts` + câblage `main.ts`/`updater.ts`) : chaque handler privilégié exige que l'émetteur soit la fenêtre principale ET que son cadre affiche l'origine Studio ou la page d'état locale (`file://…/static/status.html`), sinon refus `untrusted_sender` journalisé ; la fenêtre ne peut plus naviguer ailleurs (lien web → navigateur système) ; `window.open`/`target=_blank` : origine Studio → fenêtre de l'app (fenêtres pop-out existantes conservées, sans droit IPC puisque non principales), web → navigateur système, autre schéma refusé. Inchangés : sandbox, contextIsolation, nodeIntegration off, surface du pont.

**Validation manuelle (Antoni, 2026-10-05) :** OK — page d'état « Réessayer » / « Redémarrer » et pages ouvertes seules fonctionnent. Bouton « Mise à jour » : désactivé en mode développement (comme l'indique l'UI), non testable hors application packagée — à vérifier sur la prochaine version packagée. Ouverture d'un overlay dédié : non applicable (la Tombola actuelle n'offre qu'une preview intégrée et l'URL OBS, aucun bouton d'ouverture).

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Absence de garde explicite constatée ; aucun parcours d'exploitation distant démontré. CSP, sandbox et contenu local réduisent le risque.

**Problème constaté :** Les handlers IPC restart/update ne vérifient pas explicitement l'origine/frame émettrice. L'audit n'a pas identifié une allowlist complète des navigations/nouvelles fenêtres du shell.

**Preuve précise :**

- [apps/studio/desktop/src/main.ts:264](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:264>) — handlers IPC privilégiés.
- [apps/studio/desktop/src/main.ts:283](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:283>) — création de fenêtre et protections Electron.
- [apps/studio/desktop/src/preload.cts:14](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/preload.cts:14>) — bridge vers les actions Desktop.

**Cause racine :** Le contenu local attendu et les protections du renderer sont utilisés comme garantie implicite de l'émetteur privilégié.

**Risque concret :** Si un contenu inattendu accède à cette frontière, il pourrait tenter des actions privilégiées du shell.

**Scénario de panne / impact utilisateur :** Une navigation/frame non prévue utilise le bridge restart/update ; l'IPC ne rejette pas explicitement son origine.

**Recommandation :** Vérifier origine/frame et encadrer navigations/nouvelles fenêtres selon une politique explicite, tout en gardant sandbox, CSP, contextIsolation et bridge limité.

**Portée probable de la correction :** Handlers IPC et navigation du shell Desktop.

**Effort indicatif :** S.

**Tests à prévoir :**

- Frame/origine autorisée : actions légitimes conservées.
- Émetteur inattendu : IPC refusé.
- Navigation/nouvelle fenêtre non prévue : traitement conforme à l'allowlist.

**Dépendances avec d'autres findings :** [ASTRA-P2-014](#astra-p2-014), [ASTRA-P1-006](#astra-p1-006).

**Traçabilité de l'audit initial :** Audit initial §12 Electron : P2/S.

---

#### Studio

<a id="astra-p2-028"></a>

##### ASTRA-P2-028 — Lecteurs sans garde de fin après démarrage

**ID :** `ASTRA-P2-028`

**Sévérité :** P2

**Domaine :** Studio

**Titre court :** Lecteurs sans garde de fin après démarrage

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `dcec32a`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `07e8507` : confirmé. Lecteur TTS (`apps/studio/server/tts-player/player.js`) : le délai de démarrage est effacé au start, puis `speak()` attend `onend`/`onerror` sans limite ; un moteur vocal muet laisse `current` occupé et la page n'accepte plus aucun TTS (`accept = !current`) : file bloquée côté lecteur, alors que Core (bail de lecture = durée estimée × 2 + 30 s) et le worker passent déjà la lecture en `execution_unknown`. Lecteur Soundboard : après `playing`, attente illimitée de `ended` (sons superposés, file non bloquée, mais élément audio et mixage retenus). Correction minimale côté lecteurs, protocole P1-017 intact : garde de fin calée sur le bail Core (TTS : durée estimée × 2 + 30 s, règles Core par défaut ; Soundboard : durée + 15 s, `executingMarginMs`) ; au-delà, coupe, abandon des callbacks tardifs (session), libération, **sans ACK**. Distinction : fin certaine → `completed` ; stop confirmé → `stopped` (P1-017) ; échec avant lecture → `failed` (inchangé) ; démarré sans fin → aucun ACK, Core conclut `execution_unknown` à l'expiration du bail (jamais rejoué, pas de remboursement certain). Aucun double ACK/rejeu : une fin tardive est ignorée. Dette : si les règles TTS de Core sont modifiées (facteur/marge), la garde du lecteur reste aux valeurs par défaut.

**Validation manuelle (Antoni, 2026-10-05) :** OK — TTS disponible au démarrage, TTS normal lu en entier, STOP TTS coupe correctement puis un second TTS repart normalement ; Soundboard normal et STOP Soundboard fonctionnent.

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Absence de garde post-start observée ; blocage réel du moteur et fréquence non reproduits, À VÉRIFIER.

**Problème constaté :** TTS attend onend/onerror et supprime son timeout de démarrage quand la narration commence. Soundboard attend également la fin audio après playing, sans durée maximale post-start comparable.

**Preuve précise :**

- [apps/studio/server/tts-player/player.js:215](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/tts-player/player.js:215>) — speak()/play(), attente des callbacks.
- [apps/studio/server/tts-player/player.js:293](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/tts-player/player.js:293>) — timeout de démarrage supprimé au start.
- [apps/studio/server/sound-player/player.js:121](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/sound-player/player.js:121>) — play(), distinction démarrage/fin.

**Cause racine :** Le watchdog ne couvre pas le cas où le moteur démarre puis ne produit plus d'événement terminal.

**Risque concret :** Lecteur restant occupé alors que les heartbeats continuent, file qui ne progresse plus.

**Scénario de panne / impact utilisateur :** Le moteur navigateur ne livre ni fin ni erreur après start ; Studio le voit encore vivant mais le contenu suivant ne peut pas jouer.

**Recommandation :** Garde de durée maximale cohérente avec le contenu, libération sûre et signalement d'un résultat ambigu. Une lecture peut-être entendue n'est pas automatiquement un remboursement certain.

**Portée probable de la correction :** Lifecycle lecteurs TTS/Soundboard, diagnostics et résultat vers worker/Core.

**Effort indicatif :** M.

**Tests à prévoir :**

- Start reçu puis aucun événement terminal : garde et état explicite.
- Contenu légitimement long : aucune interruption prématurée.
- Fin tardive/stop concurrent : un résultat cohérent, aucun replay ni double refund.

**Dépendances avec d'autres findings :** [ASTRA-P1-017](#astra-p1-017), [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-015](#astra-p2-015).

**Traçabilité de l'audit initial :** Audit initial §6 P2-12.

---

#### Tests

<a id="astra-p2-029"></a>

##### ASTRA-P2-029 — Deux suites PostgreSQL détruisant le même schéma en parallèle

**ID :** `ASTRA-P2-029`

**Sévérité :** P2

**Domaine :** Tests

**Titre court :** Deux suites PostgreSQL détruisant le même schéma en parallèle

**Statut initial :** **OUVERT**

**Statut actuel :** **FERMÉ — corrigé** — commit `cc3994d`

**Résolution (passe P1, 2026-10-04) :** Revalidé sur `ca95a66` : confirmé et reproduit. `postgres.integration.test.ts` et `commands-v2.integration.test.ts` font tous deux `drop schema public cascade` sur `TEST_DATABASE_URL`, et Vitest exécute les fichiers en parallèle (`test:integration`, ou `npm test` avec la variable). Sur une base jetable locale (`raptoru_p2029_test`, créée puis supprimée), lancées ensemble : 3 échecs sur 3 de `commands-v2.integration` ; chacune seule : verte. Correction minimale sans réécrire le harnais : chaque suite destructive prend un verrou consultatif PostgreSQL (`test/pg-exclusive.ts`, propre à la base) sur sa propre connexion avant l'effacement et le garde jusqu'à sa fin ; la concurrence multi-connexions interne aux suites (la vraie preuve) est conservée ; des suites sur des bases différentes restent parallèles.

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Les deux fichiers d'intégration utilisent TEST_DATABASE_URL et réinitialisent public par DROP SCHEMA. Le script lance les deux fichiers sans désactiver leur parallélisme, actif par défaut dans le runtime Vitest inspecté.

**Preuve précise :**

- [apps/core-api/test/postgres.integration.test.ts:29](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/test/postgres.integration.test.ts:29>) — drop schema public cascade; create schema public.
- [apps/core-api/test/commands-v2.integration.test.ts:23](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/test/commands-v2.integration.test.ts:23>) — même reset sur la même URL.
- [apps/core-api/package.json:14](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/package.json:14>) — script d'intégration des deux fichiers.
- [apps/core-api/vitest.config.ts:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/vitest.config.ts:1>) — pas de désactivation identifiée du parallélisme des fichiers.

**Cause racine :** L'isolation de base se fait par suite, mais la configuration permet à plusieurs suites de partager la ressource destructive.

**Risque concret :** Échecs non déterministes ou invalidation des preuves de concurrence lorsque l'autre suite détruit les tables.

**Scénario de panne / impact utilisateur :** Une suite commence ses opérations multi-connexions pendant que l'autre réinitialise public.

**Recommandation :** Sérialiser les fichiers ou attribuer une base/schéma isolé par suite. Conserver la concurrence interne multi-connexions qui apporte la vraie preuve.

**Portée probable de la correction :** Harnais et configuration d'intégration, aucune réduction des tests métier.

**Effort indicatif :** S.

**Tests à prévoir :**

- Les deux suites via le script officiel sur bases de test dédiées : aucune collision.
- Répétabilité après un échec et cleanup sûr.
- Courses internes Wallet/Commands toujours exercées sur plusieurs connexions.

**Dépendances avec d'autres findings :** [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-007](#astra-p2-007).

**Traçabilité de l'audit initial :** Audit initial §6 P2-04, §11 Harnais PostgreSQL et §15.

---

### P3

#### Build

<a id="astra-p3-001"></a>

##### ASTRA-P3-001 — Provenance des binaires à enrichir pour une diffusion large

**ID :** `ASTRA-P3-001`

**Sévérité :** P3

**Domaine :** Build

**Titre court :** Provenance des binaires à enrichir pour une diffusion large

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Signature/provenance réelle des installations et releases non inspectées. Il ne s'agit pas d'un constat de binaire non signé.

**Problème constaté :** Les contrôles release vérifient fichiers, versions, hashes et blockmap. L'état réel de signature/provenance des binaires distribués n'a pas été vérifié ; la configuration source ne suffit pas à le conclure.

**Preuve précise :**

- [apps/studio/desktop/electron-builder.json:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/electron-builder.json:1>) — configuration du build Windows ; absence d'indication seule ne prouve pas un binaire non signé.
- [apps/studio/desktop/scripts/release.mjs:320](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/scripts/release.mjs:320>) — contrôles de version, empreintes et artefacts existants.

**Cause racine :** La provenance destinée à une diffusion plus large n'a pas encore été évaluée dans le périmètre statique local.

**Risque concret :** Difficulté future à vérifier l'origine d'un installateur ou confiance réduite lors d'une diffusion publique.

**Scénario de panne / impact utilisateur :** Un utilisateur reçoit un binaire hors du circuit habituel et ne peut pas le rattacher aisément à une version/source approuvée.

**Recommandation :** Évaluer provenance et signature lors de la décision de distribution, puis compléter les preuves utiles sans dégrader les protections release existantes.

**Portée probable de la correction :** Politique de distribution et métadonnées/build/signature si retenus.

**Effort indicatif :** À évaluer ; S–L selon décision.

**Tests à prévoir :**

- Vérifier les preuves du binaire réellement distribué et leur rattachement à la référence annoncée.
- Artefact altéré ou provenant d'une autre version : rejet par les contrôles retenus.

**Dépendances avec d'autres findings :** [ASTRA-P2-004](#astra-p2-004).

**Traçabilité de l'audit initial :** Audit initial §7 Provenance, §8 Release/update et §12.

**Décision préalable :** Choisir le périmètre de diffusion et les preuves attendues ; aucun achat de certificat ni changement de publication automatique.

---

#### Config

<a id="astra-p3-002"></a>

##### ASTRA-P3-002 — Nommage BonkLab utilisé pour un runtime transversal

**ID :** `ASTRA-P3-002`

**Sévérité :** P3

**Domaine :** Config

**Titre court :** Nommage BonkLab utilisé pour un runtime transversal

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Des noms BonkLab désignent maintenant le runtime partagé de Bonk, Soundboard, TTS, Tombola, Modération et Commands. Ce décalage complique la compréhension sans démontrer de défaut fonctionnel.

**Preuve précise :**

- [apps/studio/server/src/runtime/local-runtime.ts:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/runtime/local-runtime.ts:1>) — imports/types/noms historiques et configuration du Core Lab transversal.
- [apps/studio/server/src/index.ts:430](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:430>) — configuration du runtime sous noms hérités.
- [apps/core-api/src/bonk-lab/local-server.ts:24](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:24>) — bootstrap de plusieurs domaines sous bonk-lab.

**Cause racine :** Le premier slice Bonk a été étendu sans mise à jour progressive de son vocabulaire transversal.

**Risque concret :** Compréhension et recherche de responsabilité moins immédiates pour les nouveaux modules.

**Scénario de panne / impact utilisateur :** Un développeur cherche le lifecycle TTS ou Commands et le retrouve dans un fichier/appellation Bonk sans s'y attendre.

**Recommandation :** Clarifier progressivement les noms/documents lors des évolutions concernées. Préserver la compatibilité des variables/configurations historiques tant qu'elles sont utilisées.

**Portée probable de la correction :** Noms internes et documentation de runtime ; pas de renommage global imposé.

**Effort indicatif :** S, progressif.

**Tests à prévoir :**

- Si renommage adopté : ancienne configuration toujours supportée ou migration explicite.
- Packaging, lancement et status utilisent le même runtime sous le vocabulaire choisi.

**Dépendances avec d'autres findings :** [ASTRA-P1-008](#astra-p1-008), [ASTRA-P1-019](#astra-p1-019), [ASTRA-P2-009](#astra-p2-009).

**Traçabilité de l'audit initial :** Audit initial §7 Nommage et §19.

**Décision préalable :** Choisir le vocabulaire transversal avant de renommer des interfaces/configurations publiques ; dette sans panne justifiant une passe automatique.

---

<a id="astra-p3-003"></a>

##### ASTRA-P3-003 — Ports par défaut répétés dans plusieurs couches

**ID :** `ASTRA-P3-003`

**Sévérité :** P3

**Domaine :** Config

**Titre court :** Ports par défaut répétés dans plusieurs couches

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Plusieurs composants répètent des ports de serveur/runtime dans leur configuration ou diagnostic. L'audit ne démontre pas qu'une configuration locale actuelle est erronée.

**Preuve précise :**

- [apps/studio/desktop/src/main.ts:33](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:33>) — STUDIO_PORT par défaut.
- [apps/studio/server/src/index.ts:55](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:55>) — PORT du serveur, défaut 4100.
- [apps/studio/server/src/runtime/local-runtime.ts:27](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/runtime/local-runtime.ts:27>) — port Core Lab ; diagnostics du runtime.

**Cause racine :** Les ports et leur affichage ne proviennent pas tous d'une source de configuration effectivement partagée.

**Risque concret :** Maintenance et diagnostics moins cohérents lors d'un changement de port.

**Scénario de panne / impact utilisateur :** Une configuration utilise un port non standard et un diagnostic/lien conserve un défaut codé ailleurs.

**Recommandation :** Faire dériver les liens/statuts du port effectif et limiter les constantes dupliquées. Traiter au fil des changements, sans imposer une refonte de configuration.

**Portée probable de la correction :** Configuration locale, URLs et diagnostics Desktop/Server/runtime.

**Effort indicatif :** S.

**Tests à prévoir :**

- Ports non standard : lancement, liens et health cohérents.
- Source et version packagée : même résolution des paramètres.
- Conflit de port : message mentionnant la valeur réellement utilisée.

**Dépendances avec d'autres findings :** [ASTRA-P1-005](#astra-p1-005), [ASTRA-P2-004](#astra-p2-004).

**Traçabilité de l'audit initial :** Audit initial §7 Ports et §8 Electron/runtime.

---

#### État

<a id="astra-p3-004"></a>

##### ASTRA-P3-004 — Catégories Commands éditées sans version concurrente

**ID :** `ASTRA-P3-004`

**Sévérité :** P3

**Domaine :** État

**Titre court :** Catégories Commands éditées sans version concurrente

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Les catégories Commands ne possèdent pas la garde de version des commandes. Une édition concurrente peut appliquer la règle du dernier écrit gagnant. Impact limité avec un seul cockpit.

**Preuve précise :**

- [apps/core-api/src/commands/service.ts:302](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/service.ts:302>) — updateCategory(), écriture sans expected_version.
- [docs/COMMANDS_V2_STATUS.md:46](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/COMMANDS_V2_STATUS.md:46>) — dette des catégories sans version.

**Cause racine :** Le contrat d'édition des catégories est plus simple que celui des commandes versionnées.

**Risque concret :** Écrasement d'un changement si plusieurs surfaces deviennent éditrices.

**Scénario de panne / impact utilisateur :** Deux sessions/surfaces du streamer éditent la même catégorie ; la seconde enregistre un état ancien qui remplace la première modification. Cela ne suppose pas que les modérateurs puissent actuellement éditer les catégories.

**Recommandation :** Introduire une garde/version et une UX de conflit seulement lorsque le modèle d'édition concurrente le justifie ; garder la sémantique actuelle explicite jusque-là.

**Portée probable de la correction :** Contrat catégorie, persistence et interfaces d'édition.

**Effort indicatif :** S–M.

**Tests à prévoir :**

- Deux éditions concurrentes : conflit ou règle explicite selon décision.
- Rechargement après conflit : changements du premier auteur conservés.
- Édition séquentielle depuis un seul cockpit : parcours inchangé.

**Dépendances avec d'autres findings :** [ASTRA-P2-004](#astra-p2-004), [ASTRA-P3-005](#astra-p3-005).

**Traçabilité de l'audit initial :** Audit initial §7 Catégories Commands.

**Décision préalable :** Définir si les catégories auront plusieurs writers et quelle UX de conflit est souhaitée avant changement de contrat.

---

#### Observabilité

<a id="astra-p3-005"></a>

##### ASTRA-P3-005 — Catégories Commands sans historique propre

**ID :** `ASTRA-P3-005`

**Sévérité :** P3

**Domaine :** Observabilité

**Titre court :** Catégories Commands sans historique propre

**Statut initial :** **OUVERT**

**Marquages :** Constat établi par inspection statique à la référence auditée.

**Niveau de preuve :** Constat statique au HEAD audité ; scénario et impact déduits du code, sans reproduction dynamique.

**Problème constaté :** Création/édition de catégories ne possède pas un historique propre équivalent à celui des commandes. L'audit lié à des commandes affectées n'est pas la même preuve que l'historique de la catégorie.

**Preuve précise :**

- [apps/core-api/src/commands/service.ts:278](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/service.ts:278>) et :302 — createCategory()/updateCategory().
- [docs/COMMANDS_V2_STATUS.md:47](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/COMMANDS_V2_STATUS.md:47>) — dette d'historique des catégories.

**Cause racine :** La catégorie est traitée comme une configuration légère, sans cycle d'audit autonome.

**Risque concret :** Origine d'un changement de rangement/nom plus difficile à retrouver avec plusieurs éditeurs.

**Scénario de panne / impact utilisateur :** Une catégorie a changé ; le cockpit ne permet pas de retrouver son ancien état et l'auteur de l'édition.

**Recommandation :** Définir le besoin d'historique avant de l'ajouter. Enregistrer les changements futurs utiles, sans fabriquer des preuves rétroactives.

**Portée probable de la correction :** Audit catégories Core et éventuelle restitution Studio/Extension.

**Effort indicatif :** S–M.

**Tests à prévoir :**

- Changement futur : acteur, date et diff conformes à la granularité choisie.
- Ancien état sans historique : aucune fausse attribution.
- Permissions de lecture de l'historique conformes à celles des configurations.

**Dépendances avec d'autres findings :** [ASTRA-P3-004](#astra-p3-004), [ASTRA-P2-015](#astra-p2-015).

**Traçabilité de l'audit initial :** Audit initial §7 Catégories Commands et §19 historique avancé.

**Décision préalable :** Choisir la granularité et l'utilité produit de cet historique ; faible priorité avec un seul cockpit.

---

#### UX

<a id="astra-p3-006"></a>

##### ASTRA-P3-006 — Harmonisation visuelle entre modules à cadrer

**ID :** `ASTRA-P3-006`

**Sévérité :** P3

**Domaine :** UX

**Titre court :** Harmonisation visuelle entre modules à cadrer

**Statut initial :** **OUVERT**

**Marquages :** **À VÉRIFIER** ; **À REVALIDER SUR CODE ACTUEL**

**Niveau de preuve :** Le périmètre exact de ce qui reste non démontré figure dans la réserve ci-dessous. Aucun comportement n'a été vérifié dynamiquement.

**Réserve — À VÉRIFIER :** Aucun défaut visuel précis ni impact UX mesuré dans l'audit initial. Besoin réel À VÉRIFIER avant tout correctif.

**Réserve — À REVALIDER SUR CODE ACTUEL :** UI/CSS et phase F Extension ont évolué depuis le HEAD audité ; recommandations visuelles à revalider.

**Problème constaté :** L'audit suggérait une harmonisation des détails visuels entre modules, sans documenter une anomalie utilisateur précise. Ce point ne doit pas devenir une campagne cosmétique générale.

**Preuve précise :**

- [apps/twitch-extension/extension/shared/ui.js:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/ui.js:1>) — rendus et branches de plusieurs générations.
- [apps/twitch-extension/extension/base.css:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/base.css:1>) — styles partagés volumineux.
- [apps/studio/web/src/commands.ts:1](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/web/src/commands.ts:1>) — écran Studio spécifique ; diversité des surfaces à confronter aux références UX.

**Cause racine :** Évolutions successives et implémentations par module ; l'écart visuel concret reste à établir.

**Risque concret :** Coût d'apprentissage/incohérence éventuels, de faible priorité face aux garanties de livraison.

**Scénario de panne / impact utilisateur :** Un utilisateur retrouve une même intention présentée différemment selon module ; ce scénario doit être confirmé par revue UI, pas supposé.

**Recommandation :** Faire une revue UX ciblée avec les prototypes validés, identifier les écarts concrets et harmoniser uniquement les points approuvés.

**Portée probable de la correction :** Styles/composants et conventions d'écran, selon décision produit.

**Effort indicatif :** S–L après cadrage.

**Tests à prévoir :**

- Revue des surfaces Panel/Mobile/Vidéo et Studio sur les écarts retenus.
- Comparaison avec prototypes validés et absence de régression navigation/accessibilité.

**Dépendances avec d'autres findings :** [ASTRA-P1-008](#astra-p1-008), [ASTRA-P2-011](#astra-p2-011).

**Traçabilité de l'audit initial :** Audit initial §7 Harmonisation visuelle, §16 framework et §19.

**Décision préalable :** Décision UX/produit préalable avec respect des prototypes ; aucune refonte esthétique automatique.

---

## Analyses et nuances de l'audit initial

Les analyses ci-dessous conservent le contenu transversal de l'audit initial : points solides, verdicts par composant, cutover, tests, sécurité, performance, legacy, quick wins, éléments à conserver et trajectoire. **Toutes les affirmations « actuel », « désormais » ou « HEAD » de cette section décrivent la référence auditée `cac8d54`, pas une nouvelle validation de `b54ad46`.** Les marquages du registre priment pour toute correction. Les tests cités ont été lus, pas exécutés.

Les tailles, notes et ordres de grandeur ne sont pas actualisés artificiellement. Les tables de travail restant ne créent pas de nouveaux findings : elles explicitent le contexte produit/architecture des entrées du registre.

### Historique Git observé pendant l'audit initial

Les derniers commits montrent que le projet a avancé au-delà du checkpoint Tombola :

| Commit | Changement |
|---|---|
| `cac8d54` | Droit d’équipe `rename` |
| `f26a75d` | État Commands V2 : A0 à E terminées, F suivante |
| `36ae298` | Affichage et édition du nom d’une commande dans l’Extension |
| `3975535` | Commands V2, interface de modération Extension |
| `1a71099` | Reconnaissance du vrai broadcaster dans Commands |
| `e2bb54f` | Onglet Commandes Studio |
| `bbec48d` | Redémarrage de l’exécuteur chat lors de l’activation |
| `cc930bb` | Étapes Commands durables et sortie chat Twitch |

### Contradictions documentaires à la référence initiale

| Document | Affirmation | État réel |
|---|---|---|
| [HANDOFF](<C:/Users/Antoni/Documents/Raptoru 2.0/Raptoru-2.0-HANDOFF.md:3>) | HEAD fonctionnel `ed781f6`, checkpoint du 03/10 | HEAD actuel `cac8d54`, après plusieurs phases Commands |
| [État projet](<C:/Users/Antoni/Documents/Raptoru 2.0/Raptoru-2.0-ETAT-PROJET.md:3>) | Même checkpoint Tombola | Le résumé courant ne couvre pas Commands |
| [README](<C:/Users/Antoni/Documents/Raptoru 2.0/README.md:7>) | Seul Daily est implémenté ; autres apps placeholders | Très largement obsolète |
| [README, Lab EBS](<C:/Users/Antoni/Documents/Raptoru 2.0/README.md:144>) | Jetons fictifs en mémoire ; aucune écriture Twitch | Wallet Lab désormais persistant ; sortie chat réelle possible derrière un interrupteur |
| [Bonk Lab](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/bonk-lab.md:1>) | Slice en attente de validation OBS | Document historique qui ne représente plus l’ensemble du runtime actuel |
| [Parité Modération](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/moderation-v2-d4-parity.md:254>) | Lab sans signal de fin de stream | L’ingestion Twitch et les sessions Lab existent maintenant |
| [Parité Tombola](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/tombola-v2-parity.md:183>) | Ingestion jamais activée automatiquement | Le code redémarre l’ingestion si l’utilisateur l’a laissée activée |

Le dernier point demande une formulation précise : **OFF par défaut** et **restauration d’un choix ON précédemment enregistré** sont compatibles. « Jamais activé automatiquement » décrit mal ce comportement.

Le document [Commands V2 Status](<C:/Users/Antoni/Documents/Raptoru 2.0/docs/COMMANDS_V2_STATUS.md:7>) est le plus proche du HEAD actuel. Il indique correctement :

- A0 à E terminées selon les validations rapportées ;
- droit `rename` implémenté, validation manuelle encore indiquée comme restante ;
- phase F, liste publique viewer dans l’Extension, non commencée.

Les compteurs de tests du HANDOFF concernent un ancien HEAD. Ils ne constituent pas une validation du HEAD audité.

### Fondements à préserver

#### Le Wallet Core possède de vraies garanties économiques

Dans `WalletService`, une opération :

1. réserve une clé d’idempotence unique ;
2. compare un hash de la requête en cas de répétition ;
3. verrouille les wallets concernés dans un ordre stable ;
4. applique solde et ledger dans la même transaction ;
5. conserve le résultat initial pour les retries.

Cela protège notamment les transferts concurrents et les répétitions après perte de réponse. Un changement de payload sous la même clé est refusé.

Preuve : [WalletService, transaction économique](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/wallet/wallet-service.ts:311>).

Le ledger est également protégé contre les mises à jour et suppressions par un trigger PostgreSQL : [migration Wallet](<C:/Users/Antoni/Documents/Raptoru 2.0/supabase/migrations/20260926120000_wallet.sql:68>).

**C’est une base à conserver.**

#### Daily distingue décision persistante et paiement externe

La décision de claim est transactionnelle, avec verrouillage par viewer. Le traitement du crédit sait distinguer un fournisseur idempotent d’un fournisseur dont le résultat après crash serait ambigu.

La reprise ne suppose donc pas aveuglément qu’une écriture externe peut être rejouée.

Preuves : [DailyService.decideClaim](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/daily/daily-service.ts:146>), [DailyCredits.recoverInterrupted](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/daily/credits.ts:104>).

#### Presence évite de transformer les trous d’observation en présence rémunérée

Les leases et cycles sont protégés contre plusieurs workers concurrents. Les intervalles validés dépendent de snapshots complets et suffisamment récents.

Loyalty reçoit les intervalles validés dans la transaction Presence, puis traite les crédits après commit.

Preuves : [PresenceService](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/presence/presence-service.ts:81>), [LoyaltyEngine.presenceListener](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/loyalty/engine.ts:150>).

Le Bot refuse aussi de présenter un snapshot partiel de chatters comme une liste complète. Cette prudence a une conséquence métier utile : une page Helix manquante ne devient pas une absence supposée.

#### Les interactions Lab traitent explicitement l’exécution ambiguë

Bonk, Soundboard et TTS utilisent des tentatives, des leases et des ACK liés à l’exécuteur.

Le code différencie notamment :

- jamais remis au lecteur ;
- remis mais démarrage non prouvé ;
- démarré ;
- terminé ;
- résultat inconnu.

Le choix de ne pas rejouer automatiquement une interaction potentiellement déjà entendue ou affichée est pertinent.

Preuve : [TtsLabService.ack](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/tts-lab/tts-lab-service.ts:687>).

#### Les permissions ne reposent pas seulement sur les boutons

Modération V2 vérifie les permissions dans Core. Les sanctions sensibles, l’administration wallet et les changements de droits ont des règles distinctes.

Un modérateur ne peut pas modifier ses propres permissions ni distribuer des permissions qu’il ne possède pas.

Preuves : [access / allowed](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/lab-moderation/store.ts:124>), [édition des permissions](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/lab-moderation/service.ts:567>).

#### Tombola possède un modèle métier explicite

Les transitions sont définies, les manches et résultats sont persistants, et les paiements gagnants disposent de protections contre les répétitions.

`pay()` verrouille le gagnant, vérifie le statut et le mouvement existant avant d’appliquer le crédit. Une contrainte unique complète cette protection.

Preuves : [TRANSITIONS](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/raffle-lab-service.ts:93>), [pay](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/raffle-lab-service.ts:830>), [unicité des gains](<C:/Users/Antoni/Documents/Raptoru 2.0/supabase/migrations/20261008120000_raffle_v2.sql:43>).

Je n’ai pas trouvé de justification pour réécrire son moteur.

#### Commands sépare correctement décision et exécution Twitch

L’admission verrouille les données nécessaires aux quotas et crée les étapes durables dans la transaction.

L’exécuteur :

- confirme `running` ;
- journalise avant l’appel Helix ;
- conserve le résultat ;
- retente l’ACK ;
- classe un envoi ambigu `unknown`, sans le renvoyer.

Preuves : [CommandsAdmission](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/admission.ts:127>), [CommandSteps](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/steps.ts:291>), [LabChatOutput](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/lab-chat-output.ts:342>).

C’est une orchestration spécialisée qui reste compatible avec l’objectif de ne pas recréer SAMMI.

#### Electron et la release comportent des protections concrètes

Le shell utilise `sandbox`, `contextIsolation`, désactive `nodeIntegration`, impose une instance unique et possède une page de recovery indépendante du serveur Studio.

La supervision limite les redémarrages. L’updater ne télécharge ni n’installe automatiquement et arrête le serveur avant installation explicite.

Le packaging utilise une liste explicite de fichiers, et la release vérifie notamment versions, empreintes, blockmap, feed et présence de secrets locaux dans les fichiers textuels packagés.

Preuves : [Electron main](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:42>), [updater](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/updater.ts:31>), [stage](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/scripts/stage.mjs:29>), [contrôles release](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/scripts/release.mjs:320>).

Ces protections ont été inspectées, pas exécutées pendant cet audit.

### Architecture par composant

#### Core

**Verdict : sain, avec un bon socle transactionnel.**

Le découpage Daily, Presence, Wallet, Loyalty, Commands et interactions est compréhensible. Le SQL dans les services reste acceptable : un repository supplémentaire par table n’apporterait pas nécessairement de valeur.

Les principales faiblesses sont :

- des services Lab fortement liés à une économie spécifique ;
- plusieurs variantes du modèle admission/delivery/ACK ;
- des fichiers métier volumineux ;
- des réponses API peu validées chez certains consommateurs ;
- la readiness et les délais DB.

`RaffleLabService` atteint 2 545 lignes, mais rassemble un domaine réellement complexe. Une extraction ciblée de présentation, paiements ou scheduler peut devenir utile ; sa taille ne justifie pas une réécriture.

#### Studio

**Verdict : cockpit crédible, orchestration locale encore inégalement consolidée.**

Le serveur assume correctement les effets locaux, proxies, fichiers audio, lecteurs et OBS. Les routes de configuration transmettent généralement les décisions à Core.

L’accès PostgreSQL de Studio sert notamment à préparer le runtime local et les migrations. **Je n’ai pas identifié de seconde économie métier persistante maintenue directement par Studio.**

La vraie zone ambiguë est `LabEbs` : elle combine compatibilité frontend, projections Core, fixtures et simulation historique. Ces responsabilités doivent devenir explicites au fur et à mesure du raccordement.

Studio Web gagnera surtout à utiliser une convention commune pour les écrans, états d’erreur, chargements et nettoyage. Un registre de modules léger suffirait ; un moteur générique de panneaux serait prématuré.

#### Twitch Bot

**Verdict : il reste majoritairement un adaptateur fin.**

Il normalise les événements Twitch, gère les tokens, récupère les données Helix, transmet au Core et exécute les messages décidés par Core.

Les calculs économiques importants restent dans Core. La résolution de badges ou la classification d’une erreur Helix relèvent légitimement de l’adaptateur.

Le problème principal est l’écart de robustesse entre :

- forwarding Loyalty durable ;
- réconciliation du stream du chemin principal ;
- ingestion Lab plus simple ;
- exécution chat durable.

La reconnexion EventSub possède un watchdog et une déduplication bornée. La révocation d’une subscription est principalement journalisée : le diagnostic doit pouvoir distinguer socket connecté et abonnements effectivement utilisables.

#### Twitch Extension

**Verdict : fonctionnelle et riche, mais composant le plus endetté structurellement.**

Les bonnes décisions visibles comprennent :

- partage des écrans entre surfaces ;
- reprise au retour de visibilité ;
- protections contre les refresh simultanés ;
- conservation de certains composants au lieu de reconstruire leur DOM à chaque poll ;
- erreurs et refus provenant du Core sur les modules V2.

La dette vient surtout du mélange entre Raptoru Live, nouveaux modules, rendering central et APIs différentes.

Les constantes client ne sont pas toutes des violations. Une aide de prix ou un affichage de cooldown est acceptable si Core décide à l’admission. Sur les chemins V2 inspectés, Core conserve ces validations.

En revanche, la coexistence des anciens chemins autoritaires et des nouveaux modèles rend le contrat difficile à comprendre. Il faut documenter quelle génération de backend alimente chaque module.

#### Viewer Web

**Verdict : non implémenté.**

Le [point d’entrée](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/viewer-web/src/main.ts:1>) affiche explicitement un placeholder.

Il n’y a pas de frontend fonctionnel à auditer ici. Garder le workspace est raisonnable, mais il ne faut pas le compter comme un composant prêt pour le cutover.

#### Database

**Verdict : modèle global sérieux, avec deux économies et deux modèles de session à raccorder.**

Les migrations utilisent utilement :

- clés uniques ;
- foreign keys ;
- contraintes d’états ;
- indexes liés aux lectures courantes ;
- unicité de manche active et de session ouverte ;
- unicité des mouvements de débit/remboursement ;
- intégrité des tentatives en cours.

Les champs JSON de configuration restent validés principalement par Core. Cela est acceptable avec un writer unique ; reproduire chaque règle Zod en SQL créerait une dette supplémentaire.

La base ne garantit pas seule l’égalité entre solde et somme du ledger : cette propriété dépend du service transactionnel. Le trigger protège l’immutabilité, pas toutes les écritures possibles par un administrateur DB.

Les migrations historiques contiennent des changements destructifs, notamment le remplacement de l’ancienne table de cooldown Lab : [migration D4](<C:/Users/Antoni/Documents/Raptoru 2.0/supabase/migrations/20261007120000_moderation_d4.sql:51>). Cela doit rester un historique figé, pas un modèle à rejouer sans examen sur des données de production.

Le migrateur conserve les noms appliqués, mais pas leur empreinte, et ne verrouille pas globalement une exécution concurrente : [migrate](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/db/migrate.ts:23>). **P2/S avant des déploiements automatisés concurrents**, faible urgence pour un seul lanceur local.

Je n’ai pas identifié d’index supplémentaire suffisamment évident pour recommander de l’ajouter immédiatement.

#### Packages partagés

**Verdict : sobre et utile.**

Un seul package de contrats partagés constitue un choix adapté. Aucun besoin démontré d’une multiplication de packages `utils`, `events`, `features` ou `platform`.

Les abstractions devenues utiles concernent surtout :

- identité canonique ;
- contexte de session ;
- opérations économiques composables ;
- fichiers de journal atomiques et chemins persistants ;
- réponses HTTP critiques validées.

Ces abstractions doivent partager un problème observé, sans déplacer toute la logique métier dans Schemas.

#### Electron/runtime

**Verdict : shell solide ; ownership des processus et dépendances à compléter.**

La séparation Electron → serveur Studio → runtime local est bonne. La recovery via IPC fonctionne conceptuellement même lorsque le serveur est indisponible.

Les fragilités ne nécessitent pas un nouveau superviseur universel. Il faut surtout aligner les niveaux existants sur quelques règles : identité de processus, arrêt attendu, dépendances, readiness et budget de reprise.

#### Release/update

**Verdict : protections supérieures à ce qu’on trouve habituellement dans un outil local de cette taille.**

Les vérifications d’artefacts et de secrets ont une vraie valeur. L’updater respecte une décision explicite de l’opérateur.

Les limites sont :

- quelques nouveaux fichiers persistants échappent au modèle de chemins ;
- la version de package `0.1.5` ne représente pas à elle seule le code du HEAD ;
- l’état des installations et releases distantes n’a pas été vérifié ;
- la compatibilité avec un Core distant mis à jour indépendamment reste à définir.

### Architecture transversale

#### Ownership et état

| État | Autorité actuelle | Évaluation |
|---|---|---|
| Wallet central, Daily, Loyalty | Core + PostgreSQL | Bonne |
| Wallet des interactions Lab | Core Lab + tables Lab | Cohérente pour tester, raccordement restant |
| Admission, files et cooldowns V2 | Core Lab | Bonne frontière |
| Configuration métier | Core, avec projections Studio/Extension | Majoritairement respectée |
| Lecture réellement en cours | Lecteur local, journal worker, état Core | Trois niveaux légitimes, preuve d’arrêt incomplète |
| Navigation et préférences UI | Frontend local | Placement normal |
| État Twitch | Twitch → Bot → Core | Lab insuffisamment réconcilié |
| Processus et ports | Electron, LocalRuntime, TestLab, Ingress | Ownership incomplet entre contrôleurs |

Le journal worker n’est pas une seconde source métier par nature. Il conserve une preuve locale que Core ne peut pas connaître directement. Il devient problématique quand « ordre préparé » est assimilé à « effet confirmé ».

#### Communication et événements

L’implémentation actuelle repose principalement sur HTTP, polling et états persistants par domaine.

La cible décrite dans la [spécification d’infrastructure](<C:/Users/Antoni/Documents/Raptoru 2.0/Raptoru Studio — Infrastructure Spec.md:514>) prévoit un bus `events`, des curseurs de replay et Supabase Realtime. Ce système n’a pas été identifié dans l’implémentation actuelle.

**C’est un écart à la cible, pas une preuve que l’implémentation actuelle est mauvaise.**

Pour un seul streamer, un polling raisonnable et des files durables peuvent rester suffisants. Le besoin de push devient plus convaincant avec le nombre de viewers et la réactivité recherchée qu’avec le seul nombre de modules.

#### Contrats

Les schémas Zod jouent bien leur rôle sur de nombreuses **entrées Core**. Les frontières de sortie sont plus faibles :

- clients utilisant `as T` ;
- projections `Record<string, unknown>` ;
- frontend JS lisant des objets sans validation structurelle ;
- contrats legacy et V2 coexistant dans la façade.

Exemple : [localLabCoreClient](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/lab-moderation/proxy.ts:62>) caste la réponse mais ne la valide pas.

La version de configuration Commands protège les éditions concurrentes. Elle ne remplace pas une stratégie de compatibilité API entre Studio installé, Core distant et Extension.

**P2/M progressivement :** commencer par valider les réponses d’admission, ACK, wallet et état d’interaction, puis annoncer les capacités/versions compatibles.

Il n’est pas indispensable de générer immédiatement tous les clients OpenAPI.

#### Idempotence et résilience

La qualité est inégale selon la chaîne :

| Chaîne | Évaluation |
|---|---|
| Wallet Core | Très bonne |
| Daily vers fournisseur idempotent | Bonne |
| Loyalty vers Wallet | Bonne |
| Admission des interactions Lab | Bonne |
| Envoi chat Commands | Bonne gestion de l’ambiguïté |
| Actions Modération via Extension | Clé perdue en chemin |
| Arrêt des lecteurs | Livraison non confirmée |
| Entrée chat / stream Lab | Reprise insuffisante |

L’erreur serait de conclure « le projet est idempotent » à partir du seul Wallet. Il faut évaluer chaque intention depuis sa surface d’entrée jusqu’à son dernier effet.

#### Abstractions communes

Trois modules reproduisent désormais :

- persistance de journal ;
- sérialisation locale ;
- heartbeats ;
- remise au lecteur ;
- reprise après crash ;
- règles de nettoyage.

Un petit socle commun pour les journaux, chemins et identités de tentative serait rentable.

Un moteur unique d’interactions serait plus risqué : Soundboard concurrent, TTS séquentiel et Bonk visuel ont des politiques différentes. Partager le mécanisme n’impose pas de fusionner les règles.

#### Observabilité

L’historique Core, les tentatives, mouvements wallet et diagnostics Studio permettent déjà de comprendre une grande partie d’un incident.

Les angles morts sont surtout :

- exceptions Core Lab sans cause enregistrée ;
- absence de corrélation systématique entre requête, interaction, tentative et lecteur ;
- health vert malgré dépendance inutilisable ;
- arrêt TTS sans confirmation ;
- ingestion chat perdue malgré socket connecté ;
- version des composants en présence insuffisamment visible.

Dans six mois, on pourra souvent identifier **l’interaction concernée**, mais pas toujours **le dernier maillon ayant réellement confirmé son action**.

Un écran de diagnostic doit pouvoir afficher : admission, tentative, worker, remise au lecteur, démarrage, fin, arrêt demandé, arrêt confirmé, opération économique et versions des composants. Aucun besoin d’une plateforme de tracing lourde pour cela.

### Lab → Production

**Le projet construit de vrais moteurs réutilisables, mais le Lab actuel exige encore beaucoup de raccordement. La préparation au cutover est nettement moins avancée que la qualité fonctionnelle du Lab.**

#### Ce qui protège correctement le Lab

Le Core Lab impose :

- loopback ;
- base dédiée dont le nom est contrôlé ;
- secret de session ;
- absence de démarrage du moteur Wallet/Loyalty principal ;
- interactions simulées ;
- garde-fous des lecteurs.

Preuve : [bootstrap Core Lab](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:24>).

La frontière de migrations est également devenue explicite et refuse les fichiers non classés : [migration-scopes](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/db/migration-scopes.ts:1>).

Nuance importante : **12 migrations Lab historiques restent incluses dans la sélection production**, volontairement pour préserver le comportement antérieur. Les quatre migrations Commands récentes sont Lab seulement.

La séparation n’est donc pas « toutes les tables Lab sont impossibles en production ». C’est une frontière explicite avec un héritage figé.

#### Travail réellement restant

| Sujet | État actuel | Travail avant production | Effort |
|---|---|---|---|
| Économie | Wallet central et wallet Lab distincts | Raccorder les admissions au Wallet canonique en conservant atomicité, idempotence et remboursement | L |
| Sessions | Sessions principales et sessions Lab distinctes | Définir identité, début/fin, reprise et lien aux événements Twitch communs | M–L |
| Identité | Acteurs Lab et identités simulées | Vérifier JWT Twitch, canal, identité partagée et rôle ; résoudre droits internes dans Core | L |
| Transport Studio/Core | Clients HTTP loopback et secrets locaux | Client HTTPS distant, authentification, délais, recovery réseau, compatibilité | L |
| EBS | Façade locale et ancienne API Live | Exposer les intentions viewers dans la future Core/EBS et raccorder les surfaces | L |
| Paiements Channel Points | Crédits et paiements simulés | Cycle réel des redemptions, décisions d’exécution, fulfil/cancel, reprise et rapprochement | L |
| Lecteurs/OBS | Lecteurs explicitement Lab | Contrat d’exécution utilisable en production, assets, readiness et confirmation | M–L |
| Imports économiques | Production historique encore séparée | Import borné avec références, point de coupure, soldes d’ouverture et contrôles | L |
| Déploiement distant | Cible décrite, raccordement non démontré | Configuration, migrations, sauvegardes, rollback, diagnostics et accès Studio | L |
| Versions | Co-développement du monorepo | Tolérance aux mises à jour indépendantes et capacités exposées | M |
| Viewer Web | Placeholder | Implémentation seulement si nécessaire au produit/cutover choisi | L |
| Statistiques/achievements | Historiques par domaine, pas de socle complet | Choisir les événements réellement nécessaires, sans bus générique prématuré | Variable |

Ces efforts ne s’additionnent pas mécaniquement : plusieurs tâches partagent le même raccordement. **L’ensemble dépasse cependant une finition de release.**

#### Ce qui rendrait la trajectoire plus saine

Le meilleur prochain exercice architectural serait un parcours isolé mais représentatif :

1. identité viewer vérifiée ;
2. intention reçue par la future frontière publique ;
3. admission Core ;
4. opération sur le Wallet canonique de test ;
5. effet via un Studio utilisant le transport prévu ;
6. ACK ou résultat ambigu ;
7. recovery ;
8. historique exploitable.

Ce parcours doit utiliser un environnement de test et préserver SAMMI/StreamElements en production, conformément au périmètre actuel.

Il permettrait de découvrir les incompatibilités maintenant. On pourrait ensuite raccorder chaque module à des frontières déjà éprouvées.

Je déconseille deux extrêmes :

- attendre d’avoir vingt modules Lab pour concevoir ces raccordements ;
- reconstruire immédiatement toute la vision Realtime/OpenAPI/Auth/Storage avant un premier parcours.

### Tests

**Aucun test n’a été exécuté. Les résultats sont non vérifiés dynamiquement pendant cet audit lecture seule.**

#### Inventaire statique

| Composant | Fichiers de tests repérés |
|---|---:|
| Core | 26 |
| Studio Server | 13 |
| Twitch Bot | 13 |
| Studio Desktop | 2 |
| Extension | 4 |
| Studio Web | Aucun fichier/suite correspondante identifié |
| Total | **58 fichiers** |

Ce sont des fichiers, pas un nombre de tests réussis.

#### Tests à conserver

Les suites les plus utiles traitent :

- conservation et intégrité économique ;
- répétition de clés et conflits de payload ;
- crédits/spends/transferts concurrents ;
- claims Daily ;
- qualité des snapshots Presence ;
- permission refusée côté Core ;
- refund unique ;
- ACK tardif ou tentative incorrecte ;
- reprise sans rejeu ;
- quotas et aliases Commands ;
- états et paiement Tombola ;
- budgets de redémarrage ;
- état updater ;
- classification des migrations.

Les tests PostgreSQL multi-connexions sont particulièrement importants : [économie et présence](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/test/postgres.integration.test.ts:36>), [admission/exécution Commands](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/test/commands-v2.integration.test.ts:35>).

#### Limite des tests PGlite

Le helper PGlite sérialise explicitement les opérations sur une seule connexion : [createPgliteDb](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/test/helpers.ts:17>).

C’est utile pour vérifier SQL, contraintes et transactions. En revanche, un `Promise.all()` dans cette fixture **ne démontre pas les mêmes courses que plusieurs connexions PostgreSQL indépendantes**.

Les suites opt-in PostgreSQL compensent en partie cette limite.

#### Problème du harnais PostgreSQL

Les deux fichiers d’intégration utilisent le même `TEST_DATABASE_URL` et exécutent chacun :

`drop schema public cascade; create schema public;`

Le [script d’intégration](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/package.json:14>) lance les deux fichiers, et la configuration ne désactive pas leur parallélisme. Le runtime Vitest installé annonce le parallélisme des fichiers activé par défaut.

**Risque déduit :** une suite détruit les tables utilisées par l’autre. Cela doit être corrigé avant de compter sur ce harnais comme preuve répétable.

Le garde-fou « URL locale et nom contenant test » est utile. Ces suites restent explicitement destructrices pour leur base de test ; elles n’ont pas été lancées.

#### Un test qui protège une mauvaise garantie

Le test TTS nommé « the player is told to stop once » vérifie qu’un second appel ne retourne plus l’ordre d’arrêt.

Preuve : [test d’arrêt TTS](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/test/tts-lab.test.ts:298>).

Ce test démontre le comportement actuel, mais pas la livraison effective. Il verrouille même la consommation prématurée de l’ordre.

Il devrait vérifier qu’une réponse perdue conduit à une nouvelle proposition idempotente, puis qu’un ACK d’arrêt termine cette proposition.

Cela ne rend pas la suite inutile : les assertions de refund et d’ACK tardif conservent leur valeur.

#### Garanties menacées par les E2E non versionnés

On risque de perdre la reproduction de :

- la vraie chaîne Extension → façade → Core → worker → lecteur ;
- l’adéquation des rôles entre surfaces ;
- le comportement après reload d’un lecteur ;
- la livraison des commandes de stop ;
- l’anti-spoil Tombola entre overlay et Extension ;
- la compatibilité Panel/Mobile/Vidéo ;
- le fonctionnement du Studio installé avec les bons chemins de données.

#### Parcours à versionner en premier

| Ordre | Parcours | Garantie recherchée |
|---|---|---|
| 1 | Action wallet Modération, réponse perdue, retry | Un seul delta et un résultat cohérent |
| 2 | Achat TTS/Soundboard, réponse ou ACK perdu | Un seul débit, traitement correct de l’ambiguïté |
| 3 | Stop audio avec première réponse perdue | Silence confirmé et refund unique |
| 4 | Crash/restart Studio ou lecteur | Aucun rejeu d’un effet peut-être exécuté |
| 5 | Fin de stream pendant panne Core | Session rattrapée et scheduler arrêté |
| 6 | Tombola avec inscriptions concurrentes et relance du paiement | Résultat stable, paiement unique |
| 7 | Modérateur sans droit, acteur falsifié, droit retiré | Refus réel côté backend |
| 8 | Studio packagé séparé de ses données | Journaux/tokens conservés après redémarrage et update |

Une poignée de parcours fiables apporterait plus qu’un grand volume de snapshots UI.

### Sécurité

#### Protections actuellement présentes

| Protection | Évaluation |
|---|---|
| Studio lié à `127.0.0.1` | Bonne restriction réseau |
| Contrôle du Host et headers des APIs Studio | Protection utile contre les appels depuis une page externe |
| Core Lab avec secret comparé en temps constant | Bonne protection entre processus locaux |
| Base Lab dédiée contrôlée au démarrage | Bonne limitation des erreurs de configuration |
| Validation Zod côté Core | Protection utile contre payloads invalides |
| Permissions calculées côté Core | Bonne frontière |
| SQL paramétré pour les données utilisateur | Pas d’injection évidente identifiée dans les chemins inspectés |
| Assets audio locaux et chemins allowlistés | Bonne limitation du lecteur |
| CSP Studio/overlays | Protection utile |
| Electron sandbox et bridge limité | Bonne base |
| Contrôles release des fichiers et secrets | Bonne protection de packaging |

Preuves principales : [Studio host/headers](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:55>), [Core Lab auth](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:87>), [CSP Studio](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:147>).

#### Risques réellement crédibles

1. **Replay des actions sensibles non idempotentes** : démontré structurellement par [ASTRA-P1-009](#astra-p1-009).
2. **Arrêt de contenu sans confirmation** : [ASTRA-P1-017](#astra-p1-017), important pour la modération.
3. **Sorties d’erreurs brutes avant redaction** : [ASTRA-P2-014](#astra-p2-014) ; fuite potentielle, aucune fuite effective démontrée.
4. **Ownership PID insuffisant** : [ASTRA-P2-026](#astra-p2-026) ; risque local conditionnel.
5. **Lab branché trop directement au futur public** : problème de raccordement [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-007](#astra-p1-007), [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-010](#astra-p1-010), [ASTRA-P1-019](#astra-p1-019), pas faille publique actuellement démontrée.

Le modèle `STUDIO_ACTOR = broadcaster` est acceptable pour un cockpit local privilégié derrière ses protections. Il serait dangereux s’il était réutilisé dans une façade publique sans identité vérifiée.

Les identités Lab falsifiables sont une simulation volontaire. Elles ne doivent jamais devenir la méthode d’authentification production.

#### Electron : durcissement rentable

Les handlers IPC de restart/update ne vérifient pas explicitement l’émetteur, et aucune restriction de navigation équivalente à une allowlist complète n’a été identifiée dans le shell.

Preuves : [IPC main](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:264>), [preload](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/preload.cts:14>).

**P2/S :** vérifier l’origine/frame émettrice et encadrer navigation/nouvelles fenêtres.

C’est un durcissement de la frontière privilégiée. Je n’ai pas démontré de parcours d’exploitation distant : CSP, sandbox et contenu local réduisent déjà le risque.

#### Dépendances

Les dépendances de production déclarées restent peu nombreuses : `pg`, `zod`, `electron-updater`, Schemas et Electron pour le shell. Elles ont des usages identifiables.

Je n’ai pas trouvé de duplication évidente de bibliothèques HTTP, ORM ou état frontend justifiant un remplacement.

Le problème démontré est surtout **Zod non déclaré par Schemas**. Le packaging compense actuellement cette dépendance via son package racine.

Je ne recommande aucun upgrade simplement sur la base d’un numéro de version. L’état actuel des avis de sécurité et de maintenance des bibliothèques n’a pas été vérifié auprès de sources externes ; aucune conclusion d’absence de CVE ou d’abandon ne doit être tirée de cet audit.

### Performance

Les fréquences ci-dessous sont déduites des constantes du code. **Aucun benchmark, profil CPU, mesure DB ou test de charge n’a été exécuté.**

| Zone | Fréquence / comportement | Coût probable | Quand cela devient visible | Priorité |
|---|---|---|---|---|
| Journaux Bonk/Sound/TTS | Boucle toutes les 150 ms, avec sauvegarde même sans changement | Jusqu’à environ 20 réécritures de journal par seconde pour les trois workers, selon durée des ticks | Sessions longues, stockage lent, multiplication des workers | P2/S–M |
| Claims des workers | Même cadence courte à vide | HTTP et transactions DB répétés | Davantage de modules ou Core distant | P2/M |
| Lecteur Soundboard | Poll toutes les 120 ms | Environ 8 requêtes/s par lecteur prêt | Principalement charge locale ; à surveiller si plusieurs lecteurs | P2/S |
| Tombola Core | Tick toutes les 250 ms | Quatre recherches de canaux/s, puis transactions pour les canaux actifs | Plusieurs modules reprenant chacun ce pattern | P2/M |
| Avatars | Tick toutes les 5 s, sans garde de superposition | Requêtes réseau pendantes et traitements dupliqués | Réseau Twitch lent ou bloqué | P2/S |
| Soundboard random | Vérification séquentielle des cooldowns de candidats | Plusieurs requêtes sous verrou de canal | Beaucoup de sons avec cooldown non nul et demandes random fréquentes | P2/S–M |
| Quotas Commands | Agrégats sur l’historique accepté d’une commande | Coût croissant avec l’historique, sous verrou | Commandes très utilisées sur des mois | P2/M |
| Redaction logs | Lecture synchrone de plusieurs fichiers par ligne | Blocage de la boucle Node | Bursts de logs/reconnexion | P2/S |
| Logs Electron | Rotation au début d’une session, puis fichier courant non borné | Croissance disque | Sessions prolongées et erreurs répétées | P2/S |
| Outbox Loyalty | Événements conservés jusqu’à résolution | Croissance et réécritures de fichier | Longue panne Core avec événements entrants | P2/M |

Sources : [runtime TTS](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/runtime.ts:46>), [sauvegarde TTS](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/tts-lab/worker.ts:378>), [Soundboard random](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/sound-lab/sound-lab-service.ts:520>), [Commands usage](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/commands/admission.ts:470>), [serverLog](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/src/main.ts:84>).

#### Les améliorations rentables

- Écrire le journal seulement après changement, tout en conservant l’écriture avant remise d’un effet.
- Ralentir les claims à vide et reprendre une cadence courte pendant une activité.
- Grouper les lectures de cooldown Soundboard.
- Préserver la sémantique des quotas avant de remplacer les agrégats par des compteurs.
- Ajouter des compteurs d’outbox et alertes de backlog ; ne pas jeter arbitrairement des événements économiques.
- Borner les logs par taille pendant une session.

#### Charge viewer future

Le host Extension relit son état toutes les 5 ou 15 secondes selon surface/visibilité. TTS poll toutes les 2 secondes ; Tombola active toutes les secondes.

Preuves : [overlay](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/overlay.js:28>), [TTS](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/tts-v2.js:23>), [Tombola](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/tombola-v2.js:16>).

À titre de projection, 1 000 viewers consultant simultanément une Tombola active représentent environ 1 000 lectures/s de ce module, auxquelles s’ajoutent les lectures du host. Ce n’est pas une mesure du trafic réel.

Le push ou des états publics cachables auront un intérêt à cette échelle. Il n’est pas nécessaire de commencer par un bus événementiel complet.

#### Frontend

`base.css` représente environ **537 Ko de source** ; les feuilles mobile et overlay sont également volumineuses.

Cela prouve une surface de maintenance importante. L’impact exact du chargement, de la compression et du rendu n’a pas été mesuré.

Je n’ai pas trouvé de raison de présenter ces tailles comme le principal goulot actuel. Les écritures inutiles et les boucles de polling ont des causes plus directement démontrables.

### Code mort / obsolète / suspects

| Élément | Pourquoi suspect | Confiance | Supprimable maintenant ? |
|---|---|---|---|
| Anciennes branches TTS/Tombola/modération de `ui.js` | Les variantes V2 existent | Haute sur leur caractère legacy ; faible sur leur inutilité | **Non**, certaines restent utilisées par l’ancien backend |
| Simulation en mémoire dans `LabEbs` | Les nouveaux modules utilisent Core | Haute sur la coexistence des modèles | **Pas globalement** ; rendre le mode explicite puis retirer les chemins réellement remplacés |
| `demo-data.js` | Fixtures volumineuses | Haute sur son usage de démonstration | **Non**, utilisé par les previews |
| Anciennes migrations cooldown/modération | Modèle remplacé dans les migrations suivantes | Haute | **Non**, historique de migration |
| Migrations Lab historiques sélectionnées en prod | Héritage avant frontière explicite | Haute | **Non**, ne pas réécrire l’historique appliqué |
| Viewer Web | Placeholder | Haute | Pas utile à supprimer ; son statut doit être clair |
| Prototypes locaux | Non versionnés et exclus | Haute sur leur rôle de référence UX | **Non**, nécessaires aux spécifications actuelles |
| README/HANDOFF dépassés | Ne correspondent plus au HEAD | Haute | Actualiser, conserver l’historique pertinent |
| Commentaires « rien écrit dans le chat » | Sortie Commands réelle désormais possible | Haute | Corriger les commentaires |
| Anciennes couches Bonk/lecteurs | Certaines ressemblent à des wrappers | Moyenne | Pas de suppression sans vérifier transport, assets et compatibilité |

Aucune dépendance de production suffisamment démontrée comme inutile n’a été identifiée.

Les gros fichiers de données, catalogues et assets ne doivent pas être assimilés aux gros fichiers de logique. Leur taille ne porte pas la même dette.

### QUICK WINS AVANT LE PROCHAIN GROS MODULE

Ces corrections sont petites ou ciblées. Elles ne demandent pas de refonte.

| Priorité | Correction | Gain | Effort | Risque | Fichiers probables |
|---|---|---|---|---|---|
| P1 | Restreindre les retries automatiques des mutations sans idempotence garantie | Empêche le double effet avant le correctif complet | S | Faible à moyen : conserver les retries des achats correctement idempotents | [api.js](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/api.js:95>) |
| P1 | Déplacer le journal chat dans `DATA_ROOT` et compléter les exclusions | Persistance correcte dans Studio installé | S | Faible | [local-env.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/local-env.ts:42>), [config.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-bot/src/config.ts:59>) |
| P1 | Attendre `labchat.stop()` dans le shutdown | Cleanup déterministe | XS | Faible | [index.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:467>) |
| P1 | Inclure le Core Lab dans la garde d’arrêt PostgreSQL | Évite de couper une dépendance active | S | Faible | [test-lab.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/test-lab/test-lab.ts:393>), [local-runtime.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/runtime/local-runtime.ts:142>) |
| P2 | Conserver le timeout jusqu’à la fin du JSON | Évite un refresh bloqué sans limite | S | Faible | [api.js](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/twitch-extension/extension/shared/api.js:160>) |
| P2 | Ajouter timeout et garde au cache avatars | Empêche l’accumulation réseau | S | Faible | [avatars.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/avatars.ts:100>), [local-server.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:139>) |
| P2 | Journaliser les erreurs inattendues Core Lab après redaction | Diagnostic beaucoup plus rapide | S | Faible | [local-server.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/bonk-lab/local-server.ts:112>) |
| P2 | Sérialiser les deux fichiers PostgreSQL d’intégration | Supprime une collision du harnais | S | Faible | [package Core](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/package.json:14>), [vitest.config.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/vitest.config.ts:1>) |
| P2 | Déclarer Zod dans Schemas | Frontière package autonome | XS–S | Faible | [package Schemas](<C:/Users/Antoni/Documents/Raptoru 2.0/packages/schemas/package.json:1>), [stage.mjs](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/desktop/scripts/stage.mjs:95>) |
| P2 | Nettoyer aussi stderr/stack avant log Electron | Réduit le risque de secret dans les diagnostics | S | Faible | [index.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/studio/server/src/index.ts:416>) |
| P2 | Corriger la reconnaissance broadcaster Tombola | Annulation chat cohérente avec Commands | S | Faible à moyen : respecter les permissions existantes | [raffle-lab-service.ts](<C:/Users/Antoni/Documents/Raptoru 2.0/apps/core-api/src/raffle-lab/raffle-lab-service.ts:1093>) |
| P2 | Remettre les nouveaux modules Extension dans le lint | Détecte les erreurs simples avant intégration | S | Faible si périmètre progressif | [eslint.config.js](<C:/Users/Antoni/Documents/Raptoru 2.0/eslint.config.js:12>) |
| P2 | Actualiser les résumés de reprise | Évite de reconstruire des décisions sur un état dépassé | S | Faible | [HANDOFF](<C:/Users/Antoni/Documents/Raptoru 2.0/Raptoru-2.0-HANDOFF.md:3>), [README](<C:/Users/Antoni/Documents/Raptoru 2.0/README.md:7>) |

Le correctif durable de l’idempotence Modération et le protocole de stop confirmé restent des travaux P1 plus complets. Leur protection provisoire ne doit pas être présentée comme une résolution totale.

### CHOSES QUE JE NE TOUCHERAIS PAS ENCORE

#### Le modèle Wallet central

Il possède des garanties utiles et compréhensibles. Je conserverais tables, ledger, clés, hashes et verrouillage.

Les nouveaux raccordements doivent utiliser ce modèle, éventuellement en ajoutant une frontière transactionnelle composable.

#### Le moteur Tombola

Les transitions, résultats figés, séparation temporelle overlay/viewer et protections de paiement sont déjà structurés.

Je corrigerais les défauts démontrés autour de l’ingestion et de l’identité. Je ne rouvrirais pas toute la mécanique validée.

#### Le framework frontend

Une migration React/Vue/Svelte ne réglerait pas automatiquement retries, contrats, stop, ownership ou tests manquants.

Le premier gain vient du découpage par écran et du lifecycle explicite.

#### Les APIs legacy encore nécessaires

Le frontend de production actuel conserve des chemins anciens. Leur suppression avant le raccordement effectif casserait la migration.

Il faut définir une date et une condition de retrait, puis supprimer une branche prouvée inutilisée.

#### Les migrations appliquées

Ne pas nettoyer les fichiers historiques pour rendre le dossier plus élégant. Les évolutions doivent rester additives et classées.

#### Un bus événementiel complet

Les interactions critiques ont déjà des états et files durables. Mettre Realtime partout maintenant augmenterait le nombre de problèmes simultanés.

Le premier besoin est la fiabilité et la compatibilité des frontières existantes.

#### Un moteur générique de workflows

Commands peut conserver réponses, actions spécialisées, ordre et politique d’erreur. Il ne devrait pas devenir un éditeur de scripts arbitraires, conditions universelles et accès wallet libre.

#### Une abstraction unique pour tous les workers

Partager chemins, journalisation et identité de tentative serait utile. Fusionner leurs politiques de lecture serait risqué.

#### Les microservices et nouveaux packages « plateforme »

Le monorepo et les processus actuels sont bien dimensionnés pour un streamer. Rien dans l’audit ne justifie une fragmentation supplémentaire.

### Risques à 6 mois

Si dix à vingt modules s’ajoutent sans correction, les risques les plus probables sont :

| Ordre | Risque | Pourquoi il augmente |
|---|---|---|
| 1 | Régressions lors des changements UI/façade | Trop de responsabilités dans les fichiers centraux et peu de parcours reproductibles |
| 2 | Effets perdus, doublés ou mal diagnostiqués | Nouveaux modules copiant des garanties incomplètes de retry/stop/ACK |
| 3 | Recovery nécessitant de plus en plus d’actions manuelles | Plusieurs contrôleurs de processus et dépendances insuffisamment partagées |
| 4 | Cutover beaucoup plus coûteux que prévu | Chaque module dépend directement de concepts Lab |
| 5 | Charge permanente disproportionnée à vide | Polling et écritures de journal multipliés par module |
| 6 | Ruptures entre Studio installé, Core et Extension | Pas de contrat global de compatibilité |
| 7 | Debug lent malgré des historiques nombreux | Preuves dispersées sans vue de chaîne complète |

Je ne pense pas que le premier problème sera PostgreSQL incapable de stocker davantage de modules. Le modèle transactionnel actuel est plus solide que les frontières UI/runtime.

Le premier frein quotidien sera probablement **le coût de modification et d’intégration**. Le premier incident de stream sérieux viendra plus probablement **d’une livraison ou d’une recovery incomplète**.

Ces projections sont des risques déduits, pas des incidents observés.

### Scorecard

Les notes évaluent le code et les garanties conçues. Elles ne représentent pas une validation dynamique.

| Domaine | Note /10 | Commentaire |
|---|---:|---|
| Architecture | **8** | Répartition globale adaptée ; frontières Lab/production à consolider |
| Core | **8,5** | Transactions, idempotence et permissions solides |
| Studio | **7** | Cockpit crédible ; orchestration locale inégalement aboutie |
| Bot | **7,5** | Adaptateur majoritairement fin ; ingestion Lab moins robuste |
| Extension | **5,5** | Produit riche, dette legacy et contrôle qualité insuffisant |
| Database | **8** | Contraintes et indexes cohérents ; deux économies et sessions à raccorder |
| Tests | **6,5** | Bon contenu métier ; intégration complète insuffisamment reproductible |
| Observabilité | **5,5** | Historique utile, preuves de livraison et readiness incomplètes |
| Sécurité | **7** | Bonne base locale/interne ; frontière publique future non prête |
| Maintenabilité | **6** | Core viable ; surfaces et façade deviennent coûteuses |
| Facilité d’ajout d’une feature | **6,5** | Modules métier assez clairs ; trop de raccordements spécifiques |
| Préparation au cutover | **3,5** | Beaucoup de comportement réutilisable, production globale encore éloignée |
| Fiabilité de conception | **6,5** | Bonnes garanties centrales, défauts importants aux extrémités |

Réponses explicites aux questions de trajectoire :

- **A — Architecture : adaptée, 8/10.** Je garderais la séparation actuelle.
- **B — Maintenabilité : 6/10.** Plusieurs mois de développement restent raisonnables si les surfaces centrales et conventions d’intégration sont traitées progressivement.
- **C — Fiabilité : 6,5/10.** Le système possède les mécanismes nécessaires, mais les P1 empêchent de considérer la chaîne complète comme suffisamment fiabilisée pour un cutover global.
- **D — Testabilité : 6,5/10.** Bonne injection des dépendances et tests DB ; manque de reproductibilité entre surfaces.
- **E — Observabilité : 5,5/10.** On voit bien les états métier, moins bien la dernière preuve d’exécution réelle.
- **F — Sécurité : 7/10 dans le périmètre actuel.** Cette note ne s’étend pas à une future API publique utilisant les raccourcis Lab.
- **G — Complexité : globalement correctement dimensionnée**, avec une complexité accidentelle déjà importante dans le frontend et la gestion du runtime.
- **H — Dette : importante**, sans être critique ou nécessiter une reconstruction générale.
- **I — Cutover : moteurs de production en construction, mais surtout très bon Lab pour les fonctionnalités récentes.** La dette de raccordement est réelle et encore trop concentrée à la fin.

## Traçabilité avec la réponse initiale

Les anciens numéros identifiaient des groupes de la réponse en conversation. Ils ne doivent pas être utilisés comme IDs de fermeture : seuls les IDs ASTRA du registre sont stables. Les nouvelles entrées séparent des causes déjà décrites, sans ajout d'incident ou de finding issu des changements postérieurs.

| Groupe initial | Entrée(s) du registre |
| -- | -- |
| P1-01 | [ASTRA-P1-009](#astra-p1-009) |
| P1-02 | [ASTRA-P1-017](#astra-p1-017) |
| P1-03 | [ASTRA-P1-002](#astra-p1-002), [ASTRA-P1-003](#astra-p1-003) |
| P1-04 | [ASTRA-P1-004](#astra-p1-004), [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-011](#astra-p1-011) |
| P1-05 | [ASTRA-P1-012](#astra-p1-012), [ASTRA-P1-013](#astra-p1-013), [ASTRA-P1-014](#astra-p1-014), [ASTRA-P1-015](#astra-p1-015) |
| P1-06 | [ASTRA-P1-016](#astra-p1-016) |
| P1-07 | [ASTRA-P1-001](#astra-p1-001), [ASTRA-P1-007](#astra-p1-007), [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-010](#astra-p1-010), [ASTRA-P1-019](#astra-p1-019) |
| P1-08 | [ASTRA-P1-018](#astra-p1-018) |
| P1-09 | [ASTRA-P1-008](#astra-p1-008), [ASTRA-P2-011](#astra-p2-011), [ASTRA-P1-018](#astra-p1-018) |
| P2-01 | [ASTRA-P2-010](#astra-p2-010), [ASTRA-P2-003](#astra-p2-003) |
| P2-02 | [ASTRA-P2-005](#astra-p2-005) |
| P2-03 | [ASTRA-P2-013](#astra-p2-013) |
| P2-04 | [ASTRA-P2-029](#astra-p2-029) |
| P2-05 | [ASTRA-P2-012](#astra-p2-012) |
| P2-06 | [ASTRA-P2-022](#astra-p2-022) |
| P2-07 | [ASTRA-P2-001](#astra-p2-001) |
| P2-08 | [ASTRA-P2-014](#astra-p2-014) |
| P2-09 | [ASTRA-P2-002](#astra-p2-002) |
| P2-10 | [ASTRA-P2-009](#astra-p2-009) |
| P2-11 | [ASTRA-P2-006](#astra-p2-006) |
| P2-12 | [ASTRA-P2-028](#astra-p2-028) |
| P2-13 | [ASTRA-P2-026](#astra-p2-026) |
| §8 Database — migrateur sans verrou / empreinte | [ASTRA-P2-007](#astra-p2-007), [ASTRA-P2-008](#astra-p2-008) |
| §9 Contrats — sorties / versions | [ASTRA-P2-003](#astra-p2-003), [ASTRA-P2-004](#astra-p2-004) |
| §9 Observabilité — dernière preuve de chaîne | [ASTRA-P2-015](#astra-p2-015) |
| §12 Electron — émetteur IPC/navigation | [ASTRA-P2-027](#astra-p2-027) |
| §13 — journaux / claims / lecteur / scheduler | [ASTRA-P2-016](#astra-p2-016), [ASTRA-P2-017](#astra-p2-017), [ASTRA-P2-018](#astra-p2-018), [ASTRA-P2-019](#astra-p2-019) |
| §13 — cooldowns / quotas / logs / outbox / audience | [ASTRA-P2-020](#astra-p2-020), [ASTRA-P2-021](#astra-p2-021), [ASTRA-P2-023](#astra-p2-023), [ASTRA-P2-024](#astra-p2-024), [ASTRA-P2-025](#astra-p2-025) |
| §7 — provenance / nommage / ports | [ASTRA-P3-001](#astra-p3-001), [ASTRA-P3-002](#astra-p3-002), [ASTRA-P3-003](#astra-p3-003) |
| §7 — catégories : version / historique | [ASTRA-P3-004](#astra-p3-004), [ASTRA-P3-005](#astra-p3-005) |
| §7 — harmonisation visuelle | [ASTRA-P3-006](#astra-p3-006) |

La réduction des exceptions qualité reste P2 pour le quick win lint, comme dans le tableau initial des quick wins ; la dette de responsabilités concentrées reste P1. Les réserves performance/UX/provenance restent à vérifier, sans devenir des incidents établis.


## Findings à ne PAS corriger automatiquement

Ces entrées nécessitent une décision produit, architecture ou UX avant l'action indiquée. Cela n'empêche pas une protection provisoire indépendante clairement autorisée lors de la phase suivante. La présente tâche reste uniquement documentaire.

| ID | Décision nécessaire avant action | Pourquoi une correction automatique serait inadaptée |
| -- | -- | -- |
| [ASTRA-P1-001](#astra-p1-001) | Le modèle de monnaies, le point de coupure et le protocole d'import nécessitent une décision architecture/produit. | Core, admissions des interactions, monnaies, ledger et futures migrations de raccordement ; conserver un adaptateur simulé pour le Lab. |
| [ASTRA-P1-002](#astra-p1-002) | La durée de validité et les commandes admissibles à une reprise demandent une politique métier explicite. | Bot ingress, contrat d'entrée Core, politique d'expiration et diagnostics de refus/abandon. |
| [ASTRA-P1-006](#astra-p1-006) | Les choix d'authentification, de publication, de compatibilité et le périmètre du premier cutover nécessitent une décision architecture/produit. Aucune publication autorisée par ce finding. | Core/EBS public, adaptateurs d'identité, facade, contrats Extension et protections de la frontière publique. |
| [ASTRA-P1-007](#astra-p1-007) | La définition métier de stream, stream-day et activités hors stream doit être décidée avant migration. | Core sessions, domaines consommateurs et migrations/adaptateurs de raccordement. |
| [ASTRA-P1-008](#astra-p1-008) | Le legacy encore connecté à la production et les UX validées ne doivent pas être supprimés ou redessinés automatiquement. | Extension, Studio Web et façade EBS ; extractions incrémentales sans changement de framework imposé. |
| [ASTRA-P1-010](#astra-p1-010) | Le modèle produit de crédits/redemptions et le cutover nécessitent une décision. Aucun accès ou changement Twitch/production autorisé par cette entrée. | Adaptateur Twitch, Core paiements/interactions, contrats d'exécution et affichage des preuves. |
| [ASTRA-P1-019](#astra-p1-019) | Transport de production, autorisation Studio et stratégie de compatibility/cutover doivent être décidés ; ne pas simplement lever les restrictions Lab. | Clients Studio/Bot, auth transport, contrats lecteurs, diagnostic et compatibilité de versions. |
| [ASTRA-P2-002](#astra-p2-002) | Décider si Test Lab interdit toutes les écritures économiques ou uniquement celles de Loyalty avant de modifier les flags. | Politique de sécurité Test Lab, validation des flags et diagnostics. |
| [ASTRA-P2-004](#astra-p2-004) | Définir les versions supportées et le niveau de handshake avant toute rupture d'API ; codegen intégral non requis. | Contrats transversaux, diagnostics, clients et stratégie de release. |
| [ASTRA-P2-006](#astra-p2-006) | La règle produit de remboursement au-delà du plafond doit être choisie avant correction. | Wallet Lab, résultat de remboursement, ledger et affichage ; le Wallet central n'est pas accusé de ce défaut. |
| [ASTRA-P2-008](#astra-p2-008) | L'enrôlement des historiques existants dans une vérification par empreinte doit partir d'une référence approuvée ; ne pas remplir des preuves rétroactives automatiquement. | Migrateur, métadonnées et contrôle documentaire/CI de l'historique ; aucune réécriture de migration appliquée. |
| [ASTRA-P2-024](#astra-p2-024) | Toute expiration, suppression ou perte assumée d'événements économiques nécessite une politique explicite ; ne pas purger automatiquement. | Outbox Bot, diagnostics et stratégie de stockage durable. |
| [ASTRA-P2-025](#astra-p2-025) | Choisir une stratégie selon les besoins d'audience/réactivité ; ne pas déployer un bus Realtime global pour cette projection seule. | Projection publique Core/EBS, cache éventuel et lifecycle de polling Extension. |
| [ASTRA-P3-001](#astra-p3-001) | Choisir le périmètre de diffusion et les preuves attendues ; aucun achat de certificat ni changement de publication automatique. | Politique de distribution et métadonnées/build/signature si retenus. |
| [ASTRA-P3-002](#astra-p3-002) | Choisir le vocabulaire transversal avant de renommer des interfaces/configurations publiques ; dette sans panne justifiant une passe automatique. | Noms internes et documentation de runtime ; pas de renommage global imposé. |
| [ASTRA-P3-004](#astra-p3-004) | Définir si les catégories auront plusieurs writers et quelle UX de conflit est souhaitée avant changement de contrat. | Contrat catégorie, persistence et interfaces d'édition. |
| [ASTRA-P3-005](#astra-p3-005) | Choisir la granularité et l'utilité produit de cet historique ; faible priorité avec un seul cockpit. | Audit catégories Core et éventuelle restitution Studio/Extension. |
| [ASTRA-P3-006](#astra-p3-006) | Décision UX/produit préalable avec respect des prototypes ; aucune refonte esthétique automatique. | Styles/composants et conventions d'écran, selon décision produit. |

### Réserves préalables à toute fermeture

- Les **À VÉRIFIER** demandent la preuve manquante décrite dans chaque entrée, avant de transformer une hypothèse en panne établie ou de lancer une optimisation générale.
- Les **À REVALIDER SUR CODE ACTUEL** demandent comparaison de la référence historique et du HEAD de correction. Un titre de commit, une réussite apparente ou un nouveau fichier de test ne suffisent pas à conclure.
- Ne pas supprimer automatiquement le legacy utilisé, les prototypes de référence, les historiques SQL ou les événements économiques pending. Ne pas lever les gardes Lab pour simuler un raccordement production.
- Ne pas convertir un effet ambigu en replay/remboursement certain ; les décisions de compensation doivent correspondre aux preuves disponibles.
- Le Wallet central, les moteurs Daily/Presence/Loyalty et Tombola, la séparation des applications et les protections release sont des fondements à conserver. Les refontes framework, workflows, microservices, bus généralisé et nouveaux packages n'ont pas de justification automatique dans cet audit.

## Checklist de fermeture

**Toutes les entrées commencent à OUVERT.** Le champ Commit est vide tant qu'une fermeture n'est pas prouvée. Les commits postérieurs cités dans les réserves sont des candidats à examiner, pas des validations de fermeture.

Pour fermer une entrée : revalider sa preuve sur le HEAD concerné, réaliser la correction ou documenter la décision qui la résout, exécuter les tests pertinents dans un environnement isolé, inscrire les résultats et procéder à la validation manuelle requise. Une mesure qui infirme un impact spéculatif doit être conservée avec son contexte. Une protection provisoire ne ferme pas une cause persistante.

| ID | Sévérité | Domaine | Statut | Commit | Tests | Validation manuelle | Notes |
| -- | -------- | ------- | ------ | ------ | ----- | ------------------- | ----- |
| [ASTRA-P1-001](#astra-p1-001) | P1 | Architecture | BLOQUÉ — décision de cutover | — | — | — | Décision : modèle de monnaies, point de coupure, protocole d'import |
| [ASTRA-P1-002](#astra-p1-002) | P1 | Bot | FERMÉ — corrigé | `dcfdf3d` | Bot lab-chat-ingest : Core revenu < 15 s → une admission, aucun essai après succès ; réponse perdue après commit → dédupliqué ; même message reçu deux fois → un effet ; Core absent > 15 s → essais 0/1/3/7/15 s puis abandon ; 4xx → aucun essai ; arrêt pendant les reprises → plus rien envoyé. Core raffle-v2 : !join tardif après clôture → `raffle_closed`. Déduplication Core existante : commands-v2-admission « dedupes the same Twitch message », raffle-v2 « replayed chat message ». Bot 98/98 | Optionnel : ingestion ON, redémarrer le Core Lab pendant un !join → une seule inscription | — |
| [ASTRA-P1-003](#astra-p1-003) | P1 | Bot | FERMÉ — corrigé | `47b71bd` | lab-chat-ingest « ASTRA-P1-003 » (offline perdu → réparé ; état stable → rien ; Helix en panne → rien) ; bot 92/92 | Optionnel : ingestion ON, couper Core pendant la fin du live → session Lab fermée ≤ 60 s après son retour | Âge de la dernière confirmation : P2-015 |
| [ASTRA-P1-004](#astra-p1-004) | P1 | Core | FERMÉ — corrigé | `ccc8e5d` | db-limits.test.ts : serveur muet → échec < 3 s (toujours) ; sur PostgreSQL réel local (opt-in `TEST_DATABASE_URL`, lecture seule : pg_sleep + verrou consultatif) requête 57014, verrou 55P03, client réutilisable — exécuté sur raptoru2-pg | — | Réglages PostgreSQL de production à revoir au cutover |
| [ASTRA-P1-005](#astra-p1-005) | P1 | Core | FERMÉ — corrigé | `ccc8e5d` | readiness.test.ts (prêt ; base en échec ou figée → /health 200, /ready 503 borné) ; local-runtime « ASTRA-P1-005 » | Optionnel : arrêter le conteneur PG pendant que Studio tourne → Core local « dégradé » (base injoignable), puis « prêt » au redémarrage | — |
| [ASTRA-P1-006](#astra-p1-006) | P1 | EBS | BLOQUÉ — décision de cutover | — | — | — | Décision : authentification, publication, périmètre du premier cutover |
| [ASTRA-P1-007](#astra-p1-007) | P1 | État | BLOQUÉ — décision de cutover | — | — | — | Décision : définition métier de stream / stream-day / hors stream |
| [ASTRA-P1-008](#astra-p1-008) | P1 | Extension | FERMÉ — décision adoptée | `2c0020e` | — (décision documentée, aucun code modifié) | — | Dette résiduelle acceptée, résorption progressive ; ligne de base dans CLAUDE.md |
| [ASTRA-P1-009](#astra-p1-009) | P1 | Idempotence | FERMÉ — corrigé | `6caa2e6` | Core moderation-d4 « idempotent action » ; Studio moderation-d4 « ASTRA-P1-009 » (échoue sans le relais EBS) ; Core 365 / Studio server 138 | Extension Lab : crédit wallet de test, coupure réseau simulée → un seul crédit | Studio packagé : migration appliquée au prochain démarrage du runtime |
| [ASTRA-P1-010](#astra-p1-010) | P1 | Paiements | BLOQUÉ — décision de cutover | — | — | — | Décision : modèle produit crédits/redemptions et cutover |
| [ASTRA-P1-011](#astra-p1-011) | P1 | Studio | FERMÉ — corrigé | `ccc8e5d` | local-runtime « ASTRA-P1-011 » (figé → arrêt → relance bornée) + test crash existant ; Studio server 140/140 | — | — |
| [ASTRA-P1-012](#astra-p1-012) | P1 | Studio | FERMÉ — corrigé | `2c617d1` | test-lab.test.ts (garde Postgres) | — | — |
| [ASTRA-P1-013](#astra-p1-013) | P1 | Studio | FERMÉ — corrigé | `2c617d1` | lab-chat.test.ts (orphelin) | Optionnel : tuer le serveur Studio (pas l'arbre) ingestion ON, relancer → un seul labchat | Identité de processus : ASTRA-P2-026 |
| [ASTRA-P1-014](#astra-p1-014) | P1 | Studio | FERMÉ — corrigé | `2c617d1` | test-lab.test.ts « shutdown barrier » | Fermer Studio avec l'ingestion ON : plus de processus labchat restant | — |
| [ASTRA-P1-015](#astra-p1-015) | P1 | Studio | FERMÉ — corrigé | `2c617d1` | lab-chat.test.ts supervision (2) ; bot 91/91 | Ingestion ON, tuer le processus labchat → reconnexion en ≤ 5 s | — |
| [ASTRA-P1-016](#astra-p1-016) | P1 | Studio | FERMÉ — corrigé | `2c617d1` | local-env.test.ts (3) ; suite Studio server 137/137 | Studio packagé : vérifier `<données>/apps/twitch-bot/.lab-chat-journal.json` après un envoi Commands V2 | Dossier données sans `apps/twitch-bot` : l'exécuteur échoue comme avant (jetons au même endroit) |
| [ASTRA-P1-017](#astra-p1-017) | P1 | Studio | FERMÉ — corrigé | `2aba120` | tts-lab « moderation stop: proposed again… » ; moderation-d4 Soundboard stop (réponse perdue → reproposé → prouvé) ; Studio server 138/138 | Validé par Antoni (2026-10-04) : STOP TTS et STOP Soundboard | Lecteur TTS d'une ancienne page ouverte : ordre reproposé sans effet jusqu'au rechargement |
| [ASTRA-P1-018](#astra-p1-018) | P1 | Tests | FERMÉ — corrigé | `fd365dd` | e2e/commands-public.e2e.ts (navigateur, pile isolée) ; Core 368 / Studio server 140 inchangés | Une fois par machine : `npx playwright install chromium` | Commits 93f07db (assemblage partagé), fd365dd (harnais + parcours), a120335 (build schemas) |
| [ASTRA-P1-019](#astra-p1-019) | P1 | Transport | BLOQUÉ — décision de cutover | — | — | — | Décision : transport de production, autorisation Studio, compatibilité/cutover |
| [ASTRA-P2-001](#astra-p2-001) | P2 | Build | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-002](#astra-p2-002) | P2 | Config | FERMÉ — corrigé | `0e4c040` | test-lab.test.ts « loyalty credits guard » (refus Daily + démarrage forcé) | — | Core externe non géré : hors garde (inchangé) |
| [ASTRA-P2-003](#astra-p2-003) | P2 | Contrats | FERMÉ — corrigé | `52591d0` | Extension test/api.test.js : JSON invalide / vide / non-objet → invalid_response sans retry ; 204 → {} ; refus 403/400 conservés (échoue sur l'ancien code : {} accepté) | — | Validation de forme des réponses internes : relève de P2-004 |
| [ASTRA-P2-004](#astra-p2-004) | P2 | Contrats | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Décision préalable |
| [ASTRA-P2-005](#astra-p2-005) | P2 | Core | FERMÉ — corrigé | `28e9fd3` | raffle-v2 « Twitch pictures (ASTRA-P2-005) » : 2 ticks concurrents → 1 seul appel Twitch ; appel Twitch figé → TimeoutError au budget ; test existant : panne → initiales → retry 1 h → récupération | — | — |
| [ASTRA-P2-006](#astra-p2-006) | P2 | Core | FERMÉ — corrigé | `5ff2519` | moderation-d4 « ASTRA-P2-006 » : wallet à plafond − 100, remboursement d'un TTS de 7 500 → solde = plafond, ligne refund = 100 (échoue sur l'ancien code : 7 500), variation du solde = somme des lignes du ledger, audit after.amount = 100, second remboursement sans ligne ni effet ; Core 374, Studio server 142 | Optionnel : Studio « Wallet de test » → solde proche du plafond, rembourser un TTS → historique wallet = montant crédité | — |
| [ASTRA-P2-007](#astra-p2-007) | P2 | Database | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Preuve statique à revalider lors de la correction |
| [ASTRA-P2-008](#astra-p2-008) | P2 | Database | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Décision préalable |
| [ASTRA-P2-009](#astra-p2-009) | P2 | Documentation | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-010](#astra-p2-010) | P2 | Extension | FERMÉ — corrigé | `52591d0` | Extension test/api.test.js : corps bloqué → erreur à 8 s (échoue sur l'ancien code : blocage) ; réponse normale ; retry 503 avec la même clé ; Extension 28/28 | — | — |
| [ASTRA-P2-011](#astra-p2-011) | P2 | Extension | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Preuve statique à revalider lors de la correction |
| [ASTRA-P2-012](#astra-p2-012) | P2 | Identité | FERMÉ — corrigé | `c8284c6` | commands-v2-admission et raffle-v2 « ASTRA-P2-012 » (900100 via Twitch → refusé ; via simulateur → streamer ; échouent sur l'ancienne règle) ; tests existants vrai broadcaster / badge forgé / modérateur ; Core 371, Studio server 140 | Optionnel : simulateur de chat Studio en tant que « Raptoru_ (lab) » → !annuletombola annule toujours | — |
| [ASTRA-P2-013](#astra-p2-013) | P2 | Observabilité | FERMÉ — corrigé | `87465b7` | lab-core.test.ts : panne inattendue → 500 inchangé + ligne de log avec route et cause, sans secret, mot de passe ni query ; erreur attendue (400) → contrat inchangé, rien journalisé | — | — |
| [ASTRA-P2-014](#astra-p2-014) | P2 | Observabilité | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER |
| [ASTRA-P2-015](#astra-p2-015) | P2 | Observabilité | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-016](#astra-p2-016) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER |
| [ASTRA-P2-017](#astra-p2-017) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER |
| [ASTRA-P2-018](#astra-p2-018) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER |
| [ASTRA-P2-019](#astra-p2-019) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-020](#astra-p2-020) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER |
| [ASTRA-P2-021](#astra-p2-021) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL |
| [ASTRA-P2-022](#astra-p2-022) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER |
| [ASTRA-P2-023](#astra-p2-023) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER |
| [ASTRA-P2-024](#astra-p2-024) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER ; Décision préalable |
| [ASTRA-P2-025](#astra-p2-025) | P2 | Performance | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL ; Décision préalable |
| [ASTRA-P2-026](#astra-p2-026) | P2 | Restart/replay | FERMÉ — corrigé | `0e235fb` | test-lab.test.ts : processus Node réel étranger sous le PID enregistré → refusé et laissé vivant (vraie sonde CIM) ; même entrée mais créé 1 h plus tard → refusé ; bon processus → adopté ; PID nu → ancienne règle ; tests existants : adoption réelle d'un orphelin et arrêt, PID mort nettoyé ; Studio server 142 | Optionnel : Studio packagé — tuer le serveur Studio (pas l'arbre) puis relancer → « Core local orphelin retrouvé » puis remplacé | Enregistrements « PID nu » : ancienne règle jusqu'au relancement du service |
| [ASTRA-P2-027](#astra-p2-027) | P2 | Sécurité | FERMÉ — corrigé | `6df7cf6` | Desktop ipc-guard.test.ts : origine Studio / page d'état acceptées ; autre port, autre hôte, web, autre fichier, data:, URL invalide refusés ; décisions d'ouverture de fenêtre ; Desktop 19/19 ; build OK | Validé par Antoni (2026-10-05) : Réessayer/Redémarrer, pages seules. Mise à jour : à vérifier en app packagée. Overlay dédié : non applicable | — |
| [ASTRA-P2-028](#astra-p2-028) | P2 | Studio | FERMÉ — corrigé | `dcec32a` | e2e/players.e2e.ts (pages lecteurs réelles dans Chromium, Studio simulé, Web Speech/Audio factices, horloge Playwright) : TTS démarré sans fin → libéré à la borne sans ACK, TTS suivant joué, fin tardive ignorée ; lecture longue légitime terminée normalement ; stop modération → started+stopped ; Soundboard bloqué → libéré sans ACK, autres sons joués ; stop → started+stopped. Les 2 cas « sans fin » échouent sur l'ancien code, les 3 autres passent avant et après (non-régression P1-017). npm run e2e 6/6 | Validé par Antoni (2026-10-05) : TTS normal, STOP TTS puis TTS suivant, Soundboard normal et STOP | Garde TTS aux règles Core par défaut |
| [ASTRA-P2-029](#astra-p2-029) | P2 | Tests | FERMÉ — corrigé | `cc3994d` | Base jetable : les deux suites ensemble 3/3 vertes (contre 3/3 en échec avant) ; chacune seule verte ; npm test avec TEST_DATABASE_URL 383/383 ; npm test sans URL 373 + 10 ignorés (inchangé) | — | — |
| [ASTRA-P3-001](#astra-p3-001) | P3 | Build | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER ; Décision préalable |
| [ASTRA-P3-002](#astra-p3-002) | P3 | Config | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Décision préalable |
| [ASTRA-P3-003](#astra-p3-003) | P3 | Config | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Preuve statique à revalider lors de la correction |
| [ASTRA-P3-004](#astra-p3-004) | P3 | État | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Décision préalable |
| [ASTRA-P3-005](#astra-p3-005) | P3 | Observabilité | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | Décision préalable |
| [ASTRA-P3-006](#astra-p3-006) | P3 | UX | OUVERT | — | À prévoir : voir entrée | À effectuer sur le périmètre corrigé | À VÉRIFIER ; À REVALIDER SUR CODE ACTUEL ; Décision préalable |

### Marquages du registre

- **À VÉRIFIER — 21 findings :** [ASTRA-P1-004](#astra-p1-004), [ASTRA-P1-013](#astra-p1-013), [ASTRA-P2-002](#astra-p2-002), [ASTRA-P2-005](#astra-p2-005), [ASTRA-P2-014](#astra-p2-014), [ASTRA-P2-015](#astra-p2-015), [ASTRA-P2-016](#astra-p2-016), [ASTRA-P2-017](#astra-p2-017), [ASTRA-P2-018](#astra-p2-018), [ASTRA-P2-019](#astra-p2-019), [ASTRA-P2-020](#astra-p2-020), [ASTRA-P2-021](#astra-p2-021), [ASTRA-P2-022](#astra-p2-022), [ASTRA-P2-023](#astra-p2-023), [ASTRA-P2-024](#astra-p2-024), [ASTRA-P2-025](#astra-p2-025), [ASTRA-P2-026](#astra-p2-026), [ASTRA-P2-027](#astra-p2-027), [ASTRA-P2-028](#astra-p2-028), [ASTRA-P3-001](#astra-p3-001), [ASTRA-P3-006](#astra-p3-006).
- **À REVALIDER SUR CODE ACTUEL — 19 findings :** [ASTRA-P1-005](#astra-p1-005), [ASTRA-P1-006](#astra-p1-006), [ASTRA-P1-007](#astra-p1-007), [ASTRA-P1-008](#astra-p1-008), [ASTRA-P1-009](#astra-p1-009), [ASTRA-P1-010](#astra-p1-010), [ASTRA-P1-018](#astra-p1-018), [ASTRA-P2-001](#astra-p2-001), [ASTRA-P2-003](#astra-p2-003), [ASTRA-P2-005](#astra-p2-005), [ASTRA-P2-009](#astra-p2-009), [ASTRA-P2-010](#astra-p2-010), [ASTRA-P2-012](#astra-p2-012), [ASTRA-P2-013](#astra-p2-013), [ASTRA-P2-015](#astra-p2-015), [ASTRA-P2-019](#astra-p2-019), [ASTRA-P2-021](#astra-p2-021), [ASTRA-P2-025](#astra-p2-025), [ASTRA-P3-006](#astra-p3-006).
- **Présence des deux marquages — 6 findings :** [ASTRA-P2-005](#astra-p2-005), [ASTRA-P2-015](#astra-p2-015), [ASTRA-P2-019](#astra-p2-019), [ASTRA-P2-021](#astra-p2-021), [ASTRA-P2-025](#astra-p2-025), [ASTRA-P3-006](#astra-p3-006).

La checklist reste le point de suivi. Les notes de fermeture doivent indiquer la référence de code, le résultat attendu/observé, les limites restantes et, pour les décisions produit/architecture, la décision retenue.

