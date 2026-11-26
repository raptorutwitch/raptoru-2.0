# Chaos V2 — déploiement, activation, retour arrière (préparé le 26/11/2026, RIEN n'est déployé)

Branche : `feat/chaos-integration` (locale, **non poussée**) = `feat/ext-interactions` + `feat/chaos-studio` + lot 2
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
- Studio › Chaos › Sécurité › « Durée maximale d'un effet » : 30 000 ms aujourd'hui ; **60 000 ms pour ouvrir 60 s**
  (le moteur l'applique, Studio l'envoie au Core au heartbeat, l'extension propose alors jusqu'à 60 s).
- Permissions D4 : arrêter / retirer = `queue.stop` / `queue.cancel` (+ `refund` pour rembourser en même temps) ;
  remboursement manuel = `refund.manual` ; suspendre / reprendre = `module.pause` / `module.resume` ; offrir un effet
  et accorder / retirer un crédit = droit « Admin Wallet » (valeur économique).

## 2. Routes

- Viewer (JWT de l'extension, `Idempotency-Key` pour l'achat) : `GET /v1/ext/chaos/state`, `POST /v1/ext/chaos/quote`,
  `POST /v1/ext/chaos/buy` ; la session porte `chaos: { enabled, cap_s }`.
- Studio Production (jeton d'installation) : `/v1/studio/chaos/heartbeat`, `/claim`, `/requests/:id/ack`, `/stop-all`.
- Lab : `/v1/lab/chaos/<chaîne>/…` (secret Studio) ; l'extension du Lab de Studio passe par `/ext-lab/api/chaos/*`.
- Modération : commande `{ action: 'chaos', command: { action: stop | cancel | refund | pause | stop_all | gift |
credit_grant | credit_revoke, … } }` par `/moderation/v2/actions` ; aperçu D4 clé `chaos`.

## 3. Ordre (un GO par étape)

1. **Fusion** : PR de `feat/chaos-integration` vers `main` (CI verte). Indispensable avant toute release Studio : une
   release faite depuis `main` sans cette branche retirerait Chaos de Studio.
2. **Core** (Coolify, depuis `main`, OPERATIONS.md § déploiement) : sauvegarde de la base < 60 min, puis
   `plan core <sha>` → `deploy core <sha> --migrations-approved --go` (applique `20261206130000_chaos.sql`). Vérifier :
   `chaos.enabled` absent ou 0, `CHAOS_EXTENSION` non défini ; session de l'extension → `chaos.enabled: false`.
3. **Studio** : `npm run studio:release` (version calculée par le script, jamais à la main) ; installation par Antoni
   (remplace 0.1.44-chaos.11). Vérifier dans Studio › Chaos : moteur prêt ; journal « boucle Core » sans erreur ; rien
   ne se déclenche seul.
4. **Extension** : ZIP `--target production --shell v2` (déjà construit localement, voir § 7) → Hosted Test par Antoni.
5. **Essai réel sur le seul compte d'Antoni** : `CHAOS_EXTENSION=testers:<id Twitch d'Antoni>` puis `chaos.enabled = 1`.
   Liste au § 5.
6. **Tarifs** : valider [TARIFS.md](TARIFS.md) (fourchettes du 28/11) ou demander d'autres bornes.
7. **Ouverture** : revue Twitch de la version, puis `CHAOS_EXTENSION=on`.

## 4. OBS (rien à modifier)

Les achats sont joués en **mode écran** sur l'écran principal (DISPLAY1, à droite, 2560×1440) : la capture d'écran
« Écran » d'OBS les voit telle quelle, comme les essais chaos.11 validés. Aucune scène, source ni filtre à ajouter. À
vérifier une fois : la source « Écran » capture bien l'écran principal ; la fiche Studio › Chaos › Écran des effets
reste « principal ». STOP ALL : Studio › Chaos, ou console FX de l'extension (« Tout arrêter »).

## 5. Essai réel (étape 5, compte d'Antoni seulement)

1. Acheter un Clin d'œil ponctuel (8 000) : débit une fois, effet à l'écran et dans OBS, fin, historique « joué ».
2. Rejouer vite trois fois (« Ne plus demander confirmation ») : trois débits, trois effets, charges décomptées.
3. Couper Studio (ou son moteur) puis acheter : refus « Studio ne répond plus », **rien débité**.
4. Acheter un effet de 20 s puis STOP ALL au bout de 3 s : fin, **remboursé** (joué < 50 %).
5. Console FX (bouclier) : suspendre → la fiche dit « Suspendu » ; reprendre ; rembourser un effet récent ; un second
   remboursement est refusé.
6. Vérifier le solde dans le Wallet / raptoru.fr après chaque étape.

## 6. Retour arrière

- Extension : `CHAOS_EXTENSION=off` (immédiat, rien d'autre à faire ; ce qui attendait est remboursé par le balayage) ;
  au besoin, remettre la version publique précédente de l'extension.
- Core : redéployer l'image précédente ; la migration est additive (tables `chaos_*` inutilisées, contraintes élargies
  compatibles) : pas de migration inverse.
- Studio : réinstaller la version précédente (la boucle Core disparaît ; le Core ne voit plus de Studio prêt et refuse
  les achats sans débit ; ce qui attendait expire et est remboursé).
- Jetons : toute demande `queued` / `claimed` sans démarrage confirmé est remboursée par le balayage du Core (au
  démarrage et toutes les 5 s) ; un remboursement ne peut pas avoir lieu deux fois (mise à jour conditionnelle + clé
  Wallet). Un effet démarré sans fin connue reste « fin inconnue », remboursable à la main.

## 7. Livrables locaux (rien n'est publié)

Voir `docs/chaos/LIVRAISON_CHAOS_2026-11-26.md` (ZIP, SHA, tests, verdict).
