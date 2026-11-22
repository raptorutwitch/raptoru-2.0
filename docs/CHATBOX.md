# Chatbox Raptoru : chantier (remplacer les trois chatbox StreamElements)

**État au 22/11/2026 : direction décidée par Antoni (§ 4) ; proposition d'architecture et de découpage rédigée
(§ 5 à 7), à valider par Antoni avant toute implémentation. Rien de développé.** Ce fichier est le point d'entrée du
chantier ; il ne remplace pas le rapport de reconnaissance ni la présentation (§ 1).

## 1. Sources (hors Git, privées)

| Quoi                                      | Où                                                                                                                    | Statut                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Rapport de reconnaissance (référence)** | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\_recherches\chatbox-2026-11-20\RECONNAISSANCE_CHATBOX.md`          | **source principale** : réglages OBS, CSS, JavaScript, comparatif, préservation, manques          |
| **Présentation pour décider (22/11)**     | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\_recherches\chatbox-2026-11-20\PRESENTATION_CHATBOX_2026-11-22.md` | paramètres exacts code → écran, critiques, options ; ne pas la refaire                            |
| Copies locales du code des widgets        | `C:\Users\Antoni\Documents\ChatGPT\Chatbox Twitch\` (`streamelements-main`, `-react`, `-compact`)                     | copies **probables** (dernière modification 03/09/2026), identité avec StreamElements non prouvée |
| Overlay local non retenu (même projet)    | `Chatbox Twitch\public\`                                                                                              | version antérieure, **pas une référence visuelle** (autres valeurs)                               |
| Collection OBS lue                        | collection active « Twitch Dofus » (canvas 1920 × 1080)                                                               | relue le 22/11, rien modifié                                                                      |

Ne pas déplacer ces fichiers. Ne jamais les copier tels quels dans le dépôt (il est public). Le portage du moteur
d'emotes (§ 5.4) attend l'accord d'Antoni ; code relu le 22/11 : aucun secret, seulement des API publiques (7TV,
BTTV, FFZ, Twemoji).

## 2. Les trois chatbox en service

| Variante      | Source OBS       | Scènes                        | Code probable            | Caractéristiques (détail : présentation § 2)                                                                                                                        |
| ------------- | ---------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Just Chatting | `Boîte de chat`  | Just Chatting, Waiting screen | `streamelements-main`    | chat permanent, Figtree, cartes sombres opaques, emotes seules en grand, apparition par glissement ; texte ≈ 26 px à l'écran                                        |
| React         | `ChatReact`      | Scène PS5, Scène Fullscreen   | `streamelements-react`   | fond noir 18 % (le flou CSS est sans effet dans OBS), rôles en couleur, dernier message en avant, disparaît 10 s après le dernier message, dépliage ; texte ≈ 21 px |
| Dessin        | `Chatbox Dessin` | Scène Dessin                  | `streamelements-compact` | cartes noires, barre de couleur selon le rôle, disparaît 15 s après le dernier message, dépliage ; agrandie par OBS ; texte ≈ 24 px                                 |

Capacités communes à préserver : emotes Twitch, **7TV** (y compris les emotes superposées), BTTV, FFZ, GIF et emotes
animées, emojis, filtrage des commandes `!`, messages supprimés par la modération (message, timeout, ban), couleurs et
distinctions des rôles. La collection active garde un autre overlay StreamElements (`Sponso`, masqué) : hors
périmètre.

## 3. Précautions

- Les sources OBS pointent vers des **URL d'overlay StreamElements qui contiennent une clé d'accès** : ne jamais les
  afficher, les recopier ni les committer (ni ici, ni dans un rapport, un journal ou un commit).
- Le code réellement collé chez StreamElements n'a pas été relu : les copies locales ne font pas foi avant
  vérification ; la comparaison côte à côte en Lab révélera les écarts.
- Aucune modification de scène, de source OBS, d'overlay StreamElements ni de chatbox active sans GO d'Antoni. Les
  sources StreamElements restent **intactes** jusqu'à la validation explicite de chaque remplaçante, scène par scène.

## 4. Décision du 22/11 (Antoni)

**Modernisation maîtrisée + intégration complète dans Raptoru Studio.**

- Garder l'identité et les comportements particuliers des trois chatbox ; moderniser les proportions, les animations,
  la lisibilité et la qualité technique.
- **Tout se gère depuis Studio** : plus jamais de HTML ou de CSS à modifier ni de code à téléverser chez
  StreamElements.

Objectifs :

1. Un moteur de chat partagé par les trois overlays, sur l'infrastructure Twitch existante de Raptoru.
2. Trois profils graphiques indépendants : Just Chatting, React, Dessin.
3. Un écran Chatbox dans Studio, avec modification visuelle des paramètres.
4. Une prévisualisation en direct avec des messages et des emotes fictifs.
5. Des réglages indépendants par profil : polices, tailles, couleurs, dimensions, espacement, opacité, badges, emotes,
   animations, durée de présence et disparition.
6. Les réglages enregistrés s'appliquent tout seuls aux sources OBS déjà installées, sans rechargement manuel ni
   nouvelle publication.
7. Des présets, dont le retour aux valeurs d'origine.
8. Emotes Twitch, 7TV (superpositions comprises), BTTV, FFZ et GIF animés.
9. Modération : suppression de messages, timeout, ban, clear.
10. Les anciennes sources StreamElements restent intactes jusqu'à la validation explicite des remplaçantes.

Contraintes : réutiliser le bot et le Core s'ils fournissent les événements ; pas de seconde connexion Twitch ni de
service inutile ; jamais une connexion par profil ; réglages persistants après un redémarrage de Studio ou d'OBS ; un
profil se modifie sans toucher les deux autres ; prévisualisation hors live ; pas de refonte générale de Studio.

## 5. Proposition d'architecture (22/11, à valider par Antoni)

### 5.1 Chemin des messages : aucune nouvelle connexion Twitch

```text
Twitch EventSub ── connexion existante du bot (jeton LeCroupier_)
  → bot (VPS) : POST /v1/bot/chat, déjà envoyé pour chaque message, + champs d'affichage
                + suppressions et clear (3 abonnements de plus, même connexion)
  → Core (VPS) : relais chatbox EN MÉMOIRE (derniers événements, curseur) → flux SSE /v1/studio/chatbox/…
  → Studio (PC) : UNE connexion au Core pour les trois profils, tampon local, catalogues d'emotes
  → pages OBS (une par scène), flux local sur le port 4100
```

- **Bot** : ajoute au message déjà transmis ce que l'affichage demande (couleur, fragments emotes / mentions /
  cheermotes, badges avec leur version, type de message : annonce, message mis en avant, premier message ; réponse).
  S'abonne, sur sa connexion existante, à `channel.chat.message_delete`, `channel.chat.clear_user_messages` et
  `channel.chat.clear` (scope `user:read:chat`, déjà présent) et les transmet. Il ne transmet pas ses propres
  messages aujourd'hui : il les transmettra marqués si LeCroupier_ doit s'afficher (§ 7), sans que les jeux les voient.
- **Core** : un relais **en mémoire seulement** (aucune table, aucune migration, aucun journal du contenu des
  messages) : les quelque 200 derniers événements par chaîne avec un numéro de séquence ; un flux SSE pour Studio sur
  le jeton d'installation (modèle : flux du Jeu des mots, `http/word-game-routes.ts`) ; le même sous `/v1/lab/…` (le
  simulateur de chat du Lab alimente le même routeur). Images des badges : catalogue Helix (badges globaux et de la
  chaîne) avec le jeton d'application que le Core sait déjà obtenir (modèle : `raffle-lab/avatars.ts`), en cache ;
  l'adresse de l'image voyage avec le message.
- **Studio** : un module `chatbox` qui n'écoute le Core que si une page OBS ou la prévisualisation est ouverte
  (modèle : `level-up/runtime.ts`), garde un tampon local (historique pour une page rechargée) et pousse aux pages par
  un flux local (modèle : `/level-up/events`). Les catalogues 7TV, BTTV et FFZ sont chargés **une seule fois** par
  Studio (toutes les 10 min, cache disque pour redémarrer sans réseau) et servis aux pages.
- **Panne** : si le Core, le VPS ou Studio s'arrête, les pages gardent l'affichage et se reconnectent seules ; les
  sources StreamElements, masquées mais intactes, restent le recours tant qu'Antoni le veut.
- Latence attendue : quelques centaines de millisecondes (Twitch → VPS → PC), invisible à côté du délai du stream ;
  mesurée au jalon 1.

### 5.2 Les pages OBS

- Une page unique servie par Studio (dossier statique, comme `level-up-player`), choisie par l'adresse : profil +
  scène. L'adresse est stable : installée une fois dans OBS, elle ne change plus.
- **Source plein cadre 1920 × 1080 à l'échelle 1 ; la boîte est placée par Studio.** Position, taille et apparence se
  règlent dans Studio ; le rendu est net (plus d'agrandissement par OBS) ; OBS ne garde que l'ordre des calques. Source
  à verrouiller dans OBS, comme le Level Up et les effets (déjà plein cadre).
- **Un emplacement par scène** : Just Chatting, Waiting screen, PS5, Fullscreen, Dessin, soit cinq sources pour trois
  profils. L'emplacement (position, taille) appartient à la scène ; l'apparence, au profil.
- Réglages enregistrés → poussés par le flux et appliqués **sans rechargement**. Après une mise à jour de Studio, une
  page ancienne se recharge seule (modèle : correctif « page périmée » des effets, `effects/player.ts`).
- Une page (re)chargée reçoit les derniers messages ; l'option OBS « arrêter la source quand elle n'est pas visible »
  devient possible (une seule chatbox active à la fois), à mesurer au jalon 3.

### 5.3 Profils, présets, persistance

- Trois profils indépendants, chacun avec **tous** ses réglages : polices ; tailles (pseudo, texte, emotes, emotes
  seules, badges) ; couleurs (texte, fond, bord, rôles) ; carte (opacité, arrondi, marges, espacement, ombre du
  texte) ; barres de rôle ; mise en avant du dernier message ; apparition (style, durée) ; présence (permanente ou
  « disparaît après N s », barre de décompte, fondu) ; fondu du haut ; plafond de messages ; filtres (commandes `!`,
  bots) ; emplacements de ses scènes.
- Présets : **« Origine »** par profil, en lecture seule, le rendu StreamElements actuel converti en pixels d'écran
  (présentation § 2) ; **« Modernisée »**, la proposition de l'agent (ombre du texte, contraste des pseudos, animations
  plus courtes, polices locales), réglée avec Antoni dans la prévisualisation ; présets nommés enregistrables. Retour à
  l'origine à tout moment.
- Persistance : un fichier JSON par profil dans le dossier de données de Studio (écriture atomique, schéma partagé
  `packages/schemas/src/chatbox.ts`), relu au démarrage ; compris dans les sauvegardes des données de Studio
  ([BACKUPS.md](BACKUPS.md) § 0.2).
- Polices : celles fournies avec Studio (Figtree, Barlow Condensed…) et toute police installée sur le PC.

### 5.4 Moteur d'affichage

- Porté du code des widgets `streamelements-*` (accord d'Antoni requis, § 1) : fragments Twitch (emotes animées
  comprises), 7TV avec emotes superposées, BTTV, FFZ, Twemoji, emotes seules agrandies, `/me`, coupe des pseudos,
  modération (message, viewer, clear). Leurs tests sont repris.
- Une seule mécanique réglée par profil (fondu du haut, emotes seules, barres de rôle) ; animations sans hauteur
  animée, allégées en rafale ; contraste minimum des pseudos.
- Le même fichier sert dans OBS et dans la prévisualisation : rendu identique.

### 5.5 Écran Chatbox dans Studio

- Nouvel écran dans ses propres fichiers (`chatbox*.ts`) ; le fichier central ne fait que le brancher.
- Les trois profils ; pour le profil choisi, la **prévisualisation en direct** (la vraie page dans un cadre)
  par-dessus une image de la scène, avec la boîte déplaçable et redimensionnable ; les réglages groupés ;
  « Enregistrer » (appliqué tout de suite dans OBS), « Annuler », « Revenir à l'origine », présets ; l'adresse à coller
  dans OBS pour chaque scène.
- Simulateur intégré, hors live et sans Core : messages fictifs avec emotes Twitch, 7TV (superposées comprises), BTTV,
  FFZ, GIF, rôles, `/me`, rafale, suppression, timeout, clear.
- Pas de console ni de tableau de bord.

## 6. Découpage proposé : trois jalons utilisables en Lab, puis la Production sur GO

| Jalon                                   | Contenu                                                                                                                                                        | Utilisable à la fin                                                                             | Production             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| **1. Le chat arrive dans une page OBS** | bot (champs, suppressions, clear) ; relais Core et flux Studio / Lab ; module Studio ; page OBS avec le moteur porté et les présets « Origine »                | la page en Lab, alimentée par le simulateur de chat, côte à côte avec les copies StreamElements | code prêt, non déployé |
| **2. Tout se règle dans Studio**        | écran Chatbox ; prévisualisation et simulateur ; tous les réglages ; présets ; emplacements ; persistance ; application en direct                              | régler les trois profils dans Studio et les voir changer dans la page OBS sans la recharger     | non                    |
| **3. Prêt pour le live**                | messages spéciaux (annonces, mis en avant, réponses, premier message) ; préset « Modernisée » réglé avec Antoni ; charge (cinq sources, chat rapide) ; latence | recette complète en Lab                                                                         | non                    |
| **4. Production (GO à chaque étape)**   | déploiement Core et bot, release de Studio ; Antoni ajoute les nouvelles sources **masquées** à côté des anciennes ; essai en live ; bascule scène par scène   | chatbox Raptoru en service, sources StreamElements gardées jusqu'à la décision d'Antoni         | oui                    |

Tests à chaque jalon : unitaires (bot, Core, Studio), tests repris des widgets, e2e de la page et de l'écran
(application en direct, persistance après redémarrage), captures. Classe C ([AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)
§ 3) : ni Jetons, ni droits, ni migration.

## 7. À confirmer par Antoni avant l'implémentation

1. L'architecture du § 5.1 (bot → Core → Studio → pages), sans nouvelle connexion Twitch.
2. Sources OBS plein cadre, boîte placée par Studio, une source par scène (cinq).
3. Le portage du moteur d'emotes des widgets dans le dépôt public.
4. LeCroupier_ : masqué, affiché, ou affiché sauf ses réponses aux commandes (Nightbot et StreamElements masqués).
5. Présets « Origine » et « Modernisée » ; lequel est actif au premier essai.
6. Abonnements et raids hors V1 (les alertes existent) ; messages spéciaux du chat (annonces, mis en avant) en V1.

Risques connus : les GIF Twitch (balise expérimentale des widgets) ne sont pas prouvés dans EventSub, vérification au
jalon 1 sur un vrai message (les emotes animées, elles, sont couvertes) ; l'affichage dépend du VPS et de Studio
(recours : les sources StreamElements).

## 8. Reprise

- Lire ce fichier, puis la présentation et le rapport (§ 1). Ne refaire ni la reconnaissance ni la présentation.
- Prochaine étape : les réponses d'Antoni au § 7, puis le jalon 1 dans le worktree `agent`.
