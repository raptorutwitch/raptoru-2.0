# Sonde Windows SMTC pour Spotify Desktop (09/11/2026)

> Prototype isolé, Lab seulement : `tools/smtc-probe/` (source C#), construit sur place par le compilateur C# de Windows
> (aucun SDK, aucun paquet) dans `.lab-data/smtc-probe/`. **Pas branché à Studio.** Lecture seule : les métadonnées
> locales de Windows ; jamais d'appel à l'API Spotify, jamais de commande au lecteur.

## 1. Ce qui est déjà prouvé sur le PC du stream (09/11, 04:57, écoute passive)

- Windows 11 (26200), Spotify Desktop **version classique** : session `Spotify.exe` trouvée, le navigateur (Brave)
  reconnu et ignoré.
- Lus en 4 ms : titre, artiste, album, état (pause), position / durée, **pochette** (~199 Ko).
- **Pas encore prouvé** : les événements (changement de titre, pause, téléphone, fermeture) — il faut agir dans Spotify,
  donc ton test (§ 2).

## 2. Le test (toi, 5 minutes)

1. Double-clic **`Tester la detection Spotify (SMTC).cmd`** (racine du worktree). Spotify Desktop ouvert.
2. Dans Spotify, en regardant la fenêtre de la sonde :
   1. lance une musique → ligne `LECTURE` (ou `EN COURS` au démarrage) ;
   2. titre suivant (bouton ou touche média) → `PISTE` avec le nouveau titre ;
   3. clique directement un autre morceau dans une playlist → `PISTE` ;
   4. pause puis reprise → `PAUSE` puis `LECTURE` ;
   5. depuis ton **téléphone** (Spotify toujours lu sur le PC) : change de titre, pause → `PISTE`, `PAUSE` ;
   6. rejoue le même titre depuis le début → `REJOUÉ` ;
   7. ferme Spotify complètement → `PERDUE` ; rouvre-le et relance une musique → `TROUVÉE` puis `EN COURS` / `PISTE`.
3. **Ctrl+C** → ligne `BILAN`. Envoie-moi la fenêtre (ou le fichier `.lab-data\smtc-probe\smtc-<date>.jsonl`).

## 3. Lire le résultat

| Ligne | Sens |
| ----- | ---- |
| `PISTE` / `REJOUÉ` | un changement de titre annoncé par un événement Windows (ce qu'on veut) |
| `LECTURE` / `PAUSE` | changement d'état annoncé |
| `DOUBLON` (compté dans le bilan) | Spotify envoie souvent 2 événements par changement : ignoré |
| `TRANSITION` | titre vide un instant pendant un changement : ignoré |
| **`MANQUÉ`** | un changement vu par le contrôle local (toutes les 5 s) **sans** événement : c'est ce qui disqualifierait SMTC |
| `reçu +N ms après l'événement` | délai interne de la sonde (de l'événement Windows à sa lecture) |
| `Spotify a mis à jour sa position il y a N ms` | indicateur du délai Spotify → Windows → sonde (approché : Windows ne date pas l'événement) |

Critère « concluant » : chaque manipulation du § 2 produit sa ligne en ~1 s, **zéro `MANQUÉ`**, et la session revient
seule après fermeture / réouverture.

## 4. Limites déjà connues

- **Aucun identifiant Spotify** dans SMTC (ni ID ni URI) : titre, artiste, album, pochette, état, position seulement.
  Jamais d'identification d'une demande par titre + artiste.
- Spotify cesse d'alimenter Windows si son réglage **« Afficher la superposition du bureau en utilisant les touches
  multimédia »** est désactivé (témoignages 2026) : à laisser activé.
- Lecture sur **un autre appareil** (Spotify Connect vers le téléphone ou une enceinte) : pas de session locale fiable.
  Ici, la musique reste lue sur le PC (le téléphone ne fait que télécommander) : à confirmer par le test 2.5.
- Un événement Windows n'est pas daté : la latence est mesurée de façon approchée.

## 5. Intégration proposée (seulement si le test est concluant)

SMTC ne remplace pas le suivi Spotify V2 : il sert de **déclencheur** de la lecture API existante.

1. Studio démarre la sonde (même exécutable, mode « JSON lines ») en processus enfant, Lab d'abord ; arrêt propre avec
   Studio ; redémarrage borné s'il plante.
2. Sur `PISTE` / `REJOUÉ` / `LECTURE` / `PAUSE` (doublons déjà regroupés), Studio avance sa prochaine lecture
   `GET /me/player` à « maintenant » — **une** lecture, partagée par le cache de 1,5 s, jamais pendant un 429.
   C'est elle (URI exacte, position) que Core juge : début de demande, fin normale, interruption, passage d'une
   demande retirée, `!songcancel`, remboursements — **règles inchangées**.
3. La cadence actuelle ([SPOTIFY_QUOTA.md](SPOTIFY_QUOTA.md)) reste le filet ; avec SMTC fiable, le milieu de morceau
   peut passer de 6 s à ~30 s (gain théorique ~−70 % de plus), les lectures obligatoires restant (15 premières
   secondes, autour de la fin, demande retirée en suivante).
4. Repli automatique sur la cadence actuelle : sonde absente, session perdue, appareil lu ≠ ce PC, ou un changement
   vu par une lecture programmée sans événement SMTC.
5. Tests : simulateur SMTC du Lab (événements émis par le Spotify simulé), doublons, rafales, perte de session,
   repli ; banc de consommation avant / après.
