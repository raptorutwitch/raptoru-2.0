# Music Hub — tester le vrai catalogue Spotify en Lab (09/11/2026)

> Le Lab reste fictif (chaîne, viewers, Jetons, Core local) ; seule la musique est réelle. Rien en Production, rien
> sur Twitch, aucune extension publique. Ce n'est **pas** une autorisation d'usage : voir
> [SPOTIFY_CATALOGUE.md](SPOTIFY_CATALOGUE.md) (conditions Spotify) avant toute ouverture.

## 1. Les deux modes

|                                        | Mode A — Lab simulé (défaut)                          | Mode B — Lab sur ton compte Spotify                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lancement                              | `Ouvrir Music Hub (Lab).cmd`                          | `Ouvrir Music Hub (Lab, Spotify reel).cmd` (demande confirmation)                                                                                               |
| Catalogue                              | fictif, signalé « Catalogue de démonstration du Lab » | **Spotify** (titres, artistes, albums, versions, pochettes, disponibilité), signalé « fournis par Spotify » + lien « Ouvrir dans Spotify »                      |
| Lecteur                                | simulé                                                | ton lecteur réel, **lu** seulement                                                                                                                              |
| Ajout à ta file, skips, pause / volume | simulés                                               | **bloqués** (refus « Lab en lecture seule », Jetons du Lab rendus une fois) tant que tu n'as pas cliqué « Autoriser les ajouts pour cette session » dans Studio |
| Persistant ?                           | —                                                     | **non** : le mode est choisi à chaque lancement (variable `LAB_SPOTIFY=real` du lanceur), les ajouts sont recoupés à chaque démarrage                           |
| Données                                | `.lab-data/…/spotify-lab`                             | dossier séparé `.lab-data/…/spotify-lab-real` (jeton chiffré Windows, jamais envoyé au navigateur ni à l'extension)                                             |

## 2. Une fois avant le premier essai (toi)

1. **Hors live** : le quota Spotify est celui de ton compte développeur (le même que la Production).
2. Recommandé : dans le tableau de bord Spotify (developer.spotify.com/dashboard), une **application à part
   « Raptoru Lab »** (mode développement), pour ne jamais toucher à la connexion de la Production. Adresse de
   redirection : `http://127.0.0.1:4100/api/spotify/oauth/callback`. API cochée : Web API. Ton compte Premium.
   (Réutiliser l'application de la Production marche aussi, mais crée une seconde connexion sur la même application.)
3. Ferme Raptoru Studio (installé), démarre Docker Desktop.

## 3. L'essai

1. Double-clic `Ouvrir Music Hub (Lab, Spotify reel).cmd`, réponds **O**.
2. Studio (Lab) s'ouvre ; page **Musique** : un bandeau dit « Lab sur ton vrai compte Spotify — lecture seule ».
   Section « Connexion Spotify » : colle le Client ID, **Connecter Spotify**, accepte dans le navigateur.
3. Les pages de l'extension s'ouvrent (viewer, modérateur, supermod). Cherche un titre : résultats réels, versions,
   pochettes, « Indisponible » quand Spotify le dit.
4. **Identification exacte, sans rien ajouter** : choisis une version et demande-la. Studio lit le titre exact
   (`GET /tracks/{id}`), puis refuse l'ajout (« Lab en lecture seule ») : la demande apparaît refusée et remboursée.
   Le journal de Studio et la page Musique montrent le titre exact retenu.
5. Consigner sans secret (facultatif) : `powershell -File scripts\music-hub-real-check.ps1` — quelques recherches,
   identifiants, ISRC, albums → `.lab-data/spotify-real-check-<date>.json`.
6. **Ajout réel à ta file — seulement si tu le décides au moment de l'essai**, après avoir vérifié que cet usage te
   convient (conditions Spotify) : Studio › Musique › « Autoriser les ajouts pour cette session » (confirmation).
   Une demande va alors dans ta vraie file ; skip et lecteur supermods aussi. « Revenir en lecture seule » ou
   redémarrer coupe tout.

## 4. Ce qui reste bloqué ou à faire

- Logo Spotify officiel (règles de marque) à ajouter avec l'attribution texte actuelle ; lien « Ouvrir dans Spotify »
  sur chaque résultat (aujourd'hui : sur la version choisie).
- Domaine d'images `i.scdn.co` à déclarer dans la console Twitch le jour d'une extension hébergée. **Corrigé le 09/11 :**
  le Lab ne l'autorisait pas en réalité, et les pochettes du vrai catalogue étaient cassées. La CSP du Lab l'ajoute
  désormais ([SMTC_STUDIO.md](SMTC_STUDIO.md) § 5).
- En mode réel, Studio lance aussi la sonde Windows (musique en cours, musiques du stream) : [SMTC_STUDIO.md](SMTC_STUDIO.md).
- Aucun branchement de l'extension publique ni du Hosted Test à Spotify : le module ne répond qu'en Lab (`config.lab`).
