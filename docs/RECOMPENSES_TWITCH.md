# Récompenses Twitch dans Studio — statut, inventaire, migration

12/11/2026. Livraison isolée : worktree `recompenses-twitch`, branche `feat/recompenses-twitch-studio` (depuis
`origin/main` `c1632825`), **non commitée, rien en Production, aucune action Twitch en écriture**.

## 1. La règle de Twitch qui décide de tout

Seule l'**application qui a créé** une récompense peut la modifier (pause, coût, nom), lire et changer l'état de ses
rachats, donc **rembourser** ses points (`CANCELED`) [doc Twitch : Update Custom Reward, Update Redemption Status,
`only_manageable_rewards`]. L'API ne dit pas quelle application a créé une récompense ; elle dit seulement, pour
l'application qui appelle, lesquelles **elle** peut gérer.

## 2. Statut de la récompense « Ban aléatoire » — confirmé par Twitch le 12/11 (audit en lecture)

Lecture authentifiée du 12/11/2026 (consentement dédié de raptoru_, droit `channel:read:redemptions` seul, non
renouvelable ; application Twitch = celle du bot de Production) : **40 récompenses, une seule gérable par Raptoru**.

| Champ | Valeur |
| --- | --- |
| Nom, id | « Ban aléatoire », `b15cc303-bf34-4bc8-9535-1f11ef1299dd` |
| Coût, état | 3 000 points, **active**, pas en pause |
| Gérable par l'application Raptoru | **non** (`only_manageable_rewards=true` ne la liste pas) |
| Cooldown global, maximum par stream, maximum par viewer | aucun |
| Validée automatiquement | non (les rachats restent « en attente » sur Twitch) |
| Texte du viewer | non |

**Conclusion : il faut recréer Random Ban depuis Studio.** Raptoru ne peut ni la mettre en pause, ni rembourser ses
rachats, ni lire ses rachats en attente : seuls le tableau de bord Twitch (ou l'outil qui l'a créée) le peuvent. Le Client
ID d'origine n'est pas fourni par l'API.

La seule récompense déjà gérable : **« Choisi la prochaine musique »** (1 500 points, active, texte du viewer), créée par
Raptoru pour Spotify / le Music Hub. L'ancienne « Choisi la prochaine musique ! » (1 000) est désactivée.

**Pourquoi rien n'a été lu en Production :** la route de lecture du Core fait aussi l'entretien (expirations,
remboursements dus) ; le jeton local expiré n'a pas été rafraîchi (il pourrait partager l'autorisation du bot).

## 3. Ce que Studio sait faire (avant / maintenant)

| Besoin | Avant (Production actuelle) | Maintenant (worktree, testé) |
| --- | --- | --- |
| Lister les récompenses, régler leurs actions | oui (lecture Twitch par le bot, règles dans Studio) | idem |
| Savoir lesquelles Raptoru peut gérer | non (seulement « créée par Raptoru ») | **oui**, d'après Twitch à chaque synchro du bot ; badge dans la fiche |
| Créer une récompense gérée par Raptoru | seulement celle de la musique (page Spotify) | **oui**, générique : nom, coût, description, saisie du viewer |
| Remplacer une ancienne récompense | non | **oui** : la nouvelle reçoit la règle de l'ancienne, **coupée** ; l'ancienne n'est pas touchée |
| Mettre en pause / réactiver, changer le coût | non | **oui** (récompenses Raptoru seulement ; Twitch refuserait les autres) |
| Rembourser un rachat via Twitch | automatique seulement (Spotify, expirations) | **oui**, bouton dans le détail d'un rachat ; une fois, jamais après une validation |
| Cooldown individuel de 10 min (Random Ban) | non | oui, **seulement sur une récompense Raptoru** (le refus est remboursé) ; l'ancienne garde son comportement actuel |
| « À traiter » | non | **oui** : remboursements à faire sur Twitch, actions Twitch refusées ou sans réponse, récompenses disparues |

Code : Core `channel-points/service.ts` (création, migration, pause, remboursement, À traiter), `twitch-actions.ts`
(action `reward_update`), routes `…/channel-points/<canal>/rewards`, `…/rewards/<id>/twitch`,
`…/redemptions/<source>/<id>/refund` ; bot `cp-twitch-actions-executor.ts` (PATCH), `twitch/helix.ts`,
`channel-points-events.ts` (synchro « gérable ») ; Studio `pages/rewards-admin.ts`, `channel-points/runtime.ts` ;
migration additive `20261124120000/130000_cp_reward_admin*.sql` ; Lab : le Lab Core reçoit les actions Twitch,
`npm run rb:lab-simulator` les exécute sur un faux Twitch ; audit `npm run rewards:audit` (lecture seule).

Pas fait : réglages Twitch secondaires à la création (cooldown global, maximum par stream, couleur, image) — à régler
sur Twitch si besoin ; la page Studio n'a pas été vue à l'écran (typée, testée par la chaîne HTTP).

## 4. Inventaire (Twitch, 12/11 — audit en lecture)

40 récompenses ; **10 actives** ; **1 gérable par Raptoru** (« Choisi la prochaine musique »).

**A. Actives et raccordées à Raptoru 2.0 — à migrer une à la fois (aucune n'a de cooldown global, sauf Eren cri 300 s et
ntm 60 s, à recopier sur Twitch après création) :**

| Récompense | Coût | Action Raptoru | Gérable | Ordre |
| --- | ---: | --- | --- | --- |
| Ban aléatoire | 3 000 | Random Ban | non | **1** |
| TTS | 2 000 | crédits TTS | non | 2 |
| Soundboard | 2 000 | crédits Soundboard | non | 3 |
| Be Right Back | 1 500 | BRB | non | 4 |
| Couleur Cam | 100 | effet OBS | non | 5 |
| FX cam | 200 | effet OBS | non | 6 |
| Creepy | 700 | effet OBS | non | 7 |
| Eren cri | 1 500 (cooldown 300 s) | son | non | 8 |
| ntm | 2 000 (cooldown 60 s) | vidéo | non | 9 |
| Choisi la prochaine musique | 1 500 | demande Spotify | **oui** | rien à faire |

**B. Désactivées — rien à recréer :** 200 IQ, Arrêteuh, Ban forcé, Boop!, Bzez, Cash-In, Choisi la prochaine musique !
(ancienne), Couleur Overlay, Couleur overlay Cam, Counter Ban 1, Counter ban 5, Dance Fortnite, Emote only, Fais moi
écouter ta musique !, Hello, Je t'offre le sub, Je t'offre le ubereat !, Jeu offert !, Led couleur, Lever le ban,
Musique refusée, Ohlala, Seigneur Percé, Skip la musique, Skyzz, Soundboard (ancien), Test Lab, Tiens bon !, TTS (ancien),
Wasted. (Depuis le 20/10, Bzez, Emote only, Je t'offre le sub, Led couleur, Seigneur Percé, Skyzz, Test Lab et Tiens bon !
ont été désactivées.)

**Méthode pour chacune (A puis B au cas par cas) :** remplacement depuis Studio (nouveau nom, même coût, règle recopiée
coupée) → test contrôlé → bascule (nouvelle règle ON, ancienne règle OFF, ancienne mise en pause sur Twitch à la main)
→ quelques jours d'observation → suivante. L'ancienne n'est jamais supprimée.

## 5. La livraison isolée et ses prérequis Production (chacun sur GO)

**Contenu** (et rien d'autre du chantier Mini-jeux) : administration des récompenses (Core, bot, Studio), cooldown
individuel Random Ban sur récompense Raptoru, remboursement automatique d'un Random Ban sans effet sur récompense Raptoru,
« À traiter », audit en lecture (`rewards-audit-auth.ts`, `rewards-audit.ts`), catalogue fictif du Lab (une « Ban
aléatoire » non gérable pour répéter la migration), migration `20261124120000/130000_cp_reward_admin*.sql`.

**Exclu volontairement** : le prix progressif de `!rb` (le code de `!rb` n'est pas touché : prix fixe de Studio, comme
aujourd'hui), l'achat depuis l'extension, le Sniper, Le Viseur, la modération et les statistiques Random Ban, la
migration `random_ban_purchase`. Ils restent dans le worktree `mini-jeux-random-ban`, à rebaser sur cette branche.

**Effets du déploiement, à connaître :**
- aucun changement visible tant qu'aucune récompense Raptoru n'a de règle Random Ban (le cooldown et les remboursements
  ne visent que les récompenses Raptoru) ;
- la seule récompense déjà gérable, « Choisi la prochaine musique », gagne seulement le badge et les boutons ; ses
  règles ne changent pas ;
- « À traiter » liste les rachats d'anciennes récompenses dont les points sont dus (à rendre sur Twitch).

**Ordre :**
1. Migration `20261124130000_cp_reward_admin.sql` (additive : deux colonnes nullables, une contrainte élargie).
2. Core : **avant** le bot (le bot envoie un champ `manageable` que l'ancien Core refuserait).
3. Bot : juste après le Core (l'ancien bot ne sait pas exécuter `reward_update` : ne pas mettre en pause avant).
4. Studio (release) : la page « Récompenses Twitch » avec la gestion.
5. Vérifier que le jeton du streamer **du bot de Production** a `channel:manage:redemptions` (une action refusée faute
   de droit s'affiche dans « À traiter », rien n'est envoyé).

**Retour arrière** : Studio précédent (les boutons disparaissent), bot précédent, Core précédent ; la migration reste
(colonnes ignorées). Une récompense créée reste sur Twitch : la mettre en pause depuis le tableau de bord ou Studio.

## 6. Procédure : migration de Random Ban

| # | Étape | Qui / où | Twitch | Retour arrière |
| --- | --- | --- | --- | --- |
| 1 | **Lecture** : consentement dédié (`rewards-audit-auth.ts`, un seul droit `channel:read:redemptions`, non renouvelable, fichier hors du dépôt), puis `rewards-audit.ts` | toi + moi | lecture seule | — · **fait le 12/11** |
| 2 | Réglages Twitch de « Ban aléatoire » : aucun cooldown global, aucun maximum, non validée automatiquement, pas de texte | moi | — | — · **fait le 12/11** |
| 3 | Studio › Récompenses › Ban aléatoire › **Remplacer par une récompense Raptoru…** : « Random Ban », 3 000 points, « Créer masquée » coché (par défaut) | toi (GO) | **création, masquée** (invisible des viewers) | mettre en pause ou laisser masquée |
| 4 | Vérifier : « Gérée par Raptoru », masquée, règle Random Ban recopiée **coupée** ; puis activer la règle (Studio) | toi | — | règle OFF |
| 5 | **Test de remboursement contrôlé, hors live** : « Rendre visible sur Twitch… », tu la rachètes toi-même → refusée (« hors live »), **aucun Random Ban**, points rendus (CANCELED) — visible dans Studio et sur ton solde. Tout rachat hors live d'un viewer est rendu de la même façon | toi (GO) | **remboursement** | la masquer de nouveau (« Mettre en pause ») |
| 6 | En live, quand tu le décides : un rachat réel → un Random Ban (vrai timeout) ; un 2ᵉ rachat du même viewer dans les 10 min → refusé et remboursé | toi (GO) | timeout réel, remboursement | règle OFF (les rachats sont alors rendus) |
| 7 | **Bascule** : règle de l'ancienne OFF (Studio), ancienne **mise en pause à la main sur Twitch** (Raptoru ne peut pas), jamais supprimée | toi (GO) | pause manuelle | ancienne : règle ON + réactivation ; nouvelle : pause depuis Studio |
| 8 | **Anciens rachats en attente** de « Ban aléatoire » : Raptoru ne peut ni les lire ni les changer ; les valider ou rembourser dans la file des récompenses de Twitch (Studio liste dans « À traiter » ceux dont il sait que les points sont dus) | toi | manuel | — |

**Jamais de points perdus pendant la migration :** une récompense Raptoru rachetée alors que sa règle ou les
automatisations sont coupées, ou hors live, rend les points (CANCELED, une fois). L'ancienne garde son comportement
actuel jusqu'à la bascule.

**Double déclenchement :** impossible pour un même rachat (dédoublonnage par identifiant de rachat). Deux récompenses
actives en même temps = deux façons de payer, pas deux exécutions : c'est pourquoi la règle de la nouvelle est créée
coupée et l'ancienne coupée à la bascule. SAMMI doit rester arrêté (CLAUDE.md : abandonné).

## 7. Ce qui demande ton autorisation

- Toute création, modification, pause, réactivation ou suppression d'une récompense réelle (étapes 3, 7).
- Tout remboursement réel (étape 5, 6) et tout Random Ban réel (étape 6).
- Les déploiements du § 5 (migrations, Core, bot, release de Studio).
- L'autorisation Twitch de l'étape 1 est une connexion de ton compte : c'est toi qui la fais.
