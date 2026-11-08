# Music Hub — accès au catalogue Spotify (reconnaissance du 08/11/2026)

> Lecture du code existant (Spotify V2, Studio) et des textes officiels déjà relevés dans
> [MUSIC_HUB_STATE.md](MUSIC_HUB_STATE.md) § 10. Rien n'est branché : l'extension publique n'a **aucun** compte réel,
> le Lab utilise le catalogue fictif. Aucune base Spotify parallèle, aucun scraping.

## 1. Ce qui existe déjà (code)

| Sujet                  | État dans Spotify V2                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appel de recherche     | `GET /v1/search?q=…&type=track&limit=10` — `apps/studio/server/src/spotify/api.ts` `search()`. Seul Studio appelle Spotify, avec le compte Premium du streamer.                                                                                            |
| Lien collé             | `parseTrackReference` (Core, `spotify/reference.ts` : `open.spotify.com/…/track/<id>`, `intl-xx`, `spotify:track:<id>`) puis `GET /v1/tracks/{id}` (`api.track()`). Music Hub V2 s'en sert déjà.                                                           |
| Métadonnées récupérées | Titre, artistes, album (nom, type, date, nombre de titres), durée, ISRC, popularité, `linked_from`, pochettes (`album.images`, https `i.scdn.co`).                                                                                                         |
| Disponibilité          | `is_playable` est lu **mais Spotify ne le renvoie qu'avec un paramètre `market`** : aujourd'hui, sans `market`, toute version paraît jouable. À ajouter : `market=from_token` (le scope `user-read-private` est déjà demandé).                             |
| Scopes                 | `user-modify-playback-state`, `user-read-playback-state`, `user-read-private`. Recherche et lecture d'un titre ne demandent aucun scope de plus. Jeton rafraîchi par Studio (PKCE, secret chiffré DPAPI) ; un refresh refusé → « reconnexion nécessaire ». |
| Rythme et quotas       | Une seule porte : appels sérialisés, ≥ 200 ms d'écart, **90 appels par minute glissante** pour TOUT Spotify V2 (lecture, file, skips, recherches), arrêt complet sur 429 jusqu'au `Retry-After`, persisté.                                                 |
| Cache                  | Recherche : 5 min par texte normalisé (Studio) + réutilisation du même job pendant 5 min (Core). Titre : 30 min. Lecture en cours : 1,5 s.                                                                                                                 |
| Limites par viewer     | Core : 20 recherches par minute et par viewer ; 2 caractères minimum ; délai de frappe ~260 ms côté extension.                                                                                                                                             |
| Pagination             | **Pas encore** : la recherche ne demande que la première page (10). L'API accepte `offset` (pages de 10 au plus avec les règles actuelles) : une page = un appel de plus.                                                                                  |

## 2. Coût d'une recherche pendant la frappe

- Un viewer qui tape « animal i have become » déclenche au plus une recherche par pause de frappe (~260 ms) :
  typiquement 2 à 4 appels pour une recherche, moins si le même texte a été cherché dans les 5 dernières minutes.
- Le plafond de 90 appels/min est **partagé** avec la file et le skip automatique : une dizaine de viewers qui cherchent
  en même temps peut l'atteindre. Le 429 bloque alors tout Spotify V2, y compris l'ajout des demandes de la récompense.
- Garde-fous à prévoir avant un vrai compte : budget de recherches réservé (ex. 40/min) distinct des appels de lecture ;
  délai de frappe plus long (400 ms) ; pas de recherche sous 3 caractères ; pagination seulement sur demande
  (« Plus de résultats ») ; résultat partagé entre viewers (déjà le cas par texte).

## 3. Autorisations nécessaires (non techniques)

| Point                             | Constat (§ 10 de l'état)                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Afficher le catalogue à des tiers | Permis sous conditions : attribution Spotify, lien vers Spotify sur chaque titre, pochette non recadrée, pas de mélange avec d'autres catalogues.                                            |
| Mode développement                | Application limitée à quelques comptes autorisés (relevé : 5) ; la recherche passe par le compte du streamer, donc un seul compte suffit techniquement.                                      |
| Quota étendu                      | Réservé aux organisations d'au moins 250 000 utilisateurs actifs par mois (relevé du 08/11) : pas accessible.                                                                                |
| Jukebox payant, diffusion         | Diffusion de l'audio Spotify sur un stream : interdite. Faire payer (Jetons) autour du contenu : plutôt défavorable. Programme DJ Twitch : pas de lecture automatique de demandes du public. |

## 4. Comment brancher le fournisseur existant, le jour où c'est autorisé

Rien à réécrire : la recherche de l'extension passe déjà par les jobs `search` de Spotify V2 (Core → Studio → API).
Il faudrait seulement :

1. ouvrir la façade `/v1/ext/music/*` hors Lab (le code la ferme aujourd'hui) ;
2. ajouter `market=from_token` (disponibilité réelle) et, si voulu, `offset` (pagination) dans `api.search()` ;
3. séparer un budget de recherches dans la porte d'appels ;
4. ajouter attribution et lien Spotify dans le module ;
5. tester avec le compte du streamer, en Lab d'abord.

Chaque étape demande un GO ; aucune ne doit être faite tant que les autorisations du § 3 ne sont pas tranchées.
