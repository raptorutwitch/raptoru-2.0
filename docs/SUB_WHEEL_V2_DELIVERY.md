# Roue du Sub V2 — livraison en Production

**Livrée le 26/10/2026** (§ 7) : PR #11, `main` `1df65d1`. Plan et décisions : [SUB_WHEEL_V2_PLAN.md](SUB_WHEEL_V2_PLAN.md). Règles de déploiement :
[CICD.md](CICD.md), [OPERATIONS.md](OPERATIONS.md). Chaque étape ci-dessous demande le **GO explicite d'Antoni**, hors
live.

## 1. Ce qui part

| Composant        | Changement                                                                                                                | Obligatoire avant le mode `v2` |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Base Production  | 7 migrations **additives** : `20261109130000` … `20261109230000` (`sub_wheel_v2*`)                                        | oui                            |
| Core             | droits V2, tirage à l'affichage, reprise des roues jamais affichées, « À vérifier », annonces, accorder par pseudo        | oui                            |
| Bot              | `409 not_lease_holder` jamais définitif (fidélité, alertes, chat)                                                         | oui (préalable P1)             |
| Studio           | onglets V2 (En attente, Droits, À vérifier…), roue réclamée seulement si le lecteur peut la jouer, rapport de fin renvoyé | oui                            |
| Extension Twitch | module « Roue du Sub » du Hub (tours du viewer, équipe : Tirer / Accorder par pseudo)                                     | non (Studio et chat suffisent) |

Compatibilité :

- migrations sur une base au niveau Production du 25/10 : lignes V1, soldes, origines du chat intacts (test permanent) ;
- nouveau Core en mode `v1` = V1 ; Studio face à un Core sans V2 (section V1, « Core à mettre à jour ») ; nouveau
  Studio face à un Core qui refuse le champ `started` (fin de roue renvoyée sans lui) (tests permanents) ;
- l'ancien service Roue de Production (`origin/main`) sur le schéma V2 complet : interrupteur, sub, resub, doublon,
  gift, affichage, échec, bail expiré, test, état — aucune erreur SQL, puis repris par le nouveau Core sans nouveau
  crédit (test ponctuel du 26/10, non conservé : il exécute du code retiré).

## 2. Ordre de livraison

0. **Intégration** : pousser `feat/sub-wheel-v2`, ouvrir la PR vers `main`, CI verte, fusionner (CI complète sur `main`).
1. **Sauvegarde** de la base Production (< 60 min, [BACKUPS.md](BACKUPS.md)).
2. **Migrations `preapplied`** (comme Spotify V2) : appliquer les 7 fichiers dans l'ordre (terminal de la base dans
   Coolify). L'ancien Core continue de tourner sans effet visible. Ne pas utiliser `post-deploy` : Coolify bascule le
   trafic avant la migration (~50 s pendant lesquelles le nouveau Core échouerait sur la Roue).
3. **Core** : Actions → Déployer Core / bot, `core`, `plan` puis `deploy`, migrations `preapplied`.
   Vérifier : `/health` `/ready`, commit rapporté, Studio 0.1.7 → section Roue (historique V1 visible), mode `v1`.
4. **Bot** : même workflow, `bot` (le Core doit déjà être sur ce commit). Vérifier : bail repris, EventSub valides.
5. **Studio** : Actions → Studio — construire / publier (`none`, puis `public`), puis « Rechercher une mise à jour »
   dans Studio. Vérifier : onglets V2 présents, « Lecteur prêt » quand la source OBS est ouverte.
6. **Extension** (facultatif) : `npm run build -w @raptoru/twitch-extension`, Hosted Test puis Release (Antoni).

Retour arrière du code : `deploy core|bot <sha précédent> --rollback` ; Studio : réinstaller la version précédente ;
le schéma reste (additif, ignoré par l'ancien code). Aucun droit n'est perdu.

## 3. Bascule V1 → V2 (Studio → Roue du Sub → Réglages, diffuseur)

| Étape | Mode         | Effet                                                                                       | Retour (sans perte)                                |
| ----- | ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0     | `v1`         | identique à aujourd'hui ; les preuves et les mois sont enregistrés en plus                  | —                                                  |
| 1     | `v2_acquire` | la V1 tire comme avant ; la V2 garde ce que la V1 perdait (roue désactivée, sub non vu)     | repasser `v1` : les droits `owed` restent          |
| 2     | `v2`         | tirage à l'affichage : demandes, puis file automatique (live, viewer présent, lecteur prêt) | repasser `v2_acquire` / `v1` : rien n'est consommé |

« Récupération automatique des doubles crédits » (`recovery_enabled`) reste **désactivée** (décision B, étape 4 du plan).

## 4. Validation limitée en Production

Hors live, après les étapes 1 à 5, mode `v1` puis `v2_acquire` :

1. Studio → Droits : rechercher `raptoru_` → la fiche s'ouvre (aucun Twitch ID demandé).
2. Mode `v2` hors live, source OBS « lecteur d'effets » **fermée** : « Accorder une roue » à `raptoru_` (motif « test
   livraison »), puis « Rattraper » → rien n'est tiré (« Lecteur d'effets : non ouvert »), le tour reste demandé.
3. Ouvrir la source OBS → la roue joue une fois, le gain est crédité une fois (Jetons de `raptoru_`), l'annonce part
   après le délai réglé (si « Sortie chat » est ON).
4. Repasser en `v2_acquire` (ou `v1`) avant le live si la bascule n'est pas décidée.

Premier live en `v2` : surveiller l'onglet Historique (aucune « jamais affichée » durable) et « À vérifier ».

## 5. États d'une roue (Studio)

En attente (droit gardé) → Tirée (gain décidé et crédité, à afficher) → En cours → Affichée, annoncée une fois.
Si elle n'est pas affichée :

- **jamais démarrée** (lecteur absent au moment de la prise, page qui ne démarre pas, lecteur occupé) : **nouvel essai
  automatique** du même tirage, sans nouveau crédit, en mode `v2`, roue active, quand ses conditions de tirage sont
  réunies (live et viewer présent, sauf demande du diffuseur ou d'un modérateur), au plus 5 fois (15 s, 30 s, 1 min,
  2 min, 4 min) ; puis « Rejouer l'animation » à la main ;
- **erreur non corrigeable par un essai** (sons de la roue manquants) : à la main ;
- **peut-être vue** (démarrée sans fin confirmée, lecteur disparu pendant la roue) : **À vérifier**, jamais rejouée
  seule ; « Elle a bien été vue » (annonce une fois) ou « Rejouer l'animation ». Un rapport de fin arrivé en retard du
  même lecteur la règle tout seul.

Studio ne réclame aucune roue tant que le lecteur ne peut pas la jouer (fermé, son bloqué, à recharger, sons manquants)
ni pendant une alerte OBS (mode `v2`) : rien n'est tiré ni payé entre-temps.

## 6. Validation Lab (Antoni, avant tout GO)

Lancer `C:\Users\Antoni\Documents\raptoru-roue-v2\lab-v2.cmd` (Studio serveur seul sur `http://127.0.0.1:4200`, base
Lab isolée ; la nouvelle migration s'applique au lancement). Ouvrir le lecteur d'effets (adresse dans Réglages ou
`/api/sub-wheel/state` → `effects.url`) dans un onglet et **cliquer une fois dedans** (son autorisé). Mode `v2`, roue
active, Simulateur Lab : live démarré, relevés actifs.

1. **Reprise automatique** : Simulateur Lab → « Faire échouer le prochain affichage » ; Droits → `raptoru_` →
   « Accorder une roue » puis « Rattraper ». Attendu : Historique « Jamais affichée : nouvel essai automatique… », puis
   ~15 s plus tard la **même** roue joue toute seule ; un seul crédit (gains de la fiche).
2. **Lecteur fermé** : fermer l'onglet du lecteur, accorder/rattraper un tour → rien n'est tiré (« Lecteur d'effets :
   non ouvert ») ; rouvrir l'onglet et cliquer → la roue joue.
3. **Peut-être vue** : pendant qu'une roue tourne, fermer l'onglet du lecteur ; après ~1 min, onglet « À vérifier » →
   « Animations peut-être vues » → « Elle a bien été vue » (ou « Rejouer l'animation ») ; aucun crédit en plus.
4. **Pseudo partout** : « Accorder un tour… » de l'onglet En attente ouvre Droits ; Simulateur Lab : viewer et
   événement par pseudo seulement.
5. **Annonce** : avec « Sortie chat » ON dans le Lab, l'annonce du gain part après le délai réglé, une seule fois,
   jamais pour un rejeu.

Non vérifiable dans le Lab : OBS réel (source navigateur), Twitch réel, la base et les services de Production.

## 7. Livraison réelle du 26/10/2026

| Étape       | Fait                                                                                                         | Preuve                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Répétition  | paquet SQL + vérificateur réel sur PostgreSQL 17 au schéma de Production du 25/10                            | le vérificateur refusait le paquet (fichiers dépendants) : corrigé (`cd80c15`), test ajouté |
| CI          | PR #11 puis `main` `1df65d1` : tous les jobs verts                                                           | runs `40262102804`, `40263235893`                                                           |
| Sauvegardes | Coolify 03:03 et 11:49 UTC (`success`, 2,68 Mo) ; profil Studio copié                                        | `Sauvegarde Raptoru 2.0\studio-profile-avant-0.1.8-2026-10-26`                              |
| SQL         | paquet `Documents\raptoru-roue-v2-GO\sub_wheel_v2_prod.sql` appliqué par Antoni (terminal Coolify)           | l'ancien Core a continué de répondre                                                        |
| Core        | `1df65d1`, `preapplied` : 7 fichiers conformes puis enregistrés, 108 s                                       | run `40318004645`, `/health` `/ready` 200                                                   |
| Bot         | `1df65d1`, 135 s : bail, EventSub bot et diffuseur, jeton diffuseur OK                                       | run `40318386899`                                                                           |
| Studio      | 0.1.8 publiée (mise à jour 0.1.7 → 0.1.8 vérifiée octet par octet), installée par Antoni, profil Production  | release `v0.1.8`                                                                            |
| Bascule     | `v1` → `v2_acquire` (12:08 UTC) → `v2` (12:12 UTC), par l'API du Core avec l'identité de Studio (journalisé) | état : interrupteur ON, 7 tirages historiques identiques, 0 droit, 0 gain en attente        |

Non fait, volontairement : aucun tour accordé ni tirage en Production pour tester (aucun crédit fictif) ; extension non
publiée (le module Roue du Hub n'est pas nécessaire : Studio et chat suffisent). Invitations : OFF à la livraison,
**activées par Antoni le 26/10 à 12:20 UTC** (Studio → Réglages).

**À observer au premier live** (aucune validation réelle encore) : un sub en live → un droit, une roue automatique
(viewer présent, lecteur prêt), un crédit, une annonce après le délai ; l'onglet Historique sans « jamais affichée »
durable ; « À vérifier » vide ou justifié ; les invitations, une par viewer et par live, seulement quand la sortie chat
est active.

**Limite connue** : une alerte OBS qui arrive pendant une roue passe au-dessus (la roue attend les alertes, pas
l'inverse ; le module d'alertes n'a pas été modifié).

Retour arrière : Studio → Roue du Sub → Réglages → `v1` (immédiat, aucun droit perdu) ; code :
`deploy core|bot 0b11cc0a98447972264ee1c25115d3baf0b9e74f --rollback` (workflow, `rollback` coché) ; Studio : réinstaller
0.1.7 ; le schéma reste (additif, vérifié avec l'ancien Core).
