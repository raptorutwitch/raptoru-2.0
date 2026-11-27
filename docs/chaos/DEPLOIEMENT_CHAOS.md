# Chaos V2 — déploiement, activation, retour arrière (préparé le 26/11/2026, mis à jour le 27/11 : PR #130, RIEN n'est déployé)

Branche : `feat/chaos-integration` (poussée le 27/11, PR #130, CI verte, **non fusionnée**) = `feat/ext-interactions` + `feat/chaos-studio` + lot 2
(contrat : [CONTRAT_LOT2.md](CONTRAT_LOT2.md), tarifs : [TARIFS.md](TARIFS.md)).
**Chaque étape ci-dessous demande le GO explicite d'Antoni.** Aucun Jeton réel n'est touché avant l'étape 5.

## 0. Ce qui part

| Composant | Contenu                                                                                                                                                                                                                                    | Visible avant activation ?                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Core      | migration additive `20261206130000_chaos.sql` (tables `chaos_*`, contraintes de modules de modération élargies à `chaos`) ; service `chaos` (devis, achat, file, boucle Studio, remboursements, balayage, modération D4, crédits, charges) | non : `chaos.enabled = 0` et `CHAOS_EXTENSION = off` par défaut              |
| Studio    | moteur Chaos V2 (chaos.11 validé) + boucle Core (`chaos/core-loop.ts`, journal durable), cible `screen` des achats, garde même hôte de `/api/chaos`, route Lab « Jouer sur mon PC » (refusée en profil Production)                         | la boucle interroge le Core ; tant que Chaos est fermé, elle ne démarre rien |
| Extension | module `modules/interactions` (Chaos + Bonk, section FX de la console, bouclier, badge Tombola), coque v2                                                                                                                                  | non : la carte n'apparaît que si la session dit `chaos.enabled`              |
| Bot       | inchangé                                                                                                                                                                                                                                   | —                                                                            |

## 1. Variables et réglages (noms seulement)

- Core, variable d'environnement `CHAOS_EXTENSION` : `off` (défaut) · `testers:<id Twitch>,<id Twitch>` · `on`. Tant
  qu'elle vaut `off`, le Core refuse tout achat Chaos sur l'économie canonique, quel que soit `chaos.enabled`.
- Core, réglages de module (`module_settings`, par chaîne) : `chaos.enabled` (0/1, défaut 0) ;
  `chaos.interrupted_refund_below` (pourcentage joué en dessous duquel un effet interrompu par une panne est remboursé,
  défaut 50, provisoire).
- Tarifs : Studio › Chaos › **Tarifs** (minimum et maximum de chaque effet, sans code ni redéploiement). Réglages de
  module masqués `chaos.price_<effet>_min` / `_max` (absents = fourchettes par défaut de TARIFS.md), écrits par paire et
  contrôlés par le Core ; jamais par « Paramètres des modules ».
- Studio › Chaos › Sécurité › « Durée maximale d'un effet » : 30 000 ms aujourd'hui ; **60 000 ms pour ouvrir 60 s**
  (le moteur l'applique, Studio l'envoie au Core au heartbeat, l'extension propose alors jusqu'à 60 s).
- Permissions D4 : arrêter / retirer = `queue.stop` / `queue.cancel` (+ `refund` pour rembourser en même temps) ;
  remboursement manuel = `refund.manual` ; suspendre / reprendre = `module.pause` / `module.resume` ; offrir un effet
  et accorder / retirer un crédit = droit « Admin Wallet » (valeur économique).

## 2. Routes

- Viewer (JWT de l'extension, `Idempotency-Key` pour l'achat) : `GET /v1/ext/chaos/state`, `POST /v1/ext/chaos/quote`,
  `POST /v1/ext/chaos/buy` ; la session porte `chaos: { enabled, cap_s }`.
- Studio Production (jeton d'installation) : `/v1/studio/chaos/heartbeat`, `/claim`, `/requests/:id/ack`, `/stop-all`.
- Tarifs : `GET` / `POST /v1/lab/chaos/<chaîne>/prices` (Lab, secret Studio) ; en Production par le cockpit de
  l'installation appairée, `/v1/studio/cockpit/chaos/<chaîne>/prices` (seule route `chaos` du cockpit, chaîne du Core
  seulement) ; l'état viewer porte `prices` (fourchettes en vigueur).
- Lab : `/v1/lab/chaos/<chaîne>/…` (secret Studio) ; l'extension du Lab de Studio passe par `/ext-lab/api/chaos/*`.
- Modération : commande `{ action: 'chaos', command: { action: stop | cancel | refund | pause | stop_all | gift |
credit_grant | credit_revoke, … } }` par `/moderation/v2/actions` ; aperçu D4 clé `chaos`.

## 3. Ordre (un GO par étape)

État de départ relevé le 27/11 (lecture seule) : Core `408f201a` (sain), bot `df3adb5e` (inchangé par Chaos : pas
redéployé), dernière sauvegarde automatique 26/11 04:00 UTC, hors live. API Coolify : `COOLIFY_URL=https://dashboard.raptoru.fr`
(`coolify.raptoru.fr` répond 502 depuis le 04/11). Seule migration de Production : `20261206130000_chaos.sql`.

1. **Fusion** de la PR #130 en **« Create a merge commit »** (jamais en squash : l'inventaire de l'extension liste les
   commits de la branche ; la fusion simulée garde `2e2d664208a9` et ses 56 commits). Puis attendre la CI du commit de
   fusion sur `main` (porte de livraison `scripts/delivery/ci-gate.mjs` : quality, core, studio, extension, e2e, images).
2. **Core, Chaos fermé** (OPERATIONS.md § 3) : « Backup now » de la base (< 60 min, statut success, taille cohérente) →
   `node scripts/coolify-deploy.mjs plan core <sha de fusion> --migrations-approved` (PRÊT) →
   `deploy core <sha> --migrations-approved --go` (suit le déploiement, vérifie `applied: 20261206130000_chaos.sql`,
   `running:healthy`, `/health`, `/ready`). Vérifier ensuite : `CHAOS_EXTENSION` absent (= `off`), `chaos.enabled` = 0,
   session de l'extension `chaos: { enabled: false }`, `/v1/ext/chaos/buy` refusé ; modules existants (Bonk,
   Soundboard, TTS, Tombola, Mini-jeux, Casino) répondent ; journaux du Core sans erreur.
3. **Studio** : workflow « Studio — construire / publier » depuis `main` (`publish = public`, version vide = **0.1.44**,
   patch suivant de 0.1.43 ; confirmation `PUBLISH studio <7 caractères du SHA>`) : tests Windows, vérification du paquet,
   essai de mise à jour sans perte de données, publication. Installation **par Antoni** (Studio › Système › Rechercher une
   mise à jour), qui remplace 0.1.44-chaos.11, Studio fermé hors live. Vérifier : Studio › Chaos moteur prêt, journal
   « boucle Core » sans erreur, Studio › Chaos › Tarifs lit les fourchettes du Core, rien ne se déclenche seul.
4. **Extension** : ligne « Validé par Antoni : oui » dans `release-inventory/INVENTAIRE-2e2d664208a9.md` (Antoni, ou
   l'agent sur son autorisation écrite) → `node scripts/package.mjs --target production --shell v2` → contrôle du ZIP
   (`modules/interactions` présent, catalogue de 13 effets, section FX de la console, aucun `lab-modules/`) →
   **Hosted Test par Antoni** (console Twitch : nouvelle version, ZIP, Hosted Test ; l'automatisation de la console est
   exclue).
5. **Essai fermé sur le seul compte d'Antoni** (id Twitch `83603689`) : variable Core
   `CHAOS_EXTENSION=testers:83603689` + redémarrage du Core (~2 min), puis Studio › Chaos › en-tête « Autoriser les achats Chaos »
   (réglage `chaos.enabled` = 1, confirmation demandée). Liste au § 5. À la fin : `chaos.enabled` = 0.
6. **Tarifs** : fourchettes du 28/11 par défaut ([TARIFS.md](TARIFS.md)), validées ou ajustées par Antoni dans
   Studio › Chaos › Tarifs (le Core les applique au devis suivant, l'extension suit en ~2 s, sans redéploiement).
7. **Ouverture publique** (dernier GO explicite, après les décisions du § 8) : revue Twitch de la version, puis
   `CHAOS_EXTENSION=on` + redémarrage du Core.

## 4. OBS (rien à modifier)

Les achats sont joués en **mode écran** sur l'écran principal (DISPLAY1, à droite, 2560×1440) : la capture d'écran
« Écran » d'OBS les voit telle quelle, comme les essais chaos.11 validés. Aucune scène, source ni filtre à ajouter. À
vérifier une fois : la source « Écran » capture bien l'écran principal ; la fiche Studio › Chaos › Écran des effets
reste « principal ». STOP ALL : Studio › Chaos, ou console FX de l'extension (« Tout arrêter »).

## 5. Essai fermé (étape 5, compte d'Antoni seulement, vrais Jetons)

Hors live, OBS ouvert, Studio 0.1.44 installé, extension en Hosted Test. Noter le solde avant ; le vérifier dans
l'en-tête de l'extension et sur raptoru.fr après chaque étape.

1. **Achat** : Clin d'œil ponctuel (7 250 aux fourchettes par défaut) → débité une fois du prix affiché ; effet sur
   l'écran et dans OBS ; historique « joué ».
2. **Prix facturé** : un effet de 10 s (ex. Miroir, 17 900) → débit = prix du devis affiché, au Jeton près.
3. **Effet qui ne démarre jamais** : couper le moteur (Studio › Chaos › Relancer, ou fermer Studio) puis acheter →
   refus « Studio ne répond plus », rien débité ; acheter un effet mis en file derrière un autre puis fermer Studio →
   après 3 min, « expiré », **remboursé automatiquement**.
4. **Arrêt anticipé** : effet de 20 s, STOP depuis la console FX au bout de 3 s → remboursé (moins de 25 % joué) ; au
   bout de 15 s → non remboursé par défaut (remboursable à la main).
5. **STOP ALL** (Studio ou console FX) pendant un effet → arrêt immédiat ; remboursé s'il a joué moins de 25 % (même règle que l'arrêt par l'équipe) ; ce qui attendait est retiré et remboursé.
6. **Modération FX** : suspendre → la fiche dit « Suspendu » ; reprendre ; rembourser un effet récent (un second
   remboursement est refusé) ; **blocage individuel** Chaos d'un compte testeur → achat refusé « bloqué », rien débité
   (avec un second compte testeur si le compte du streamer ne peut pas être bloqué).
7. **Tarif depuis Studio** : changer la fourchette d'un effet pendant que sa fiche est ouverte dans l'extension → le prix
   affiché change en ~2 s, sans redéploiement ; confirmer l'ancien prix → refusé « le prix a changé », rien débité.
8. **60 s** : Studio › Chaos › Sécurité › Durée maximale 60 000 ms → l'extension propose jusqu'à 60 s ; acheter un effet
   de 60 s → joué jusqu'au bout ; remettre 30 000 ms si voulu.
9. **Désactivation immédiate** : Studio › Chaos › décocher « Autoriser les achats Chaos » (`chaos.enabled` = 0) → la carte Interactions disparaît
   au rafraîchissement, tout achat est refusé, rien débité.

## 6. Retour arrière

| Quoi                       | Comment                                                                                                                                                                                                                      | Délai    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Couper Chaos tout de suite | Studio › Chaos › décocher « Autoriser les achats Chaos » (ou console FX › suspendre) : plus aucun achat ; ce qui attendait est remboursé par le balayage                                                                     | immédiat |
| Fermer Chaos au Core       | variable `CHAOS_EXTENSION=off` (ou supprimée) + redémarrage du Core                                                                                                                                                          | ~2 min   |
| Code du Core               | `COOLIFY_URL=https://dashboard.raptoru.fr node scripts/coolify-deploy.mjs deploy core 408f201a07cec89db0db3fd9bc3b4b7254b02940 --rollback --go` ; migration additive conservée (tables `chaos_*` ignorées par l'ancien code) | ~2 min   |
| Studio                     | réinstaller l'installateur précédent (0.1.44-chaos.11 ou 0.1.43, OPERATIONS.md § 4) : la boucle Core disparaît, le Core refuse les achats sans débit                                                                         | ~5 min   |
| Extension                  | ne pas passer la version en Release ; la version publique reste `be1744e75f63`                                                                                                                                               | —        |
| Base                       | restaurer la sauvegarde d'avant déploiement dans une base séparée (jamais sur la Production sans décision)                                                                                                                   | —        |

Jetons : toute demande `queued` / `claimed` sans démarrage confirmé est remboursée par le balayage du Core (au démarrage
et toutes les 5 s) ; un remboursement ne peut pas avoir lieu deux fois (mise à jour conditionnelle + clé Wallet). Un
effet démarré sans fin connue reste « fin inconnue » (voir § 8), remboursable à la main par la console FX.

## 7. Livrables locaux (rien n'est publié)

Voir `docs/chaos/LIVRAISON_CHAOS_2026-11-26.md` (ZIP, SHA, tests, verdict).

## 8. Décisions avant l'ouverture publique (recommandations, rien n'est appliqué)

1. **Fin d'effet inconnue** (Studio ne confirme jamais la fin) — recommandé : la traiter comme une panne et appliquer
   la politique d'interruption (remboursé sous 50 % joué), en comptant comme « joué » le temps entre le début et le
   dernier signe de vie de Studio (heartbeat) ; sans aucun signe de vie après le début → remboursé. Petit lot Core +
   tests (PostgreSQL réel), sur GO, avant `CHAOS_EXTENSION=on`.
2. **Paupières « Somnolence »** (même prix à 5 et 10 s) — recommandé : durée minimale 10 s pour ce préréglage (la
   variante du moteur est conçue pour ~12 s ; à 5 s les paupières restent fermées tout du long, c'est « Yeux fermés »).
   Les prix de 10 à 60 s ne changent pas et la progression devient strictement croissante. Catalogues Core et extension
   ensemble (test de parité), sur GO.
3. **Tarifs** : fourchettes du 28/11 conservées par défaut, éditables dans Studio › Chaos › Tarifs ; aucun changement
   de l'économie réelle sans Antoni.
