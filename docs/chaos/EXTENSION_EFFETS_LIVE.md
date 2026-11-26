# Effets live : Chaos V2 dans l'extension (maquette du 26/11/2026)

**État** : première passe UX navigable, **Lab seulement**, branchée sur un **faux Core** (données fictives). Rien n'est
publié ni branché au Core, aux Jetons ou au moteur. Branche locale `feat/ext-interactions` (worktree `agent`).
Base produit : [ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md) § 10 (module `chaos` du socle, file, remboursements).

## 0. Voir la maquette

- Double-clic sur `apps/twitch-extension/Apercu Effets live.cmd` (worktree `agent`) : la page
  `apercu.html` montre l'extension réelle (shell v2, mode démo) dans 5 tailles côte à côte : composant vidéo 651×434,
  zone de l'appli Twitch mobile 393×484, petit Android 360×409, panneau 318×496, plein écran 1053×702. Boutons :
  direction, onglet, rôle, scénario, fiche ouverte. Fermer la fenêtre arrête tout.
- À la main : `node test/responsive/server.mjs` dans `apps/twitch-extension`, puis
  `http://127.0.0.1:4471/demo-v2/video_component.html?anchor=component&labModules=effets` (ou `mobile.html?anchor=panel&platform=mobile&labModules=effets`).
  Paramètres : `demoModule=effets_live`, `ixDir=a|b|c`, `ixTab=chaos|bonk|regie`, `ixRole=mod`, `ixScenario=…`, `ixOpen=<effet>`.
- Dans le module, le bouton **Lab** (pointillés orange) change direction, scénario et rôle. Il n'existera pas pour les viewers.

## 1. Nom et place

- Le Hub s'appelle déjà « Interactions » (titre de l'extension) : le module s'appelle **« Effets live »** (carte
  fuchsia → cyan, « Secoue l'écran du stream »). Autres noms possibles : « Chaos », « Sur le stream ».
- Trois onglets : **Chaos** (les 13 effets d'écran), **Bonk** (le vrai écran Bonk, embarqué tel quel), **Régie**
  (équipe seulement). La carte Bonk quitte le Hub quand « Effets live » est proposé (`groups: ['bonk']`, socle v2) ;
  sans la maquette, le Hub est inchangé.

## 2. Parcours viewer (direction A recommandée)

1. **En haut, toujours** : « À l'écran » (effets en cours, temps restant, barre de progression) et « File n/3 ».
2. **Filtres** : Tout · Mouvement · Vision · Image (trois mots au lieu des six familles techniques).
3. **Vitrine** : une carte par effet, avec un aperçu animé (une petite scène de jeu à laquelle l'effet s'applique,
   CSS pur), le nom, « dès … ◆ » et une pastille d'état.
4. **Fiche** (toucher une carte) : aperçu qui suit le réglage, phrase d'une ligne, **Intensité** (avec jauge) ou
   **Style** selon l'effet, **Durée** (5 / 10 / 20 / 30 s ; flash 3 / 6 / 9 s), règle de cumul en une ligne, puis le pied :
   l'issue (« Démarre tout de suite » / « En file · 2e · environ 0:20 » / la raison du refus) et le bouton
   **Lancer · prix** → **Confirmer ?** (deux temps, 4 s, comme `shared/purchase.js`). Mobile : feuille du bas ; grand
   écran : carte centrée en deux colonnes.
5. **Suivi** au pied du module : « Ton Miroir · 2e dans la file · environ 0:40 » → « à l'écran · encore 0:12 » →
   « est passé » / « remboursé ». Toucher : « Mes effets récents » (6 derniers, prix barré si remboursé).

Paliers et durées : ceux du registre réel (`viewer.tiers`, `viewer.durations_ms`). Un **style** (Miroir gauche-droite /
haut-bas) garde le même prix ; une **intensité** le change (`intensity_affects_price`).

## 3. États d'un effet (pastille de la carte, issue de la fiche)

| État                 | Pastille                        | Achat                                                | Source (futur Core)                     |
| -------------------- | ------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| disponible           | —                               | oui                                                  |                                         |
| en cours (autre)     | « En cours · 0:12 »             | oui, passe en file juste après                       | effets actifs                           |
| le tien              | « Le tien, en file / en cours » | non                                                  | demandes du viewer                      |
| délai personnel      | « ⏱ 0:41 »                      | non : « Tu pourras relancer… »                       | cooldown viewer × effet                 |
| délai commun         | « ⏱ 0:30 »                      | non (effets photosensibles)                          | cooldown global de l'effet              |
| file pleine          | « File pleine »                 | non s'il doit attendre ; oui s'il part tout de suite | `queue_full`                            |
| 1 en attente         | « 1 en attente »                | non s'il doit attendre                               | 1 demande en file par viewer            |
| solde                | « Solde » (prix en rouge)       | non : « Il te manque … Jetons »                      | Wallet                                  |
| pas sur ce jeu       | « Pas sur ce jeu »              | non (seuls les calques passent)                      | `lecteur_absent` (plein écran exclusif) |
| mode doux            | « Mode doux »                   | non                                                  | `refusé_mode_sûr`                       |
| en pause / hors live | bandeau du module               | non, file gardée en pause                            | interrupteur, live (H1)                 |

## 4. Règles par défaut proposées (faux Core : `lab-modules/effets/model.js`, testées)

- **Cumul selon le moteur réel** (registre `slots`) : 1 retournement à la fois (Écran retourné, Miroir), 2 mouvements de
  caméra (Tremblement, Zoom, Écran ivre, Vision tunnel), 3 filtres (Flou, Pixelisation, Couleur, VHS), 4 calques
  (Brouillard, Clignement, Flash). Au-delà : file. _Écart_ : ARCHITECTURE § 10.3 prévoyait « un seul effet de capture à
  la fois » ; le moteur construit depuis en accepte plusieurs, la maquette le suit.
- **Doublon** : jamais deux fois le même effet en même temps ; le second (autre viewer) passe juste après. Prolonger
  l'effet en cours (le moteur sait le faire) reste une option, non retenue par défaut : moins lisible pour le viewer.
- **File** : 3 au plus, FIFO par emplacement, expiration 3 min **remboursée d'office**, une seule fois (Q5).
- **Même viewer** : 1 demande en attente à la fois ; même effet relançable **1 min après sa fin** (délai personnel).
  **Deux viewers différents** : le même effet à la suite est permis (il attend son tour).
- **Flash** (photosensible) : délai commun de 60 s entre deux flashs, refusé en mode doux (Q6).
- **Achats simultanés** : le Core sérialise ; l'issue est montrée avant la confirmation ; prix confirmé envoyé
  (`price_changed` refusé sans débit) ; file devenue pleine → refus sans débit, en mots.
- **Remboursements** : jamais démarré → automatique ; arrêté par la modération ou « Tout arrêter » **avant 25 %** de sa
  durée → automatique (Q3/Q4, proposition) ; après : au choix du modérateur, avec motif ; remboursement après coup,
  une fois, motif obligatoire.

À trancher par Antoni (QUESTIONS_OUVERTES) : prix (Q2), remboursement du STOP ALL (Q3), seuil 25 % (Q4), 3 / 3 min (Q5),
mode doux au premier live (Q6), effets agressifs (Q7), effet incompatible montré « indisponible » (Q8 : fait ainsi).

## 5. Modération : où et quoi

- **Modérateurs** (sur Twitch, pas sur le PC d'Antoni) : onglet **Régie** du module, visible pour l'équipe seulement.
  Puis, au branchement, les mêmes données dans la console de modération existante (« Autres modules »,
  `module-moderation.js`).
- **Antoni** : Studio › Chaos (déjà le moteur, STOP ALL, raccourci) gagne un panneau « File et historique » lisant le
  même état du Core (lot 2, Studio). Non dessiné dans cette passe.
- **Régie** : _Mettre en pause / Reprendre_ (plus d'achats, la file attend), _Tout arrêter_ (confirmation ; règle des
  25 % ; met en pause), _Offrir un effet_ (gratuit, passe devant la file) ; listes **À l'écran** (Arrêter : avec ou
  sans remboursement, motif obligatoire sans), **File** (Annuler : idem ; position, départ estimé, expiration),
  **Historique récent** (qui, quoi, état, par qui, motif, « remboursé » ; _Rembourser_ après coup avec motif).

## 6. Trois directions (même modèle, même fiche)

| Direction       | Idée                                       | Forces                                                           | Limites                                            |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------- |
| **A · Vitrine** | grille de cartes animées + fiche           | on comprend l'effet en le voyant ; prix et états d'un coup d'œil | 2 rangées visibles sur téléphone                   |
| **B · Liste**   | une ligne par effet, réglage déplié dedans | 5 effets visibles sur téléphone ; comparer les prix              | moins vivant ; l'aperçu n'arrive qu'au dépliage    |
| **C · Scène**   | une grande carte à la fois (comme le Hub)  | spectaculaire, cohérent avec le carrousel du Hub                 | lent pour parcourir 13 effets ; long sur téléphone |

**Recommandation : A**, avec la liste B comme repli si le catalogue grossit (lot 3) ou si les tests sur téléphone le
demandent. C reste une idée pour une mise en avant (effet du jour).

## 7. Ce qui est fictif, et le contrat attendu du Core (lot 2)

Fictif : prix (base × durée × intensité), viewers simulés (un achat toutes les 14 à 24 s), file, délais, solde (lu une
fois dans la session de démo, débité localement), aperçus (scène CSS, pas le rendu du moteur). Réel : le catalogue
(13 effets, emplacements, paliers et durées du registre), Bonk (vrai écran, mode démo), le socle v2 (Hub, en-tête,
échelle, chargement à la demande).

Le module `chaos` du Core devra fournir, par viewer : effets (état, raison, `minPrice`), effet en cours (temps restant,
acheteur), file (position, départ estimé, expiration), « mes effets », un **devis** `quote(effet, palier, durée)` →
`{ price, outcome, block }` et l'achat idempotent avec `expected_price` ; pour l'équipe : annuler, arrêter, rembourser,
pause, tout arrêter, offrir. La vue appellera `client.moduleState` / `moduleAct` à la place de `model.js`.

## 8. Mobile

- Surfaces vérifiées par captures : composant vidéo 452×301 à 1053×702, appli Twitch 393×484 et 360×409, panneau 318.
- Le module tient dans la zone visible (`--vh` du socle), sinon la page défilerait et la feuille sortirait de l'écran.
- Feuille du bas : aperçu aplati, phrase masquée sur zone très basse ; le bouton d'achat est toujours visible (collé au
  bas). Cibles tactiles ≥ 34 px en tactile.
- **Non vérifié** : vrai téléphone dans l'appli Twitch (banc mobile, `extension/BANC_MOBILE_TWITCH.md`) — à faire au
  branchement.

## 9. Idées d'effets (bonus)

| Nom                    | Idée                                                              | Place                      | Retenir ?                                                                |
| ---------------------- | ----------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **Confettis**          | pluie de confettis 4–6 s pour un « GG », styles fête / cœurs / or | calque (Image festive)     | **oui, priorité 1** : positif, léger, passe même en plein écran exclusif |
| **Pluie d'emotes**     | les emotes de la chaîne tombent (catalogue de Bonk)               | calque                     | **oui** : synergie Bonk, identité de la chaîne                           |
| **Écran fissuré**      | vitre qui se fêle au point visé, puis se répare                   | calque + légère distorsion | oui                                                                      |
| **Signal perdu**       | « NO SIGNAL », barres et neige 2–3 s                              | Image                      | oui (court, drôle, pas cher)                                             |
| **Rétro Game Boy**     | 4 tons verts                                                      | style de Filtre de couleur | oui, comme style (pas un effet de plus)                                  |
| **Écran penché**       | l'image penche de 6–10°                                           | Mouvement léger            | oui (déjà au lot 3)                                                      |
| **Neige / pluie**      | météo à l'écran                                                   | calque                     | saisonnier (lot 3)                                                       |
| **Hypnose**            | spirale au centre                                                 | calque                     | plus tard : fort, refusé en mode doux                                    |
| **Puzzle**             | l'image découpée et mélangée                                      | transformation             | plus tard (lot 3) : iconique mais lourd                                  |
| Aberration chromatique | décalage rouge / cyan                                             | Image                      | non : déjà dans VHS                                                      |

## 10. Fichiers et tests

- `apps/twitch-extension/extension/lab-modules/effets/` : `module.js` (entrée, carte, `groups`), `view.js` (vue),
  `model.js` (faux Core), `catalog.js` (catalogue et prix fictifs), `glyphs.js` (pictos, aperçu), `effets.css`,
  `apercu.html` / `apercu.js` (page de comparaison). Jamais embarqués : `scripts/package.mjs` retire `lab-modules/`.
- Socle, changements génériques : `app/v2.js` (`?labModules=effets`), `app/panel.js` (couleurs de la carte ; `groups`
  retire du Hub les cartes regroupées), `shared/hub-carousel.js` (icône `chaos`), `shared/module-registry.js` (doc).
- Tests : `test/effets-live-model.test.js` (15 cas : emplacements, doublons, file pleine, 1 en attente, délais, flash,
  prix changé, expiration remboursée, pause / hors live / plein écran, modération) ; suite de l'extension 246/246 ;
  banc `test/responsive/lab-module.mjs` vert (module démo, cycles de vie, aucun minuteur laissé) ; parcours cliqués et
  captures (achat en deux temps, suivi, Régie : annuler, offrir, tout arrêter, rembourser avec motif).
