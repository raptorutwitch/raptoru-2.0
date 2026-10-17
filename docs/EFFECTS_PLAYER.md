# Lecteur d'effets (P0.1) — sons d'effet joués par Studio

**Statut (17/10/2026)** : implémenté et testé automatiquement en Lab ; **non validé manuellement** (OBS / Twitch réels à
faire avec Antoni) ; non déployé. SAMMI exécute toujours les récompenses de production.

Direction (audit du 17/10/2026) : OBS compose les effets, Studio les pilote, les interactions sont écrites dans le code.
Le lecteur d'effets est une **capacité native de Studio** (aujourd'hui : sons ; plus tard : vidéos, fondus, images),
pas un système construit autour des anciennes récompenses SAMMI.

## 1. Chaîne

Récompense Twitch → bot / adaptateur Lab → Core (`ChannelPointsService` : déduplication, interrupteur, règle) → job
Studio (le **même** circuit que les actions OBS des Points de chaîne : bail, 3 tentatives tant que non démarré, jamais
rejoué une fois démarré) → `EffectsPlayer` (`apps/studio/server/src/effects/player.ts`) → **une** source navigateur OBS
(`apps/studio/server/effects-player/`) → `started` → Core marque l'action « en cours de lecture » et termine le job tout
de suite (la récompense suivante peut se superposer) → fin rapportée (`POST …/jobs/<id>/effects`) → « exécutée ».

- Action de règle : `{ type: 'effect_sound', sound_id, volume }` (`packages/schemas/src/effects.ts`,
  `channel-points.ts`). Le catalogue des sons est **fixé dans le code** (`EFFECT_SOUNDS`), pas d'import depuis Studio.
- Hors Soundboard : ni file, ni pause, ni prix, ni cooldown, ni débit Wallet ; les sons d'effet ne sont **pas** dans la
  banque de l'extension. Superposition libre (8 effets simultanés au maximum, au-delà : refus lisible).
- « Commande envoyée » ≠ « lu » : l'action reste « en cours de lecture » jusqu'à la fin rapportée par la page ; sans fin
  dans les 2 min → « lecture non confirmée » (jamais rejouée).
- Jamais de rejeu : un effet est remis à **une seule** page (la première qui le demande) ; non pris en 2 s → « lecteur
  d'effets non ouvert » ; pris mais non démarré en 6 s → « lecture non démarrée » ; les remises vivent en mémoire (un
  redémarrage de Studio n'en garde aucune).
- Refus lisibles (historique Studio) : lecteur non ouvert, son bloqué, fichier non importé, trop d'effets, fichier
  illisible, erreur de lecture.

## 2. Sons importés (copie, originaux intacts)

Source : `Documents\Rendu Audacity` (fichiers joués par SAMMI). Import :
`npx tsx apps/studio/server/src/effects/import-cli.ts` → `apps/studio/server/.runtime/effects/media` (hors Git, nommé
par empreinte SHA-256, empreinte de la copie vérifiée). Les originaux sont seulement lus (empreinte, taille et date
identiques avant / après, vérifié le 17/10/2026).

| Son (id)            | Fichier original         | Volume SAMMI → défaut | Récompense SAMMI                 | Durée  |
| ------------------- | ------------------------ | --------------------- | -------------------------------- | ------ |
| `eren-scream`       | `ErenScream.ogg`         | 1 → 100 %             | Eren cri                         | 10,8 s |
| `tiens-bon`         | `Tiens bon !.ogg`        | 0,41 → 41 %           | Tiens bon !                      | 6,4 s  |
| `quoicoubaka-bibou` | `Quoicoubaka bibou.ogg`  | 0,85 → 85 %           | Seigneur Percé                   | 1,5 s  |
| `pas-mal-les-bzez`  | `Pas mal les bzez_1.ogg` | 0,84 → 84 %           | Bzez                             | 2,3 s  |
| `glory-holes`       | `Glory holes.ogg`        | 1 → 100 %             | Skyzz                            | 1,9 s  |
| `karma-arreteuh`    | `Karma Arreteuh.ogg`     | 1 → 100 %             | Arrêteuh (désactivée sur Twitch) | 2,9 s  |

Ogg Vorbis, joués tels quels (aucune conversion). Le volume est réglable par règle (défaut = volume SAMMI).

## 3. Source OBS (à ajouter par Antoni, une seule fois)

Studio → Points de chaîne → « Lecteur d'effets (source OBS) » : copier l'URL
(`http://127.0.0.1:4100/effects/player.html#<jeton>` ; le jeton est créé au premier démarrage dans
`.runtime/effects/player-token` et ne change plus).

Source navigateur, nom conseillé « Raptoru — Effets » :

- URL : celle de Studio ; largeur 300, hauteur 100 (rien n'est affiché) ;
- **« Contrôler l'audio via OBS » : décoché** — comme les autres overlays de la collection (alertes, TTS…) et comme
  SAMMI : le son sort sur la sortie Windows par défaut et le stream le capte par « Son du pc ». Cocher cette case
  ferait passer le son par le mixeur OBS (il faudrait alors régler son monitoring) : routage différent de SAMMI ;
- « Arrêter la source quand elle n'est pas visible » et « Actualiser quand la scène devient active » : décochés ;
- placement : dans une scène toujours chargée (ex. « Alerte complète », où se trouve déjà « Alertes (V2) ») ; essai
  d'abord dans une scène de test.

Dans OBS la page joue sans clic ; dans un navigateur normal elle affiche « Activer le son » et ne prend aucun effet tant
que le son n'est pas autorisé (Studio indique « son bloqué »).

## 4. Différences avec SAMMI (connues)

- Même fichier, même volume relatif ; sortie audio identique en principe (à vérifier à l'oreille, § 5).
- SAMMI : boutons « Eren cri » et « Tiens bon » `queueable` (une 2ᵉ pression attend la fin de la 1ʳᵉ, si le bouton reste
  actif pendant le son — non démontré). Raptoru : superposition immédiate de toutes les récompenses.
- Raptoru ne peut ni valider ni rembourser une récompense (règle Twitch, `CHANNEL_POINTS_V1.md` § 2) ; SAMMI ne le fait
  pas non plus pour ces sons.

## 5. Validation manuelle (Lab, avec accord d'Antoni)

1. Démarrer Studio (`npm run studio`) ; onglet Points de chaîne : « 6 / 6 son(s) importé(s) ».
2. Ajouter la source OBS (§ 3) dans une scène de test → la puce « Lecteur d'effets prêt » apparaît.
3. Récompense « Eren cri » → Son d'effet « Eren — cri », 100 % → Enregistrer → « Écouter » (joué dans Studio seulement).
4. « Tester » (automatisations OFF, aucune vraie récompense consommée) → entendu dans le casque **et** dans un
   enregistrement / l'aperçu du stream ; historique « en cours » puis « Exécutée ».
5. Deux « Tester » rapprochés (Eren puis Tiens bon) → les deux sons se superposent.
6. Soundboard en pause → l'effet joue quand même.
7. Fermer la source OBS → « Tester » → échec « lecteur d'effets non ouvert », rien ne se rejoue à la réouverture.
8. Comparer à l'oreille avec le bouton SAMMI (volume, sortie).
9. Vraie récompense : seulement avec accord, bouton SAMMI de cette récompense désactivé avant d'activer les
   automatisations (sinon double déclenchement).

## 6. Fichiers

`packages/schemas/src/effects.ts` · `apps/core-api/src/channel-points/service.ts` (`effectReport`, `settleEffects`) ·
`apps/core-api/src/http/channel-points-routes.ts` · `apps/studio/server/src/effects/{player,import-cli}.ts` ·
`apps/studio/server/effects-player/` · `apps/studio/server/src/channel-points/runtime.ts` ·
`apps/studio/web/src/channel-points{,-view}.ts` · tests : `apps/core-api/test/channel-points-effects.test.ts`,
`apps/studio/server/test/effects-player.test.ts`, `apps/studio/server/e2e/effects-player.e2e.ts`. Aucune migration de
base (les actions sont du JSON).
