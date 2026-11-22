# Moteur Chaos : contrats

Protocole **v2**. Les types TypeScript et les schémas zod sont dans `packages/schemas/src/chaos.ts`. Le registre est
`packages/schemas/src/chaos-registry.json`, et il est la seule déclaration des effets.

## 1. Transport

- Le moteur est lancé ainsi : `ChaosEngine.exe --serve --parent <pid> --state-dir <dossier> --heartbeat-ms 3000`.
- Les messages sont du JSON, un par ligne, sur stdin et stdout.
- Le client envoie un message, ne serait-ce qu'un `ping`, au moins toutes les `heartbeat-ms`. Sinon le moteur
  s'arrête et ses fenêtres disparaissent.
- Commande : `{"v":2,"id":"<corrélation>","cmd":"<nom>", …}`.
- Réponse :
  - succès : `{"v":2,"type":"response","id":"<même>","ok":true,"result":{…}}` ;
  - refus : `{"ok":false,"error":{"code","message"}}`.
- Événement : `{"v":2,"type":"event","event":"<nom>","t_ms":<ms depuis le lancement>, …}`.

## 2. Commandes

| Commande                                     | Corps                                                           | Résultat                                                                              |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `hello` / `ping`                             | —                                                               | identité, version, protocole, registre, carte graphique, temps de démarrage / horloge |
| `describe`                                   | —                                                               | `registry` (le fichier entier), `implemented`, `primitives`, `curves`                 |
| `status`                                     | —                                                               | effets actifs et en file (vues), surfaces, captures ouvertes, gardien, configuration  |
| `diagnostics`                                | —                                                               | télémétrie complète, shaders, pool, gardien, démarrage                                |
| `targets.list`                               | —                                                               | fenêtres proposables (hwnd, titre, processus, taille, réduite, premier plan)          |
| `effect.request`                             | voir § 3                                                        | la vue de la demande (§ 4)                                                            |
| `effect.cancel`                              | `request_id`, `immediate?`, `reason?`                           | `{canceled}`                                                                          |
| `stop_all`                                   | `reason?`                                                       | `{stopped: n}` (file vidée, tout coupé sans transition)                               |
| `config.get` / `config.set` / `config.reset` | `section` (`engine`, `safety` ; `presets` pour reset), `values` | la configuration                                                                      |
| `preset.set` / `preset.delete`               | `effect`, `name`, `value` (params, `duration_ms`, `transition`) | la configuration                                                                      |
| `shutdown`                                   | —                                                               | `{bye}`, puis STOP ALL et sortie                                                      |

Codes d'erreur courants :

- enveloppe : `bad_json`, `unsupported_version`, `unknown_command`, `bad_id` ;
- demande : `bad_request_id`, `unknown_effect`, `invalid_source`, `internal_effect`, `invalid_priority`,
  `invalid_policy`, `unknown_preset`, `unknown_variant` ;
- paramètres et durée : `unknown_param`, `invalid_param`, `param_out_of_range`, `param_not_overridable`,
  `duration_out_of_range`, `invalid_transition` ;
- cible : `no_window`, `target_minimized`, `exclusive_fullscreen`, `no_foreground`, `invalid_target` ;
- autres : `unknown_request`, `invalid_config`, `config_too_new`.

## 3. Demande d'effet (`effect.request`)

Une demande sépare les éléments suivants :

- **identité** : `request_id`, l'idempotence (une demande rejouée rend son état, sans doublon) ;
- **effet** : `effect`, et facultativement `variant` et `preset` ;
- **paramètres** : `params` ;
- **durée** : `duration_ms` ;
- **transition** : `transition.in` et `transition.out` (`kind`, `duration_ms`) ;
- **priorité** : `priority` (-100 à 100) ;
- **politique de conflit** : `policy` (`queue`, `replace`, `reject` ou `extend`) ;
- **source** : `source.kind` et `source.ref` ;
- **cible** : `target` ;
  - `{kind:"window",hwnd}` (mode D) ;
  - `{kind:"foreground"}` ;
  - `{kind:"monitor",hwnd?}` (mode C) ;
  - `follow_foreground?`.

Sources possibles : `studio`, `core`, `extension`, `channel_points`, `test`.

- Une source externe (`core`, `extension`, `channel_points`) ne peut ni régler un paramètre non exposé, ni demander
  un effet interne (diagnostic).
- **Aucun prix, aucun Jeton, aucune récompense** : ils seront gérés par le Core, avant la demande et à partir des
  événements.

## 4. États et événements (ce que le Core écoutera)

`effect.<état>`, avec la vue complète de la demande :

| Événement                           | Sens                                                                                                                                                                                 | Pour le futur Core             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `accepted`                          | va démarrer (ressources en préparation)                                                                                                                                              | —                              |
| `queued`                            | en file (`position`, `blocked_by`)                                                                                                                                                   | afficher « en attente »        |
| `started`                           | **première image réellement visible** (la durée court à partir de là)                                                                                                                | point de non-remboursement     |
| `extended`                          | prolongé par une autre demande (`by`)                                                                                                                                                | —                              |
| `ended`                             | terminé (`reason` : `duration`, `canceled`, `stop_all`, `emergency_hotkey`, `target_lost`, `capture_lost`, `never_visible`, `replaced`, `shutdown`…), avec `started` et `visible_ms` | rembourser si `started` = faux |
| `failed`                            | échec (`reason`, `detail`)                                                                                                                                                           | rembourser si `started` = faux |
| `canceled` / `expired` / `rejected` | annulé en file / attente trop longue / refusé (`reason`)                                                                                                                             | rembourser                     |
| `merged` / `duplicate`              | absorbé par un prolongement / demande rejouée                                                                                                                                        | —                              |

Événements du moteur :

- `engine.ready`, `engine.telemetry`, `engine.degraded` et `engine.recovered` ;
- `engine.emergency_stop`, `engine.error` et `engine.exit` (avec `reason`).

## 5. Fichiers

- **Registre** : schéma `raptoru.chaos.registry`, version. Voir `chaosRegistrySchema`.
- **Configuration** : `<state-dir>/config.json`, schéma `raptoru.chaos.config`, version 2.
- **Cache des shaders** : `<state-dir>/shader-cache/*.cso`, effaçable sans risque.
- Studio garde un dossier par profil (`runtime/…/chaos`). Le Chaos Lab utilise `%LOCALAPPDATA%\Raptoru\Chaos\lab`.

## 6. Versionnement

- `v` du protocole : un moteur refuse toute autre version.
- `version` du registre, et `version` de chaque effet. Un effet change de version quand ses paramètres changent de
  sens.
- `version` de la configuration, migrée à la lecture. Une configuration plus récente que le moteur est refusée.
