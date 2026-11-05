# Extension Twitch : modules du socle

## Une porte, deux serveurs

`packages/schemas/src/module-facade.ts` est utilisée **telle quelle** par :
- la façade de Production (`core-api/src/ext/ext-facade.ts`) ;
- l'EBS du Lab (`studio/server/src/extension-lab/lab-ebs.ts`).

Un module n'est donc jamais écrit deux fois (friction E1). Elle reçoit l'identité vérifiée et la clé d'idempotence du
client ; elle ne décide rien.

| Requête | Effet |
|---|---|
| `GET /modules/v3` | modules à actions viewer : identité, interrupteur, actions (prix, règle de live), politique de modération |
| `GET /modules/v3/<id>/state` | état pour CE viewer : disponibilité et raison, prix du serveur, état propre, historique récent |
| `POST /modules/v3/<id>/<action>` | `identity_required` sans identité, `idempotency_key_required` sans clé |
| `GET /modules/v3/moderation/activity`, `POST /modules/v3/moderation/refund` | équipe seulement ; le Core revérifie la permission et audite |

## Côté client — `twitch-extension/extension/shared/`

- `module-registry.js` : `registerViewerModule(id, fabrique, { icon })`. Le Hub montre un module **seulement si le
  serveur le liste ET si cette version le connaît** (négociation, friction E4) :
  - Core ancien sans la route → aucun module ;
  - module inconnu de l'extension → pas affiché (jamais d'écran vide).

  La liste est relue au plus toutes les 30 s.
- `purchase.js` : `createPurchaseButton({ document, run, onResult })` gère l'achat :
  - deux touches (prix, puis confirmation) ;
  - jamais deux envois en parallèle ;
  - la **clé vit le temps de l'intention** : réutilisée après un délai dépassé ou une coupure réseau, renouvelée après
    un succès ou un refus définitif (friction E3) ;
  - `update({ label, price, available, reason })` redessine depuis l'état du serveur : un achat que le serveur ne peut
    pas honorer est désactivé, avec sa raison en mots.
- `module-moderation.js` : panneau générique ajouté par l'hôte sous tout module dont la politique est visible, pour
  l'équipe seulement. Il affiche le journal et propose « Rembourser » avec un motif obligatoire.
- `api.js` : `moduleCatalog`, `moduleState`, `moduleAct`, `moduleModerationActivity`, `moduleModerationRefund`.

## Écrire la vue d'un module

Prendre `shared/coffre-mystere.js` comme modèle (67 lignes) :
- la fabrique reçoit `{ document, client, module }` et rend `{ node, start(), destroy() }` ;
- son seul contenu propre : son texte et son affichage ;
- ajouter une ligne `import './<id>.js'` dans `ui.js` ;
- `ui.js` ne reçoit **aucune** branche, constante ou garde par module.
