# Centre de contrôle Studio — architecture (lot 3, 21/10/2026)

**Objectif (décision d'Antoni) :** Raptoru Studio est la seule application ouverte pendant le live, avec OBS. Le Centre de contrôle montre l'état
**réel** de chaque service, puis, plus tard, permettra de les piloter. Le **lot 3** ne livre que la base et un premier module : **LeCroupier\_ (bot)**.

## 1. Principe

Un seul format de statut pour tous les modules, un seul rendu, et une source par module.

```
Studio (page)                      Studio (serveur local)                         Source
─────────────                      ──────────────────────                         ──────
mountControlCenter ──GET──▶ /api/control/status ──▶ ControlCenter
  renderStatusTile(s)              └─ providers[] (un par module)
  (même rendu pour tous)              ├─ botStatusProvider ──GET──▶ Core Production /v1/studio/status/bot
                                      ├─ (futur) miniGames ─────────▶ état du module (déjà relayé par Studio)
                                      └─ …
```

- **Modèle** (`apps/studio/server/src/control-center/model.ts`) : `ModuleStatus`, avec les champs suivants.

  | Champ         | Contenu                                                                  |
  | ------------- | ------------------------------------------------------------------------ |
  | `id`, `label` | identifiant et nom du module                                             |
  | `level`       | `ok` · `warn` · `error` · `off` · `unknown`                              |
  | `state`       | un ou deux mots : « Actif », « En attente », « Déconnecté », « Erreur »… |
  | `summary`     | une phrase pour le streamer                                              |
  | `facts[]`     | libellé, valeur, niveau                                                  |
  | `hint`        | quoi faire, ou `null`                                                    |
  | `checkedAt`   | date de lecture                                                          |

- **Fournisseur** (`StatusProvider`) : `{ id, label, read(): Promise<ModuleStatus> }`. Chaque module lit **sa propre** source et se décrit lui-même.
  `ControlCenter` les interroge en parallèle. Un fournisseur qui échoue ou dépasse 4 s s'affiche « Inconnu » **seul**, les autres restent lisibles.
- **Route** : `GET /api/control/status` → `{ modules: ModuleStatus[] }`. Mêmes protections que toutes les API Studio : hôte local, origine,
  en-tête `x-raptoru-studio: 1`. Aucun secret ne transite : le serveur Studio appelle le Core avec l'identifiant d'installation déjà utilisé par le reste
  du profil Production.
- **Rendu** (`apps/studio/web/src/control-center.ts`) : `renderStatusTile(s)`, fonction pure, plus `mountControlCenter(el)`, qui interroge la route toutes les 5 s
  tant que l'onglet est visible. Carte « Centre de contrôle » en tête de l'accueil Studio.
- **Ajouter un module = ajouter un fournisseur** côté serveur, puis l'inscrire dans `new ControlCenter(…, [ … ])` (`apps/studio/server/src/index.ts`). Rien à
  changer côté page.

## 2. Module 1 : LeCroupier_ (`control-center/bot.ts`)

**Source :** le bail d'instance unique du Core (lots 1–2), `GET /v1/studio/status/bot`. Les durées sont calculées avec **l'horloge du Core**
(`status.now`), jamais celle du PC.

| État affiché   | Niveau     | Quand                                                                                                 |
| -------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| **Actif**      | ok         | bail vivant, Twitch connecté (chat du bot et, s'il est utilisé, EventSub du diffuseur), signal ≤ 30 s |
| **Actif**      | warn       | signal en retard (> 30 s, bail encore valide) **ou** une autre instance attend (bascule PC ↔ VPS)     |
| **Connexion**  | warn       | démarré depuis moins de 60 s, Twitch pas encore joint                                                 |
| **Erreur**     | error      | actif mais connexion Twitch absente depuis plus de 60 s, ou autorisation `raptoru_` inutilisable      |
| **Déconnecté** | error      | bail expiré sans arrêt propre (plantage, réseau, fenêtre fermée) ; conseil adapté au VPS ou au PC     |
| **En attente** | warn       | aucun titulaire, une instance attend le bail                                                          |
| **Arrêté**     | off        | dernier bot arrêté proprement (heure affichée)                                                        |
| **Non suivi**  | warn / off | aucun bot n'a jamais déclaré sa présence (bot antérieur au lot 2) ; en profil Lab : non suivi (off)   |
| **Inconnu**    | unknown    | Core injoignable, ou Core sans la route (404 : déployer le lot 1)                                     |

**Informations affichées :**

- où il tourne (VPS Contabo ou PC de stream, plus l'identifiant d'instance) ;
- Twitch, chat (LeCroupier_) ;
- Twitch, subs / bits / points (raptoru_) ;
- autorisation raptoru_ ;
- dernier signal (durée et heure de Paris) ;
- actif depuis ;
- fonctions activées ;
- version ;
- instances en attente.

## 3. Modules suivants (à brancher, un par un, chacun validé)

| Module                           | Source déjà disponible dans Studio                                     | Exemples d'états                                                     |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Mini-jeux (Slot, Roulette, Duel) | `/api/mini-games/state` (relais cockpit `mini-games`)                  | interrupteur ON/OFF, sortie chat                                     |
| Roue du Sub                      | `sub-wheel/runtime.ts` → `…/state`                                     | ON/OFF, gains en attente, animation OBS prête                        |
| Jeu des mots                     | `/api/word-game/state`                                                 | session du live, mots actifs, source OBS du son                      |
| Points de chaîne                 | `channel-points/runtime.ts` → `…/state`                                | interrupteur général, règles et récompenses actives, travaux en file |
| TTS / Soundboard / Bonk          | `/api/tts-lab/status`, `/api/sound-lab/status`, `/api/bonk-lab/status` | lecteur prêt, file, module en pause                                  |
| Alertes                          | `/api/alerts/state`                                                    | mode, réception, source OBS                                          |
| Random Ban                       | `random-ban/runtime.ts` → `…/state`                                    | exécuteur présent, en cours                                          |
| Extension Production (A6)        | à créer : marqueur de build de l'extension (lot 5)                     | build servi, API cible, dernier appel                                |
| OBS                              | connexion WebSocket déjà connue de Studio                              | connecté, sources requises présentes                                 |

**Les contrôles avant live (lot 5)** réutiliseront ces fournisseurs : un contrôle = un fournisseur dont le niveau attendu avant le live est `ok`.

## 4. Règles pour le futur pilotage (non implémenté)

- **Une action passe par la route existante du module**, celle que son onglet utilise déjà. Le Centre de contrôle n'a aucune logique métier ni chemin
  parallèle.
- **Actions sensibles** (arrêter un module pendant le live, tirage, remboursement) : confirmation explicite et trace d'audit côté Core,
  comme dans les onglets actuels.
- **Lecture d'abord :** un module n'obtient d'actions dans le Centre de contrôle qu'une fois son statut validé en live.
- **Aucun accès direct à Coolify ou au VPS depuis Studio.** Pour le bot, Studio affiche l'état et le geste à faire ; le redémarrage reste dans
  Coolify (garde-fou).
