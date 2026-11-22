# Chatbox Raptoru : chantier (remplacer les trois chatbox StreamElements)

**État au 23/11/2026 : terminé en Lab (jalons 1 à 3, § 10), prêt à installer ; rien en Production sans le GO
d'Antoni (procédure § 12).** Aucune source OBS active, aucun widget StreamElements ni la Production ne sont touchés sans autorisation
explicite d'Antoni. Ce fichier est le point d'entrée du chantier ; il ne remplace pas le rapport de reconnaissance ni
la présentation (§ 1).

## 1. Sources (hors Git, privées)

| Quoi                                      | Où                                                                                                                    | Statut                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Rapport de reconnaissance (référence)** | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\_recherches\chatbox-2026-11-20\RECONNAISSANCE_CHATBOX.md`          | **source principale** : réglages OBS, CSS, JavaScript, comparatif, préservation, manques          |
| **Présentation pour décider (22/11)**     | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\_recherches\chatbox-2026-11-20\PRESENTATION_CHATBOX_2026-11-22.md` | paramètres exacts code → écran, critiques, options ; ne pas la refaire                            |
| Copies locales du code des widgets        | `C:\Users\Antoni\Documents\ChatGPT\Chatbox Twitch\` (`streamelements-main`, `-react`, `-compact`)                     | copies **probables** (dernière modification 03/09/2026), identité avec StreamElements non prouvée |
| Overlay local non retenu (même projet)    | `Chatbox Twitch\public\`                                                                                              | version antérieure, **pas une référence visuelle** (autres valeurs)                               |
| Collection OBS lue                        | collection active « Twitch Dofus » (canvas 1920 × 1080)                                                               | relue le 22/11, rien modifié                                                                      |

Ne pas déplacer ces fichiers. Le moteur d'emotes des widgets est **porté** dans le dépôt (accord d'Antoni du 22/11),
réécrit pour le nouveau contrat de messages ; code relu : aucun secret, seulement des API publiques (7TV, BTTV, FFZ,
Twemoji). Licences : le code des widgets est celui d'Antoni ; polices Figtree et Barlow Condensed sous SIL Open Font
License (fichier de licence fourni avec les polices) ; images Twemoji sous CC-BY 4.0 (attribution dans la page) ; les
images d'emotes restent chez leurs fournisseurs (affichées comme dans tout client de chat, jamais copiées).

## 2. Les trois chatbox en service

| Variante      | Source OBS       | Scènes                        | Code probable            | Caractéristiques (détail : présentation § 2)                                                                                                                        |
| ------------- | ---------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Just Chatting | `Boîte de chat`  | Just Chatting, Waiting screen | `streamelements-main`    | chat permanent, Figtree, cartes sombres opaques, emotes seules en grand, apparition par glissement ; texte ≈ 26 px à l'écran                                        |
| React         | `ChatReact`      | Scène PS5, Scène Fullscreen   | `streamelements-react`   | fond noir 18 % (le flou CSS est sans effet dans OBS), rôles en couleur, dernier message en avant, disparaît 10 s après le dernier message, dépliage ; texte ≈ 21 px |
| Dessin        | `Chatbox Dessin` | Scène Dessin                  | `streamelements-compact` | cartes noires, barre de couleur selon le rôle, disparaît 15 s après le dernier message, dépliage ; agrandie par OBS ; texte ≈ 24 px                                 |

La collection active garde un autre overlay StreamElements (`Sponso`, masqué) : hors périmètre.

## 3. Précautions

- Les sources OBS pointent vers des **URL d'overlay StreamElements qui contiennent une clé d'accès** : ne jamais les
  afficher, les recopier ni les committer (ni ici, ni dans un rapport, un journal ou un commit).
- Le code réellement collé chez StreamElements n'a pas été relu : les copies locales ne font pas foi avant
  vérification ; la comparaison côte à côte en Lab révélera les écarts.
- **Interdit sans autorisation explicite d'Antoni** : modifier les sources OBS actives, les widgets StreamElements, la
  Production. Les sources StreamElements restent **intactes** jusqu'à la validation explicite de chaque remplaçante,
  scène par scène.
- Masquer un message dans la chatbox n'agit **jamais** sur Twitch (ni ban, ni timeout, ni suppression) : l'interface
  le dit en toutes lettres.
- Aucun contenu de message n'est écrit sur disque ni dans un journal (Core et Studio : mémoire seulement).

## 4. Décisions d'Antoni (22/11)

**Direction : modernisation maîtrisée + intégration complète dans Raptoru Studio.** Garder l'identité et les
comportements particuliers des trois chatbox ; moderniser proportions, animations, lisibilité et qualité technique ;
**tout se gère depuis Studio** (plus jamais de HTML ou de CSS chez StreamElements).

Validé après la proposition d'architecture :

- Architecture **bot Twitch existant → Core → Raptoru Studio → overlays OBS** ; une seule infrastructure partagée ;
  aucune seconde connexion Twitch ; jamais une connexion par profil.
- Trois profils indépendants (Just Chatting, React, Dessin), un éditeur visuel dans Studio, des réglages persistants
  appliqués immédiatement aux overlays.
- Présets « Origine » et « Modernisée » ; **préset initial : Modernisée**, bascule instantanée sur Origine pour
  comparer.
- Portage du moteur d'emotes des anciens widgets, après vérification des licences et des fichiers copiés (§ 1).
- Annonces Twitch et messages mis en avant dès la V1.
- Organisation des sources OBS laissée à l'agent (cinq pages plein cadre retenues, § 5.2) ; exigences : proportions
  fidèles, messages nets, configuration intuitive, **aucune régression** sur les scènes existantes.
- Démonstration manipulable des trois chatbox **avant toute installation** ; fonctionnement en Lab hors live, sans
  toucher la Production.
- Pas d'IA pour le filtrage.

## 5. Architecture

### 5.1 Chemin des messages : aucune nouvelle connexion Twitch

```text
Twitch EventSub ── connexion existante du bot (jeton LeCroupier_)
  → bot (VPS) : POST /v1/bot/chat, déjà envoyé pour chaque message, + champs d'affichage ;
                suppressions et clear (3 abonnements de plus, même connexion) ; ses propres messages, marqués
  → Core (VPS) : classe chaque message (commande connue, famille du Croupier, rôle d'équipe) ;
                 relais chatbox EN MÉMOIRE (derniers événements, curseur) → flux SSE /v1/studio/chatbox/…
  → Studio (PC) : UNE connexion au Core pour les trois profils ; règles de visibilité ; tampon local ; catalogues
  → pages OBS (une par scène), flux local sur le port 4100
```

- **Bot** : ajoute au message déjà transmis ce que l'affichage demande (couleur, fragments emotes / mentions /
  cheermotes, badges avec leur version, type de message : annonce avec sa couleur, message mis en avant, premier
  message ; réponse). S'abonne, sur sa connexion existante, à `channel.chat.message_delete`,
  `channel.chat.clear_user_messages` et `channel.chat.clear` (scope `user:read:chat`, déjà présent). Transmet ses
  propres messages **marqués** : les jeux ne les voient jamais, seule la chatbox les reçoit.
- **Core** : classe, puis relaie **en mémoire seulement** (aucune table, aucune migration) les quelque 200 derniers
  événements par chaîne, avec un numéro de séquence ; flux SSE pour Studio sur le jeton d'installation (modèle : flux
  du Jeu des mots, `http/word-game-routes.ts`) ; le même sous `/v1/lab/…` (le simulateur de chat du Lab alimente le
  même routeur). Badges : catalogue Helix (globaux et chaîne) avec le jeton d'application que le Core sait déjà
  obtenir (modèle : `raffle-lab/avatars.ts`), en cache.
- **Studio** : un module `chatbox` qui n'écoute le Core que si une page est ouverte (modèle : `level-up/runtime.ts`),
  applique les règles de visibilité (§ 6), garde un tampon local (historique pour une page rechargée) et pousse aux
  pages par un flux local. Catalogues 7TV, BTTV et FFZ chargés **une seule fois** par Studio (toutes les 10 min, cache
  disque) et servis aux pages.
- **Deux flux séparés** : `live` (le vrai chat, pour OBS) et `demo` (le simulateur, pour la prévisualisation et la
  démonstration). Le simulateur n'écrit jamais dans le flux `live` d'une page OBS de Production.
- **Panne** : si le Core, le VPS ou Studio s'arrête, les pages gardent l'affichage et se reconnectent seules ; les
  sources StreamElements, masquées mais intactes, restent le recours.

### 5.2 Les pages OBS

- Une page unique servie par Studio (dossier statique `apps/studio/server/chatbox-player/`), choisie par l'adresse :
  profil + scène. Adresse stable (jeton dans le fragment `#`, comme les effets) : installée une fois, elle ne change
  plus.
- **Source plein cadre 1920 × 1080 à l'échelle 1 ; la boîte est placée par Studio.** Position, taille et apparence se
  règlent dans Studio ; rendu net (plus d'agrandissement par OBS) ; OBS ne garde que l'ordre des calques. Source à
  verrouiller dans OBS, comme le Level Up et les effets.
- **Un emplacement par scène** : Just Chatting, Waiting screen, PS5, Fullscreen, Dessin (cinq sources, trois
  profils). L'emplacement appartient à la scène ; l'apparence, au profil. Valeurs de départ = les zones affichées
  d'aujourd'hui (présentation § 2), donc aucune régression de placement.
- Réglages enregistrés → poussés par le flux et appliqués **sans rechargement**. Après une mise à jour de Studio, une
  page ancienne se recharge seule.

### 5.3 Profils, présets, persistance

- Trois profils indépendants, chacun avec **tous** ses réglages (§ 9.2). Modifier un profil ne touche jamais les deux
  autres.
- Présets par profil : **« Origine »** (lecture seule) = le rendu StreamElements actuel, converti en pixels d'écran ;
  **« Modernisée »** (lecture seule, préset initial) = la direction artistique du § 8 ; **présets personnels**
  enregistrables, renommables, supprimables. « Revenir à l'origine » à tout moment ; comparaison Origine / Modernisée
  sur les mêmes messages.
- Persistance : un fichier JSON versionné dans le dossier de données de Studio (écriture atomique ; un fichier abîmé
  est mis de côté et réparé champ par champ depuis le préset, modèle `spotify/music-overlays.ts`) ; relu au
  démarrage ; compris dans les sauvegardes des données de Studio ([BACKUPS.md](BACKUPS.md) § 0.2).

### 5.4 Moteur d'affichage

- Porté des widgets : fragments Twitch (emotes animées comprises), 7TV / BTTV / FFZ par nom, emotes **zero-width**
  empilées sur l'emote précédente, Twemoji (graphèmes composés), emotes seules agrandies avec réduction progressive,
  `/me`, coupe des pseudos et des mots trop longs, modération.
- Animations par `transform` et `opacity` seulement (la pile glisse par la technique FLIP, jamais en animant la
  hauteur) ; allégées en rafale.
- Le même fichier sert dans OBS, dans la prévisualisation de Studio et dans la démonstration : rendu identique.

## 6. Visibilité : un vrai gestionnaire dans Studio

Ordre de décision (le premier qui s'applique gagne) : **modération** (message supprimé, viewer exclu, clear : retiré
partout) → **règle de compte** → **famille du Croupier** → **type spécial** → **commande** → **affiché normalement**.
Trois comportements partout : **masquer**, **normal**, **mettre en avant**. Règles globales aux trois profils,
persistantes, éditées dans Studio ; aucune IA, aucune liste de phrases.

### 6.1 Comptes

- Une règle par compte Twitch, reconnue par son **identifiant stable** (jamais par le pseudo seul : un pseudo
  saisi est résolu en identifiant par le Core, Helix avec le jeton d'application, `twitchAppLoginLookup`).
- Comportement : masquer, normal (exception : toujours affiché, même si une autre règle masquerait), mettre en avant.
- Ajout depuis la liste des comptes vus récemment (un clic) ou par pseudo.
- Par défaut : Nightbot et StreamElements masqués (modifiables) ; LeCroupier_ suit le catalogue du § 6.3 ; les
  viewers sont visibles.

### 6.2 Commandes (catalogue complet, demande d'Antoni du 23/11)

- Une commande, c'est `!` suivi d'une lettre ou d'un chiffre (`!song`, `!Roue`) ; `!!!!!`, `!?!?`, `! salut` ne le
  sont jamais (jamais masqués comme commandes).
- **Catalogue** (Core, `chatbox/catalog.ts`, lu par Studio chaque minute) : le registre Commandes V2 de la chaîne
  (noms + alias, désactivées comprises : une commande créée dans Studio apparaît seule), les mots réservés des modules
  (Tombola, mini-jeux, `!tts`, `!rb`, `!fxcam`, Jetons des modérateurs, modules hôtes), les mots que les modules ne
  déclarent que dans leur analyseur (Caution, Votekick, Musique, Roue du Sub, Halloween, Jeu des mots, Objectif, Daily
  et Jetons du bot : `MODULE_COMMANDS`, une seule liste) et les mots qu'un module a pris dans le chat (découverts : une
  nouvelle commande de module apparaît à sa première utilisation, jusqu'au redémarrage du Core).
- **Une entrée par commande, ses alias avec elle** (`!solde · !balance · !compte` = un seul réglage).
- **Deux réglages indépendants par commande** : le **message du viewer** (afficher / masquer ; par défaut masqué) et la
  **réponse de LeCroupier_** (comme sa catégorie / masquer / afficher / mettre en avant).
- **Lien réponse ↔ commande, sans lire de texte** : le routeur de chat du Core exécute chaque module dans le contexte
  du message (`chatbox/trigger.ts`) ; chaque réponse écrite à ce moment garde `params.trigger` (message et mot de
  commande) dans `cmd_steps` (aucune migration) ; les réponses directes du bot (Daily, Jetons) sont marquées par le
  bot lui-même.
- **Commandes externes** (Nightbot, StreamElements…) : une liste éditable dans Studio, masquées si listées.
- **Commande inconnue** : politique réglable, **affichée par défaut**.

### 6.3 Catalogue des messages du Croupier

- Tous les messages de LeCroupier_ qui viennent du Core passent par la file `cmd_steps` : origine (`commands`,
  `word_game`, `mini_game`, `raffle`, `sub_wheel`, `music`, `module:<nom>`), nature (`reply`, `refusal`, `action`),
  commande d'origine, et, après l'envoi, l'**identifiant Twitch du message** (`twitch_message_id`). Le Core rattache
  l'écho du message au pas qui l'a émis par cet identifiant (repli pour les annonces, que Twitch renvoie sans
  identifiant : le texte exact qu'il vient d'émettre, dans une fenêtre de quelques secondes).
- **Famille** = `params.family` quand l'émetteur la déclare (ajoutée au fil des modules), sinon `origine:nature`,
  et pour une commande `commands:<nature>:<commande>`. Chaque famille a un libellé clair en français et une catégorie :
  Réponses aux commandes · Refus et erreurs · Jeux du chat · Tombola · Roue du Sub · Musique · Level Up · Casino ·
  Annonces · Autres.
- Studio montre le catalogue par catégorie, avec le dernier exemple vu de chaque famille ; on règle une catégorie
  entière ou une famille seule (la famille l'emporte).
- **Repli** : un message de LeCroupier_ qui ne se rattache à aucun pas (envoi direct du bot, message tapé à la main)
  va dans « Non catégorisé », avec son propre réglage.
- **Par défaut** : tout masqué (messages ordinaires et retours techniques) ; Antoni autorise ou met en avant les
  familles qu'il choisit.

### 6.4 Messages spéciaux

| Type                                    | Défaut          | Remarque                                                                   |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| Annonce Twitch (`/announce`)            | mettre en avant | la couleur choisie dans Twitch donne l'accent                              |
| Message mis en avant (points de chaîne) | mettre en avant |                                                                            |
| Premier message d'un viewer             | normal          |                                                                            |
| Messages spéciaux du Croupier           | selon § 6.3     | une famille réglée « mettre en avant »                                     |
| Anniversaires du bot                    | selon § 6.3     | n'existent pas dans le code aujourd'hui ; ils deviendront une famille      |
| Abonnements, raids                      | masquer         | phase suivante ; déjà couverts par les alertes : pas de doublon par défaut |

### 6.5 Rôles et barres de couleur (cas Aouh)

- Rôle = la source autorisée la plus haute : badge Twitch `broadcaster` → **rouge** ; badge `moderator` **ou**
  `lead_moderator` **ou** rôle d'équipe Raptoru (`supermod`, `moderator`, table d'équipe de `lab-moderation`, joint
  par le Core) → **vert** ; badge `vip` → **rose**. Priorité : broadcaster > modération > VIP.
- Cause probable du cas Aouh : les widgets ne reconnaissent que le badge `moderator` ; un Lead Moderator Twitch porte
  `lead_moderator` à la place (le bot le gère déjà, `chatRole`). La règle ci-dessus couvre aussi un rôle Raptoru sans
  badge Twitch. Aucune exception par pseudo. À confirmer sur un vrai message d'Aouh au jalon 2.
- Les badges coexistent et s'affichent tous ; la couleur du pseudo reste celle de Twitch (palette de secours si
  absente ; lisibilité des pseudos très sombres réglable, éteinte dans Origine).

## 7. Parité historique : aucun downgrade

Matrice de parité : chaque ligne est un cas de test réutilisable (`apps/studio/server/src/chatbox/parity.ts`) et un
message de la démonstration. Valeurs Origine (code des widgets ; à l'écran : présentation § 2).

| N°  | Caractéristique                                                      | Just Chatting                        | React                             | Dessin                            |
| --- | -------------------------------------------------------------------- | ------------------------------------ | --------------------------------- | --------------------------------- |
| P01 | Emotes Twitch statiques et animées                                   | oui                                  | oui                               | oui                               |
| P02 | 7TV, BTTV, FFZ par nom (chaîne et globales)                          | oui                                  | oui                               | oui                               |
| P03 | 7TV zero-width empilées sur l'emote précédente (plusieurs couches)   | oui                                  | oui                               | oui                               |
| P04 | GIF et WebP animés                                                   | oui                                  | oui                               | oui                               |
| P05 | Emojis Unicode en Twemoji (drapeaux, séquences ZWJ, teintes)         | oui                                  | oui                               | oui                               |
| P06 | Message d'emotes seules agrandi (une pile zero-width compte pour 1)  | 120, puis 104 / 92 / 82 / 74 / 68 px | 60 px, jamais agrandi             | 58 px, − 2,5 px par emote, min 48 |
| P07 | Emote dans le texte · badges                                         | 44 · 25 px                           | 60 · 32 px                        | 46 · 22 px                        |
| P08 | Pseudo · message (police, taille, graisse)                           | Figtree 26/800 · Figtree 34/500      | Barlow C. 32/800 · Figtree 34/500 | Barlow C. 22/800 · Figtree 23/600 |
| P09 | `/me` en italique, couleur éclaircie                                 | oui                                  | oui                               | oui                               |
| P10 | Pseudo coupé « … », mots trop longs coupés si nécessaire             | oui                                  | oui                               | oui                               |
| P11 | Couleur Twitch du pseudo, palette de secours (8 couleurs)            | oui                                  | oui                               | oui                               |
| P12 | Barre de rôle (rouge / vert / rose), largeur                         | aucune                               | 6 px                              | 4 px                              |
| P13 | Dernier message en avant                                             | non                                  | anciens à 88 %                    | non                               |
| P14 | Apparition                                                           | glissement 34 px, 620 ms             | dépliage 40 px, 1 300 ms          | dépliage 20 px, 1 300 ms          |
| P15 | Présence                                                             | permanente                           | 10 s, fondu 800 ms, barre 4 px    | 15 s, fondu 800 ms, barre 2 px    |
| P16 | Fondu du haut                                                        | 5 % fixe                             | dès 630 px, jusqu'à 200 px        | de 600 à 650 px, jusqu'à 50 px    |
| P17 | Plafond ; les plus anciens qui débordent sortent par le haut         | 50                                   | 50                                | 65                                |
| P18 | Modération : message, viewer (timeout, ban), clear (nouveau)         | oui                                  | oui                               | oui                               |
| P19 | Commandes : Raptoru masquées, `!!!` visibles (remplace « tout `!` ») | oui                                  | oui                               | oui                               |
| P20 | Carte : fond, bord, arrondi                                          | noir 85 %, 8,5 %, 14                 | noir 18 %, 2 px 8 %, 16           | noir 65 % (× 91 % OBS), 6 %, 10   |

« Modernisée » garde chaque ligne (les valeurs changent, la caractéristique reste) ; la démonstration montre les deux
présets sur les mêmes messages.

## 8. Direction artistique (préset « Modernisée »)

Liberté graphique donnée par Antoni ; contraintes : pas de grosses cartes violettes ni de néons ; moderne et
professionnel ; animations fluides ; messages nets et lisibles ; fonds discrets sans voile grisâtre ni faux flou ;
emotes qui ressortent ; hiérarchie claire pseudo / badges / message ; annonces traitées avec élégance ; propre sur fond
lumineux, sombre ou chargé ; **la transparence du fond ne rend jamais le texte ni les emotes transparents**.

- **Principe commun** : le texte porte sa propre lisibilité (ombre portée courte et dense, contour fin optionnel), le
  fond n'est qu'un appui. Fonds en noir chaud légèrement bleuté, opacité réglable sur le fond seul. Rôles en barre fine
  arrondie. Pseudo au-dessus du message, badges alignés sur le pseudo.
- **Just Chatting, permanente et confortable** : colonne de cartes pleines, très lisibles, généreuses ; barre de rôle
  discrète (nouvelle) ; emotes seules en grand ; glissement court.
- **React, légère, transparente et temporaire** : pas de carte pleine ; un dégradé sombre ajusté au contenu, qui
  s'efface vers la droite ; texte à forte ombre ; dernier message plein, les autres atténués **sur le fond seulement** ;
  disparition après 10 s de calme avec barre de décompte fine.
- **Dessin, compacte et discrète** : cartes serrées, petites, sombres ; barre de rôle fine ; disparition après 15 s.
- **Mise en avant** : un accent (couleur de l'annonce, sinon couleur du profil) en barre plus large et léger halo à
  gauche, une étiquette courte en capitales espacées (« Annonce », « Mis en avant », nom de la famille du Croupier).

## 9. Studio : contrôle complet

### 9.1 Écran Chatbox

- Un écran dédié (fichiers `chatbox*.ts`, le fichier central ne fait que le brancher), dans « Modules ».
- Pour le profil choisi : **prévisualisation fidèle** (la vraie page) sur un fond au choix (sombre, lumineux, chargé,
  image de la scène), réglages groupés, « Enregistrer » (appliqué tout de suite dans OBS), « Annuler », présets,
  emplacements de ses scènes (position, taille) et l'adresse OBS de chaque scène.
- Gestionnaire de visibilité (§ 6) : comptes, commandes, catalogue du Croupier, messages spéciaux.
- Simulateur intégré, hors live et sans Core : scénarios représentatifs (rafale, emotes empilées, rôles, commandes,
  Croupier, annonces, modération) ; les messages filtrés restent visibles dans la prévisualisation, barrés, avec la
  raison, pour comprendre les règles.
- **Démonstration** : les trois profils côte à côte, mêmes messages, bascule Origine / Modernisée.

### 9.2 Réglages d'un profil

Typographie (police du pseudo et du message, tailles, graisses, interligne) ; carte (fond, opacité du fond, bord,
arrondi, marges, espacement, largeur pleine ou ajustée, ombre du texte) ; badges (taille) ; emotes (taille dans le
texte, agrandissement des emotes seules : maximum, minimum, réduction) ; rôles (largeur de barre, couleurs) ; dernier
message en avant ; apparition (style, durée, distance) ; présence (permanente ou durée, fondu, barre de décompte) ;
fondu du haut ; plafond de messages ; emplacements.

## 10. Jalons

| Jalon                                           | État                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **1. Prototype Lab et démonstration**           | **livré** (22/11), essayé par Antoni le 23/11 : direction graphique validée                 |
| **2. Le vrai chat dans le Lab**                 | **livré** (23/11) : bot, relais du Core, flux Studio, catalogue, rôles, modération, reprise |
| **3. Prêt pour le live**                        | **livré en Lab** (23/11) : animations corrigées, éditeur simplifié, performances mesurées   |
| **4. Production (autorisation à chaque étape)** | **prête, non faite** : procédure § 12                                                       |

### 10.1 Ce qui est livré (branche locale `feat/chatbox-lab`, worktree `agent`, non poussée)

- **Bot** (`apps/twitch-bot/src/chatbox-forward.ts`, drapeau `CHATBOX_RELAY`, **éteint par défaut**) : sur la connexion
  EventSub existante, chaque message (couleur, badges, fragments d'emotes, réponse, message mis en avant, premier
  message), les annonces, les suppressions / timeout / ban / clear, les messages de LeCroupier_ marqués (les jeux ne
  les voient jamais) ; envoi groupé à `POST /v1/bot/chatbox`, au mieux (une panne ne bloque jamais les jeux). Route
  séparée : le message strict des jeux du chat (`/v1/bot/chat`) n'est pas modifié.
- **Core** (`apps/core-api/src/chatbox/`, `http/chatbox-routes.ts`) : relais **en mémoire** (badges Helix avec le jeton
  d'application, rôle `supermod` de `lab_staff`, messages du Croupier rattachés à leur pas `cmd_steps`, curseur et
  reprise), catalogue des commandes, flux SSE et catalogue pour Studio (`/v1/studio/cockpit/chatbox/…`, jeton
  d'installation). En Lab, le chat simulé de Studio alimente le même relais. **Aucune migration.**
- **Studio** : flux live unique pour les trois profils (ouvert seulement si une page OBS live écoute, reprise après
  coupure ou redémarrage du Core), règles par commande, écran simplifié (présets, aperçu, six réglages essentiels,
  emplacement et réglages avancés repliés, « Ce qui s'affiche » avec recherche).
- **Page OBS** : la pile glisse en bloc avec le nouveau message (Web Animations ; le nouveau part au moins aussi bas que
  le déplacement de la pile : **aucun chevauchement**, mesuré à chaque image, en rafale et à la suppression).
- **Essayer** : `npm run chatbox:demo` (sans fermer le Studio installé ; catalogue absent, pas de Core) ou
  `npm run studio:lab` (Studio installé fermé ; chat simulé du Lab → Core → page OBS live).
- **Tests** : Core 8 (relais, déclencheur, catalogue) + 258 des suites voisines ; bot 7 (dont GIF Twitch, annonces
  du chat partagé) ; Studio 52 (dont reprise du flux, redémarrage du Core, aucun doublon) ; e2e
  `e2e/chatbox.e2e.ts` (3 : page et réglages en direct, chaîne réelle Lab → Core → Studio → page, chevauchement à
  chaque image sur React et Dessin).
- **Performances** (23/11, GPU réel RTX 3070 / D3D11, 5 pages plein cadre ouvertes, chat à 22 messages/s pendant 8 s) :
  intervalle médian 16,6 ms, 95e centile 18,5–19,4 ms, 4 à 6 images au-delà de 34 ms sur ~530 par page (pic 94 ms à
  l'arrivée de nouvelles images d'emotes) ; OBS rend à 30 images/s (33 ms) : marge confortable.

## 11. Reprise

- Lire ce fichier, puis la présentation et le rapport (§ 1). Ne refaire ni la reconnaissance ni la présentation.
- Le chantier est terminé en Lab ; la suite est la procédure § 12, étape par étape, sur GO d'Antoni.

## 12. Mise en service (chaque étape sur GO d'Antoni)

Versions en Production relevées le 23/11 (lecture seule) : Core `a94d1081`, bot `2c04a5db`, Studio installé 0.1.42.
Depuis ces versions, `main` n'apporte au Core et au bot que la Chatbox ; à Studio, la Chatbox et la partie Studio du
Casino déjà fusionnée (`a94d1081`). Rien de plus récent n'est écrasé.

| Étape                     | Commande / geste                                                                                | Retour arrière                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Core                   | `node scripts/coolify-deploy.mjs deploy core <sha de main> --go` (hors live ; aucune migration) | `deploy core a94d10812c8b48bffbbbaa76a2249c0ae9e34a0b --rollback --go` |
| 2. Variable du bot        | Coolify, application `raptoru-bot` : `CHATBOX_RELAY=true` (nouvelle, sans secret)               | la passer à `false` (ou la retirer) puis redéployer le bot             |
| 3. Bot, **après le Core** | `node scripts/coolify-deploy.mjs deploy bot <sha de main> --go`                                 | `deploy bot 2c04a5db58fe4d05b3e0cbc2ab5257e3aa841346 --rollback --go`  |
| 4. Studio                 | `npm run studio:release` (version suivante, publiée) ; Antoni installe                          | réinstaller 0.1.42 (releases GitHub)                                   |
| 5. Sources OBS            | Antoni, § 12.1 (nouvelles sources **masquées**)                                                 | supprimer les nouvelles sources ; les anciennes n'ont pas bougé        |
| 6. Essai en live          | Antoni, § 12.2, scène par scène                                                                 | afficher l'ancienne source, masquer la nouvelle                        |

- Ordre obligatoire : Core avant bot (un bot `CHATBOX_RELAY=true` devant un Core ancien ne perd que les événements
  Chatbox, une ligne de journal par minute ; les jeux du chat ne sont jamais touchés).
- `CHATBOX_RELAY=false` (défaut) : le nouveau bot se comporte exactement comme l'ancien.
- Les réglages du Lab et de la démonstration ne passent pas en Production : Studio Production démarre sur « Modernisée »
  et les règles par défaut ; Antoni règle profils, emplacements, commandes dans Studio (Modules → Chatbox).

### 12.1 Sources OBS à ajouter (Antoni)

Pour chaque ligne : Studio → Modules → Chatbox → profil → scène → Emplacement → **Copier** l'adresse ; dans OBS, dans la
scène, « + » → Navigateur → nom ci-dessous → coller l'adresse → largeur **1920**, hauteur **1080** → OK ; position
0,0, échelle 1 ; la placer **juste au-dessus** de l'ancienne source ; **la masquer** (œil) ; la verrouiller.

| Scène OBS          | Nouvelle source (nom proposé)      | Profil        | Ancienne source (ne pas toucher) | Zone de départ (Studio)     |
| ------------------ | ---------------------------------- | ------------- | -------------------------------- | --------------------------- |
| `Just Chatting`    | `Chatbox Raptoru — Just Chatting`  | Just Chatting | `Boîte de chat`                  | 1264, 61 · 577 × 962        |
| `Waiting screen`   | `Chatbox Raptoru — Waiting screen` | Just Chatting | `Boîte de chat`                  | 0, 0 · 639 × 1065 · ×1,106  |
| `Scène PS5`        | `Chatbox Raptoru — PS5`            | React         | `ChatReact`                      | 0, 346 · 455 × 492          |
| `Scène Fullscreen` | `Chatbox Raptoru — Fullscreen`     | React         | `ChatReact`                      | 9, 374 · 484 × 522 · ×1,063 |
| `Scène Dessin`     | `Chatbox Raptoru — Dessin`         | Dessin        | `Chatbox Dessin`                 | 0, 315 · 438 × 688          |

Une source par scène (cinq) : l'adresse porte la scène, donc l'emplacement et les proportions décidés dans Studio. Les
réglages enregistrés s'appliquent sans recharger la source. « Arrêter la source quand elle n'est pas visible » peut
rester décoché (comme les anciennes).

### 12.2 Essai en live et bascule (Antoni)

1. Ouvrir Studio → Modules → Chatbox : le bandeau dit « Chat réel relié » quand une source OBS écoute.
2. Dans une scène : afficher la nouvelle source, masquer l'ancienne. Écrire dans le chat : un message, une emote 7TV
   avec une zero-width, `!!!!!`, une commande (`!daily`), une annonce ; supprimer un message ; vérifier les rôles.
3. Retour immédiat si besoin : réafficher l'ancienne, masquer la nouvelle.
4. Scène par scène. Les sources StreamElements restent en place jusqu'à la décision d'Antoni (ni désactivées ni
   supprimées par l'agent).

## 13. Limites connues (réelles, vérifiées le 23/11)

- **`/me`** : EventSub (connexion du bot) ne signale pas un message `/me` (aucun champ, aucun type documenté) : il
  s'affiche comme un message normal, sans italique. Les anciens widgets le recevaient par StreamElements (IRC).
- **GIF Twitch** : transmis (fragment `gif` d'EventSub, adresse utilisée telle quelle), **pas dans les annonces**
  (Twitch n'y prévoit pas de GIF) ; non vus en réel avant le live.
- **Emote géante** (power-up « gigantified ») : affichée comme une emote normale (les anciens widgets non plus).
- Un message de LeCroupier_ peut apparaître ~0,4 s (réponse directe du bot) à ~2 s (réponse d'un module) après son
  envoi : le temps de le rattacher à sa commande.
- Les commandes **découvertes** dans le chat sont oubliées au redémarrage du Core ; le registre et les listes des
  modules sont permanents.
- Le **chat partagé** s'affiche comme le reste (annonces partagées comprises), sans mention de la chaîne d'origine.
- Vérifié en Lab (chat simulé → Core → Studio → page OBS) et par les tests ; **le chemin Twitch réel n'est vu qu'à
  l'essai en live** (§ 12.2).
