# Chaos mode C : l'écran du streamer ET la source gameplay d'OBS, sans double application

État au 24/11/2026, branche locale `feat/chaos-studio`. Décision d'Antoni (24/11) : **mode C par défaut**. Le streamer
subit l'effet sur son écran ; les spectateurs voient le même effet sur la source « Écran » d'OBS ; la webcam, les
alertes et l'habillage restent normaux, au-dessus.

Étude préalable (architectures comparées, prototype) : [OBS_SOURCE_GAMEPLAY.md](OBS_SOURCE_GAMEPLAY.md). Ce document
décrit ce qui est **construit**, ce qui est **prouvé** et à quel niveau, et ce qui reste à faire par Antoni.

## 1. Architecture : une activation, deux sorties

```
Studio (fiche : Tester / Activer / Arrêter, STOP ALL)          ← une seule commande par geste
  │  effect.activate { effet, sorties: [écran, obs], obs: { écran, taille de la source } }
  ▼
Moteur Chaos = autorité de la session (file, graine, paramètres, durée, transitions, arrêt)
  │  à l'acceptation, AVANT la première image :
  │    réplique de l'activation (mêmes paramètres résolus, même graine) jouée d'avance à 60 i/s
  │    → partition de chaque passe (PNG sans perte) → événement effect.obs « prepare »
  ├──► sortie ÉCRAN : calque DirectComposition, EXCLU DES CAPTURES tant que la sortie OBS vit
  │      départ = première image affichée → effect.started
  └──► sortie OBS (via Studio, sa seule connexion OBS) :
         « prepare » → réglages des filtres « Raptoru Chaos V2 · … » (désactivés)
         effect.started → filtres activés (le temps d'OBS part de là)
         arrêt anticipé / prolongation → effect.obs « retime » → nouvelle partition à partir de maintenant
         fin, STOP ALL, urgence, moteur arrêté, Studio fermé → filtres coupés
OBS : source « Écran » (capture d'écran du VRAI écran, sans le calque) → filtres Chaos V2 → composition
      (webcam, alertes au-dessus, intactes)
```

- **Une commande, un identifiant.** Le geste de Studio (ou demain un achat du Core) donne une seule demande. Le moteur
  crée une activation (identifiant unique) qui porte ses deux sorties.
- **Le moteur calcule, OBS peint.**
  - Le shader de chaque filtre OBS est celui du moteur, réécrit mécaniquement (`ObsExport.Rewrite`).
  - La logique image par image (C#) n'existe qu'une fois. **Aucune seconde bibliothèque d'effets.**
- **Identifiants stables :**
  - écran physique (`\\.\DISPLAYn`) ;
  - source OBS (son nom, choisi dans Studio) ;
  - filtres : espace de noms « Raptoru Chaos V2 · » (distinct de V1), clé `effet:shader`.
- **Code :**
  - moteur : `Host/Engine.cs` (sorties, exclusion, sessions), `Host/ObsExport.cs` (partitions, plan, shaders) ;
  - Studio : `server/src/chaos/obs-output.ts` (pilotage OBS), `server/src/chaos/runtime.ts` (routes),
    `web/src/pages/chaos-obs.ts` (panneau « Diffusion OBS »).

## 2. Anti-double application

**Le risque.** OBS capture l'écran **déjà transformé** par le calque, puis applique son filtre une seconde fois. Un
retournement redevient droit ; un flou, un zoom ou une déformation sont doublés.

**Le mécanisme.**

- Tant qu'une activation a une sortie OBS vivante, la surface du calque est **exclue des captures**
  (`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`).
  - C'est le cas **dès sa création**, donc avant la première image.
  - Windows 10 2004 et suivants l'appliquent à la capture d'écran WGC et DXGI, les deux méthodes de la capture
    d'écran d'OBS.
  - Le streamer voit le calque ; OBS voit le vrai écran et applique l'effet **une fois**.
- **Si Windows refuse l'exclusion**, la sortie OBS est **retirée** (événement `blocked`, raison `exclusion_failed`) :
  - Studio coupe ses filtres ;
  - le calque, non exclu, reste vu par la capture d'écran : une seule application ;
  - la page l'affiche (« Protection anti-double impossible »).
- **Si la sortie OBS disparaît pendant l'effet** (OBS fermé, filtre introuvable, requête refusée), Studio prévient le
  moteur (`effect.obs_lost`), qui cesse d'exclure le calque.
- **Ordre des opérations :**
  - au départ : exclusion (création de la surface), puis activation du filtre (à `effect.started`) ;
  - à la fin : le calque disparaît, puis le filtre est coupé.

  Pendant ces quelques millisecondes, le stream peut montrer l'effet sans le calque, mais jamais les deux.

- **Sortie « OBS uniquement » :** aucun calque n'est créé.

**Niveau de preuve.**

| Ce qui est prouvé                                                                                   | Comment                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Le moteur exclut la surface quand la sortie OBS vit, et retire la sortie si l'exclusion est refusée | code et tests de bout en bout (moteur réel, OBS simulé)             |
| L'API d'exclusion fonctionne sur NOTRE calque, pour WGC et DXGI                                     | **pas encore** : test visible, jamais lancé automatiquement         |
| Le filtre OBS appliqué à l'image brute = le rendu du moteur (une seule application)                 | vrai moteur d'OBS 33.0.1 + obs-shaderfilter 2.6.1, hors écran (§ 4) |

Le test d'exclusion est prêt : `chaos-bench.exe --obs-compat`, cas « Mode C (écran + OBS) ».

- Il pose une mire, la retourne en mode C, puis lit l'écran par WGC et DXGI.
- Attendu : la capture voit la mire **droite**, et le calque lui-même (capture de sa fenêtre) est retourné.
- Il est **visible** (une mire sur l'écran secondaire, quelques secondes) : à lancer par Antoni, jeu fermé (§ 9).

## 3. Synchronisation

- **Une seule source de vérité :**
  - même graine (`SeedOf(request_id)`) ;
  - mêmes paramètres résolus (variante, niveau, préréglage) ;
  - même durée et mêmes transitions ;
  - même réplique de l'effet.

  OBS ne tire aucun hasard : il lit la partition.

- **Temps :**
  - le calque part à sa première image affichée (`started`) ;
  - le filtre part quand Studio l'active, à la réception de `started` ;
  - OBS lit la partition au temps écoulé depuis cette activation (`elapsed_time_enable`, avancé par OBS image après
    image) ;
  - la partition est échantillonnée à 60 i/s et lue à l'échantillon le plus proche. Un OBS à 30 i/s en lit un sur
    deux ; une image manquée par OBS ne décale pas la suite (le temps d'OBS avance quand même).
- **Arrêt anticipé et prolongation.** Le moteur recalcule la partition à partir de l'instant présent (« retime »,
  base de temps `chaos_t_base`). La sortie animée est la même des deux côtés.
- **Fenêtre de validité.**
  - Chaque session porte une fenêtre (`chaos_since`, `chaos_expires`) en horloge système, celle d'OBS
    (`local_time`).
  - Hors fenêtre, le filtre rend l'image intacte.
  - Un OBS relancé avec un filtre resté actif ne **rejoue donc jamais** un effet expiré, même sans Studio.
- **Mesuré** (libobs installée, hors écran) : retard de l'effet montré par OBS sur l'instant où Studio active le filtre.

  | OBS à  | Retard moyen | Mini / maxi     | Première image en mouvement après l'activation |
  | ------ | ------------ | --------------- | ---------------------------------------------- |
  | 60 i/s | 3,6 ms       | −14,5 / +9,2 ms | 20 ms en moyenne (2 à 26 ms)                   |
  | 30 i/s | 12,8 ms      | −6,4 / +33,2 ms | 46 ms en moyenne (27 à 67 ms)                  |

  **Non mesurés :**
  - le trajet `started` → Studio → obs-websocket (estimé à quelques ms en local) ;
  - l'écart réel entre l'écran du streamer et le stream.

  Attendu : **au plus une image d'OBS** d'écart, imperceptible dans un stream qui a déjà plusieurs secondes de
  retard.

## 4. Les 13 effets

Parité dans le vrai moteur d'OBS 33.0.1 (640 × 360, scène de jeu de synthèse, webcam et alerte au-dessus) : écart RVB
moyen avec le moteur au même instant, sur 255.

| Effet              | Filtres OBS              | Parité (moyenne / p99) | Arrêt anticipé (après l'arrêt) | Webcam, alerte                                | Limites                                                                                       |
| ------------------ | ------------------------ | ---------------------- | ------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Retournement 180°  | 1                        | 0 / 0                  | —                              | intactes                                      | —                                                                                             |
| Miroir             | 1                        | 0 / 0                  | 0 / 0 (vérifié)                | intactes                                      | —                                                                                             |
| Tremblement        | 1                        | 0 / 0                  | —                              | intactes                                      | —                                                                                             |
| Zoom               | 1                        | 0 / 0                  | 0 / 0 (vérifié)                | intactes                                      | point focal en coordonnées de la source : juste si « Écran » capture tout l'écran de la fiche |
| Écran ivre         | 2 (cadrage, déformation) | 0,7–0,8 / 9            | 0,8–0,9 / 11 (vérifié)         | intactes                                      | le léger flou du moteur (mipmaps) est approché dans OBS par 9 lectures                        |
| Vision tunnel      | 2 (cadrage, voile)       | 0,2 / 1                | —                              | intactes                                      | point focal : comme le zoom                                                                   |
| Clignement         | 1 (calque)               | 0 / 0                  | 0–0,3 / 1 (vérifié)            | **visibles par-dessus les paupières fermées** | —                                                                                             |
| Flash              | —                        | —                      | —                              | —                                             | **écran seulement** (§ 6)                                                                     |
| Brouillard         | 1 (calque)               | 0,3–0,7 / 1            | 0,7 / 1 (vérifié)              | intactes                                      | rendu à 100 % dans OBS (50 % dans le moteur) : coût à mesurer en 1440p                        |
| Flou               | 1                        | 1,8 / 12               | 0,5–1,7 / 4–11 (vérifié)       | intactes                                      | approché par 9 lectures : fidèle en 360p ; grands rayons en 1440p à vérifier                  |
| Pixelisation       | 1                        | 1,6 / 9                | —                              | intactes                                      | moyenne des blocs approchée (pas de mipmaps dans OBS)                                         |
| Filtres de couleur | 1                        | 0 / 0                  | —                              | intactes                                      | —                                                                                             |
| VHS / glitch       | 1                        | 0,9–1,6 / 14           | —                              | intactes                                      | léger flou approché                                                                           |

**Pour les 12 effets exportés, vérifié dans libobs :**

- le shader compile dans OBS ;
- l'effet joue en temps réel puis s'arrête seul (image intacte après la fin) ;
- la fenêtre de validité fonctionne (6 effets testés : effet dans la fenêtre ; image intacte si expirée ou pas encore
  valide).

**Pas encore vérifié :**

- une scène en mouvement dans OBS (l'image de jeu est fixe ; l'animation de l'effet, elle, est vérifiée) ;
- les variations de luminosité ;
- le 1440p pour la parité.

## 5. Gestion des filtres OBS

- **Espace de noms.**
  - Les filtres V2 s'appellent « Raptoru Chaos V2 · <effet>[ · rôle] ».
  - Les filtres V1 (« Raptoru Chaos · … ») et tous les autres ne sont **jamais** lus pour être modifiés, ni déplacés,
    ni supprimés.
- **Plan déclaratif** (commande moteur `obs.plan`) :
  - 14 filtres pour 12 effets ;
  - un fichier `.effect` par shader, nommé par l'empreinte de son contenu (un shader changé = un nouveau fichier,
    rechargé par shaderfilter) ;
  - ordre de la chaîne : les passes sur l'image, puis les calques (comme le moteur).
- **Préparation : geste explicite dans Studio** (« Préparer les filtres OBS… »).
  1. Liste exacte de ce qui sera créé, mis à jour ou laissé tel quel.
  2. Confirmation.
  3. Sauvegarde JSON des filtres de la source (`<état Chaos>/obs-backups/`).
  4. Création **désactivée**.

  L'opération est idempotente : une seconde préparation ne crée rien. « Retirer les filtres V2 » est le retour
  arrière ; il ne touche que les V2.

- **Réconciliation.**
  - À chaque (re)connexion d'OBS, tout filtre V2 actif sans session vivante est coupé.
  - Une session vivante pendant une reconnexion perd sa sortie OBS, et le moteur cesse d'exclure le calque.
- **Pilotage :**
  - la seule connexion OBS de Studio (celle du Bonk, locale, avec son mot de passe) ;
  - requêtes `GetSourceFilterList`, `CreateSourceFilter`, `SetSourceFilterSettings`, `SetSourceFilterEnabled`,
    `SetSourceFilterIndex` (seulement un filtre V2 qu'on vient de créer) ;
  - `RemoveSourceFilter` seulement sur demande, et seulement pour les V2.

  Aucun port, aucun secret ajouté.

- **Sources et scènes.**
  - Les filtres sont posés sur la **source** : ils suivent donc toutes les scènes qui l'utilisent.
  - Une source masquée ne coûte rien.
  - Une source supprimée ou renommée : Studio l'affiche (« source introuvable ») et les activations partent sur l'écran
    seul.
  - L'écran physique associé est choisi dans Studio : la sortie OBS ne suit que les effets de cet écran.

## 6. Flash : écran seulement, pour l'instant

- **Pourquoi.** Le flash fige une image de l'instant puis la fond avec le direct. obs-shaderfilter 2.6.1 n'a pas de
  mémoire séparée.
  - `previous_output` est sa propre sortie, donc l'image affichée.
  - `previous_image` est l'image précédente.
  - Le filtre Freeze installé fige toute la source, sans fondu avec le direct.
- **Comportement actuel.**
  - « Écran + OBS » : le flash part sur l'écran seul, non exclu. La capture d'écran d'OBS le voit (une application)
    et la page le dit.
  - « OBS uniquement » : il est refusé.
  - Limite : s'il tourne en même temps qu'un autre effet en mode C sur le même écran, le calque est exclu et le flash
    n'est pas diffusé.
- **Piste retenue pour la suite** (demande une modification d'OBS de plus, donc un GO) :
  - une source « Raptoru Chaos V2 · image figée » = Source Clone de « Écran » avec un filtre Freeze, dans une scène
    interne non diffusée ;
  - le filtre flash la lit comme seconde texture (paramètre de texture lié à une source, vérifié dans le code de
    shaderfilter 2.6.1).
- **Écartées :**
  - agrandir la sortie du filtre et la rogner ensuite : un plantage laisserait le gameplay rogné ;
  - plugin natif : risque pour le live, aucun compilateur sur le PC.

## 7. Studio

**Panneau Chaos › « Diffusion OBS »** (bouton dans l'en-tête, avec l'état du mode) :

- sorties : Écran uniquement / OBS uniquement / **Écran + OBS** (par défaut) ;
- OBS : connexion, version, présence d'obs-shaderfilter ;
- source gameplay (captures d'écran, de fenêtre et de jeu de la collection) et sa taille ;
- écran physique capturé, avec un avertissement si sa taille diffère de la source ;
- filtres V2 : prêts ou à préparer, actifs, puis « Préparer les filtres OBS… », « Couper », « Retirer les filtres V2… » ;
- ce qui manque au mode C, en clair ; dernier incident ; dernières sorties OBS.

**Fiches :**

- les boutons Tester, Activer et Arrêter sont inchangés, avec une seule commande par geste ;
- l'état affiche « écran + OBS », « OBS seulement » ou « écran seulement (sortie OBS coupée) » ;
- à l'activation, si la sortie OBS manque, un message dit pourquoi l'effet part sur l'écran seul.

**STOP ALL et Ctrl+Maj+F11 :**

- le calque est coupé et le curseur rétabli, comme avant (moteur) ;
- STOP ALL coupe aussi, en même temps et sans animation, tous les filtres V2 de la source ;
- l'arrêt d'urgence du moteur (`engine.emergency_stop`) déclenche la même coupure dans Studio ;
- si Studio est absent, le calque s'arrête quand même : les filtres V2 finissent leur partition (image intacte) et la
  fenêtre de validité les neutralise.

**Le reste :**

- la configuration (mode, source, écran, préparation) est gardée dans `<état Chaos>/obs-output.json` ;
- Twitch, plus tard : une offre = effet + variante + intensité + durée + écran + sorties. La session reste dans le
  moteur ; aucun second achat ni second événement. L'état des sorties (`outputs`) est déjà dans chaque vue d'activation
  pour le Core.

## 8. Performances

**Ce que coûte chaque sortie :**

- **Écran** : le moteur, comme avant (banc hors écran du Performance Lab).
- **OBS**, par filtre actif : une copie de la source (2560 × 1440 pour « Écran »), une passe, une copie. Un filtre
  coupé ne coûte rien.
- **Mode C** : la somme des deux. Il n'y a pas de capture en plus : OBS lit déjà l'écran, et le calque lit la fenêtre
  comme avant.

**Mesures :**

- Petit format (640 × 360, carte graphique au repos) : coût fixe d'un filtre actif +0,04 ms par image ; brouillard
  +0,32 ms. **Pas représentatif.**
- **1440p (écran et OBS) : pas encore mesuré.** Le banc différé attend que la garde de jeu soit libre trois minutes. Il
  porte sur :
  - le moteur hors écran en 1440p et 1080p ;
  - 14 cas de filtres OBS en 1440p à 60 i/s : miroir, zoom, tremblement, ivre, clignement, flou léger et extrême,
    brouillard marqué et occultant, retournement, tunnel, pixelisation, couleur, VHS.

  Les résultats iront dans ce paragraphe.

- **Images/s d'Overwatch : non mesurées.** Validation en jeu par Antoni (Performance Lab, mode B, § 9).

## 9. Ce qu'Antoni doit faire (dans l'ordre)

1. **Installer 0.1.44-chaos.4.** Jeu fermé ; fermer Studio d'abord. Chemin et empreinte :
   [GUIDE_STUDIO_CHAOS.md](GUIDE_STUDIO_CHAOS.md) § 4.
2. **Test d'exclusion** (visible, jeu fermé, OBS peut rester ouvert, rien n'y est touché) :
   - lancer `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\chaos-v2\apps\chaos-engine\bin\chaos-bench.exe --obs-compat`
     (le banc n'est pas dans l'installateur) ;
   - attendu : ligne « Mode C… (attendu : comme sans effet) » identique à « Mode E, sans effet ».
3. **GO pour l'intégration dans OBS.** Ce qui sera fait, exactement :
   - **sur la source « Écran » seulement**, 14 filtres créés **désactivés** :
     - Écran retourné, Miroir, Zoom chaotique ;
     - Vision tunnel · cadrage ;
     - Écran ivre · cadrage, Écran ivre · déformation ;
     - Tremblement, Flou, Filtre de couleur, Pixelisation, VHS / glitch ;
     - Vision tunnel · voile, Clignement des paupières, Brouillard ;

     tous préfixés « Raptoru Chaos V2 · » ;

   - **réglages de chaque filtre** : shaderfilter, « Charger un fichier », fichier `.effect` dans le dossier d'état de
     Studio ;
   - **intacts** : les six filtres V1 (désactivés) et la correction des couleurs ; aucune scène, aucune autre source,
     aucun réglage d'OBS ; aucun redémarrage d'OBS ;
   - **sauvegarde** : Studio écrit les filtres de « Écran » en JSON avant tout changement. Conseillé en plus : OBS ›
     Collection de scènes › Exporter ;
   - **retour arrière** : « Retirer les filtres V2… » dans Studio (ou les supprimer à la main dans OBS) ;
   - **risque** : la création compile 14 shaders dans OBS (petit à-coup possible) : à faire hors live.
4. **Essai contrôlé** (OBS ouvert, pas en live) :
   1. Studio › Chaos › Diffusion OBS : source « Écran », écran « Écran droit », mode « Écran + OBS » ; puis
      « Préparer les filtres OBS… » → Créer.
   2. Ouvrir un projecteur de la scène « Scène Fullscreen » (clic droit › Projecteur fenêtré) pour voir ce que voient
      les spectateurs.
   3. Activer **Miroir** :
      - l'écran est inversé ;
      - le projecteur est inversé **une fois** (le texte se lit à l'envers comme sur l'écran) ;
      - la webcam est normale.
   4. **Clignement** : les paupières se ferment à l'écran ; dans le projecteur, le gameplay est noir, la webcam et les
      alertes restent visibles.
   5. **Brouillard** : mêmes nappes à l'écran et dans le projecteur, au même rythme.
   6. **Zoom**, **Écran ivre**, **Flou** : pas de double zoom, de double rotation ou de double flou dans le projecteur.
   7. **Arrêter** pendant un effet : les deux reviennent à la normale. Puis **STOP ALL** pendant un effet : idem ;
      vérifier dans OBS que les filtres V2 sont désactivés.
   8. Fermer OBS pendant un effet : Studio indique la sortie OBS perdue ; l'écran continue puis s'arrête normalement.
   9. Overwatch (fenêtré sans bordure), OBS en enregistrement ou en test de stream : Performance Lab › validation en
      jeu, effet par effet ; noter les images/s et les images manquées d'OBS.
   10. En cas de souci : STOP ALL (ou Ctrl+Maj+F11), puis « Couper » ou « Retirer les filtres V2 » dans Diffusion OBS.

## 10. Les 10 conditions de validation : niveau de preuve au 24/11

| Test                    | Hors écran (moteur réel, libobs ou OBS simulé)                                                          | Écran réel | Diffusion réelle |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ---------- | ---------------- |
| 1. Miroir               | parité 0 dans libobs ; une seule application par construction ; session de bout en bout                 | à faire    | à faire (GO)     |
| 2. Clignement           | libobs : gameplay fermé, webcam et alerte visibles                                                      | à faire    | à faire          |
| 3. Zoom                 | parité 0, arrêt anticipé vérifié                                                                        | à faire    | à faire          |
| 4. Brouillard           | parité 0,3–0,7, même partition, arrêt anticipé vérifié                                                  | à faire    | à faire          |
| 5. Écran ivre           | deux filtres synchronisés (même partition), parité 0,7–0,9                                              | à faire    | à faire          |
| 6. Flou                 | parité 1,8 en 360p (application unique sur l'image brute)                                               | à faire    | à faire          |
| 7. Arrêt anticipé       | libobs : sortie recalée = moteur (6 effets) ; de bout en bout : filtres recalés puis coupés             | à faire    | à faire          |
| 8. STOP ALL             | de bout en bout : filtres V2 coupés, filtre V1 actif laissé actif ; calque et curseur : moteur inchangé | à faire    | à faire          |
| 9. Déconnexion d'OBS    | OBS simulé : sortie retirée, moteur prévenu, filtres coupés à la reconnexion                            | —          | à faire          |
| 10. Diffusion contrôlée | —                                                                                                       | —          | à faire (GO)     |

**Rien n'est validé tant qu'Antoni ne l'a pas essayé.**
