# Overlay musique (OBS) — 09/11/2026

> Lab seulement, branche `feat/music-hub`. Rien de poussé, déployé ni publié. **Non validé par Antoni ; jamais testé dans
> un vrai OBS** (rendu vérifié dans Chromium, le moteur des sources navigateur d'OBS). Socle : [SMTC_STUDIO.md](SMTC_STUDIO.md).

## 1. En une phrase

Une seule source navigateur OBS montre le titre en cours dans le look du preset « à l'antenne ».

- **Studio › Modules › Musique › Overlay musique** : choisir un modèle, le régler en voyant le résultat, l'afficher ou le
  masquer sur le stream.
- **Aucun changement d'OBS** pour changer de preset ou pour l'afficher / le masquer.

## 2. Les modèles (vraies compositions, pas des couleurs)

| Modèle | Archétype | Pour quoi |
| ------ | --------- | --------- |
| **Flottant** | `minimal` | Pastille d'une ligne (titre — artiste), pochette ronde, progression en filet. Permanent et discret. |
| **Cartouche** | `clean` | Pochette, « En cours », titre, artiste, progression, temps, badge « Demande de X ». Lisibilité maximale. |
| **Verre** | `glass` | La pochette floutée en fond (sa propre image, jamais la scène derrière), reflet, bords fins. Haut de gamme. |
| **Néon** | `neon` | Cadre lumineux, bande d'accent, titre condensé en capitales, éclat qui balaie le cadre à chaque titre, lueur qui respire (**décorative** : aucune donnée audio). |
| **Éditorial** | `editorial` | Typographie d'abord : grand titre à empattements sur 2 lignes équilibrées, filet-progression, « par Artiste » en italique, pochette en retrait. |
| **Projecteur** | `focus` | Grande pochette, tout le détail, temps aux deux bouts, bandeau « Demandée par X ». Fait pour annoncer. |

Deux presets prêts à l'emploi en plus :

- **Hybride** : un Cartouche agrandi à chaque titre, puis une pastille.
- **Jeu chargé** : minuscule, en haut, à demi transparent, sans mouvement inutile.

## 3. Réglages

- **Essentiel** :
  - taille (compacte / standard / grande) ;
  - position (grille 3 × 3) ;
  - affichage (Toujours / Annonce / Hybride, et la durée de l'annonce) ;
  - en pause (montrer « En pause », estomper, réduire, cacher) ;
  - rien ne joue (cacher, ou « Aucune musique ») ;
  - mettre en avant une demande ;
  - pochette ;
  - palette (Nuit, Aurore, Givre, Braise, Menthe, Papier) ;
  - accent tiré de la pochette ;
  - contenu affiché (titre, artiste, album, progression, temps, « En cours », badge demande, pseudo, état pause).
- **Avancé (replié)** :
  - couleurs une à une ;
  - opacité du fond, dégradé, bordure, ombre ;
  - police (Moderne, Condensée, Éditoriale, Machine : polices de Windows, rien à installer) ;
  - tailles du titre et de l'artiste, graisse ;
  - textes longs : défiler seulement s'ils débordent, 2 lignes, ou « … » ;
  - largeur, marge, alignement, orientation (Cartouche, Verre, Projecteur), arrondis, espacement ;
  - taille et forme de la pochette ;
  - apparition, changement de titre (fondu enchaîné, défilement, pochette retournée, rebond), intensité, durée ;
  - lueur décorative.
- **Valeurs impossibles** : les curseurs et listes les empêchent ; le serveur refuse le reste (« Non enregistré : … »).
- **Mouvement réduit** : si le système demande moins de mouvement, les animations s'arrêtent.

## 4. Presets et variantes

- **Les modèles ne changent jamais.** Le premier réglage modifié crée « Mon <modèle> » : la variante est créée et
  enregistrée, avec un message qui le dit.
- **Variantes** : renommer, dupliquer, supprimer, « Valeurs par défaut » (retour au modèle d'origine, nom gardé).
  Supprimer celle à l'antenne remet son modèle à l'antenne : jamais d'overlay vide.
- **Enregistrement automatique.** Une demi-seconde après le dernier changement. « Enregistré » ne s'affiche que quand
  Studio l'a confirmé, sinon « Non enregistré : raison ».
- **Persistance.** Les réglages et les variantes sont gardés au redémarrage de Studio, dans
  `<dossier Spotify>/music-overlays.json`, format versionné.
- **Robustesse.** Un réglage ancien ou abîmé est réparé champ par champ (les autres choix restent), et Studio l'annonce.
  Un fichier illisible est mis de côté (`.unreadable-…`), jamais effacé.

## 5. L'éditeur

- **Galerie.** Une vraie miniature de chaque modèle : la page d'overlay elle-même, en petit.
- **Aperçu 16:9.** C'est la vraie page OBS dans un cadre, donc le même code que l'overlay.
  - **Source** : « Morceau réel » (ce que l'overlay reçoit) ou « Démo » (Normal, Titre très long, Demande viewer,
    En pause, Spotify fermé).
  - **Fond** : jeu sombre, jeu clair, jeu chargé, transparent.
  - **Zoom ×2** sur le coin de l'overlay, et « Rejouer l'animation ».
  - **La démo ne quitte jamais ce cadre** : rien n'est envoyé au stream (vérifié par un test bout en bout).
- **En-tête.**
  - « Afficher / Masquer » : sur le stream.
  - « Tester sur le stream » : rejoue l'apparition avec le **vrai** titre.
  - « OBS » : l'assistant (§ 6).
- **Page Spotify.** Une ligne « Overlay musique : affiché / masqué · preset » avec « Afficher / Masquer » et « Régler ».

## 6. OBS

- **Une seule source.** Une source navigateur sert à tout : `http://127.0.0.1:<port>/music-overlay/overlay.html#<clé>`,
  1920 × 1080, fond transparent.
  - La clé est dans le `#` : elle ne circule pas dans les requêtes.
  - Elle ne donne accès qu'à l'état de l'overlay (titres, pochette, pseudo affiché) : ni Spotify, ni secret.
  - Elle ne change pas d'un démarrage à l'autre.
- **Afficher / Masquer.** La page apparaît et disparaît d'elle-même : aucune scène ni source n'est modifiée.
- **L'assistant** (bouton « OBS ») passe par la connexion OBS que Studio a déjà, la même que pour le Bonk et les
  récompenses. Il ne fait qu'**ajouter**, sur clic et confirmation :
  1. **« Installer dans OBS »** crée une scène à part, « Raptoru · Musique (overlay) », avec la source
     « Raptoru · Musique ».
     - Si la source existe déjà, rien n'est créé : jamais de doublon.
     - Elle n'est dite installée que si OBS le confirme en relisant.
     - Si une autre source porte déjà ce nom, Studio le dit et ne la remplace jamais.
  2. **« Ajouter à cette scène »** (scène choisie dans la liste, confirmation) ajoute la même source à une de tes
     scènes. Rien n'est retiré ni remplacé, et OBS confirme.
  3. **« Réparer l'adresse »** ne touche que notre source (nouvelle clé, Studio déplacé).
  - **Sans connexion OBS** (le cas du Lab) : l'assistant le dit, « Installer » est grisé, et l'adresse à copier permet
    l'ajout à la main.
- **Studio fermé** : la page s'efface après environ 1 s et revient seule quand Studio repart.
  - Les reconnexions se font avec un délai croissant (jusqu'à 10 s).
  - Un état périmé est estompé (« Non confirmé »).

## 7. Données et performance

- **Ce que la page reçoit de Studio.** La page interroge Studio en attente longue (*long poll*) : Studio répond dès que
  quelque chose change, et au plus tard au bout de 25 s.
  - **Source** : le titre de Windows (SMTC), puis son titre Spotify exact s'il a été lu, sinon la dernière lecture de
    l'API Web.
  - **Demandeur** : seulement quand le Core attribue la demande en cours à **ce titre exact** (son uri).
  - **Aucun appel Spotify** de plus, aucune décision : la page ne fait que lire.
- **Coût.**
  - Le DOM ne change qu'au changement de titre, de preset ou d'affichage.
  - La barre est **une** transition CSS jusqu'à la fin du titre ; l'heure bouge une fois par seconde, seulement si elle
    est affichée.
  - Les pochettes sont locales (octets de Windows, en cache par empreinte) ou celles de Spotify.
- **Anciens OBS.** Pas de `color-mix()` (calculé en JS) ni de flou de la scène : les effets se dégradent proprement.

## 8. Historique et Music Hub (finitions du 09/11)

- **Un nouveau Daily, un historique visible vide.** Le Daily est celui du projet (`stream_day` : fenêtre de 16:00 à
  16:00, Paris), celui du live en cours sinon celui de maintenant.
  - Un stream qui passe minuit garde son historique.
  - Les anciennes lignes restent en base : rien n'est supprimé.
- **Doublon.** Une occurrence anonyme (titre exact non lu) qui commence avec une demande vue par le Core (à ±4 s) n'est
  listée qu'une fois, en demande. Elle est cachée, jamais attribuée.
- **Lab en lecture seule.**
  - Studio grise « Passer la musique », Pause et Volume et dit pourquoi.
  - L'extension dit pourquoi une action du lecteur n'a pas abouti (lecture seule, aucun appareil, limite Spotify,
    Studio absent).
  - Jamais de faux succès.

## 9. Tester

- **Lanceur.** `Ouvrir Music Hub (Lab).cmd` (simulé) ou `Ouvrir Music Hub (Lab, Spotify reel).cmd` (ton Spotify, en
  lecture seule).
- **Studio.**
  1. Studio › Modules › Musique › **Overlay musique**.
  2. Clique un modèle : l'aperçu change.
  3. « Démo » et ses cas, « Zoom », un fond.
  4. Change un réglage : « Mon … » apparaît dans « Mes variantes ».
  5. « Mettre à l'antenne », puis « Afficher ».
- **OBS** : bouton « OBS » › « Installer dans OBS » (scène à part), puis « Ajouter à cette scène » pour ta scène de jeu.
  Ou une source navigateur à la main avec l'adresse copiée.
- **Musique réelle** : lance Spotify Desktop (mode réel). L'overlay suit chaque changement de titre.
- **Revenir en arrière** :
  - « Masquer » suffit ;
  - dans OBS, supprime la source et la scène « Raptoru · Musique (overlay) » si tu le souhaites (Studio ne supprime
    jamais rien) ;
  - côté code : commit précédent `43eb7c4`.

## 10. Limites connues

- **OBS.** Jamais essayé dans un vrai OBS. Ses sources navigateur utilisent Chromium (CEF) : le rendu devrait être le
  même, mais c'est à vérifier par Antoni.
- **Raccourcis.** Aucun raccourci clavier ni action « Stream Deck ».
- **Animation de changement de titre.** La hauteur du widget saute (sans animation) quand le nouveau titre en demande
  une autre (2 lignes).
- **Accent de la pochette.** Pour une pochette Spotify (`i.scdn.co`), il dépend de l'autorisation CORS du CDN ; à
  défaut, l'accent de la palette est gardé.
- **Production.** La sonde Windows n'est pas embarquée dans Studio installé. Sans elle, l'overlay utilise la lecture de
  l'API Web (moins réactive, et seulement quand Studio surveille une demande).
