# Opération Halloween 2026 — boutique d'événement et moteur de screamers

Branche `feat/halloween` (worktree `C:\Users\Antoni\Documents\raptoru-halloween`). Stream visé : samedi 31/10, 24 h.
**Rien n'est en Production** : ni migration, ni Core, ni Studio, ni extension.

**Validé par Antoni (28/10, en local)** : les screamers s'affichent sur son écran Windows avec leur son.
**Pas encore validé** : la capture OBS ; le parcours d'achat complet dans le Lab réel (testé seulement en automatique,
§ 10) ; le chat.

## 1. Ce que ça fait

Un viewer dépense des **Bonbons** dans le module « Halloween 🎃 » de l'extension. Le Core accepte l'achat, Studio le
récupère et le joue dans une **fenêtre transparente, au premier plan et non cliquable**, sur l'écran choisi. OBS capture
déjà cet écran (`monitor_capture` + « Son du pc » dans `Twitch_Dofus` et `Twitch_Raptoru`), donc **aucune scène OBS
n'est modifiée**.

```
Extension (JWT) → Core /v1/ext/actions/events/purchase → event_shop_purchases (queued)
Studio (installation) ← /v1/studio/events/claim ← boucle 700 ms ; heartbeat 3 s (engine_ready + médias présents)
Studio → page overlay (long-poll) → vidéo WebM alpha + son / effet dessiné → rapport → Core (completed / failed)
```

## 2. Règles (décidées par le Core, jamais par l'extension)

- **Un seul effet à la fois** par chaîne, sans file d'attente : un achat pendant une lecture est refusé `busy`.
- Achat possible seulement si Studio a déclaré **« prêt » depuis moins de 10 s** (page overlay ouverte) et si le média
  est présent sur le PC. Sinon, refus `engine_offline` ou `media_missing` : aucun Bonbon n'est dépensé.
- Limites réglables dans Studio : écart par viewer (2 min), recharge par effet (60 s pour les effets, 10 min par
  screamer), écart entre screamers (3 min), **6 screamers par heure** au plus.
- Débit et admission dans **une seule transaction**, sous le verrou de la ligne de réglages. Chaque achat a sa
  clé d'idempotence : un double clic ou un réseau qui rejoue n'achète jamais deux fois.
- **Jamais rejoué** :
  - non pris par Studio en 20 s, ou non démarré en 15 s : échec et remboursement, une seule fois ;
  - démarré sans fin reçue en 90 s : `unknown`, pas de remboursement (il a pu être vu) ;
  - redémarrage de Studio : rien n'est repris ;
  - STOP ALL : rembourse ce qui attend, termine ce qui joue (`stopped`, sans remboursement).

## 3. Bonbons

Monnaie séparée par saison (`halloween-2026`), dans ses propres tables (`event_wallets`, `event_ledger` append-only,
solde ≥ 0). **Les Jetons de Production ne sont jamais touchés**, sauf par la conversion. Manières d'en gagner :

| Source               | Règle (par défaut, réglable)                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Don Studio           | onglet Halloween › Bonbons : viewer (nom ou id), montant (négatif = retrait), motif `grant` ou `raffle` (récompense de tirage)                                                                                                                        |
| Sub / resub          | 10 Bonbons ; une fois par événement Twitch (clé `<rôle>:<source>:<event_id>`), après l'enregistrement de l'alerte. Un échec ne bloque jamais l'alerte                                                                                                 |
| Sub offert           | donneur 5 par sub offert, bénéficiaire 3                                                                                                                                                                                                              |
| Conversion de Jetons | 1 000 Jetons = 1 Bonbon, **10 Bonbons par heure et par viewer**, plafond vérifié dans le Core sous verrou. Le débit passe par le Wallet canonique (`module 'event_shop'`)                                                                             |
| Tombola              | Studio › Tombola › Récompense : monnaie **Bonbons** (montant fixe, N gagnants ; le pot est partagé à parts égales). Une seule fois par gagnant et par tirage, même en cas de reprise. Seulement pendant l'événement. L'inscription reste **gratuite** |

Seules les alertes `source 'twitch'` paient, ce qui exclut les alertes de test de Studio (sauf dans le Lab). Pendant
l'événement, `!solde` (la commande existante, sans doublon) ajoute « | 17 Bonbons 🍬 » (0 si aucun) ; hors événement
sa réponse est exactement l'habituelle.

**Conformité Twitch** (règles des extensions, § 5.2 et 6.2) : les Bonbons sont des points de fidélité sans valeur
monétaire, jamais échangeables contre de l'argent ou des Bits. La Tombola est gratuite et n'utilise jamais de Bits.

## 3 bis. Événement temporaire et réversible

Le Core porte l'état ouvert/fermé (Studio › Halloween › « Ouvrir / Fermer l'événement »).

- **Ouvert** : module « Événements » visible, achats, conversions, gains (subs, Tombola), `!peur` / `!bonbons`
  actifs, `!solde` enrichi.
- **Fermer** est un arrêt contrôlé, dans une seule transaction :
  - un achat payé mais pas encore remis à Studio est **remboursé** une fois (`event_closed`) ;
  - un effet déjà remis ou à l'écran se termine normalement ;
  - plus rien n'est remis à Studio, même par une requête ancienne ;
  - achats, conversions, gains de sub et Tombola Bonbons sont refusés par le Core ;
  - le module disparaît et les commandes redeviennent muettes ;
  - le don manuel de Studio reste possible.
- **Rien n'est purgé** : soldes, historique et catalogue restent. Rouvrir rend la même boutique, et une prochaine
  édition reprend le même système.

## 4. Catalogue

Les entrées sont créées par le Core au premier accès. Prix, recharge, activation et ordre se modifient dans Studio,
sans changer de code.

- **Effets dessinés** :
  - Clignement 2 (0,9 s) ;
  - Brouillard 3 (9 s) ;
  - Signal corrompu 3 (2,5 s, sans stroboscope, refusé en mode sûr) ;
  - Vision tunnel 3 (6 s) ;
  - Yeux dans le noir 4 (5 s) ;
  - Silhouette 4 (4 s).
- **Apparitions** : chauves-souris 5, araignée 5, fille fantôme 6, Bonnie qui marche (désactivée).
- **Screamers** : 26 vidéos avec son, 10 Bonbons chacun.
- **Non faits** : flou et vision inversée. Il faudrait capturer l'écran et le retraiter (lourd, et invisible pour OBS
  si la fenêtre est exclue de la capture) ou modifier un réglage de Windows (interdit). Les effets dessinés les
  remplacent.

## 5. Médias

Les originaux ne sont **jamais modifiés** : `Documents\Stream PROJET\Halloween` et `Anim de stream\Screameur Audio`.
Les vidéos ne sont pas dans Git. Elles passent par trois étapes, chacune vérifiée.

1. **Conversion** (`halloween-import.mjs`) : copies en WebM VP9 avec transparence et Opus, volume homogénéisé
   (loudnorm −16 LUFS), 1080p au plus. Les 30 médias pèsent 22 Mo. Un média déjà converti depuis le même original est
   conservé ; `--force` le refait.

   ```
   node apps/studio/server/scripts/halloween-import.mjs --ffmpeg "C:/Program Files (x86)/iMyFone VoxBox/ffmpeg.exe"
   ```

   - **ffmpeg** : la seule commande `ffmpeg` du PC est celle d'iMyFone VoxBox.
   - **Miniatures** : `--thumbs-only` les refait seules (l'image la plus visible du clip). Elles vont dans
     `apps/twitch-extension/extension/assets/halloween`, livrées avec l'extension.

2. **Paquet de livraison** : le paquet durable, indépendant de tout worktree, est déjà fait (28/10) et vérifié
   (30/30) :
   - emplacement : `Documents\Raptoru 2.0 - Livraisons\2026-10-31-halloween-medias\` ;
   - contenu : les 30 `.webm`, `manifest.json`, `SHA256SUMS.txt`, `LISEZMOI.txt` et une copie du script
     d'installation (le paquet se suffit à lui-même ; seul Node est nécessaire) ;
   - commande qui l'a créé : `halloween-media-install.mjs --to <dossier>`.

3. **Installation dans le Studio installé** (`halloween-media-install.mjs`). Le script lit la destination dans
   `%APPDATA%\Raptoru Studio\studio.json`, c'est-à-dire le dossier de données du Studio installé
   (`Raptoru 2.0\apps\studio\server\.runtime\halloween\media`) :

   ```
   cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Livraisons\2026-10-31-halloween-medias"
   node halloween-media-install.mjs --from .
   ```

   - chaque fichier du paquet est vérifié avec `SHA256SUMS.txt`, copié sous un nom temporaire, vérifié de nouveau,
     puis renommé ; le manifeste est écrit en dernier ;
   - rien n'est supprimé, et relancer ne recopie que ce qui manque ;
   - `--check` vérifie sans rien écrire ;
   - ensuite, dans Studio : « Recharger les médias ».

L'onglet Halloween signale tout article actif dont la vidéo manque sur le PC. Le Core ne le vend pas (`media_missing`).

## 6. Studio — onglet « Halloween 🎃 »

- **Moteur** : état (page prête, médias, Core), choix de l'écran, volume, **mode sûr** (refuse Signal corrompu),
  test local de chaque effet et de chaque média. Un test ne coûte rien, ne passe pas par le Core et n'apparaît pas aux
  viewers.
- **STOP ALL** : bouton du panneau ou **Ctrl+Maj+F12** (raccourci global). Il vide l'écran et prévient le Core.
- **Boutique** : ouverte ou fermée, règles, catalogue (prix, recharge, activation), dons de Bonbons, derniers achats.
- **Fenêtre overlay** : la fenêtre principale d'Electron l'ouvre sur l'écran choisi :
  - transparente, sans cadre, sans focus ;
  - clics transmis au bureau ;
  - au-dessus de tout ;
  - fermée avec Studio ;
  - aucun réglage Windows modifié.

## 7. Extension et revue Twitch (risque principal)

- Le Core n'ajoute **pas** le module à `modules`. Il expose une clé `event_shop` séparée, et seule la nouvelle
  extension affiche « Événements » (édition « Halloween 2026 », nom fourni par le Core). L'extension publiée actuellement continue donc de fonctionner sans changement face
  au nouveau Core.
- **La revue Twitch n'a pas de délai garanti** (de quelques jours à plusieurs semaines, une seule version en revue à
  la fois). Il faut compter sur l'absence de publication avant samedi.
- **Hosted Test** : seuls les comptes de la liste de testeurs voient la version de test. **Attention** : un retour de
  la communauté (forum des développeurs Twitch) signale qu'**installer la version Hosted Test sur la chaîne remplace
  la version publiée pour tout le monde**. Les autres viewers ne verraient alors plus l'extension. **Ne pas faire ça
  pendant un stream** sans l'avoir vérifié hors stream avec un compte qui n'est pas testeur.
- **Recommandation** : envoyer la version en revue **dès que possible** (après validation Lab). Pour samedi, prévoir
  que seuls les testeurs auront le module. **Le chat sert de voie principale** (§ 7 bis).

## 7 bis. Le chat : la même boutique pour tous, sans revue Twitch

Le bot transmet déjà chaque message du chat au Core. Il suffit donc de déployer le Core : **le bot ne change pas**.
Les commandes restent **muettes tant que la boutique est fermée**.

- `!peur` : le menu avec les prix ; `!peur <effet>` (`blink`, `fog`, `eyes`… ou un screamer : `!peur foxy`) ;
  `!peur screamer` : un screamer au hasard parmi ceux qui sont disponibles maintenant.
- `!bonbons` : le solde et comment en gagner ; `!bonbons <n>` : échange de Jetons, dans le plafond horaire.
- Mêmes règles que l'extension, toutes décidées par le Core. L'id du message Twitch sert de clé : le même message
  rejoué n'achète rien. Les réponses gratuites (menu, solde) sont limitées à une toutes les 30 s par viewer.
- Les mots `peur` et `bonbons` ne sont **pas** réservés dans Commands V2 : si une commande Studio porte déjà ce nom,
  les deux répondraient. Vérifier avant d'ouvrir la boutique.

## 8. Tester (Lab, sans Twitch, ni OBS, ni Production)

0. Fermer d'abord le Studio installé : les deux utilisent les mêmes ports (4100 pour Studio, 4301 pour le Core Lab).
   Le worktree a besoin de `apps/core-api/.env` : il ne contient que la ligne `DATABASE_URL` du checkout principal
   (fichier créé le 28/10, ignoré par Git, sans jeton Twitch). Sans ce fichier, le Core Lab ne démarre pas et rien
   n'est vendu (onglet Studio › Runtime local : « DATABASE_URL absent »). La base Lab `raptoru_bonk_lab` est partagée
   avec le Studio installé : le worktree y ajoute seulement les tables `event_*`.
1. `npm run studio` depuis le worktree, puis l'onglet Halloween. La fenêtre overlay s'ouvre sur l'écran choisi.
   **Elle est visible sur le vrai bureau** : à tester quand Antoni le décide.
2. « Tester » un effet, puis un screamer : vérifier l'image, le son, le clic qui traverse et STOP ALL.
3. Ouvrir la boutique dans Studio, se donner des Bonbons (« Viewer Lab », id 900101), puis ouvrir l'Extension Lab
   (`/ext/mobile.html?labRole=viewer`) › Événements et acheter ; ou taper `!peur blink` dans Studio › Simulation.
4. Dans OBS (scène de test, pas une scène de Production) : la capture d'écran doit montrer l'effet et le son.

## 9. Livraison en Production (chaque étape attend le GO d'Antoni)

1. Sauvegarde de la base, puis migration `supabase/migrations/20261112130000_event_shop.sql` : nouvelles tables
   seulement, retour arrière en tête de fichier.
2. Déploiement du Core (bot inchangé). La boutique reste **fermée** tant que Studio ne l'ouvre pas.
3. Release Studio (`npm run studio:release`) et installation par Antoni. Ensuite, installation des médias depuis le
   paquet (§ 5, étape 3) et contrôle avec `--check` : 30 identiques, puis l'onglet Halloween sans avertissement.
4. Extension : `npm run build -w @raptoru/twitch-extension`, téléversement, Hosted Test (§ 7), demande de revue.
5. Le jour J : ouvrir la boutique, vérifier « prêt » dans Studio, faire un test local, garder STOP ALL à portée.

## 10. Tests

- **Core** (`event-shop.test.ts`, 21 tests) : règles, idempotence, sort des exécutions, conversion, subs et dons,
  STOP ALL, fermeture contrôlée et réouverture.
- **`!solde`** (`event-shop-solde.test.ts`) : réponse habituelle hors événement, « | N Bonbons » pendant.
- **Tombola Bonbons** (`event-shop-raffle.test.ts`) : 3 gagnants crédités une fois, rejeu sans double, refus hors
  événement, Jetons inchangés.
- **Profil Production** (`halloween-production.test.ts`) : Studio ↔ Core principal en HTTPS, installation appairée.
- **Installation des médias** (`halloween-media-install.test.ts`) et **journal du moteur** (`halloween-runtime.test.ts`).
- **Frontière d'extension** (`ext-frontier`) : le viewer vient du JWT, la clé d'idempotence est exigée, refus `busy`.
- **Vrai PostgreSQL** (`event-shop.integration.test.ts`) : conversions et achats concurrents depuis deux pools Core.
- **Studio e2e** (Chromium) :
  - `halloween.e2e.ts` : Core Lab → runtime → page → son → fin ;
  - `events-shop.e2e.ts` : Extension → EBS Lab → Core Lab.
- **Chat** (`event-shop-chat.test.ts`) : muet fermé, un achat par message, refus sans débit, `!peur foxy` /
  `screamer`, conversion plafonnée.
- **Extension** : `events-shop.test.js`.
- **Validé par Antoni (28/10)** : vidéo et son des screamers sur son écran. **Non testé** : la capture OBS, le parcours d’achat complet par Antoni.

## 11. Anciens assets Halloween (`Stream PROJET\Halloween`, inventaire du 28/10, lecture seule)

2 137 fichiers, 26 Go : 99 `.mov` (QuickTime Animation avec transparence, 1080p ou 4K), 1 991 PNG (séquences
d'images), 22 projets After Effects (aucun After Effects sur ce PC pour les ouvrir), 11 `.mp4`, 4 `.mp3`.

**A — Déjà repris** : les 28 screamers de `Anim de stream\Screameur Audio`, les chauves-souris
(`Chauve-Souris Son.mov`) et l'araignée (`Araignée\Araignée 1 minute loop balade.mov`, 12 s). Ils sont convertis et
au catalogue.

**A — Prêts à reprendre** (transparence et son, courts : une ligne dans `halloween-import.mjs` et une entrée de
catalogue chacun) :

| Fichier                                                               | Durée          | Idée                                                                       |
| --------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| `Anim de stream\Mutant couteau.mov`                                   | 1,8 s          | screamer très court                                                        |
| `Anim de stream\Tête de brique.mov`, `Screamer Kid Head.mov`          | 1,7–1,9 s      | screamers courts (proches de « Brique bizarre » / « Enfant » : à comparer) |
| `Anim de stream\Screamer Chien.mov`, `Screamer Chien coucou.mov`      | 6,2–6,5 s      | screamer « coucou » (montée puis cri)                                      |
| `Anim de stream\Screameur Chika.mov`                                  | 3 s, 640×360   | screamer                                                                   |
| `Séquence d'images\Miss Minute Screamer\Miss Minute Halloween.mov`    | 2,5 s, 640×360 | screamer, avec `Hello Audio.mp3` (1,9 s)                                   |
| `Anim de stream\Fantome Anim Son.mov`                                 | 5,6 s, 640×360 | apparition sonore                                                          |
| `Séquence d'images\Transition Halloween\Transition Chauve souris.mov` | 3,5 s          | **Spécial** : nuée de chauves-souris plein écran, avec son                 |
| `Waiting Screen Halloween\Waiting Screen SNKloween.mp4`               | 60 s, 1080p    | écran d'attente : directement dans OBS                                     |

**B — Petite adaptation** :

- `Anim de stream\Petit fantome.mov` (5,2 s) et `Chauve souris Fx.mov` (4,3 s) : apparitions **muettes**, un son à
  ajouter ou à laisser muettes.
- `Hello Audio.mp3`, `Halloween Gift song.mp3`, `Ballon Halloween*.mp3` : la catégorie **Sons** (audio seul) demande
  une petite évolution du moteur (lecture sans image) et du script d'import.
- `Alerte\Doofus Gift*.mov` / `Doofus Jerry Subgift*.webm` (7–9 s) : alertes de sub offert Halloween. Les reprendre
  dans les alertes Studio, en variante Halloween des alertes de sub offert.
- `Séquence d'images\Araignée Overlay Cam\*.mov` (4 min 50, boucle) : décor de webcam (araignée qui descend), à
  convertir en WebM pour une source OBS.
- Les `.mp4` fond vert de la racine (« ONaF Jumpscares », « Poppy Playtime », « Spider », « Blood Splatter ») :
  incrustation à faire, et probablement des contenus tiers.

**C — Subgoal** (l'ancien, d'après les rendus : un **tube à potion** qui se remplit) :

- `Alerte\Ame\Composition 1.mov` : le tube cyan vertical ;
- `Alerte\Fond pour la barre.mp4` : la texture de potion verte animée (5 min 10, 4K) ;
- `Alerte\Ame\âme 1/3/4.mov` : une âme cyan qui vole vers le tube, à chaque sub ;
- `Alerte\Sub Plein !.mov` : des bulles au sommet du tube plein (5 min 10, 4K) ;
- `Alerte\Alerte sub Balloon\Ballon variante 1–4.mov` : une **explosion de bonbons**, parfaite pour les paliers ;
- `Alerte\Alerte sub Balloon\Subgoal anim.aep` : le projet source (non ouvrable ici).

**D — Non prioritaire** :

- `Araignée Bon loop` / `Araignée de Cam` / `araignée fixed` : 4 Go chacun, doublons lourds des boucles d'araignée ;
- les sauvegardes automatiques After Effects ;
- `Comptes rendus Jumpscare.aep` (des journaux) ;
- les PNG des séquences d'images, déjà rendues en `.mov` ;
- `Screameur Poppy Playtime\Huggy wuggy.mov`, qui fait doublon avec « Huggy Wuggy ».

## 12. Idées d'interactions (à partir de ces assets, après validation de la chaîne principale)

- **Nuée de chauves-souris** (Spécial, environ 6 Bonbons) : `Transition Chauve souris.mov`.
- **Coucou…** (Screamer) : `Screamer Chien coucou.mov` ; la montée lente rend le cri plus efficace.
- **Miss Minute** : « Hello… » puis le visage. Le son seul peut aussi servir d'effet **Sons** à 2 Bonbons.
- **Fantôme furtif** : `Petit fantome.mov`, muet, qui traverse l'écran (Apparition, environ 3 Bonbons).
- **Pluie de bonbons** : `Ballon variante`, quand un viewer échange des Jetons ou à chaque palier du Subgoal.
- **Combinaisons sobres** : Brouillard puis Yeux dans le noir (déjà dessinés), ou Clignement puis un son.

Règles inchangées : effets courts, un à la fois, sans stroboscope, volume homogénéisé (−16 LUFS). Les gros screamers
restent chers et limités à 6 par heure.

## 13. Subgoal Halloween : la solution la plus rapide

Le chemin le plus court, sans toucher aux alertes OBS, est une **source navigateur OBS servie par Studio**, comme les
autres lecteurs. Elle reprend le tube de 2024 :

- **Visuel** : le tube (`Composition 1`) en image fixe et la potion (`Fond pour la barre`) en boucle WebM courte
  (environ 20 s, 1080p, quelques Mo), masquée à la hauteur de la progression. Le texte « N / objectif ».
- **Compteur durable** : le Core compte les subs (sub, resub, subs offerts) depuis le début de l'objectif, à partir
  des événements Twitch qu'il enregistre déjà (`alert_events`, sans doublon). Studio règle l'objectif, les paliers et
  une **correction manuelle** (+/−).
- **Animations** : à chaque sub, une âme (`âme 1/3/4`) vole vers le tube. À chaque palier, une pluie de bonbons
  (`Ballon variante`) et la couleur de la potion change. À l'objectif, les bulles de `Sub Plein !` en boucle.

Estimation : environ une journée (Core, Studio, page OBS, conversions et tests). C'est faisable avant samedi
seulement si la chaîne d'achat est validée en vrai d'ici là. Sinon, la solution de repli est un compteur texte dans
OBS mis à jour à la main.
