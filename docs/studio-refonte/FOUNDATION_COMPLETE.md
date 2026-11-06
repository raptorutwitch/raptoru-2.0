# RAPTORU 2.0 — STUDIO FOUNDATION COMPLETE

Ligne d'arrivée de la refonte structurelle. Fixée le 06/11/2026. **Les critères ne s'allongent pas pendant la mission** :
ce qui apparaît en cours de route va en P2 ou dans [ROADMAP.md](ROADMAP.md).

Ce jalon n'est pas la fin du développement : c'est le moment où l'on arrête de reconstruire les fondations pour créer,
remplacer et améliorer librement les modules.

**Validation** : seul Antoni valide, à la main, dans Electron ([RECETTE_FOUNDATION.md](RECETTE_FOUNDATION.md)). Un test
automatique n'est jamais une validation.

## Légende

| État | Sens |
|---|---|
| ✅ **Acquis** | Fait et prouvé (preuve citée) |
| 🔧 **À réaliser** | Reste à faire dans cette mission |
| 👤 **Validation humaine** | Réalisé et testé automatiquement, attend Antoni |
| ⏭ **Reporté** | Après le jalon, avec justification |

Priorités : **P0** bloquant (architecture, usage normal, sécurité, compatibilité, modularité) · **P1** nécessaire pour un
vrai produit · **P2** après le jalon.

## A. Architecture Core / Studio / extension / bot

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| A1 | Production et Lab démarrent par le même assemblage (`main-server.ts`) | P0 | ✅ | `index-wiring.test.ts`, `lab-environment.test.ts` |
| A2 | Le viewer ne parle qu'à `/v1/ext` ; identité jamais lue dans un corps | P0 | ✅ | `extension-frontier.core-lab.ts`, `public-frontier` |
| A3 | Prix, cooldowns, soldes, permissions, remboursements, files : Core seul dans le Lab par défaut | P0 | 🔧 | dépend de L1 (l'ancien EBS reste en retour arrière) |
| A4 | Le bot ne décide rien : transport Twitch ↔ Core | P0 | ✅ | `docs/ARCHITECTURE.md`, portes bot du Core |
| A5 | Studio garde OBS, audio, média, lecteurs : rien de ce qui exige le PC n'est déplacé | P0 | ✅ | `prod-transport/`, workers Soundboard / TTS / Bonk |

## L. Lab unique sur le vrai Core

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| L1 | `npm run studio` lance le Lab sur le vrai Core par défaut | P0 | 🔧 | |
| L2 | Retour arrière sûr et documenté vers l'ancien Lab | P0 | 🔧 | |
| L3 | Protections au démarrage : base locale, chaîne fictive, pas d'app Twitch réelle, 127.0.0.1 | P0 | ✅ | `lab-environment.test.ts` |
| L4 | OBS fictif par défaut, bot réel et autorisation Twitch refusés | P0 | ✅ | `studio-lab.boot.ts` |
| L5 | Outils du Lab cohérents : plus de contrôle affiché qui ne peut pas marcher (Test Lab, ingestion, sortie réelle) | P0 | 🔧 | |
| L6 | Une seule pile E2E par défaut (Core principal) | P1 | 🔧 | |
| L7 | Retrait de l'ancien Lab préparé et chiffré, exécuté après validation Electron | P1 | 🔧 | suppression en attente d'Antoni |

## M. Modularité réellement exploitable

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| M1 | Capacités communes : déclaration, config, activation, Wallet, permissions, historique, modération, activité, états, exécution locale, UI Studio, extension, nettoyage | P0 | 🔧 | contrat acquis (`modules-host.test.ts`) ; à vérifier sur le Core principal |
| M2 | Un nouveau module généré se raccorde et marche sur le vrai Core dans le Lab | P0 | 🔧 | |
| M3 | Un module existant change son interface ou ses réglages sans reconstruire sa plomberie | P0 | 🔧 | |
| M4 | Un nouveau module apparaît seul dans les écrans communs (catalogue, état, palette) | P1 | 🔧 | |
| M5 | Points de raccordement mesurés et publiés | P1 | 🔧 | mesure antérieure : `architecture/PREUVES.md` |
| M6 | Bonk, Soundboard, TTS gardent leur liberté (pas de modèle générique forcé) | P0 | ✅ | variantes de l'extension, D20 |

## S. Interfaces et navigation Studio

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| S1 | Navigation : six destinations, Ctrl+K, favoris, profil toujours lisible à 1360 × 900 comme à 1024 × 768 | P0 | 🔧 | shell acquis ; pied de barre tronqué |
| S2 | Centre de contrôle : verdict en une phrase, ce qui demande une action d'abord, détail à la demande | P1 | 🔧 | |
| S3 | Incidents : plus de bandeaux empilés sur chaque page | P1 | 🔧 | |
| S4 | Régie : tenir le live sans quitter la page | P1 | 🔧 | |
| S5 | Catalogue : chaque module montre son état réel | P1 | 🔧 | |
| S6 | TTS et Bonk ont une vraie page de module, en Lab comme en Production | P0 | 🔧 | aujourd'hui : renvoi vers l'Extension Lab |
| S7 | Gabarit commun des pages de module : titre, état, actions, onglets, règles repliées | P1 | 🔧 | |
| S8 | Pages historiques recomposées : Jeu des mots, Random Ban, Caution, Votekick, Roue, Effets | P1 | 🔧 | |
| S9 | Une seule identité visuelle (jetons `rs-`) | P1 | 🔧 | Soundboard, console et Tombola ont leur palette |
| S10 | Alertes : parcours clair, capacités conservées | P1 | ✅ | `alerts-studio.e2e.ts` (4 onglets) |
| S11 | Activité : un fil lisible, pas seulement des liens | P1 | 🔧 | |
| S12 | Système : organisé par onglets | P1 | 🔧 | |
| S13 | Laboratoire : outils classés, simulation claire | P1 | 🔧 | |
| S14 | Chargement, vide, erreur et confirmation homogènes | P1 | 🔧 | |

## C. Configuration et supervision des modules

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| C1 | Réglages sûrs dans Studio, bornés par le Core, jamais les chances ni les gains | P0 | ✅ | H10, `module_settings` |
| C2 | Aucune capacité de réglage perdue par la refonte visuelle | P0 | 🔧 | contrôlé à chaque page recomposée |
| C3 | Jamais de vert sur une intention seule ; état inconnu dit inconnu | P0 | ✅ | F1, `control-center.test.ts` |
| C4 | Modules du socle dans la supervision et « Prêt pour le live » | P1 | ✅ | S5 de FRICTIONS |

## E. Économie, sécurité et permissions

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| E1 | Une écriture Wallet par intention, clés idempotentes | P0 | ✅ | P0-2, intégration PostgreSQL 204/204 |
| E2 | Refus avant débit, remboursement une fois | P0 | ✅ | `modules-host`, H2-H4 |
| E3 | Aucun secret de Production dans le Lab | P0 | ✅ | `main-lab-core.ts` (environnement propre), `lab-environment.test.ts` |
| E4 | Écritures Studio protégées (hôte, en-tête Studio) | P0 | ✅ | S2 de FRICTIONS |

## H. Compatibilité des fonctions historiques

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| H1 | Parcours V1 de l'extension conservés | P0 | ✅ | `v1-parity.e2e.ts`, 91/91 sur le vrai Core |
| H2 | Anciens liens `?tab=` conservés | P1 | ✅ | `studio-shell.test.ts` |
| H3 | Production ne dépend pas de l'ancien Lab | P0 | 🔧 | à vérifier avant tout retrait (L7) |

## F. Fiabilité et gestion des erreurs

| # | Critère vérifiable | P | État | Preuve |
|---|---|---|---|---|
| F1 | Le Lab démarre, redémarre et dit clairement pourquoi il échoue | P0 | 🔧 | démarrage acquis (`studio-lab.boot.ts`) ; messages à vérifier |
| F2 | Le Core Lab absent se lit dans l'interface, sans écran vide | P1 | 🔧 | |
| F3 | Pas d'erreur console récurrente sur les pages courantes | P1 | 🔧 | 404 `/api/alerts/se`, `/cosmetics/style.css` relevés |

## T. Vérifications automatisées

| # | Critère vérifiable | P | État |
|---|---|---|---|
| T1 | E2E complets sur le vrai Core au HEAD final | P0 | 🔧 |
| T2 | Recette `studio-lab.boot.ts` au HEAD final | P0 | 🔧 |
| T3 | Intégration PostgreSQL du Core au HEAD final | P0 | 🔧 |
| T4 | Unitaires, typecheck, lint, build au HEAD final | P0 | 🔧 |

## R. Recette manuelle et préparation de livraison

| # | Critère vérifiable | P | État |
|---|---|---|---|
| R1 | Recette courte et concrète dans Electron | P0 | 🔧 |
| R2 | Ordre de livraison et retour arrière à jour, rien de publié | P0 | 🔧 |
| R3 | Checkpoint et mode de lancement à jour | P0 | 🔧 |
| R4 | Recette réalisée par Antoni | P0 | 👤 |

## Reporté après le jalon (P2)

| Sujet | Justification |
|---|---|
| Sortir Bonk, Soundboard, TTS, Tombola de l'hôte de l'extension | Fonctionnent et n'empêchent pas d'ajouter un module (D20) |
| Migrer tous les modules historiques sur le socle | À faire quand un module est retouché |
| Découpage de `commands.ts`, `tombola.ts`, `ui.js` | Règle ASTRA-P1-008 : pas de découpage « propreté » |
| Nouveau rendu d'Halloween | Événement clos pour 2026 ; réglages conservés |
| Retrait du staging VPS | Décision explicite d'Antoni |
| Session de live unique (`lab_stream_sessions`), variables = plafond | Lots F7 métier, sans effet sur le socle |

## Statut

`TECHNIQUEMENT TERMINÉ` : non. `EN ATTENTE DE VALIDATION UTILISATEUR` : non. Mis à jour à chaque lot.
