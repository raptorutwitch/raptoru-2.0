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
- **Ajoutés le 30/10, désactivés par défaut** (le Core les insère dans un catalogue existant sans toucher aux prix,
  noms ni états déjà réglés ; Studio les active) :
  - Chaos : Écran retourné 5 (10 s, recharge 5 min), Flou 3 (6 s, moyen, recharge 2 min) — § 4 bis ;
  - screamers à 10 : Miss Minute, Mutant au couteau, Coucou…, Chika ;
  - apparitions : « Hello… » 2 (son seul, rubrique Sons), Fantôme 5, Nuée de chauves-souris 6 (rubrique Spécial),
    Fantôme furtif 3 (muet).
  - Leurs miniatures sont dans `assets/halloween/` pour la **prochaine** version de l'extension : l'extension publiée
    les affiche sans image. Le chat (`!peur flip`, `!peur s-miss-minute`…) n'en a pas besoin.

## 4 bis. Chaos : écran retourné et flou (30/10)

Le vrai écran du joueur n'est jamais modifié (aucune orientation Windows changée) : l'overlay **capture la fenêtre du
jeu** et la redessine par-dessus elle-même, retournée ou floue. Le joueur continue à jouer (souris et clavier vont au
jeu, l'overlay laisse passer les clics) et OBS, qui capture l'écran, montre la même chose aux viewers.

- **Fenêtre capturée** : celle choisie dans Studio › Halloween › Chaos (« Fenêtre du jeu »), sinon la fenêtre au premier
  plan qui n'est pas Studio. Jamais l'écran entier (l'overlay se capturerait lui-même), jamais une fenêtre de Studio.
  Fenêtre choisie fermée : l'effet échoue proprement (rien ne s'affiche ; un achat non démarré est remboursé).
- **Écran retourné** : tête en bas (180°), miroir (gauche ↔ droite) ou inversé (haut ↔ bas), 3 à 60 s, avec un
  retournement animé de 0,7 s à l'aller et au retour.
- **Flou** : faible / moyen / fort, 2 à 30 s, légèrement agrandi pendant le flou (aucun bord net ne dépasse).
- **Arrêt** : fin automatique, STOP ALL (bouton ou Ctrl+Maj+F12) immédiat, délai maximal comme les autres effets,
  fermeture ou plantage de Studio (la fenêtre de l'overlay disparaît avec lui), redémarrage : rien n'est rejoué.
- **Un effet à la fois** (comme tout le moteur : un second est refusé `busy`). Les politiques de Chaos Control
  (Replace, Stack, Queue) ne s'appliquent pas : le moteur Halloween a sa règle unique « un à la fois, sans file ».
- **Limites connues** : le jeu doit être en **fenêtré sans bordure** sur l'écran de l'overlay (le plein écran exclusif
  passe au-dessus de toute fenêtre) ; un jeu lancé **en administrateur**, ou Studio lancé en administrateur, ne peut pas
  être capturé (Windows refuse : l'effet échoue proprement) ; une fenêtre plus petite que l'écran est étirée à tout
  l'écran ; décalage d'une ou deux images pendant l'effet.
- **Tests gratuits** : Studio › Halloween › Chaos › « Tester » (sans Core ni Bonbon). La dernière fenêtre capturée est
  affichée et écrite dans le journal.

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

## 6 bis. Ambiance OBS (30/10) — décor pour les viewers

Une source navigateur OBS servie par Studio, **jamais sur l'écran du jeu** : seuls les viewers la voient.

- **Couches** : l'araignée qui se promène autour de la cam (boucle de 4 min 50, `Araignée Overlay Cam Mouche.mov`), un
  vol de chauves-souris de temps en temps (`Chauve souris Fx.mov`, muet), une vignette sombre sur les bords (le centre
  reste dégagé, légère respiration, coupée si l'OS demande moins d'animations).
- **Studio › Halloween › Ambiance OBS** : interrupteur général (coupé par défaut : la source n'affiche rien), chaque
  couche, intervalle des vols (0 = seulement sur le bouton), intensité de la vignette, « Lancer un vol maintenant ».
  L'état dit si une source est ouverte dans OBS.
- **URL** (affichées dans Studio, avec la clé) : tout ; `?layers=spider` (l'araignée seule, à placer et redimensionner
  sur la cam) ; `?layers=bats,vignette` (plein écran).
- **Sécurité** : Studio injoignable 15 s → plus rien n'est affiché ; STOP ALL arrête un vol en cours ; aucun son.

## 7. Extension, revue Twitch et accès progressif

- **Compatibilité** : le Core n'ajoute pas le module à `modules`. Il expose une clé `event_shop` séparée, et seule la
  nouvelle extension affiche « Événements » (édition « Halloween 2026 », nom fourni par le Core). L'extension publiée
  actuellement continue donc de fonctionner sans changement face au nouveau Core.
- **La revue Twitch n'a pas de délai garanti** (de quelques jours à plusieurs semaines). **Une seule version peut être
  en revue à la fois** (doc Twitch « Extension Life Cycle »).
- **Hosted Test ne convient pas à la chaîne en direct.** La doc officielle dit : « Extensions are visible only to a
  developer-provided list of test accounts… Other viewers see your channel without any Extensions. » Activer la
  version de test sur `raptoru_` **retire l'extension à tous les viewers qui ne sont pas testeurs**. Hosted Test ne
  sert qu'à vérifier la version sur une chaîne ou un compte de test, hors live.
- **Accès progressif sans risque** :
  - la version **publiée et approuvée** contient le module, et c'est le **Core** qui décide qui le voit ;
  - Studio › Halloween › Boutique : « Module « Événements » dans l'extension : **Tous les viewers / Testeurs
    seulement** » ;
  - Studio › Trouver un viewer : « + Testeur extension » ;
  - un non-testeur ne reçoit rien de la boutique (pas d'articles ni de solde) et le Core refuse ses achats depuis
    l'extension (`not_invited`) ;
  - le chat (`!peur`, `!bonbons`) et les gains (subs, Tombola) restent ouverts à tous ;
  - on ouvre à tous d'un clic.
- **Ne pas confondre** :
  - **Extension Lab** : `/ext/...` servie par le Studio local, faux viewers, Core Lab. Elle ne touche jamais Twitch.
  - **Hosted Test** : la version téléversée, visible seulement des testeurs Twitch, sur une chaîne de test.
  - **Version publique** : celle approuvée et publiée. Elle seule doit tourner sur `raptoru_` pendant le stream.
- **Recommandation** :
  - téléverser la version et la tester en Hosted Test sur un compte de test ;
  - la soumettre en revue **dès la validation Lab** ;
  - à sa publication, régler l'accès sur « Testeurs seulement », puis ouvrir à tous.

  Si l'approbation n'arrive pas avant samedi, le chat porte l'événement pour tout le monde (§ 7 bis).

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

0. **Préparation** :
   - fermer d'abord le Studio installé : les deux utilisent les mêmes ports (4100 pour Studio, 4301 pour le Core Lab) ;
   - le worktree a besoin de `apps/core-api/.env`, qui ne contient que la ligne `DATABASE_URL` du checkout principal
     (créé le 28/10, ignoré par Git, sans jeton Twitch).
1. `npm run studio` depuis le worktree, puis l'onglet Halloween 🎃.
2. Boutique : « Ouvrir la boutique ». Trouver un viewer, par exemple « Viewer Lab » (id 900101), puis le
   « Créditer ».
3. Ouvrir l'Extension Lab (`/ext/mobile.html?labRole=viewer`) › Événements et acheter un effet. On peut aussi taper
   `!peur blink` dans Studio › Simulation.
4. Le Dock OBS montre la ligne Halloween 5 s après le début de l'effet.
5. Tombola : Studio › Tombola › Montant fixe › Bonbons › Nombre fixe › Lancer. L'Extension Lab › Tombola ›
   « Je participe ». Après le tirage, le solde de Bonbons du gagnant augmente.

## 8 bis. Procédure de test OBS et STOP ALL (sur ton vrai bureau, avec une scène de test)

Aucune scène de Production n'est modifiée : dans OBS, duplique ta scène de jeu (clic droit › Dupliquer) et fais les
tests sur la copie.

1. **Capture vidéo** : dans Studio › Halloween › « Tester sur mon écran », clique « Foxy ». L'aperçu OBS de la scène
   copiée doit montrer le screamer, au-dessus de tout, avec la transparence (pas de rectangle noir).
2. **Capture audio** : pendant le test, la jauge « Son du pc » d'OBS doit bouger. Sinon, vérifier la sortie audio
   Windows utilisée par Studio.
3. **Jeu en fenêtré sans bordure** : lance le jeu en « fenêtré sans bordure », puis teste « Brouillard ». L'effet doit
   passer au-dessus du jeu, et un clic dans le jeu pendant l'effet doit fonctionner (la fenêtre de l'overlay laisse
   passer les clics). En plein écran exclusif, Windows peut afficher le jeu par-dessus : reste en fenêtré sans bordure.
4. **STOP ALL** : lance « Brouillard » (9 s), clique STOP ALL pendant l'effet. L'écran doit être propre aussitôt.
5. **Ctrl+Maj+F12** : relance « Brouillard », mets le jeu au premier plan, puis appuie sur Ctrl+Maj+F12. L'écran doit
   être propre aussitôt (le raccourci marche même si Studio n'est pas au premier plan).
6. **Fermeture et réouverture de Studio** : ferme Studio pendant un effet. L'écran doit être propre (la fenêtre de
   l'overlay se ferme avec Studio). Rouvre Studio : rien ne doit se rejouer. Le Core ne rejoue jamais un achat : un
   achat interrompu est remboursé s'il n'a pas commencé.
7. **Achat réel de bout en bout** (Lab) : un achat depuis l'Extension Lab, vérifié dans OBS (image et son), puis la
   ligne Halloween dans le Dock 5 s après.

## 9. Livraison en Production (chaque étape attend le GO d'Antoni)

**Le runbook détaillé (commandes exactes, critères d'arrêt, retour arrière) : [HALLOWEEN_GO.md](HALLOWEEN_GO.md).**

Avant tout : la PR #35 est relue puis **fusionnée** (GO), puisque Core, Studio et extension partent de `main`.

1. **Sauvegarde de la base de Production** : téléchargement manuel de la sauvegarde dans Coolify (OPERATIONS.md,
   BACKUPS.md § 2), et vérification qu'elle se lit.
2. **Migration et déploiement du Core** : `node scripts/coolify-deploy.mjs plan core <sha>` (lecture seule), puis
   `deploy core <sha> --migrations-approved --go`.
   - La migration `20261112130000_event_shop.sql` est additive : nouvelles tables, plus une ligne Bonbons dans les
     monnaies de la Tombola, et elle se rejoue sans risque. Retour arrière en tête du fichier.
   - Le bot ne change pas.
   - La boutique reste **fermée** jusqu'à son ouverture dans Studio.
   - Le Dock lit les achats Halloween seulement une fois la table créée : aucune panne pendant les quelques secondes
     où la migration passe après le démarrage.
3. **Release Studio** (`npm run studio:release`), puis installation par Antoni.
4. **Médias** : depuis `Documents\Raptoru 2.0 - Livraisons\2026-10-31-halloween-medias`, lancer
   `node halloween-media-install.mjs --from .`, puis `--check` (30 identiques). Ensuite, Studio › Halloween ›
   « Recharger les médias » : le catalogue ne doit plus afficher d'avertissement « absente de ce PC ».
5. **Extension** :
   - `npm run build -w @raptoru/twitch-extension`, puis téléversement de `dist/` comme **nouvelle version** ;
   - Hosted Test **sur un compte de test seulement** (§ 7) ;
   - demande de revue ;
   - à l'approbation : publication, accès « Testeurs seulement », puis « Tous ».
6. **Le jour J** :
   - ouvrir la boutique, vérifier « Prêt » dans Studio, faire un test local, garder STOP ALL (Ctrl+Maj+F12) à portée ;
   - vérifier qu'aucune commande Studio ne s'appelle `!peur` ou `!bonbons`.

À la fin de l'événement : « Fermer l'événement » (les achats en attente sont remboursés et les soldes gardés).

## 9 bis. Dock OBS, modération et administration

- **Dock OBS** :
  - chaque achat Halloween y apparaît (chauve-souris, nom de l'effet, viewer, coût en Bonbons, statut), **5 s après
    le début réel de l'effet** (réglable dans les règles : « Dock OBS : afficher l'achat après (s) », 0 = dès le
    début) ;
  - avant ce délai, l'achat n'existe pas pour le Dock (ni compteur, ni filtre, ni historique, même si le Dock est
    rouvert) ;
  - un achat jamais joué n'apparaît jamais ;
  - les autres événements ne sont jamais retardés ;
  - filtre propre : « Événements › Halloween ».
- **Modération (D4), comme pour les autres interactions payantes** : la « Pause Raptoru » refuse les achats (refus
  comptés dans le bandeau) et un blocage « partout » d'un viewer l'empêche d'acheter.
- **Non repris, volontairement** :
  - le blocage et le cooldown propres à un module, et l'état actif/pause d'un module : il faudrait modifier la
    console de modération, y compris l'extension publiée ; l'ouverture/fermeture de l'événement et la liste
    d'accès suffisent ;
  - le remboursement manuel depuis la modération : un achat non joué est déjà remboursé automatiquement ;
  - aucune sanction propre à Halloween.
- **Retrouver qui a acheté quoi** : Studio › Halloween › « Trouver un viewer » (pseudo Twitch ou id) montre le solde,
  les achats (effet, heure, coût, statut, remboursement) et les mouvements. Le Dock garde 30 jours d'historique.
- **Crédit manuel** :
  - « Créditer » depuis la fiche du viewer, montant et note ;
  - fonctionne avec tout viewer vu par la chaîne (et en Production, tout viewer connu) ;
  - un double clic ou une nouvelle tentative ne crédite qu'une fois ;
  - réservé à Studio, donc au streamer.
- **Tombola en Bonbons** : dans Studio › Tombola, choisir « Bonbons » passe en montant fixe (montants proposés
  5 / 10 / 20 / 30) ; « Aléatoire » est désactivé, car ses tranches sont en Jetons.

## 10. Tests

**30/10 (Chaos, médias, ambiance)** : `halloween-chaos.test.ts` (fenêtre choisie, liste des fenêtres venant d'Electron
seulement, paramètres d'un test, fenêtre capturée au journal, STOP ALL), `capture-window.test.ts` (jamais une fenêtre
de Studio, fenêtre fermée = rien), `event-shop.test.ts` (nouveaux articles insérés désactivés sans toucher aux
réglages de Studio), e2e Chromium `halloween-ambiance.e2e.ts` (source coupée = rien, interrupteurs immédiats, un vol,
source « araignée seule », Chaos sans fenêtre capturable = échec propre). **Sur le vrai bureau Windows** (Studio lancé
normalement, sans droits administrateur) : écran retourné et miroir, flou fort, double déclenchement refusé, STOP ALL
en plein effet, Studio tué en plein effet → écran propre. **Non testé** : dans OBS, en jeu réel, par Antoni.

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
- **Dock** (`dock-halloween.test.ts` et e2e) : rien avant 5 s après le début réel, les autres événements jamais
  retenus, un achat non joué jamais affiché ; preuve de bout en bout avec la page overlay.
- **Accès extension** (`event-shop.test.ts`, `ext-frontier`, e2e) : un non-testeur ne voit rien et ne peut pas
  acheter depuis l'extension ; le chat reste ouvert.
- **Parcours Lab réels (Playwright)** : défilement du module en 565×376 ; Tombola en Bonbons depuis l'onglet Tombola
  de Studio, inscriptions depuis l'Extension et gain crédité une fois ; « Trouver un viewer » puis « Créditer » sur un
  vrai pseudo, double clic compris ; « Testeurs seulement ».
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
