# Mini-profil viewer (extension Twitch)

> Livré le 15/11/2026 avec Level Up V2. Maquette validée par Antoni (V2, onglets sans défilement), puis retouches A1–A4 et
> raccordement aux vraies données. Shell **legacy** (celui du Lab et de la Production) ; le shell v2 (`app/`) ne l'a pas.

## Ce que voit le viewer

L'**avatar Twitch** du viewer, rond, à droite du wallet dans l'en-tête du Hub :

- un fin anneau montre l'XP du niveau en cours ;
- un point ambre signale une restriction active.

Au clic, un **panneau flottant** s'ouvre sous l'avatar, dans les limites du Hub, sans défilement dans les formats courants.
Il se ferme par un clic à côté, par Échap ou en recliquant l'avatar.

| Partie          | Contenu                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| En-tête commun  | Avatar et pseudo Twitch ; « Abonné » (étoile Twitch) et le multiplicateur des gains de Jetons de présence (`×2`), détail au survol ; ⚙ Préférences |
| Navigation      | Quatre icônes : Accueil (maison), Restrictions (bouclier, nombre en ambre), Historique (horloge, non lus), Classement (trophée)                    |
| Accueil         | Jetons et Crédits (le total ; le détail par module au toucher) ; carré du niveau, « #18 au classement », barre d'XP, XP restante                   |
| Restrictions    | Une carte par restriction active : module, Bloqué / Délai, détail, temps restant (le compte à rebours du Hub) ; « Aucune restriction » sinon       |
| Préférences (⚙) | « Son de Level Up » (interrupteur, enregistré par le Core, désactivé par défaut) ; « Actualiser l'extension »                                      |
| Historique      | Ouvre l'écran Historique existant (le panneau se ferme)                                                                                            |
| Classement      | Ouvre raptoru.fr (`site_url`) dans un nouvel onglet, comme l'ancien bouton du bas de l'accueil                                                     |

L'ancienne barre du bas de l'accueil n'a plus Historique ni Classement ; l'ancien ⚙ de l'en-tête et son tiroir
Préférences ont disparu (le panneau les remplace : pas de double réglage).

## D'où viennent les données (aucune donnée fictive)

Tout est lu pour le viewer **du JWT** (jamais un identifiant envoyé par le client).

| Donnée                     | Source                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pseudo, avatar             | Session (`viewer_login`, `viewer_avatar`) : Helix Get Users déjà fait par le Core pour le pseudo (`TwitchNames`), photo du CDN Twitch seulement                                                                 |
| Jetons, Crédits            | Session (`wallet.available`, `pending_actions`) : les mêmes nombres que le wallet du Hub                                                                                                                        |
| Restrictions               | Session (`restrictions`, nouveau en Production) : lignes du Core pour ce viewer, l'identité du modérateur remplacée par « Modération »                                                                          |
| Niveau, XP, rang           | `GET /v1/ext/viewer/progression` (lu à l'ouverture du panneau, jamais en boucle) : `rank` = place par XP totale, donc au classement des niveaux                                                                 |
| Abonnement, multiplicateur | Même réponse, `loyalty` (`loyalty/viewer-status.ts`) : palier du moteur Loyalty, taux personnel sinon multiplicateur du palier (`passiveReward`) ; mois cumulés = dernier réabonnement annoncé par Twitch, daté |
| Son de Level Up            | `GET/POST /v1/ext/viewer/preferences` (Level Up V2)                                                                                                                                                             |

Règles du multiplicateur (vérifiées dans le Core le 15/11) :

- c'est celui des **gains de Jetons de présence** : base × (taux personnel, sinon multiplicateur du palier) ;
- les boosts (`wallet/loyalty.ts`) ne s'appliquent à aucun gain aujourd'hui, ils ne sont donc pas comptés ;
- un compte exclu affiche « Sans gains » ;
- un palier inconnu (pas d'instantané Twitch récent) affiche `×1` : c'est ce qui est payé en attendant la vérification.

Une donnée absente reste neutre : « — », « Pas encore classé », « durée inconnue ».

## Fichiers

- `extension/shared/mini-profile.js` et `extension/mini-profile.css` : le module ;
- `shared/ui.js` : le câblage (données et comportements existants) ;
- `app/boot.js` : la feuille.
- Core : `ext/twitch-names.ts` (avatar), `ext/ext-facade.ts` (restrictions, `viewer_avatar`, `loyalty`),
  `loyalty/viewer-status.ts` (+ route interne `/v1/lab/loyalty/me/:id`, jamais en HTTP public).
- Lab : `extension/lab-modules/mini-profil.html` (vitrine des formats, jamais empaquetée) ;
  « Ouvrir le mini-profil (Lab).cmd » à la racine (Lab léger, port 4499).

## Tests

- Core :
  - `loyalty-viewer-status.test.ts` : palier, taux personnel, exclusion, palier inconnu, mois ;
  - `ext-frontier.test.ts` : avatar du CDN Twitch seulement, restrictions du viewer seul et sans nom de modérateur,
    niveau avec Loyalty.
- E2E `progression-v2-level-up.e2e.ts` : interrupteur du son désactivé par défaut et gardé après rechargement.
- Lab, 6 formats × 3 vues : aucun défilement (sauf au zoom 150 %, 181 × 260 px), hauteur identique sur chaque vue, rien
  hors du Hub, aucun solde coupé. Formats : panneau 320, zoom 125 % et 150 %, mobile 360, vidéo 565 et 960.

## Reste à faire (non bloquant)

- Shell v2 (`app/panel.js`) : à porter le jour de la bascule v2.
- Ancien Lab (`studio:legacy`, Lab EBS) : sans Loyalty ni avatar (états neutres).
