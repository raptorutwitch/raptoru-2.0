# Configuration du moteur Chaos

Le fichier est `<state-dir>/config.json`, schéma `raptoru.chaos.config`, version 5. Il se règle dans Studio ›
Chaos (panneau Réglages et carte « Écran retourné »), ou par les commandes `config.*` et `preset.*`.

## 1. Six choses séparées

| Quoi                                                                | Où                                                                            | Exemple                                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Paramètres intrinsèques d'un effet (type, bornes, défaut, animable) | **registre** (`chaos-registry.json`), jamais dans la config                   | `flip.angle` : -180 à 180, neutre 0                                                                                                |
| Préréglages utilisateur                                             | `presets.<effet>.<nom>` ; `default` = valeurs utilisées sans préréglage nommé | `presets.flip.default = { params: { fill: "black" }, duration_ms: 10000, transition: { in: { kind: "ramp", duration_ms: 550 } } }` |
| Réglages globaux du moteur                                          | `engine`                                                                      | `follow_foreground`, `capture_linger_ms`, `telemetry_interval_ms`, `default_mode`, `input_effects`                                 |
| Limites de sécurité                                                 | `safety`, toujours dans les bornes absolues du registre (`engine_limits`)     | `max_duration_ms` (30 000), `max_active_effects` (4), `safe_mode`                                                                  |
| Performances (profil et limites de coût)                            | `performance` ([PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md) § 5)          | `profile` (`equilibre`), `max_fps`, `max_passes`, `render_scale`, `gpu_budget_ms`, `on_overload`, `zero_copy`                      |
| Réglages commerciaux (prix, délais d'achat, remboursements)         | **aucun** : ils appartiendront au Core                                        | —                                                                                                                                  |

## 2. Réglages

| Réglage                        | Défaut      | Bornes                             | Effet                                                                                                                       |
| ------------------------------ | ----------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `engine.follow_foreground`     | vrai        | —                                  | fenêtre seule (diagnostic) : l'effet ne s'affiche que si la fenêtre est au premier plan                                     |
| `engine.capture_linger_ms`     | 2000        | 0 à 30 000                         | garde la capture après un effet (pas de recréation à l'effet suivant)                                                       |
| `engine.telemetry_interval_ms` | 1000        | 250 à 10 000                       | fréquence de `engine.telemetry`                                                                                             |
| `engine.default_mode`          | `window`    | `window` ou `monitor`              | cible « premier plan » : la fenêtre du jeu (calque) ou son écran entier                                                     |
| `engine.input_effects`         | faux        | —                                  | **expérimental** : sur un écran entier, Windows retourne l'affichage (souris inversée) ; chaque bascule perturbe tout le PC |
| `safety.max_duration_ms`       | 30 000      | 1000 à 60 000                      | durée maximale d'un effet                                                                                                   |
| `safety.max_active_effects`    | 4           | 1 à 8                              | effets simultanés au plus                                                                                                   |
| `safety.safe_mode`             | faux        | —                                  | les rotations deviennent instantanées                                                                                       |
| `performance.profile`          | `equilibre` | `qualite`, `equilibre`, `economie` | applique toutes les valeurs du profil ; une valeur changée à la main donne `personnalise`                                   |
| `performance.max_fps`          | 0           | 0, ou 30 à 360                     | cadence de traitement maximale par cible (0 = fréquence de l'écran)                                                         |
| `performance.max_passes`       | 6           | 1 à 8                              | passes GPU par image et par cible ; au-delà : `too_costly`                                                                  |
| `performance.render_scale`     | 1           | 0,25 à 1                           | résolution des passes intermédiaires                                                                                        |
| `performance.gpu_budget_ms`    | 2           | 0,25 à 16                          | temps GPU du moteur toléré par image                                                                                        |
| `performance.on_overload`      | `reduire`   | `signaler` ou `reduire`            | surcharge : événement seul, ou paliers annoncés (coins noirs, demi-résolution, demi-cadence) avec retour automatique        |
| `performance.zero_copy`        | vrai        | —                                  | lecture directe de l'image capturée (interrupteur de secours)                                                               |

## 3. Validation, persistance, migration

- Toute valeur est validée. Un réglage invalide est refusé (`invalid_config`), jamais corrigé en silence.
- Un préréglage est validé comme une demande d'effet.
- Écriture atomique : fichier temporaire, puis remplacement.
- Fichier illisible : défauts, et copie `config.json.illisible-<date>`.
- Valeur invalide dans le fichier : elle est ignorée et signalée (`hello.config_notes`) ; le reste est appliqué.
- Version ancienne : migrée à la lecture, avec une sauvegarde `config.json.v<n>.bak`.
  - Migration v1 → v2 : du format plat aux sections.
  - Migration v2 → v3 (22/11) : `engine.default_mode` passe à `monitor` (le retournement vise l'écran entier).
  - Migration v3 → v4 (22/11, incident de performances) : `default_mode` revient à `window`, `input_effects` est coupé.
  - Migration v4 → v5 (23/11) : section `performance` ; `engine.quality` disparaît (`high` → profil `qualite`, `auto` →
    profil `equilibre`).
  - Une migration est une fonction de plus dans `ConfigStore.Migrate`.
- Version plus récente que le moteur : refusée (`config_too_new`). Le moteur ne démarre pas plutôt que d'écraser.
- Retour aux défauts : `config.reset` (`engine`, `safety`, `performance`, `presets`, ou tout).

## 4. Emplacements

| Contexte                                  | Dossier                            |
| ----------------------------------------- | ---------------------------------- |
| Studio (profil Lab sur le Core principal) | `<runtime>/lab-main/chaos`         |
| Studio (autre profil)                     | `<runtime>/chaos`                  |
| Chaos Lab                                 | `%LOCALAPPDATA%\Raptoru\Chaos\lab` |
| Moteur lancé seul                         | `%LOCALAPPDATA%\Raptoru\Chaos`     |
