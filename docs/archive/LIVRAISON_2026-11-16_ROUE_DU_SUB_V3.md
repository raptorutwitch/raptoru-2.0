# Livraison du 16/11/2026 : Roue du Sub V3

Mandat d'Antoni du 16/11 : « GO global » pour la Roue du Sub V3, classe D (crédits, migration). Référence du module :
[../SUB_WHEEL_V3.md](../SUB_WHEEL_V3.md) § 13.

## Livré

| Élément    | Version                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| PR         | #84 (V3), #85 (test d'outillage du vérificateur de migrations)                                          |
| `main`     | `2c04a5db`, CI verte (dont `tooling`)                                                                   |
| Sauvegarde | Coolify « Backup now » 04:41:24 UTC, réussie, 9 744 425 octets                                          |
| Core       | `2c04a5db`, déployé 04:44 UTC (126 s), migration `20261130130000_sub_wheel_v3.sql` appliquée, sain      |
| Bot        | `2c04a5db`, déployé 04:46 UTC ; un seul bot actif (bail), EventSub bot et diffuseur actifs              |
| Studio     | 0.1.39 publiée 04:55 UTC (workflow GitHub, mise à jour testée sans perte de données) ; 0.1.38 installée |

## Ce qui est actif dès maintenant (Core et bot)

- Abonnement offert (et partage d'un abonnement encore offert) : jamais de roue.
- Ancienneté : un mois inconnu n'est jamais tiré ; un mois estimé attend 10 min ; confirmation par le partage, le badge
  du chat ou Studio 0.1.39.
- Barème : toujours l'ancienne roue (`grid` 1) tant qu'Antoni n'a pas choisi V3 dans Studio 0.1.39.

## Vérifications en lecture seule (Studio installé, `/api/sub-wheel/state`)

| Contrôle                                  | Avant (04:0x UTC) | Après le Core |
| ----------------------------------------- | ----------------- | ------------- |
| 20 derniers tirages crédités              | 20, 256 300       | 20, 256 300   |
| Empreinte (tirage, montant, statut, réf.) | `3e76d4ea…`       | identique     |
| Barème des tirages existants              | —                 | 1             |
| Crédits en attente · doublons possibles   | 0 · 0             | 0 · 0         |
| Revues ouvertes · droits en attente       | 0 · 0             | 0 · 0         |

Aucun solde touché, aucun tirage réel simulé en Production.

## Incidents pendant la livraison

- CI de la PR #84 : compteurs de migrations d'un test d'intégration et mode du test Studio V3 (`v2_acquire`). Corrigés
  avant fusion.
- CI de `main` (job `tooling`, absent des PR qui ne touchent pas `scripts/`) : le scénario « avant la Roue V2 » du
  vérificateur gardait la migration V3. Corrigé par la PR #85 avant tout déploiement.
- Bot : `running:unhealthy` à la fin du déploiement (healthcheck encore en période de démarrage), `running:healthy`
  30 s plus tard ; verdict du script « ÉCHEC » pour ce seul motif.

## Reste à faire (Antoni)

1. Studio › « Rechercher une mise à jour » → installer 0.1.39.
2. Roue du Sub › Barème › « Roue V3 ».
3. Regarder le premier vrai tirage V3 dans OBS.

## Retour arrière

- Barème : Roue du Sub › Barème › « Ancienne roue ».
- Code, **bot d'abord** (il envoie `is_gift` et `sub_months`, que le schéma strict de l'ancien Core refuserait) :
  `node scripts/coolify-deploy.mjs deploy bot d2fd5bb7628b54a02631f5a6dc485948c8e778ff --rollback --go`, puis
  `node scripts/coolify-deploy.mjs deploy core c1da930a1ac2da74c9ee27fbbb0a9ac4c5ac1f91 --rollback --go`. La migration
  reste : elle est additive et l'ancien Core l'ignore.
- Studio : réinstaller 0.1.38.
