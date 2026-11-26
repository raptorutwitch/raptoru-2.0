# Extension : trois correctifs du 26/11/2026 (Mini-jeux, Tombola, conditions)

Branche locale `feat/ext-interactions` (worktree `agent`), non poussée, après la refonte Interactions (`5c21290b`).
Shell v2 seulement (les ZIP publiés sont « shell-v2 », `apps/twitch-extension/PUBLISHED`) ; le shell legacy, non servi,
est inchangé. Rien n'est publié : un nouveau ZIP et la revue Twitch restent à décider par Antoni.

## B1. Mini-jeux : solde abrégé à 4 chiffres — commit `0d295667`

- **Avant** : l'en-tête de chaque module montrait le solde avec 2 chiffres significatifs dans une case fixe de 40 px
  (`formatCompactBalance` : 2 656 500 → « 2,6 M », 12 345 → « 12 K »), trop grossier pour des mises au Jeton près.
- **Correctif** : `shared/currency.js` `formatCompactAmountPrecise` (même règle que `formatCompactAmount` : tronqué,
  jamais au-dessus du vrai solde, zéros inutiles retirés ; 4 chiffres) ; `createCurrencySwitch` accepte un `format`
  (`shared/ui-primitives.js`, défaut inchangé) ; l'en-tête du module Mini-jeux (`random_ban_ext`) l'utilise dans une
  case élargie à 58 px (`app/panel.js`, `app/css/currency-switch.css`).
- Résultat : 1 000 → « 1 000 », 1 234 → « 1,234 K », 12 345 → « 12,34 K », 123 456 → « 123,4 K », 1 000 000 → « 1 M »,
  2 656 500 → « 2,656 M », 12 345 678 → « 12,34 M ». Choix d'interprétation : un millier rond sous 10 000 reste écrit en
  entier (« 1 000 », « 2 000 »), comme dans l'exemple demandé ; sinon la règle donnerait « 1 K ».
- Inchangé : les autres en-têtes (2 chiffres), les montants de mise et de gain du Casino (`shared/casino/frame.js`),
  tous les calculs de solde et de mise (affichage seulement), le solde exact dans l'infobulle.
- Tests : `test/compact-amount.test.js` (les 7 exemples, seuils 999 / 1 999 / 9 999 / 10 000 / 999 999 / 1 000 001,
  troncature 2 656 999, valeurs inconnues, autres en-têtes à 2 chiffres). Banc Casino (Core local) : 1 000 à
  12 345 678 lus dans l'en-tête, aucun débordement à 563 × 376 (lecteur PC) et 360 × 409 (Android).
- Limite : non vérifié sur un vrai téléphone (la case est en unités `--g`, comme le reste de l'en-tête).

## B2. Tombola : raccourci « Tombola ouverte » partout — commit `6d894bbc` (+ `ff01e83a`)

- **Avant** : la Tombola ouverte ne se voyait que sur sa carte du Hub ; un viewer dans un autre module ne le savait pas.
- **Correctif** (`app/panel.js`, `raffleShortcut()`) : un bouton « Tombola ouverte » (billet, point qui respire) dans la
  barre du bas du Hub et dans l'en-tête de chaque module, à côté de ‹, tant que `state.raffle` est ouverte
  (`raffleIsActive`) et que le viewer n'est pas inscrit (`state.raffle.joined`) ; jamais sur la Tombola elle-même. Un clic
  ouvre la Tombola (`navigateTo('raffle_join')`), le viewer clique ensuite sur « Rejoindre » comme aujourd'hui.
- État et navigation existants : la session lue par le sondage du socle (5 s visible, 15 s sinon) et le signal Twitch ;
  aucune notification (`experience.js` : la tombola ouverte est un état du direct). Le même bouton est gardé d'un rendu à
  l'autre ; il ne s'anime qu'à l'ouverture d'une nouvelle tombola.
- Style (`modules/tombola/tombola.css`) : rose de la Tombola, discret ; sur téléphone et panneau, le billet seul (nom
  dans l'infobulle et pour les lecteurs d'écran) ; un en-tête qui le porte passe en « auto | 1fr | auto » : rien ne se
  chevauche. `ff01e83a` : l'en-tête d'Interactions (Lab) se range aussi (pictogrammes seuls sous 150 px).
- Vérifié (banc, session démo) : Hub 563 / 393 / 318 ; en-têtes Interactions (viewer et modérateur, 3 onglets),
  Soundboard, Bonk, TTS ; clic → Tombola, raccourci absent là ; après inscription : absent partout ; scénario
  « tombola fermée » : absent ; même nœud après les rafraîchissements, aucune animation rejouée ; aucune erreur.
  Suite de l'extension 256/256, banc `lab-module` vert, matrice v2 rapide : aucun chevauchement ni coupure ne touche le
  raccourci (les 2 chevauchements et la coupure relevés à 360 × 269 concernent l'intérieur de Soundboard, Bonk et TTS).
- Limites : pas d'essai sur téléphone réel ; le raccourci suit la session, donc apparaît au plus 5 s (sondage) après
  l'ouverture si le signal Twitch n'arrive pas.
- **28/11, badge compact** (demande d'Antoni) : « Tombola ouverte » devient un petit badge **« Tombola »** — contour
  framboise, point vert « ouverte » entouré d'une onde très discrète (coupée si le viewer réduit les animations) ;
  le nom s'affiche aussi sur téléphone et dans le panneau (il est court) ; seul un en-tête étroit (≤ 400 px) qui porte le
  bouclier des modérateurs le réduit au point + billet. Même code, même état, même navigation qu'en B2 : apparaît à
  l'arrivée si la tombola est ouverte, quand elle s'ouvre pendant un autre module, disparaît à l'inscription et à la
  fermeture, ne rejoue pas d'animation à chaque navigation. En Lab, l'état vient de la session de démo ; le badge et
  le clic passent par le vrai code du shell. Vérifié : Hub 393, modules (Interactions, Soundboard, Bonk), 318 / 360 /
  563 / 651, clic → vraie Tombola, badge absent dedans ; matrice v2 identique.

## B3. « Conditions d'utilisation » à chaque ouverture : ce n'est pas un écran de Raptoru

- **Recherche dans le code** (shell v2 et legacy) : aucun écran de Raptoru ne demande d'accepter des conditions
  (aucun « CGU », « conditions », « terms », « consent »). Les écrans qui peuvent revenir à chaque ouverture sont :
  1. le bloc « Active tes actions Twitch » (`app/panel.js`) : affiché tant que `state.identity_shared` est faux ; ce
     drapeau vient du Core, qui le lit dans le jeton Twitch (identifiant présent seulement si le viewer a accepté le
     partage d'identité **dans la fenêtre de Twitch**). Raptoru ne stocke rien : il suit la décision de Twitch ;
  2. le tutoriel « Bien démarrer » : ne s'ouvre pas tout seul quand Bonk est proposé (cas de Production,
     `shouldAutoOpenTutorial`) ;
  3. la visite guidée de Bonk : revient à chaque arrivée sur Bonk tant que la case « Ne plus afficher » (dernière étape
     seulement) n'est pas cochée — un tutoriel, pas des conditions ; non modifié ici (comportement validé, à décider).
- **Écran de Twitch** : la documentation Twitch (Life Cycle Management › _Pre-Release Disclosures_) dit : « Viewers
  will not be able to use an Extension until they agree to the Extension disclosures that are visible on your channel
  page. These disclosures are removed when viewers install a reviewed and approved Extension that is listed in the
  Extension Directory. » Ces mentions sont les liens « EULA or Terms of Service URL » et « Privacy Policy URL » de la
  console Twitch. C'est très probablement l'écran vu : il est géré par Twitch, hors de l'iframe de l'extension.
- **Ce que l'extension ne peut pas faire** : masquer, accepter ou mémoriser cet écran (il est dessiné par Twitch, avant
  ou autour de l'extension) ; la documentation ne dit pas à quelle fréquence il revient (session, appareil, version).
  Aucun contournement : ce consentement est exigé par Twitch.
- **Ce qui peut le faire disparaître, côté Twitch (Antoni)** : une version revue et approuvée, **listée dans le
  répertoire des extensions** (console Twitch › Discoverability), installée sur la chaîne ; tant que l'extension est en
  test hébergé (Hosted Test, testeurs) ou non listée, les mentions restent. Vérifier aussi que les deux liens (conditions,
  confidentialité) pointent vers de vraies pages.
- **Ce qui manque pour conclure** : une capture de l'écran vu par un viewer (et sur quel appareil), et l'état de
  l'extension dans la console (version publiée, listée ou non, liens renseignés). Le dépôt ne les enregistre pas.
- Aucun code modifié pour B3 ; ce document est son livrable.
