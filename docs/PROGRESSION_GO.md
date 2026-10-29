# Progression + raptoru.fr reconnecté — runbook de livraison (un GO, étape par étape)

Deux PR livrées ensemble :

- **#39** (raptoru-2.0, `feat/progression`) : progression native (XP, niveaux, titres, badges), classements publics
  Mots / Tombola, onglet Studio, reprise WizeBot. **Une seule migration** : `20261113130000_progression.sql`.
  Elle est additive (nouvelles tables seulement), et la progression est OFF par défaut.
- **#106** (Leaderboard-Jeu-des-mots, `feat/core-wallet-reconnect`) : raptoru.fr lit Jetons, Daily, Mots, Tombola et
  Niveau dans le Core, les routes V1 sont retirées (410), le site est durci, et le profil de progression avec choix
  du titre et des badges arrive. **La fusion sur `main` déploie le site automatiquement** (Coolify).

État de départ (29/10) :

- Core `7223b0a` (Halloween), bot `4ba9243`, Studio 0.1.18 ;
- site `4400251` (affiche encore les Jetons StreamElements).

## Livraison du 29/10/2026 — état réel

| Étape              | Fait                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sauvegarde         | Coolify « Backup now » par l'API, 29/10 18:41:47 UTC, `success`, 3 164 586 octets (cohérent avec 04:00). **Copie hors VPS et restauration jetable : à faire par Antoni** (téléchargement web seulement).                                    |
| Jeton du site      | `SITE_TOKEN` (Core) = `RAPTORU_SITE_TOKEN` (site), 43 caractères, généré en mémoire et posé par l'API Coolify, jamais affiché.                                                                                                              |
| Core               | `57f3ae3` (PR #39), migration `20261113130000_progression.sql` appliquée, `running:healthy`, bot `4ba9243` actif (EventSub OK).                                                                                                             |
| Site               | `6ae2614` (PR #106), auto-déployé ; Jetons 5/5 et Daily 8/8 égaux au Core ; routes V1 en 410 ; CSP et en-têtes présents ; rendu vérifié dans Chromium (0 erreur console, aucune donnée de démo).                                            |
| Studio             | **0.1.19 publiée** (release `v0.1.19`, workflow GitHub, `57f3ae3`) : onglet Progression complet ; **à installer par Antoni**. 1er essai bloqué par une suppression de dossier temporaire Windows (`alerts-se`, sans rapport), relancé vert. |
| Simulation WizeBot | 7 852 pseudos lus (2 443 niveaux, 5 946 watchtimes, 2 993 compteurs de messages) ; 1 622 rattachables (1 501 par identifiant, 121 par pseudo), 6 228 en attente, 0 ambigu, 2 conflits.                                                      |
| Import             | 1 622 rattachés (relancé : 0 de plus, 1 622 déjà) ; 6 228 gardés en attente (rattachement automatique au retour) ; conflits `aura_dty` / `aurorra_ae` (même identifiant) à décider dans Studio.                                             |
| Activation         | progression **active** (règles par défaut) ; raptoru.fr : Niveau, Watchtime et Messages (global) depuis le Core, semaine / mois sur WizeBot.                                                                                                |
| Nouveaux gains     | **à constater au prochain live** (présence et chat ne comptent qu'en live).                                                                                                                                                                 |
| WizeBot            | **action manuelle d'Antoni** : couper le module de rangs / niveaux (XP) de WizeBot et ses annonces « Level UP » ; garder WizeBot et ses archives tant que l'indépendance n'est pas confirmée.                                               |

Les appels Studio de l'import et de l'activation ont été faits avec l'identité de l'installation Studio du PC
(fichier local, jamais affichée), Studio 0.1.19 n'étant pas encore installé.

## Émancipation WizeBot — 29/10/2026 soir (état réel)

| Étape           | Fait                                                                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventaire      | Seul raptoru.fr dépendait de WizeBot à l'exécution (semaine / mois, tâche quotidienne, présence du profil, succès). Core, bot, Studio : aucune dépendance. Le bot envoie **tous** les messages au Core (`CHAT_GAMES=true`).                              |
| Sauvegarde      | Coolify 29/10 21:20:37 UTC (`success`, 3 348 756 octets), téléchargée par Antoni, **restauration complète vérifiée** en base jetable (131 tables, Wallet 747 / 13 255, historiques 7 852) — `Sauvegarde Raptoru 2.0\2026-10-29-prod-db-avant-periodes\`. |
| Archive WizeBot | `Sauvegarde Raptoru 2.0\2026-10-29-wizebot-archive\` : l'export importé et un relevé final (7 852 pseudos chacun), `progression_history` et `progression_accounts` en CSV, empreintes SHA-256.                                                           |
| Core            | `7b40a63` (PR #41) : migration `20261114130000_progression_periods.sql` appliquée (semaine / mois Paris, historiques non supprimables, un seul rattachement par viewer) ; puis PR #42 (classement jusqu'à 2 000 lignes).                                 |
| Site            | `a85b111` (PR #107) : Niveau, Présence, Messages en All-time / Semaine / Mois depuis le Core ; tâche quotidienne et profil sans WizeBot ; vérifié dans Chromium (9 combinaisons, 0 requête vers WizeBot, 0 erreur) ; puis PR #108.                       |
| Données         | 1 622 rattachés, 6 228 en attente (rattachement automatique au retour : présence, chat, connexion au site), 2 conflits non tranchés (`aura_dty` / `aurorra_ae`).                                                                                         |
| Semaine / Mois  | vides à ce jour, avec une note honnête (« aucune activité comptée par Raptoru pour l'instant ») : aucun live depuis l'activation. Ils se remplissent dès le prochain live.                                                                               |
| Tests           | Core 1 454 / 1 454 (PostgreSQL réel compris) ; chaîne réelle (lurker Jetons + XP + présence, rejeu, redémarrage du bot, fin de live, retour d'un ancien viewer) ; bornes Paris (minuit, semaine, mois, deux changements d'heure) ; site 201.             |
| WizeBot         | plus aucun appel d'exécution ; seul l'export de migration (`?export=1`) l'interroge s'il est appelé. **Action d'Antoni** : couper dans WizeBot le système de rangs / XP et les annonces « Level UP » (ses classements peuvent rester).                   |

## 0. Conditions (sinon on ne commence pas)

- Pas de live et pas d'enregistrement OBS (l'outil de déploiement le vérifie aussi).
- **Pas le 31/10** ni pendant Halloween : livrer après l'événement, ou au plus tard la veille avec une journée de marge.
- CI verte sur #39. Suite du site verte (198/198 le 29/10).

## 1. Sauvegarde de la base (Antoni + agent, comme HALLOWEEN_GO § 1)

1. Coolify › base de Production › Backups › **Backup now**.
2. Télécharger la sauvegarde dans `Documents\Sauvegarde Raptoru 2.0\2026-xx-xx-prod-db-avant-progression\`.
3. Vérification par l'agent (rien en Production) :
   - taille et statut ;
   - `pg_restore --list` ;
   - restauration complète dans une base jetable, avec des lignes dans `wallets`, `wallet_transactions`, `viewers`
     et `presence_*`.

**Arrêt** si un critère manque. Le déploiement suit dans l'heure (`BACKUP_MAX_AGE_MS`).

## 2. Le jeton partagé du site (Antoni, 3 min, la valeur n'est jamais affichée)

Il autorise le site à faire **une seule chose** : équiper un titre ou des badges que le viewer possède déjà.

1. Générer le jeton dans le presse-papiers, sans l'afficher :
   `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | clip`
2. Coolify › `raptoru-core` › Environment Variables › `SITE_TOKEN` = (coller).
3. Coolify › `leaderboard--jeu-des-mots` › Environment Variables › `RAPTORU_SITE_TOKEN` = (coller, même valeur).
4. Vider le presse-papiers (copier un autre texte). Ne l'écrire ni dans un fichier du dépôt, ni dans un message.

Sans ce jeton :

- le Core ne monte pas la route d'équipement (404) ;
- le site répond « équipement indisponible » ;
- tout le reste fonctionne.

## 3. Fusion de #39 et Core (agent, sur GO)

```
gh pr ready 39 && gh pr merge 39 --merge
node scripts/coolify-deploy.mjs plan core <sha40 de main>                   → PRÊT
node scripts/coolify-deploy.mjs deploy core <sha40> --migrations-approved --go
node scripts/coolify-deploy.mjs status core
```

**Attendu** :

- `applied: 20261113130000_progression.sql` ;
- `running:healthy`, `/health` et `/ready` à 200 ;
- le Core rapporte le nouveau commit ;
- le bot `4ba9243` garde son bail ;
- `GET /v1/progression/leaderboard` à 200 (vide), `GET /v1/word-game/leaderboard` et `/v1/raffle/leaderboard` à 200.

La progression reste **OFF** : aucune XP n'est comptée avant l'étape 7.

## 4. Studio : release puis installation

- Agent, sur GO : `npm run studio:release` (ou le workflow GitHub). Il apporte l'onglet Progression, la simulation et
  l'import WizeBot.
- Antoni : installe la nouvelle version (0.1.18 → 0.1.19).

## 5. Site : fusion de #106 (agent, sur GO, après les étapes 2 et 3)

`gh pr ready 106 && gh pr merge 106 --merge` dans `raptorutwitch/Leaderboard-Jeu-des-mots`. Coolify redéploie seul.

**Vérifications** (agent, lecture seule) :

- `/api/status` à 200 ;
- Jetons de 5 viewers égaux au Core (5/5 le 29/10 avec le code de la PR en local), à refaire en ligne ;
- Daily de 5 viewers égal au Core (5/5 le 29/10), à refaire en ligne ;
- les anciennes routes V1 répondent 410 ;
- les en-têtes CSP et sécurité sont présents.

Antoni vérifie ensuite dans le navigateur : connexion Twitch, son profil, les onglets Jetons, Daily, Mots, Tombola et
Niveau.

## 6. Reprise WizeBot (Antoni dans Studio)

1. Studio › Progression › **Simuler (n'écrit rien)** : lire les comptes, attendus au moins 407 résolus, 0 ambigu,
   0 conflit. S'il y a des ambigus ou des conflits, s'arrêter et les envoyer à l'agent.
2. **Importer** (confirmation) : chaque viewer résolu démarre à son niveau WizeBot. Relancer l'import ne change rien.
3. Les non-résolus restent sur WizeBot. On peut les réimporter plus tard, quand ils sont passés sur le stream.

## 7. Activer (Antoni dans Studio, quand il le décide)

Studio › Progression › **Activer**. L'XP compte alors :

- la présence validée, par minute ;
- le chat, avec délai entre messages et longueur minimale ;
- uniquement en live ;
- jamais pour les bots ni pour le streamer.

Ensuite :

- Créer les titres et badges (par exemple « Roi d'Halloween ») et les donner.
- Les viewers les équipent sur raptoru.fr (profil). Le classement « Niveau » du site passe sur le Core.

## Retour arrière (résumé)

| Quoi        | Comment                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Progression | **Studio › OFF** : fige tout sans rien perdre (à préférer).                                                                          |
| Import      | Studio › « Annuler l'import » (`import/revert`) : retire exactement l'import.                                                        |
| Site        | Coolify › `leaderboard--jeu-des-mots` › redéployer `440025158e882216edf18938644dba17c4ea76bb` (ou `git revert` du merge sur `main`). |
| Core        | `deploy core 7223b0a6196f7cdccd9f3a5ca8702484180fa269 --rollback --go`. La migration reste : additive, ignorée par l'ancien Core.    |
| Jeton       | retirer `SITE_TOKEN` (Core) : la route d'équipement disparaît au redémarrage.                                                        |
| Base        | normalement rien. Le SQL en tête de la migration (démontré, `progression-rollback.integration.test.ts`) efface XP et inventaires.    |
| Studio      | réinstaller 0.1.18.                                                                                                                  |

## Limites connues (pas des blocages)

- **WizeBot** : ni l'XP ni les titres de rang ne sont exposés par son API. On reprend le niveau, le watchtime et les
  messages.
- **Lurkers** : ceux qui sont absents de la liste des chatters Twitch ne sont pas mesurés. La présence validée suit
  cette liste.
- **Badges du Core** : ils n'ont pas d'image dans les classements (texte et rareté seulement).
