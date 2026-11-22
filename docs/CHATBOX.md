# Chatbox Raptoru : chantier (remplacer les trois chatbox StreamElements)

**État au 22/11/2026 : reconnaissance faite (20/11), rien de spécifié, rien de développé.** Priorité de développement
décidée par Antoni le 22/11, après la fin du Casino V1. Ce fichier est le point d'entrée du chantier ; il ne remplace
pas le rapport de reconnaissance.

## 1. Sources (hors Git, privées)

| Quoi                                      | Où                                                                                                           | Statut                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Rapport de reconnaissance (référence)** | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\_recherches\chatbox-2026-11-20\RECONNAISSANCE_CHATBOX.md` | **source principale** : réglages OBS, CSS, JavaScript, comparatif, préservation, manques          |
| Copies locales du code des widgets        | `C:\Users\Antoni\Documents\ChatGPT\Chatbox Twitch\` (`streamelements-main`, `-react`, `-compact`)            | copies **probables** (dernière modification 03/09/2026), identité avec StreamElements non prouvée |
| Overlay local non retenu (même projet)    | `Chatbox Twitch\public\` (serveur Node local, variantes par `config.json` + `variant.css`)                   | déjà pensé « un moteur, plusieurs profils » ; jamais utilisé dans OBS                             |
| Collection OBS lue                        | collection active « Twitch Dofus » (canvas 1920 × 1080)                                                      | lue le 20/11, rien modifié                                                                        |

Ne pas déplacer ces fichiers. Ne jamais les copier dans le dépôt (il est public).

## 2. Les trois chatbox en service

| Variante      | Source OBS       | Scènes                        | Code probable            | Caractéristiques (détail : rapport § 2 à 5)                                                                        |
| ------------- | ---------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Just Chatting | `Boîte de chat`  | Just Chatting, Waiting screen | `streamelements-main`    | chat permanent, ~50 messages, Figtree, cartes sombres, apparition par glissement                                   |
| React         | `ChatReact`      | Scène PS5, Scène Fullscreen   | `streamelements-react`   | verre très transparent (flou), pseudos et messages plus grands, disparaît ~10 s après le dernier message, dépliage |
| Dessin        | `Chatbox Dessin` | Scène Dessin                  | `streamelements-compact` | compact, barre de couleur selon le rôle, ~65 messages, disparaît ~15 s après le dernier message, dépliage          |

Capacités communes à préserver : emotes Twitch, **7TV** (y compris les emotes superposées), BTTV, FFZ, GIF et emotes
animées, emojis, filtrage des commandes `!`, messages supprimés par la modération (message, timeout, ban), couleurs et
distinctions des rôles.

## 3. Précautions

- Les trois sources OBS pointent vers des **URL d'overlay StreamElements qui contiennent une clé d'accès** : ne jamais
  les afficher, les recopier ni les committer (ni ici, ni dans un rapport, un journal ou un commit).
- Le code réellement collé chez StreamElements n'a pas été relu : les copies locales ne font pas foi avant
  vérification (rapport § 8).
- Aucune modification de scène, de source OBS, d'overlay StreamElements ni de chatbox active sans GO d'Antoni. Les
  chatbox actuelles restent en service jusqu'au remplacement validé, scène par scène.

## 4. Orientation (pas une spécification)

Remplacer progressivement les trois overlays par une chatbox propre à Raptoru 2.0 : un moteur partagé ; trois profils
visuels indépendants ; des paramètres par scène ; une source navigateur pour OBS ; une gestion cohérente des emotes
animées ; un rendu fiable à plusieurs résolutions ; une configuration dans Studio si c'est pertinent ; une
prévisualisation locale de chaque profil. Garder les particularités importantes, moderniser le reste.

## 5. À décider avec Antoni avant toute conception

1. Ce qui reste identique, ce qui devient réglable, ce qui change, pour chaque variante (proposition : rapport § 7).
2. La source des messages : le bot Raptoru (EventSub, déjà en service) ou StreamElements (rapport § 9).
3. Les bots à masquer (`LeCroupier_`…), les commandes `!`, les événements à afficher (abonnements, raids, annonces,
   Level Up : aucun aujourd'hui).
4. Les manques à combler (rapport § 8) : le code réellement collé chez StreamElements, la position du widget dans
   chaque overlay, une capture de chaque scène en live, les autres collections OBS.

## 6. Reprise

Première étape d'une nouvelle session : lire ce fichier et le rapport, puis revoir avec Antoni les caractéristiques
existantes (§ 5) **avant** d'écrire du code. Ne pas refaire la reconnaissance.
