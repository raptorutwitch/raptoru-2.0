# Spotify V2 — consommation de l'API, priorités et suivi de la lecture (09/11/2026)

> Branche `feat/music-hub`, Lab seulement. Rien n'est déployé. Chiffres **simulés** (simulateur du Lab, horloge
> factice, aucun appel réel) : à confirmer par les compteurs de Studio pendant un vrai live.

## 1. Ce qui a changé

| Sujet | Avant | Maintenant |
| ----- | ----- | ---------- |
| Porte d'appels (Studio `spotify/api.ts`) | une file unique : une recherche du Music Hub passait devant un skip | **deux voies** : *essentielle* (file, skips, lecteur, lectures de lecture, recherches de la récompense et de `!song`) toujours servie d'abord ; *catalogue* (recherches du Music Hub) avec son budget : **30 / min**, et seulement si la porte entière reste sous 60 / min. Au-delà : refusée tout de suite (jamais mise en attente) |
| Recherches du Music Hub dans Studio | exécutées dans la boucle principale, une à une | **à côté de la boucle** (2 à la fois), abandonnées après 6 s d'attente ; la boucle (synchronisation avec Core, lecture, skips, ajouts) n'attend plus |
| Core (`spotify/service.ts`) | tâches servies par ordre d'arrivée, recherches comprises ; une recherche en attente faisait lire le lecteur | demandes, skips, commandes du lecteur et `!song` **avant** les recherches ; une recherche de plus de 6 s n'est plus servie ; une nouvelle recherche d'un viewer remplace la précédente encore en attente ; plafond de chaîne **30 recherches nouvelles / min** (un texte déjà cherché reste gratuit) → « Beaucoup de recherches en ce moment » ; une recherche seule ne déclenche plus la surveillance du lecteur |
| Recherches du Music Hub | sans disponibilité | `market=from_token` : Spotify dit si chaque version se lit sur le compte du streamer. La récompense et `!song` sont inchangées |
| Suivi de la lecture (`cadence()`) | 2,5 s sur une demande, 1 s sur les 15 dernières secondes de chaque titre | voir § 2 |
| Compteurs locaux | total des appels par minute | par endpoint (appels, 429, erreurs), lectures évitées par le cache par type, attente par voie, recherches refusées (budget) et abandonnées, écritures bloquées (Lab réel). Panneau Studio « Détails techniques › Consommation ». Rien ne sort du PC |

## 2. Suivi de la lecture : quand Studio lit Spotify

L'API Web reste la seule source des décisions de Core (début d'une demande, fin normale, interruption, demande retirée
qui démarre, `!songcancel`). Seul le moment des lectures change :

- **demande retirée en suivante** (elle peut démarrer à tout moment) : rythme historique inchangé — 2,5 s, 1 s sur les
  15 dernières secondes, voie rapide 200 ms juste avant son début (passage automatique) ;
- **15 premières secondes d'une demande** : 2,5 s (le `!songcancel` de sa période de grâce est jugé sur une lecture
  de moins de 10 s) ;
- **fin de chaque titre** : une lecture 4 s avant la fin (« jouée jusqu'au bout » exige une lecture à moins de 5 s de
  la fin), une 0,7 s après, puis toutes les secondes jusqu'au changement (voit aussi le même titre rejoué) ;
- **après un skip ou une commande du lecteur** : lecture immédiate (inchangé) ;
- sinon : **6 s** sur une demande, 30 s sur un titre hors demandes, 10 s en pause ; rien quand Core n'a rien à suivre.

## 3. Mesures (simulateur, `apps/studio/server/test/spotify-consumption.test.ts`)

| Scénario | Avant | Après |
| -------- | ----- | ----- |
| 1 h de demandes enchaînées | 1 400 lectures `GET /me/player` | **630** (−55 %) ; chaque fin vue à moins de 5 s, chaque début vu avant 12 s |
| 1 h de musique du streamer, une demande en attente | 280 | **147** (−48 %) |
| Vague de 30 recherches + un skip + une demande | skip traité en 6,2 s, demande en 6,4 s, Studio muet 6,9 s pour Core | skip **0,8 s**, demande **1,2 s**, silence max **1,9 s** ; 14 recherches réellement envoyées |
| Quota d'une heure (`QUOTA_EXCEEDED`) | — | un seul appel le rencontre, aucun ensuite (même après redémarrage), Studio continue de parler à Core, les demandes sont refusées et remboursées une fois |

**Limite connue (cas rare)** : deux skips faits **à la main dans l'appli Spotify** à moins de ~6 s d'écart en milieu
de demande → la demande du milieu peut ne jamais être vue (avant : sous 2,5 s). Elle reste alors « en attente » et est
remboursée à la fin du live ; aucune demande n'est attribuée à la mauvaise musique. À 7 s d'écart, tout est vu.

## 4. Quotas Spotify (rappel)

Documenté : fenêtre glissante de 30 s ; quota propre au mode développement, compté **par compte développeur** depuis le
23/07/2026, 429 avec `"reason": "QUOTA_EXCEEDED"` ; aucun chiffre publié. Observé par la communauté (non documenté) :
attentes de 2 à 22 h. Studio respecte `Retry-After` sans le raccourcir, le garde au redémarrage, ne retente rien avant.
**Attention** : tout autre outil branché sur le même compte développeur (ex. un widget « Now Playing ») consomme le même
quota.

## 5. Encore possible plus tard (non fait)

- Réduire le suivi des demandes grâce à SMTC (milieu de titre de 6 s à ~30 s, −70 % en théorie) : **non fait**.
  Il faudrait d'abord des mesures réelles prouvant que Windows annonce chaque changement (y compris téléphone et
  fermeture), puis rejouer tout le banc. SMTC ne sera jamais une source d'identité (pas d'identifiant Spotify).
- Alimenter le cache des titres avec les résultats de recherche (un appel de moins par demande du Hub).

## 6. Musique en cours par Windows (SMTC, 09/11) — coût mesuré

Le détail est dans [SMTC_STUDIO.md](SMTC_STUDIO.md). Le banc a été rejoué avec le Windows simulé du Lab
(`spotify-consumption.test.ts`, bloc « with the live track from Windows »).

| Scénario (1 h, simulé)                              | Sans SMTC | Avec SMTC | Pourquoi                                                                 |
| --------------------------------------------------- | --------- | --------- | ------------------------------------------------------------------------ |
| Demandes enchaînées                                 | 630       | **630**   | La lecture « titre exact » remplace la lecture déjà prévue (avancée).    |
| Musique du streamer, une demande en attente         | 147       | **147**   | Idem.                                                                    |
| Musique du streamer, rien à surveiller              | 0         | **21**    | Une lecture par titre (~17–21 titres / h) : uri et pochette exactes.     |
| Deux skips à la main à 3 s (et 2 s) d'écart         | demande du milieu **non vue** | **vue**  | Windows annonce le changement, la lecture suit 1,2 s après.            |

- **Toutes les garanties du § 3 sont tenues aussi avec SMTC** : chaque fin lue à moins de 5 s, chaque début avant
  12 s.
- **Quota dépassé.** Un seul appel le rencontre ; ensuite, aucune lecture de plus. L'affichage continue sans titre
  exact ni pochette Spotify.
- **Messages Studio → Core** : environ 150 à 170 par heure (chaque changement, plus 30 s de battement). Aucun ne part
  vers Spotify.
- **Estimation réelle.** Au plus **+1 lecture `GET /me/player` par changement de titre** quand rien n'est surveillé,
  soit environ +20 par heure. Cela fait +3 % du scénario « demandes enchaînées », et 0 quand une demande est en jeu.
