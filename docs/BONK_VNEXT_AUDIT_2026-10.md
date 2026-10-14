# Bonk VNext — audit et architecture proposée (2026-10-14)

> Audit seul, aucun code. Lu sur le vrai code au commit `c7f20de` (branche `feat/compact-video-port`).
> Rien n'est validé ici : c'est une proposition à valider par Antoni avant tout lot.

## 1. Architecture Bonk actuelle (chaîne réelle)

| #   | Étape            | Fichiers                                                                                                                                                         | Données                                                                                                                                                                                                                                                                                                                                        | Côté      |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Clic viewer      | `extension/shared/ui.js` (`sendBonk` l.2100, formulaire l.3780+, « + Munitions » l.3543)                                                                         | `spendTokens('bonk', {emote_source, emotes:[id], emote_glyph})` + clé d'idempotence par clic                                                                                                                                                                                                                                                   | Extension |
| 2   | Frontière viewer | `core-api/src/ext/ext-facade.ts` `spend()` l.560                                                                                                                 | JWT → viewer ; `emotes.length` doit valoir **1** ; `channel_id` = chaîne du Core                                                                                                                                                                                                                                                               | Core      |
| 3   | Admission        | `core-api/src/bonk-lab/bonk-lab-service.ts` `admitTx()` l.354                                                                                                    | 1 transaction : verrou canal → idempotence (hash) → pause globale / module / blocage / cooldown → validation emote (catalogue Twitch du viewer, 7TV/BTTV/FFZ, Twemoji) → `sweep` → Studio prêt (heartbeat < 10 s, OBS, source, renderer) → file ≤ 50 → `channel_sequence` +1 → ligne `queued` (`expires_at` = +120 s) → débit wallet (même tx) | Core      |
| 4   | Paiement         | `economy.debit` (défaut `labEconomy`, Jetons de test) ; `refund` idempotent (expiré, échec avant start, modération)                                              | 200 `jetons_lab`, `real_debited = 0`                                                                                                                                                                                                                                                                                                           | Core      |
| 5   | Claim            | `bonk-lab-service.ts` `claim()` l.651 ; route `http/studio-transport-routes.ts`                                                                                  | Studio prêt + module actif + **aucun claim non démarré** → plus ancien `queued` par `channel_sequence` → delivery (attempt, bail 30 s)                                                                                                                                                                                                         | Core      |
| 6   | Studio           | `studio/server/src/bonk-lab/worker.ts`, `runtime.ts`, `worker-loop.ts`                                                                                           | Boucle 150 ms : heartbeat, ACK en attente, claim (≤ 12 entrées locales). Journal disque : `sent` écrit **avant** de donner l'effet → jamais de rejeu                                                                                                                                                                                           | Studio    |
| 7   | Overlay          | `studio/server/bonk-overlay/overlay.js` + `bonk-v3-core.js` (moteur legacy copié octet pour octet)                                                               | Poll `/next` toutes les 100 ms ; vérifie l'URL d'emote (allowlist CDN) ; **refuse tout ce qui n'est pas `test_mode` + `simulated`** ; anime ; ACK `started` puis `completed` (retry ACK seulement)                                                                                                                                             | Overlay   |
| 8   | ACK              | Studio journalise puis relaie à Core (`ack()` l.702) : `started` → `executing` (bail 60 s), `completed`, `failed` (+ refund si non démarré), `execution_unknown` | Core                                                                                                                                                                                                                                                                                                                                           |

### Où sont calculés les paramètres visuels aujourd'hui (tout overlay-side)

| Paramètre         | Où                    | Valeur actuelle                                                                                                                                                                           |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position d'impact | `overlay.js`          | **fixe** (960, 400) sur un canvas fixe 1920×1080                                                                                                                                          |
| Taille            | `overlay.js`          | **fixe 150 px** (`sampleBonkSize` existe dans le moteur mais n'est pas utilisé ; il donnerait 0,45×–1,55×, soit un écart ×3,4)                                                            |
| Rotation          | `buildBonkTrajectory` | 50 % lente (35–145°/s), 50 % rapide (250–620°/s), puis roulage physique                                                                                                                   |
| Trajectoire       | `buildBonkTrajectory` | 1 seule famille balistique, 6 entrées (top ×2, left, right, topleft, topright), gravité 3 800, rebond sol/bords, sortie « fall » ou « shrink » ; graine = `interaction_id` (déterministe) |
| Durée             | `buildBonkTrajectory` | ≈ 2,6–4,5 s                                                                                                                                                                               |
| Son               | `overlay.js`          | `punch-2.mp3`, volume 0,4, **à chaque impact** (la pool de 7 sons du moteur n'est pas utilisée)                                                                                           |
| Burst / combo     | `bonk-v3-core.js`     | `createBonkComboController`, Giga : **présents mais non branchés**                                                                                                                        |
| Cible caméra      | —                     | aucune (`DEFAULT_CAMERA` constant dans le moteur)                                                                                                                                         |

### Réponses directes

- **1 clic = 1 interaction** Core. Aucun lot. Le mode « Munitions » de l'extension est un chargeur local : chaque clic tire la munition suivante, toujours 1 requête.
- **Ordre** : `channel_sequence` alloué sous verrou de canal, claim strictement dans l'ordre.
- **Délais** : expiration 120 s si jamais démarré ; bail 30 s claim→started ; 60 s started→completed ; `sweep` → `failed(expired)` + remboursement, ou `execution_unknown`.
- **Plusieurs Bonk rapides** : animations superposées dans l'overlay, mais **les départs sont sérialisés** : un nouveau claim n'est possible qu'après l'ACK `started` du précédent. Chaque Bonk coûte un aller-retour : poll overlay 100 ms → Studio → ACK → tick 150 ms → Core (réseau) → claim. Cadence réelle ≈ 2–4 Bonk/s, avec du jitter réseau : **aucune maîtrise du rythme**.
- **Densité** : file ≤ 50 ouverts par canal (refus `queue_full`), ≤ 12 entrées locales Studio. **Aucune limite visuelle** dans l'overlay.
- **Son** : un `new Audio()` par impact, sans plafond.

## 2. Limites actuelles

1. Cible fixe, canvas fixe 1920×1080, source OBS au nom imposé « Raptoru Bonk Lab ».
2. Taille unique ; une seule famille de trajectoire ; aucun FX hormis l'anneau jaune « Lab ».
3. Son systématique, sans gouverneur.
4. Rythme non maîtrisable (sérialisation claim/started + réseau).
5. **Bloquants prod** (indépendants du visuel) :
   - l'overlay refuse tout paiement non simulé ;
   - le Core public utilise `labEconomy` (le Wallet réel n'est pas branché) ;
   - le mot de passe OBS n'est pas persisté et la connexion ne se refait pas seule : après un redémarrage de Studio ou d'OBS, Bonk reste indisponible jusqu'à une reconnexion manuelle ;
   - le `sweep` d'une chaîne ne tourne qu'au claim ou à l'admission sur cette chaîne : des `queued` orphelins restent (cas LeCroupier_ en B3).
6. Le Studio claim avec la chaîne de son build, et le Core ne vérifie pas qu'elle est la sienne : claim vide silencieux (vu en B3).

## 3. Architecture VNext recommandée

Principe : **le Core reste l'autorité économique et d'ordre, l'overlay devient un vrai moteur de rendu, et Studio fournit la cible.**

```
Extension ── shot ou salve ──▶ Core (admission atomique : N interactions, 1 transaction, N débits)
                                  │ claim (unitaire, ou toute la salve d'un coup)
                                  ▼
Studio ── journal (inchangé) ── cible résolue (Auto OBS / Manuel / Fullscreen) + réglages de rendu
                                  ▼
Overlay ── planificateur (cadence locale) → gouverneur densité → sélection famille/preset (graine)
        → moteur physique → gouverneur audio → ACK par shot
```

- **Core** : ne connaît **aucun** paramètre visuel. Il ajoute seulement la notion de salve (§13).
- **Studio** : résout la cible (obs-websocket, lecture seule), stocke les réglages de rendu et les pousse à l'overlay avec un numéro de version.
- **Overlay** : tout le visuel et l'audio, déterministe par `interaction_id` (même graine → même rendu, testable).
- Le moteur legacy est découpé en modules dans `apps/studio/server/bonk-overlay/engine/` (cible, tailles, familles, presets, densité, audio) ; `overlay.js` ne fait que les câbler (règle des fichiers centraux).

## 4. Décision : Bonk individuel ou séquences

| Critère                   | A. Séquence Core-side (1 interaction = N tirs) | B. Individuels, cadence côté client / Studio   | **C. Recommandé : salve = N interactions liées, admises et claimées ensemble, cadencées par l'overlay**                                             |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fiabilité                 | ACK partiel ambigu (« 6 tirs sur 10 ? »)       | Bonne                                          | Bonne : chaque tir garde son cycle de vie                                                                                                           |
| Reprise après déconnexion | Tout ou rien, `execution_unknown` global       | Par tir                                        | Par tir (journal inchangé)                                                                                                                          |
| Wallet                    | 1 débit, remboursement partiel à inventer      | N requêtes, N débits, échec possible au milieu | N débits **dans 1 transaction** (tout ou rien à l'admission), remboursement par tir (existant)                                                      |
| Ordre                     | Garanti                                        | Entrelacé avec les autres viewers              | Séquences contiguës + ordre intra-salve                                                                                                             |
| ACK                       | 1 pour N : perte de précision                  | N, mais rythme cassé                           | N (par tir), éventuellement groupés en un appel                                                                                                     |
| Persistance               | 1 ligne                                        | N lignes                                       | N lignes + `volley_id`                                                                                                                              |
| Timing                    | Précis (overlay)                               | **Mauvais** (réseau + sérialisation)           | **Précis** : l'overlay planifie localement                                                                                                          |
| Modération                | Bloc / cooldown sur 1 action                   | Chaque tir revalidé (lourd)                    | Validée 1 fois pour la salve ; pause = pas de nouvelle salve (une salve dure ≤ ~3 s : cohérent avec « pas de stop »/« pas d'annulation » pour Bonk) |
| Réseau                    | 1 requête                                      | N requêtes viewer + N claims                   | 1 requête viewer + 1 claim + ACK                                                                                                                    |
| UX                        | Bonne                                          | Saccadée                                       | Bonne, cadence ressentie                                                                                                                            |

**Recommandation : C.** On garde l'invariant « 1 tir = 1 interaction » (paiement, remboursement, historique, modération, ACK : rien à réinventer) et on ajoute un regroupement (`volley`) que le Core admet atomiquement et que le claim délivre d'un bloc. La cadence est jouée par l'overlay, seul endroit où le timing peut être exact. Un tir unique est simplement une salve de 1 : même chemin, aucune double implémentation.

Modes viewer (extension), tous sur ce même chemin :

| Mode               | Contenu                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coup unique        | 1 tir                                                                                                                                                       |
| Rafale courte      | 3 tirs, 110 ms                                                                                                                                              |
| Salve              | 5 tirs, 180 ms                                                                                                                                              |
| Mitraille          | 2–10 tirs (le chargeur « Munitions » existant), cadence réglable : lent 300 ms, normal 180 ms, rapide 110 ms                                                |
| Auto-fire maintenu | **à reporter** : tant que le bouton est tenu, envoi de salves successives de ≤ 10. Ça pose une question de dépense continue : à décider après la mitraille. |

Bornes Core : `shot_count` 1–10 et `cadence_ms` 90–600. Ces bornes, et le coût par tir, sont des réglages Core (cockpit), jamais fixés par le client.

## 5. Détection Auto OBS (sources + transforms, sans IA)

**Requêtes obs-websocket v5, lecture seule** :

- `GetVideoSettings` (canvas de base) ;
- `GetCurrentProgramScene` ;
- `GetSceneItemList` / `GetGroupSceneItemList` ;
- `GetSceneItemTransform` ;
- `GetInputSettings` / `inputKind` ;
- `GetSourceScreenshot` (aperçu Manuel uniquement).

**Événements** : passer `eventSubscriptions` de 0 aux catégories Scenes, SceneItems, Inputs et Config. Événements utiles :

- `CurrentProgramSceneChanged` ;
- `SceneItemTransformChanged` ;
- `SceneItemEnableStateChanged` ;
- `SceneItemCreated` / `SceneItemRemoved` ;
- `InputNameChanged` ;
- `VideoSettingsChanged`.

Chaque événement déclenche un recalcul débouncé (100 ms) et une nouvelle version de cible poussée à l'overlay. Une relecture complète toutes les 5 s sert de filet.

**Algorithme** : parcours récursif de la scène programme.

- Pour chaque item **visible** (`sceneItemEnabled`), composer la matrice : position, rotation, échelle, alignement, bounds (type, taille, alignement), crop.
- Si l'item est une scène imbriquée ou un groupe, descendre avec la matrice parente. Un parent masqué masque tout son sous-arbre.
- Une caméra est un input de kind `dshow_input` (Windows), `av_capture_input(_v2)` (macOS) ou `v4l2_input` (Linux), **ou** une source épinglée par nom dans Studio (NDI, capture d'écran de téléphone, etc.).
- Le rectangle final se calcule dans le canvas après crop et scale. En cas de rotation, on garde le rectangle orienté (centre, demi-axes, angle) et sa boîte englobante.
- Coordonnées **normalisées 0..1 du canvas** : ça règle le cas d'un canvas différent de 1080p.
- Il faut aussi lire la transform de la source overlay Bonk elle-même. Si elle ne couvre pas tout le canvas, convertir les coordonnées ou signaler « overlay non plein écran ».

**Sélection** quand plusieurs caméras sont visibles :

1. la source épinglée, si elle est visible ;
2. sinon la plus grande surface visible ;
3. à égalité, celle du dessus.

Une même source réutilisée dans plusieurs scènes est traitée par instance : seule la scène programme compte.

**Repli** si aucune caméra n'est visible : zone Manuel de la scène, sinon Manuel global, sinon Fullscreen. Le statut Studio indique la cible effective (« Auto · Cam Logitech · scène Just Chatting », ou « Auto → repli Fullscreen : aucune cam visible »).

## 6. Modèle de zone cible

La cible est un rectangle orienté normalisé, `{mode, rect, angle, source, scene, version}`. Le point d'impact est tiré par catégorie pondérée, avec une graine par `interaction_id` :

| Catégorie       | Poids | Point d'impact                                                 | Suite                             |
| --------------- | ----- | -------------------------------------------------------------- | --------------------------------- |
| Couronne (bord) | 45 %  | bande ±12 % autour du bord, pondérée par la longueur des côtés | rebond vers l'extérieur           |
| Traversée       | 22 %  | intérieur hors noyau central (30 %)                            | la trajectoire continue à travers |
| Effleurement    | 15 %  | juste à l'extérieur du bord                                    | déviation légère                  |
| Décalé          | 15 %  | halo extérieur jusqu'à +25 %                                   | impact « raté » sobre             |
| Centre          | 3 %   | noyau                                                          | impact franc                      |

Anti-agglutinement : rejet si le point tombe à moins d'une demi-taille d'un des 6 derniers impacts (2 essais, puis on garde).

Fullscreen : la cible est le canvas moins une marge de 6 %, avec la même anti-agglutination, sans couronne.

## 7. Modèle de trajectoires

Les familles sont pondérées et paramétrées. Le moteur physique actuel (pas de 16 ms, gravité, rebonds) reste le socle : une famille ne fait que choisir les entrées du simulateur.

| Famille       | Poids | Entrée                 | Caractère                                                |
| ------------- | ----- | ---------------------- | -------------------------------------------------------- |
| Chute         | 20 %  | haut → bas             | gravité normale, rotation lente                          |
| Diagonale     | 18 %  | coins hauts            | rapide                                                   |
| Lancer en arc | 18 %  | gauche ↔ droite        | apex au-dessus de la cible                               |
| Tir tendu     | 12 %  | côté, quasi horizontal | gravité ×0,4, impact direct                              |
| Remontée      | 10 %  | bas → haut             | balistique montante, retombe                             |
| Lourd         | 9 %   | haut                   | vitesse ×0,7, gravité ×1,3, peu de rotation, gros squash |
| Courbe        | 9 %   | côté                   | dérive latérale (force latérale décroissante)            |
| Abstrait      | 4 %   | angle inhabituel       | spin fort, rotation inversée à l'impact                  |

Rotation, définie par famille :

- spin lent 50 % ;
- spin rapide 30 % ;
- sans spin puis vrille à l'impact 20 %.

Anti-répétition : pas 3 fois de suite la même famille, ni 2 fois la même entrée.

## 8. Distribution de tailles

La taille moyenne `M` est réglable, 128 px par défaut à 1080 p (mise à l'échelle avec la hauteur du canvas). Le décalage se tire dans un mélange :

Révisé le 2026-10-14 après retour d'Antoni : la moyenne doit être largement dominante et les gros, rares.

| Part  | Décalage                                     | À M = 128             |
| ----- | -------------------------------------------- | --------------------- |
| 80 %  | gaussienne σ 5 px, bornée à ±10 px           | 118–138 px            |
| 14 %  | 10 à 20 px (60 % plus petit, 40 % plus gros) | 108–118 ou 138–148 px |
| 4 %   | −20 à −32 px                                 | 96–108 px             |
| 1,5 % | +20 à +26 px                                 | 148–154 px            |
| 0,5 % | −32 à −44 px (très petit)                    | 84–96 px              |

Résultat : 94 % des emotes dans ±20 px, 80 % dans ±10 px. Les plus grosses dépassent +20 px dans 1,5 % des cas seulement, sans aller au-delà de +26 px. Le rapport max/min est de 1,83 sur les extrêmes et de 1,37 dans la bande normale. Le réglage « variance » multiplie les décalages (Faible ×0,6, Normale ×1, Forte ×1,3), jamais la moyenne. `sampleBonkSize` (écart ×3,4) est remplacé.

## 9. Système FX / presets

Un preset est une **donnée**, pas du code :

```
{ id: 'double-bounce-cam', tier: 'variant', weight: 6, cost: 2,
  families: ['chute','lourd'],                    // compatibilité (optionnel)
  impact: [{ fx: 'squash', k: .18 }],
  after:  [{ fx: 'bounce', collider: 'target', count: 2, restitution: .45 }],
  exit:   'roll' | 'fall' | 'shrink' | 'slide',
  sound:  'impact' | 'heavy' | 'pop' | 'none' }
```

Le tirage se fait par tier (common 82 %, variant 14 %, rare 3,5 %, very_rare 0,5 %), puis par poids dans le tier. La graine est l'`interaction_id`.

| Tier      | Effets                                                                     | Coût moteur                                                                                  |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Commun    | impact simple, squash, rebond, glisse, chute                               | **simple** : déjà dans le simulateur (squash, rebond sol/bords, roulage, sortie fall/shrink) |
| Variant   | rotation après impact, petit dérapage (friction au sol), roule vers le bas | **simple**                                                                                   |
| Variant   | double rebond sur la cam                                                   | **moyen** : collisionneur rectangle de la cible dans le simulateur                           |
| Rare      | explosion en mini-copies (4–6 clones de l'emote, balistique courte)        | **moyen**                                                                                    |
| Rare      | se brise : 4–6 fragments en `clip-path` de la même image                   | **moyen**                                                                                    |
| Rare      | étoile ou « POW » cartoon (1 SVG sobre)                                    | **simple**                                                                                   |
| Très rare | l'emote reste collée 0,6 s au bord de la cam puis glisse et tombe          | **moyen**, réutilise le collisionneur                                                        |

Pas de système de particules générique : chaque FX est une petite fonction qui ajoute 1 à 6 éléments animés par WAAPI, comme aujourd'hui.

## 10. Audio adaptatif (overlay, un seul gouverneur)

**Intensité** : `I` = impacts par seconde, moyenne exponentielle (τ 1,5 s).

**Échantillonnage déterministe**, par compteur et non par hasard, pour éviter les grappes :

| Intensité   | Sons joués |
| ----------- | ---------- |
| I < 1,2     | tous       |
| 1,2 ≤ I < 3 | 1 sur 2    |
| 3 ≤ I < 6   | 1 sur 3    |
| I ≥ 6       | 1 sur 5    |

**Plafonds** : écart minimal 90 ms entre deux sons et seau de jetons à 5 sons/s.

**Enveloppe** :

- `gain = volume × (1 − 0,5 × min(1, durée_rafale / 8 s))`, plancher 45 % ;
- après 1,5 s de calme, retour progressif sur 2 s.

**Variété** : la pool existante (`punch-2…6`, `roblox-oof`, présents dans les assets), sans répéter deux fois le même fichier, avec `playbackRate` entre 0,94 et 1,06. La famille Lourd prend le son « heavy » (rate 0,85). Les FX rares passent par le même gouverneur.

**Implémentation** : un seul `AudioContext`, buffers décodés une fois, un `GainNode` maître. On n'utilise plus `new Audio()` par impact.

## 11. Densité / anti-spam visuel (overlay)

- **Seuil doux, 18 projectiles vivants (réglable)** : les nouveaux tirs n'utilisent que le tier commun, la pose au sol est divisée par 2 et la sortie se fait en shrink. On supprime l'anneau d'impact.
- **Au-delà du seuil doux** : les plus anciens sortent en accéléré (shrink 250 ms), priorité aux nouvelles interactions.
- **Seuil dur, 30** : un nouveau tir **attend** un slot, sans être supprimé. L'attente est bornée à 4 s, bien sous le bail claim de 30 s, et la cadence de la salve s'étire.
- **Jamais de tir payé jeté** : sous saturation, un tir est raccourci, jamais supprimé. `started` et `completed` restent vrais.
- **Performance** :
  - une seule boucle `requestAnimationFrame` pour tous les projectiles ;
  - cache de décodage par URL (spam de la même emote) ;
  - `will-change: transform` ;
  - trajectoires précalculées, comme aujourd'hui.

La file Core (≤ 50) et le local Studio (≤ 12) restent les premières barrières.

## 12. Config Studio

Organisation logique de la carte Bonk (Production et Lab, même composant) :

1. **Statut** : OBS, source overlay (trouvée et plein écran), renderer, cible effective.
2. **Cible** : `Auto | Manuel | Fullscreen`.
   - Auto : source détectée, scène, épingler une source.
   - Manuel : aperçu (capture de la scène programme) avec un rectangle déplaçable et redimensionnable.
   - « Utiliser pour cette scène seulement » : override par scène.
3. **Rendu** :
   - taille moyenne (px) ;
   - variance (Faible / Normale / Forte, qui choisit des tables de §8 resserrées ou élargies) ;
   - dispersion (largeur de couronne) ;
   - intensité FX (Sobre / Normal / Fun, qui règle les poids des tiers).
4. **Densité et son** : densité max (seuil doux, le dur valant ×1,6), volume, fréquence audio (Normal / Réduit).
5. **Tester** : un Bonk, une rafale de 5, une salve de 10.
   - C'est un **aperçu local** : Studio injecte des tirs marqués `preview` dans l'overlay, sans Core, sans paiement, sans ACK Core.
   - Avertissement : visible en direct si la source overlay est dans la scène diffusée.

**Stockage** :

| Réglages                                                                                    | Où                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rendu et cible, globaux                                                                     | Studio, fichier JSON versionné du profil (Lab et Production séparés, comme le journal). Ils dépendent d'OBS local. |
| Par scène OBS                                                                               | Uniquement `{mode?, rect manuel?, source épinglée?}`, dans une map par nom de scène.                               |
| Économie et bornes (coût par tir, `shot_count` max, cadence min, modes ouverts aux viewers) | Core (cockpit / modération), car ce sont des règles économiques.                                                   |

Tout le reste est global : pas de config par scène sur les tailles, les FX ou le son.

## 13. Payloads à modifier

| Lien                                                    | Aujourd'hui              | VNext                                                                                                                                |
| ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Extension → `/v1/ext`                                   | `payload.emotes: [1 id]` | `payload.emotes: [1..10 ids]` (le tableau existe déjà), `payload.cadence_ms?` ; une clé d'idempotence par salve                      |
| Ext facade → Core admit                                 | `emote`                  | `emotes[]` + `cadence_ms` ; la facade garde la validation `invalid_payload`                                                          |
| Interaction (schéma `packages/schemas/src/bonk-lab.ts`) | `quantity: literal(1)`   | `quantity` reste à 1 par tir ; ajout de `volley: {id, index, count, cadence_ms} \| null`                                             |
| Claim                                                   | `{interaction}`          | `{interaction, volley: Interaction[] \| null}` (les tirs suivants de la même salve, chacun avec sa delivery) ; ancien champ conservé |
| Studio → overlay `/next`                                | `{interaction}`          | `{shots: [...], target: {...}, settings_version}` ; `/config` sert les réglages de rendu et la cible versionnés                      |
| Overlay → Studio ACK                                    | 1 par appel              | idem ; le regroupement est possible plus tard                                                                                        |

**Visuel absent des payloads Core** : ni position, ni taille, ni preset. Tout est dérivé de la graine côté overlay.

## 14. Migrations éventuelles

Une seule, additive, au lot Salves :

```sql
alter table bonk_lab_interactions
  add column volley_id uuid, add column volley_index smallint,
  add column volley_count smallint, add column cadence_ms integer;
-- check : les 4 nulles ensemble, ou 0 <= index < count <= 10 et 90 <= cadence_ms <= 600
create index on bonk_lab_interactions (channel_id, volley_id) where volley_id is not null;
```

Les réglages Core (coût par tir, bornes) réutilisent le stockage de réglages module existant s'il convient (à vérifier au lot 5) ; sinon `BONK_LAB_RULES`.

Aucune migration pour la cible, le rendu, les FX ou le son : tout est local Studio.

## 15. Lots d'implémentation

Chaque lot fait l'objet d'un audit court, d'un patch minimal, de tests et d'une validation par Antoni dans le vrai Studio et le vrai OBS. Pas de staging sans accord.

| Lot                                                        | Périmètre                                                                                                                                                                                                                                                                    | Fichiers                                                                                                                         | Tests                                                                                                                                                                                             | Validation (vrai Studio + OBS)                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **0. Socle prod** (sans changement visuel)                 | Reconnexion OBS automatique + identifiants persistés (stockage chiffré Studio, à choisir) ; source overlay retrouvée par URL au lieu du nom imposé ; contrôle d'appartenance de chaîne au claim (`wrong_channel` explicite) ; `sweep` global périodique des `queued` expirés | `bonk-lab/obs.ts`, `runtime.ts`, `bonk-lab-service.ts`, `studio-transport-routes.ts`                                             | Unitaires obs (pair WS simulé), Core PGlite + PG réel (sweep, chaîne)                                                                                                                             | Redémarrer OBS puis Studio : Bonk revient seul ; renommer la source                         |
| **1. Moteur de rendu** (Bonk individuel, cible par défaut) | Découpage du moteur en modules : tailles (§8), familles (§7), presets communs (§9), gouverneurs densité (§11) et audio (§10), boucle rAF unique, cache d'images ; aperçu local « Tester »                                                                                    | `bonk-overlay/engine/*.js` (nouveaux), `overlay.js` (câblage), `runtime.ts` (route preview)                                      | Unitaires purs graine → distributions (statistiques sur 10 000 tirages), sélection presets, gouverneur audio (horloge simulée)                                                                    | Coups uniques, spam manuel ; écoute du son ; lisibilité                                     |
| **2. Cible Manuel + Fullscreen + réglages**                | Store de réglages du profil, carte Studio (§12), aperçu par capture OBS, zone (§6)                                                                                                                                                                                           | `bonk-lab/settings.ts` (nouveau), `studio/web/src/bonk-*.ts`, overlay `engine/target.js`                                         | Store (versions, valeurs invalides), géométrie de zone                                                                                                                                            | Dessiner une zone, la retrouver après redémarrage ; Fullscreen                              |
| **3. Auto OBS**                                            | Abonnement aux événements, graphe de scène, transforms, groupes, imbrication, crop, rotation, sélection et replis (§5), override par scène                                                                                                                                   | `bonk-lab/obs.ts`, `bonk-lab/obs-scene.ts` (nouveau)                                                                             | Fixtures JSON de réponses OBS réelles (groupes, scènes imbriquées, bounds, rotation, canvas 1440p) → rectangles attendus                                                                          | Changer de scène, déplacer et redimensionner la cam, la masquer, deux cams, scène imbriquée |
| **4. FX variants et rares**                                | Collisionneur de cible, double rebond, collé-glisse, mini-copies, brisé, POW                                                                                                                                                                                                 | `engine/fx/*.js`                                                                                                                 | Unitaires déterministes (graine → preset → keyframes bornées)                                                                                                                                     | Forcer chaque preset depuis « Tester », puis tirage naturel                                 |
| **5. Salves**                                              | Schéma, migration (§14), admission N tirs atomique, claim de salve, facade `emotes[1..10]`, UI extension (mitraille sur le chargeur Munitions), planification overlay                                                                                                        | `packages/schemas`, `bonk-lab-service.ts`, `ext-facade.ts`, `worker.ts`, `ui.js` (câblage) + nouveau module extension, migration | Core : atomicité (solde insuffisant → rien), idempotence de salve, ordre contigu, remboursement par tir, concurrence PG réel ; Studio : journal avec salve, reprise ; extension : modèle de salve | Salves de 3, 5 et 10, cadences lente et rapide ; coupure OBS au milieu d'une salve          |
| **6. Combos (option)**                                     | Rebrancher `createBonkComboController` / Giga legacy si tu le souhaites                                                                                                                                                                                                      | overlay                                                                                                                          | Unitaires existants du legacy                                                                                                                                                                     | À décider                                                                                   |

L'ordre proposé est 0 → 1 → 2 → 3 → 5 → 4 → 6. Les salves passent avant les FX rares, car elles touchent le contrat Core. Le lot 0 est indispensable pour la prod, quel que soit le visuel.

## 16. Risques

- Calculs de transforms OBS : types de bounds, alignements, rotation. Il faut des fixtures issues de ton vrai OBS.
- Heuristique multi-cam : prévoir l'épinglage manuel dès le lot 3.
- Performance CEF (navigateur OBS) sous spam : à mesurer au lot 1 sur ta machine.
- Audio dans la source navigateur OBS : `AudioContext` y démarre sans geste ; à confirmer sur ta version d'OBS.
- Salves et bail claim (30 s) : une salve de 10 à 600 ms plus une attente de densité de 4 s reste à 10 s environ, donc la marge est suffisante, mais à tester.
- Wallet réel : les salves multiplient le débit (10 × coût). Il faut l'atomicité tout-ou-rien et un affichage du coût total côté extension avant envoi.
- Aperçu « Tester » visible en direct si la source est dans la scène diffusée.
- Fichiers centraux : `ui.js` ne doit que câbler un nouveau module de salve.

## 17. Réutilisable tel quel

- Toute l'admission Core : idempotence (hash), pause, module, blocage, cooldown, validation d'emote (Twitch / 7TV / BTTV / FFZ / Twemoji), séquence, débit et remboursement idempotent, file bornée.
- Claim, ACK, baux, `sweep`, transitions qui ne régressent jamais.
- Journal Studio : `sent` écrit avant l'effet, jamais de rejeu, `execution_unknown`, ACK ordonnés.
- Overlay : allowlist des URL CDN, CSP, retry des seuls ACK, contrôle unique du renderer.
- Moteur legacy : RNG à graine, simulateur physique (gravité, rebonds, roulage, sorties), squash, combo et Giga (non branchés), pool de sons et `playbackRate`.
- Extension : chargeur « Munitions », états et emotes Twitch (B1 / B2), retours d'erreur.
- Client obs-websocket lecture seule (à étendre avec les événements).
