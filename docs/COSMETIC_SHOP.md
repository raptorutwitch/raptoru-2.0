# Boutique cosmétique V1 — titres et badges en Jetons ou en Bonbons

**État (30/10/2026 soir)** : développée et testée (Lab de bout en bout, PostgreSQL réel, navigateur), **rien n'est actif
en Production**. Branche monorepo **`feat/halloween-titles`** : la boutique (PR #44) rejouée sur `main` **sans Level Up V2**
(PR #43, indépendante), plus les « Titres » de l'extension (§ 8). Site : `feat/cosmetic-shop` (repo
`Leaderboard-Jeu-des-mots`, PR #109), facultatif (§ 8). Chaque étape sur GO d'Antoni.

## 1. Principe

- Antoni crée, modifie, prévisualise et publie les titres et badges **dans Studio › Boutique**, sans développement :
  aucun code ni CSS n'est saisi, l'apparence est faite de réglages (couleur, dégradé, effet, graisse, image du badge).
- Les viewers achètent et équipent sur **raptoru.fr › Boutique** ; l'équipement reste celui de la progression
  (Profil & collection). Ce qui est acheté reste au viewer, même après un événement.
- Le Core décide de tout : prix, solde, disponibilité, propriété. Studio et le site ne font que relayer ; le site
  n'envoie que l'offre choisie et l'identité Twitch de **sa** session (jamais un prix, un solde ou un viewer du
  navigateur).
- Un même rendu partout : la feuille de style des apparences est **générée par le Core** (`/v1/cosmetics/style.css`) ;
  l'aperçu de Studio et raptoru.fr chargent la même.

## 2. Créer un titre ou un badge (Studio › Boutique)

1. « Nouveau titre / badge » : identifiant (ex. `roi-citrouille`, minuscules, chiffres, `-`, `_`), type, nom affiché,
   catégorie, rareté, ordre, niveau de déblocage (facultatif), événement (facultatif), description.
2. Apparence : couleur, ou dégradé (deux couleurs + angle), effet (aucun, lueur, brillance, pulsation, arc-en-ciel,
   étincelles ; réduits si le viewer demande moins d'animations), graisse. L'aperçu « rendu de raptoru.fr » suit chaque
   réglage.
3. Badge : image PNG ou WebP **fixe**, 128 × 128 et 40 Ko au plus (SVG, GIF et images animées refusés par le Core).
4. État :
   - **Brouillon** : invisible des viewers, l'identifiant peut encore changer (« Changer l'identifiant… ») ;
   - **Publié** : seul état vendable ;
   - **Masqué** : hors boutique, gardé par ceux qui l'ont ;
   - **Archivé** : idem, retiré de la gestion courante.
5. « Dupliquer » crée une copie en brouillon (pratique pour une variante de couleur).

## 3. Mettre en vente

Objet sélectionné › « Vente de … » :

- offre (identifiant, par défaut `<objet>-jetons` / `<objet>-bonbons`), **monnaie Jetons ou Bonbons**, prix entier,
  « en vente » ;
- ouverture / fermeture **en heure de Paris** (vide : sans limite) ;
- événement (facultatif) : l'offre n'est en vente que si cet événement est la saison ouverte de la boutique
  d'événement (ex. `halloween-2026`) ;
- un objet peut avoir une offre en Jetons et une autre en Bonbons.

Refus possibles côté site, expliqués au viewer : solde insuffisant, déjà possédé, pas encore ouverte, terminée, plus en
vente, événement fermé.

## 4. Achats, remboursements, dons

- Un achat = **une transaction** : verrou par viewer, débit (Wallet pour les Jetons, registre de l'événement pour les
  Bonbons), titre / badge attribué, achat journalisé. Un double clic est le même achat (clé d'idempotence) ;
  un deuxième achat du même objet est refusé (`already_owned`).
- « Derniers achats » › « Rembourser… » (raison obligatoire) : la monnaie revient, l'objet est retiré ; rejouer un
  remboursement ne paie pas deux fois.
- « Donner à un viewer » : un titre / badge, des Bonbons ou des Jetons, une fois par clic (journalisé). Les mini-jeux
  futurs utiliseront la même porte (`award`, une fois par `module:clé`).

## 5. Technique

- Migration `20261118130000_cosmetic_shop.sql` (renommée le 30/10 : après `20261117130000_halloween_economy.sql`, déjà en Production) (additive ; contrainte de source élargie `NOT VALID` ; SQL de retour
  arrière en tête, démontré sur PostgreSQL réel). Tables `cosmetic_images`, `cosmetic_offers`, `cosmetic_purchases`,
  `cosmetic_awards` ; `progression_rewards` gagne `status`, `style`, `image_id`, `event_key` (les récompenses existantes
  restent « Publié »).
- Core `apps/core-api/src/cosmetics/` (service, images, apparences) et `http/cosmetics-routes.ts` :
  public `/v1/cosmetics/catalog | images/<sha256> | style.css | style.json` ; Studio `/v1/{studio|lab}/cosmetics/...` ;
  site `/v1/site/cosmetics/viewers/:id` et `/purchase` (jeton `SITE_TOKEN`, déjà utilisé pour l'équipement).
- Studio : relais `src/cosmetics/relay.ts` (`/api/cosmetics/*`, aperçu `/cosmetics/style.css` et
  `/cosmetics/images/<id>`), onglet `web/src/cosmetics.ts`.
- Site : `api/shop.js` (`/api/shop`, `/api/shop/images/:id`, `/cosmetics.css`), `public/shop.js`, page « Boutique »,
  apparences dessinées dans les classements et « Ma collection ».

## 6. Activation après Halloween (chaque étape sur GO d'Antoni)

Prérequis : aucun (depuis le 30/10, la branche `feat/halloween-titles` ne dépend plus de Level Up V2, PR #43).

1. Sauvegarde Coolify + restauration vérifiée (comme le 29/10).
2. Fusion de la PR boutique, CI verte, déploiement du Core : migration additive, rien ne change pour les viewers
   (catalogue vide).
3. Vérifier que `SITE_TOKEN` est bien présent côté Core et `RAPTORU_SITE_TOKEN` côté site (déjà requis pour
   l'équipement des titres) — sans afficher les valeurs.
4. Release Studio (onglet Boutique), installation par Antoni.
5. Fusion du site (`feat/cosmetic-shop`) : déploiement automatique ; la page Boutique affiche « aucun objet » tant que
   rien n'est publié.
6. Antoni crée le vrai catalogue dans Studio (brouillons), vérifie l'aperçu, publie, met en vente.

Retour arrière : arrêter les offres ou masquer les objets (immédiat, Studio) ; revenir au site précédent (Coolify /
commit précédent) ; Core précédent (la migration reste, additive) ; en dernier recours le SQL en tête de la migration
(perd les achats : rembourser d'abord).

## 7. Tests

- Core, PGlite et **PostgreSQL réel** (même suite `cosmetic-shop.suite.ts`) : images (types, taille, animation),
  brouillon invisible / non attribuable, disponibilités (désactivée, pas ouverte, fermée, événement), achat Jetons et
  Bonbons, solde insuffisant, déjà possédé, rejeu idempotent, **achats concurrents** (un seul débit), remboursement
  idempotent, dons une fois par clé ; routes (`cosmetics-routes.test.ts`) ; retour arrière de la migration (PG réel).
- Studio : relais (`cosmetics-relay.test.ts`) ; **e2e navigateur** `cosmetic-shop.e2e.ts` : création d'un titre et d'un
  badge avec image, aperçu, offre en Jetons, don de Jetons, achat par la route du site (rejeu = même achat, second achat
  refusé), remboursement dans Studio.
- Site : `core-reconnect.test.js` › Boutique (session obligatoire, viewer de la session et jamais un prix du navigateur,
  refus du Core expliqué, images et feuille relayées avec leur type vérifié).
- Navigateur réel (Lab local, 30/10) : raptoru.fr branché sur un Core Lab isolé — catalogue, apparences du Core,
  achat 300 Jetons (13 000 → 12 700, « Possédé »), solde insuffisant en Jetons et en Bonbons (« Confirmer » désactivé),
  bureau et mobile. **Non validé par Antoni.**

## 8. « Titres » dans l'extension (Halloween, 30/10)

- Module « Événements » : onglets **Interactions · Titres · Bonbons**. « Titres » liste les **titres** de la boutique
  vendus en **Bonbons** (créés et mis en vente dans Studio › Boutique, § 2–3) : nom avec son apparence (couleur,
  dégradé, graisse, lueur), rareté, prix, état (Disponible, Possédé ✓, Pas assez de Bonbons, Indisponible), achat en
  deux touches (« Confirmer ? »), retour immédiat (« Titre ajouté à ta collection »). Message : récompense
  **permanente**, contrairement aux effets.
- Même boutique que raptoru.fr : mêmes objets, offres, prix, solde de Bonbons de l'événement, même achat (un débit,
  un titre, journalisé ; même clic = même achat ; `already_owned`). Le viewer est **l'identité Twitch du jeton de
  l'extension** (jamais un champ envoyé) ; seules les offres « titre en Bonbons » affichées peuvent être achetées par
  cette route.
- **Bonbons = événement ouvert** : une offre en Bonbons n'est jamais vendue quand l'événement est fermé (règle du Core,
  pour toute offre en Bonbons). Fermé : l'onglet disparaît ; les titres achetés restent (inventaire de la
  progression, `progression_grants`).
- **raptoru.fr** : le site en Production lit déjà ce même inventaire (`GET /v1/progression/viewers/:id`, « Ma
  collection ») et équipe par le Core (`/v1/site/progression/equip`, vérifie la possession) : un titre acheté y apparaît
  et s'équipe **sans déployer le site** ; il y est affiché en texte simple tant que le site n'a pas la page Boutique
  (PR #109 : apparences dessinées, achat sur le site).
- Routes : extension `GET /events/titles`, `POST /actions/events/titles/purchase` (Core `ext-facade.ts`, appels internes
  au service de la boutique, jamais exposés en HTTP par la frontière ; Lab : `event-shop-facade.ts`).
- **Extension publiée** : l'onglet n'existe que dans une **nouvelle version** de l'extension, soumise à la revue
  Twitch (délai non garanti, une seule version en revue à la fois). L'extension publiée actuellement l'ignore sans
  erreur (elle n'appelle pas ces routes).
- Tests : Core (frontière extension avec vrais jetons : liste, fermé, anonyme, offre en Jetons refusée, achat, rejeu,
  déjà possédé, fermeture → titre gardé, profil et équipement du site) ; suite boutique PGlite + PostgreSQL réel
  (Bonbons refusés événement fermé) ; extension (états de l'onglet) ; e2e navigateur `halloween-titles.e2e.ts`
  (Studio crée et vend, l'extension achète, rechargement, inventaire).
