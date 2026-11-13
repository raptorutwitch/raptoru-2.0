# Passation — Récompenses Twitch (A) + Mini-jeux / Random Ban V2 (B) — 13/11/2026

Rien n'est déployé, rien n'est poussé, rien n'est fusionné dans `main`, aucune écriture Twitch n'a été faite.

## 1. Contexte

- Twitch : seule l'application qui a **créé** une récompense peut la modifier, la mettre en pause ou rembourser ses
  rachats (`CANCELED`). La récompense « Ban aléatoire » n'a pas été créée par Raptoru : il faut la **recréer depuis
  Studio**, puis basculer.
- L'ordre de priorité fixé par Antoni : **A d'abord, jusqu'à la bascule de Random Ban ; B ensuite.**

## 2. Chantier A — prioritaire

- Worktree `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\recompenses-twitch`
- Branche `feat/recompenses-twitch-studio` (depuis origin/main `c1632825`), commit `dddb285e` + ce document. Non poussée.
- Ce que fait la branche : Studio crée, remplace (la règle de l'ancienne est recopiée **coupée**, la nouvelle est
  créée **masquée**), met en pause ou reprend, change le coût ou la visibilité, et rembourse les récompenses gérées par
  Raptoru. Elle affiche aussi un bloc « À traiter ». Le cooldown personnel de Random Ban (10 min) ne s'applique qu'aux
  récompenses gérées par Raptoru. Un rachat refusé, raté, arrivé règle coupée ou hors live est remboursé. `!rb` n'a pas
  changé (prix fixe).
- Documentation complète : `docs/RECOMPENSES_TWITCH.md` (statut, inventaire, procédure § 6, retour arrière).
- Tests :

  | Suite                                                               | Résultat                                                                                   |
  | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
  | Core (2 workers)                                                    | 1525 réussis ; 1 échec `sub-wheel-viewers` (« bad port »), réussi quand on le relance seul |
  | Bot                                                                 | 292 réussis                                                                                |
  | Studio ciblé (rewards-admin-chain, random-ban, brb, effects-player) | 28 réussis                                                                                 |
  | Lint, typecheck                                                     | propres                                                                                    |
  | Contrôle visuel                                                     | Chromium sur la pile e2e (`apps/studio/server/e2e/core-lab-stack.ts`)                      |

  **Pas encore validé par Antoni à la main.**

- Reste à faire avant livraison : pousser la branche (GO), ouvrir la PR et passer la CI. Il faut aussi la suite globale
  Studio, le build et éventuellement une recette Lab par Antoni.

## 3. Chantier B — après A

- Worktree `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\mini-jeux-random-ban`
- Branche `audit/mini-jeux-random-ban` (depuis `c1632825`), commit `a407f320` (WIP). Non poussée.
- Contenu :
  - prix progressif de `!rb <montant>` ;
  - Sniper et Viseur ;
  - modération et page Sanctions ;
  - vue extension ;
  - formatage K/M des Jetons ;
  - statistiques publiques.

  Modules `random_ban` et `random_ban_ext` coupés par défaut. Docs : `docs/mini-jeux/`. Démo :
  `cd apps/core-api && npx tsx scripts/mini-jeux-demo.ts` → http://127.0.0.1:4495.

- Pas fait : Unban, tampon SNIPER, vrais avatars, pages du site.
- **À rebaser sur A** : B contient une version antérieure de l'administration des récompenses. Garder la version de A
  pour :
  - le cooldown limité aux récompenses gérées ;
  - la création masquée ;
  - le remboursement quand la règle est coupée ;
  - l'interface `REFUSALS` et l'affichage masqué.

## 4. Audit Twitch — TERMINÉ (12/11), ne pas le refaire

- 40 récompenses, 10 actives. Une seule est gérable par Raptoru : « Choisi la prochaine musique » (1500).
- « Ban aléatoire » :

  | Champ           | Valeur                                 |
  | --------------- | -------------------------------------- |
  | id              | `b15cc303-bf34-4bc8-9535-1f11ef1299dd` |
  | Coût            | 3000 points                            |
  | État            | active, **non gérable**                |
  | Limites         | aucun cooldown, aucun maximum          |
  | Validation      | manuelle (pas `skip_queue`)            |
  | Texte du viewer | non                                    |

- Inventaire détaillé : `docs/RECOMPENSES_TWITCH.md` § 2 et § 4.

## 5. État des jetons (aucun secret dans le dépôt)

- Jeton d'audit : `C:\Users\Antoni\.raptoru\twitch-audit-broadcaster.json`. Droit `channel:read:redemptions` seul,
  sans jeton de renouvellement, expiré depuis le 13/11 vers 03:20. Antoni peut le supprimer.
- L'ancien jeton local du streamer (`apps/twitch-bot/.twitch-tokens.broadcaster.json`, dans le checkout principal) est
  expiré. **Ne pas le rafraîchir** : il pourrait partager l'autorisation du bot de Production.
- Ne pas appeler la route Production `…/channel-points/<ch>/state` « pour lire » : elle fait aussi l'entretien
  (expirations, remboursements).
- Ne jamais demander à Antoni de recopier un jeton. Utiliser les fichiers locaux et le processus d'autorisation prévu
  (`src/scripts/rewards-audit-auth.ts`).

## 6. Livraison de A (chaque étape sur GO d'Antoni)

1. Migration `20261124130000_cp_reward_admin.sql` (additive).
2. Déployer le Core.
3. Déployer le bot **juste après**. Un ancien Core refuse le champ `manageable` ; un ancien bot ne sait pas exécuter
   `reward_update`.
4. Release de Studio (`npm run studio:release`, après validation d'Antoni).
5. Vérifier que le jeton streamer du bot de Production a le droit `channel:manage:redemptions`. Sinon, l'action
   apparaît dans « À traiter » et rien n'est envoyé.

## 7. Migration de Random Ban (procédure détaillée : `docs/RECOMPENSES_TWITCH.md` § 6)

1. **GO** : créer « Random Ban », 3000 points, **masquée**, depuis Studio (« Remplacer par une récompense Raptoru… »).
2. Vérifier « Gérée par Raptoru » et la règle recopiée coupée, puis activer la règle.
3. **GO** : « Rendre visible ». Antoni la rachète hors live : rachat refusé et remboursé, aucun Random Ban.
4. **GO** : test en live (vrai timeout ; un 2ᵉ rachat dans les 10 min est refusé et remboursé).
5. **GO** : bascule. Couper la règle de l'ancienne dans Studio et mettre l'ancienne en pause **à la main sur Twitch**.
   Ne **jamais la supprimer**.
6. Les anciens rachats en attente se traitent dans la file Twitch : Raptoru ne peut pas les modifier.

## 8. Interdits sans GO explicite d'Antoni

- Pousser, fusionner dans `main`, déployer, appliquer une migration distante, publier une release.
- Créer, modifier, mettre en pause, désactiver, supprimer ou rembourser une récompense ou un rachat réel.
- Ban ou timeout d'un vrai viewer, débit de vrais Jetons, changement des prix Production.
- Supprimer une ancienne récompense (jamais).
- Contacter Twitch en écriture pour tester.
- Dans le checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` (dossier de données de Studio), ne jamais
  lancer `git clean`, `reset --hard` ni `checkout .`.

## 9. Modifications locales sans rapport

Le checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` (branche `main` locale, très en retard sur origin)
contient de nombreuses modifications non commitées et des dossiers `.runtime-*` antérieurs à ces chantiers. Elles ne
viennent pas de ce travail et ont été **laissées en place, intactes**. Les deux chantiers vivent uniquement dans leurs
worktrees.

## 10. Méthode de travail (décidée le 13/11)

Décider → Coder → Tester utilement → Corriger → Commiter → Préparer la livraison.

Interrompre Antoni seulement pour :

1. une opération réelle en Production ou sur Twitch qui demande un GO ;
2. une décision métier vraiment nouvelle ;
3. un blocage concret.

Pas d'audits répétés ni de rapports intermédiaires. Les tests ciblés, les contrôles de sécurité avant déploiement et la
CI restent obligatoires.

## 11. Prochaine action

Dans le worktree A : faire tourner les suites globales et le build. Ensuite, demander à Antoni le GO pour pousser la
branche et ouvrir la PR, puis passer la CI. Après la PR verte : GO Production (§ 6), puis les étapes du § 7.
