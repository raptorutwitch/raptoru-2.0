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

| Commande                                     | Corps                                                                                     | Résultat                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hello` / `ping`                             | —                                                                                         | identité, version, protocole, registre, carte graphique, temps de démarrage / horloge                                                                                                                                                      |
| `describe`                                   | —                                                                                         | `registry` (le fichier entier), `implemented`, `primitives`, `curves`                                                                                                                                                                      |
| `status`                                     | —                                                                                         | effets actifs et en file (vues), surfaces, captures ouvertes, gardien, `input`, configuration                                                                                                                                              |
| `diagnostics`                                | —                                                                                         | télémétrie complète, shaders, pool, gardien, démarrage                                                                                                                                                                                     |
| `targets.list`                               | `windows?` (faux : écrans seulement)                                                      | `monitors` rangés de gauche à droite (device, `key` left/right/s:n, libellé « Écran gauche »…, `order`, principal, position, taille, `hz`, orientation, premier plan) et `windows` (hwnd, titre, processus, taille, réduite, premier plan) |
| `effect.request`                             | voir § 3                                                                                  | la vue de la demande (§ 4)                                                                                                                                                                                                                 |
| `effect.cancel`                              | `request_id`, `immediate?`, `reason?`                                                     | `{canceled}`                                                                                                                                                                                                                               |
| `effect.activate`                            | `effect`, `kind` (`test` : 5 s au plus, `manual`), `request_id`, `source`                 | `{effect, kind, screen, activations}` : l'effet avec SES réglages (écran(s) de `effects.<effet>`, préréglage `default`) ; une activation par écran (`id:rang`) pour « tous »                                                               |
| `effect.stop`                                | `effect`, `immediate?`                                                                    | `{effect, stopped: n}` : toutes ses activations (transition de sortie)                                                                                                                                                                     |
| `stop_all`                                   | `reason?`                                                                                 | `{stopped: n}` (file vidée, tout coupé sans transition)                                                                                                                                                                                    |
| `config.get` / `config.set` / `config.reset` | `section` (`engine`, `safety`, `performance`, `effects` ; `presets` pour reset), `values` | la configuration                                                                                                                                                                                                                           |
| `preset.set` / `preset.delete`               | `effect`, `name`, `value` (params, `duration_ms`, `transition`)                           | la configuration                                                                                                                                                                                                                           |
| `shutdown`                                   | —                                                                                         | `{bye}`, puis STOP ALL et sortie                                                                                                                                                                                                           |

Codes d'erreur courants :

- enveloppe : `bad_json`, `unsupported_version`, `unknown_command`, `bad_id` ;
- demande : `bad_request_id`, `unknown_effect`, `invalid_source`, `internal_effect`, `invalid_priority`,
  `invalid_policy`, `unknown_preset`, `unknown_variant` ;
- paramètres et durée : `unknown_param`, `invalid_param`, `param_out_of_range`, `param_not_overridable`,
  `duration_out_of_range`, `invalid_transition` ;
- cible : `no_window`, `no_monitor`, `screen_missing`, `target_minimized`, `exclusive_fullscreen`, `no_foreground`,
  `invalid_target` ;
- coût et disponibilité : `too_costly`, `effect_disabled` (effet désactivé, source communautaire) ;
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
  - `{kind:"screen",device}` (fiche d'un effet) : la fenêtre qui occupe cet écran (jeu en fenêtré sans bordure,
    fenêtre agrandie), en calque, sans devoir être au premier plan ; à défaut, l'écran entier ; `target.screen` dit
    « Écran gauche · 1920×1080 » ;
  - `{kind:"monitor",device}` : l'écran entier `\\.\DISPLAYn` (mode C). Si `engine.input_effects` est activé
    (expérimental), Windows retourne l'écran et la souris est inversée ([COUCHE_ENTREES.md](COUCHE_ENTREES.md)) ;
    sinon, ce n'est qu'un calque, invisible dans la capture d'écran d'OBS ;
  - `{kind:"monitor",hwnd?}` : l'écran qui contient cette fenêtre ;
  - `{kind:"foreground"}` (défaut) : la fenêtre du jeu au premier plan (`default_mode` = `window`, défaut), ou son
    écran entier (`monitor`) ;
  - `{kind:"window",hwnd}` (mode D, calque par défaut : image retournée, souris normale, clics au point symétrique) ;
  - `follow_foreground?` (fenêtre seule).
- La vue de la demande dit ce qui sera fait : `target.mode` (`C` écran entier, `D` fenêtre), `target.input`
  (`invert_xy` ou null), `target.title`.

Sources possibles : `studio`, `core`, `extension`, `channel_points`, `test`.

- Une source externe (`core`, `extension`, `channel_points`) ne peut ni régler un paramètre non exposé, ni demander
  un effet interne (diagnostic).
- **Aucun prix, aucun Jeton, aucune récompense** : ils seront gérés par le Core, avant la demande et à partir des
  événements.

## 4. États et événements (ce que le Core écoutera)

`effect.<état>`, avec la vue complète de la demande :

| Événement                           | Sens                                                                                                                                                                                                                         | Pour le futur Core             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `accepted`                          | va démarrer (ressources en préparation)                                                                                                                                                                                      | —                              |
| `queued`                            | en file (`position`, `blocked_by`)                                                                                                                                                                                           | afficher « en attente »        |
| `started`                           | **première image réellement visible** (la durée court à partir de là)                                                                                                                                                        | point de non-remboursement     |
| `extended`                          | prolongé par une autre demande (`by`)                                                                                                                                                                                        | —                              |
| `ended`                             | terminé (`reason` : `duration`, `canceled`, `stop_all`, `emergency_hotkey`, `target_lost`, `capture_lost`, `display_changed`, `input_unavailable`, `never_visible`, `replaced`, `shutdown`…), avec `started` et `visible_ms` | rembourser si `started` = faux |
| `failed`                            | échec (`reason`, `detail`)                                                                                                                                                                                                   | rembourser si `started` = faux |
| `canceled` / `expired` / `rejected` | annulé en file / attente trop longue / refusé (`reason`)                                                                                                                                                                     | rembourser                     |
| `merged` / `duplicate`              | absorbé par un prolongement / demande rejouée                                                                                                                                                                                | —                              |

Événements du moteur :

- `engine.ready`, `engine.telemetry`, `engine.degraded` et `engine.recovered` ;
- `engine.input` : bascule d'affichage de la couche Entrées (`state` = `applied`, `restored` ou `lost`, `device`,
  `request_id`, `call_ms`, `qpc` et `qpc_freq` pour aligner une mesure externe) ;
- `engine.emergency_stop`, `engine.error` (dont `input_unavailable`, `input_busy` avec `request_id`) et
  `engine.exit` (avec `reason`).

État du curseur retourné (`status.cursor`, `diagnostics.cursor`, `engine.telemetry.cursor`) : `enabled`
(`engine.cursor_follow`), `hidden` (curseur matériel masqué en ce moment), `hides`, `hidden_ms`, `shapes` (formes
lues), `failures`, `last_error`. Par surface (`engine.telemetry.surfaces[]`) : `cursor_follow`, `cursor_over`,
`cursor_latency_est_p50_ms` et `cursor_latency_est_p95_ms`.

État de la couche Entrées (`status.input`, `diagnostics.input`) : `primitive` (`display_orientation`), `active`
(`owner` = request_id, `device`, `orientation`, `since_ms`, `apply_ms`), `last_apply_ms`, `last_revert_ms`.

## 5. Fichiers

- **Registre** : schéma `raptoru.chaos.registry`, version 2. Voir `chaosRegistrySchema`. `input_effects` déclare les
  transformations d'entrée ; un effet s'y relie par `input`. Un effet de l'emplacement `transform` peut déclarer
  `cursor: "follow"` : le curseur visible suit l'image (retournement).
- **Configuration** : `<state-dir>/config.json`, schéma `raptoru.chaos.config`, version 5 (section
  `performance` ; `engine.cursor_follow`). Version 4 : retour au calque sur la fenêtre, `input_effects` coupé. Avant : version 3 (v2 migrée : la cible par
  défaut devient l'écran entier).
- **Cache des shaders** : `<state-dir>/shader-cache/*.cso`, effaçable sans risque.
- Studio garde un dossier par profil (`runtime/…/chaos`). Le Chaos Lab utilise `%LOCALAPPDATA%\Raptoru\Chaos\lab`.

## 6. Versionnement

- `v` du protocole : un moteur refuse toute autre version.
- `version` du registre, et `version` de chaque effet. Un effet change de version quand ses paramètres changent de
  sens.
- `version` de la configuration, migrée à la lecture. Une configuration plus récente que le moteur est refusée.
