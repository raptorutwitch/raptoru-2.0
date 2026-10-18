# Twitch OAuth — deux comptes et réautorisation groupée

État : corrections locales du 18/10/2026, après audit de `9fae46e`. Aucune réautorisation réelle, aucun token réel
modifié pendant le développement. Les tests automatisés ne constituent pas une validation manuelle d'Antoni.

## Profils approuvés

La source unique est `packages/schemas/src/twitch-oauth.ts`. Les interrupteurs `.env` sélectionnent les capacités
utilisées à l'exécution ; ils ne réduisent plus les droits demandés par `twitch:auth` ou Studio.

| Compte        | Identité attendue | Scopes demandés à chaque autorisation                                                                                                                         |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raptoru_`    | `83603689`        | `bits:read`, `channel:read:subscriptions`, `moderator:read:followers`, `moderation:read`, `channel:read:redemptions`, `channel:manage:redemptions`            |
| `LeCroupier_` | `1239040922`      | `user:read:chat`, `user:write:chat`, `moderator:read:chatters`, `moderator:read:followers`, `moderator:manage:announcements`, `moderator:manage:banned_users` |

Le runtime accepte encore les autorisations antérieures pour les fonctions qu'elles permettent. Une lecture Points de
chaîne accepte `channel:read:redemptions` **ou** `channel:manage:redemptions` ; une nouvelle autorisation demande bien
les deux scopes approuvés. Une fonctionnalité privée de droits doit être présentée comme indisponible.

Random Ban et le futur Votekick utilisent le droit de sanction du bot ; Votekick n'est pas implémenté par ce lot.
Les scopes ne remplacent pas le rôle de modérateur de LeCroupier_. Autoriser la gestion des redemptions ne transfère
pas à Raptoru la propriété des récompenses historiques : leur recréation et le cutover restent la décision D7.

## Garanties et limites

- Avant sauvegarde : validation Twitch, user token, client OAuth attendu, compte numérique attendu et totalité des
  scopes demandés. Un mauvais compte ne remplace pas le fichier existant.
- L'écriture atomique existante est conservée. Les renouvellements et le remplacement des autorisations utilisent
  une exclusion entre processus et une relecture du fichier pour empêcher une ancienne instance d'écraser le token
  d'une nouvelle autorisation.
- Les erreurs transitoires, dont HTTP 429, ne sont pas assimilées à une révocation du consentement.
- Un refresh réussi suivi d'une indisponibilité de `/validate` conserve le refresh token tourné en attente ; le nouvel
  access token non validé n'est pas utilisé. Le runtime reprend ce renouvellement ; Studio affiche l'attente au lieu
  d'annoncer une connexion prête sur la seule validité de l'ancien access token.
- Les deux comptes sont validés périodiquement ; une expiration enregistrée ne prouve pas une validation Twitch.
- Les diagnostics Studio ne renouvellent pas les tokens. L'ouverture de la carte n'engage aucun OAuth ; seule une
  action explicite de l'utilisateur prépare le flux.
- Un ancien exécutable **antérieur à ce correctif** ne connaît pas les protections de concurrence. Il faut arrêter
  les anciens consommateurs avant la première réautorisation ; une protection ajoutée aujourd'hui ne peut pas
  modifier le comportement d'un processus déjà lancé avec l'ancien code.
- Après un crash pendant une écriture/rotation, un fichier `.lock` abandonné peut subsister. Il n'est jamais effacé
  automatiquement : deux processus tentant de récupérer un verrou pourraient sinon supprimer le nouveau verrou
  d'un tiers. L'opération signale le stockage occupé ; arrêter tous les consommateurs, vérifier que le verrou est
  effectivement abandonné, puis retirer uniquement ce fichier `.lock` avant de réessayer. Ne jamais supprimer le
  fichier JSON contenant les tokens pour résoudre ce cas.
- Les fichiers de tokens restent locaux et hors Git. Le chiffrement du magasin bot/broadcaster et les ACL Windows
  ne sont pas refondus par ce lot.
- Au démarrage, un broadcaster indisponible laisse le chat et la présence du bot fonctionner ; ses modules restent
  indisponibles. Après démarrage, une perte durable d'autorisation ou de scopes arrête les consommateurs et nécessite
  une reprise explicite, au lieu de conserver des exécuteurs fondés sur des droits périmés.

## Procédure depuis Studio — à effectuer avec Antoni après validation

1. Utiliser le Studio construit depuis ce code. Ne pas utiliser l'ancienne release publiée 0.1.5 pour cette procédure.
2. Dans **Simulation**, couper **Ingestion chat Twitch**. Dans **Test Lab**, arrêter le bot et attendre la fin de toute
   opération/preflight. Arrêter aussi tout bot/adaptateur lancé à part, notamment un ancien processus pré-correctif.
   Conserver les automatisations et les sorties réelles désactivées ; examiner les demandes Random Ban en attente
   avant toute reprise. Cette procédure n'active aucune sanction, récompense ou règle.
3. Dans **Studio → Connexions → Comptes Twitch**, vérifier les deux identités attendues et le magasin de données affiché.
4. Pour **raptoru_**, cliquer **Réautoriser Twitch**, puis **Ouvrir Twitch** lorsque le lien est prêt. Dans le navigateur,
   vérifier le compte `raptoru_` et accepter le lot de six droits. Revenir dans Studio et attendre la confirmation de
   l'identité et des droits après le callback. En cas de mauvais compte, corriger la session navigateur et recommencer.
5. Répéter pour **LeCroupier_** (`1239040922`). Ne pas utiliser le parcours viewer/emotes Bonk pour ces deux tokens.
6. Utiliser **Vérifier** pour relire l'état auprès de Twitch sans renouvellement. Vérifier identité, droits manquants
   et date de validation ; une date d'expiration seule n'est pas une preuve de connexion.
7. Réactiver les consommateurs séparément, après contrôle des interrupteurs et des files. Les tests de timeout réel,
   la création de récompenses et le cutover nécessitent leurs étapes de validation propres.

Alternative CLI (uniquement après arrêt des consommateurs) :

```sh
npm run twitch:auth -w @raptoru/twitch-bot -- --broadcaster
npm run twitch:auth -w @raptoru/twitch-bot
```

Les préflights historiques peuvent renouveler les tokens : ce ne sont pas des audits strictement en lecture seule.

## Vérifications de développement

Tests sur tokens fictifs et fichiers temporaires : profils indépendants des flags, mauvais compte/client/type,
scopes incomplets, expiration, rotation du refresh token, erreur 429, concurrence, remplacement d'autorisation,
redémarrage, diagnostic Studio et compatibilité des événements. Aucun flux OAuth réel ne doit être lancé pour
exécuter ces tests.

La validation manuelle des deux autorisations et des sanctions réelles reste à faire. L'authentification viewer/emotes
et les app tokens Core demeurent des circuits distincts ; ce lot ne fusionne pas leurs magasins avec ceux du bot.
Leurs réserves d'audit (validation périodique et confirmation de révocation viewer) ne sont pas corrigées dans ce lot
centré sur les deux comptes opérateurs.

Résultats du lot local :

- Bot : **191 tests**, 21 fichiers, suite complète réussie ; les 7 tests de câblage ont été réexécutés après la correction
  finale de lint d'un mock, avec succès.
- Studio : **513 tests**, 50 fichiers, suite complète réussie ; **22 tests ciblés** de diagnostic, routes et interface
  réexécutés avec succès après les derniers ajustements du diagnostic (historique, profil exact et rotation en attente).
- TypeScript et build globaux : 8 packages réussis ; Studio serveur/web revérifiés après les derniers ajustements.
- ESLint global réussi ; formatage vérifié sur les fichiers du lot, sans reformater les documents maintenus à la main.
- Aperçu navigateur isolé sur données fictives : deux comptes et boutons visibles, aucun débordement horizontal ni
  erreur JavaScript, aucune requête réseau réelle et aucun bouton OAuth cliqué.
- Contenu et date de modification des deux magasins de tokens réels et des deux `.env` conservés à l'identique.

Fichiers principaux : profils et contrôles communs `packages/schemas/src/twitch-oauth.ts` ; cycle de vie et verrouillage
`apps/twitch-bot/src/twitch/auth.ts`, `token-store.ts`, `auth-supervision.ts` ; flux CLI `apps/twitch-bot/src/scripts/twitch-auth.ts` ;
câblage `apps/twitch-bot/src/index.ts` et `lab-chat-main.ts` ; contrôleur Studio
`apps/studio/server/src/twitch-oauth/twitch-connections.ts` ; carte `apps/studio/web/src/twitch-connections.ts`.

Sources officielles : [validation](https://dev.twitch.tv/docs/authentication/validate-tokens/),
[renouvellement](https://dev.twitch.tv/docs/authentication/refresh-tokens/),
[scopes](https://dev.twitch.tv/docs/authentication/scopes/),
[redemptions](https://dev.twitch.tv/docs/api/reference/#update-redemption-status).
