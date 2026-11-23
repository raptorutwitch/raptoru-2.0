# Soundboard

État et règles du module Soundboard. Le Core décide (catalogue, prix, achat, file, remboursement) ; Studio joue les sons
sur la sortie audio du PC et règle la banque ; l'extension montre le catalogue du Core et fait écouter un aperçu local.

## 1. Qui fait quoi

| Pièce                                              | Rôle                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Core `apps/core-api/src/sound-lab/`                | banque d'origine (`bank.ts`, 69 sons livrés avec l'extension), réglages (`sound_lab_sounds`), sons ajoutés dans Studio, achats, file, ACK |
| Fichiers publiés (`sound_files`, Postgres)         | extraits envoyés par Studio : WAV PCM 16 bits, identifiant = SHA-256 des octets, immuables                                                |
| Studio serveur `apps/studio/server/src/sound-lab/` | relais d'administration vers le Core, lecteur local (`sound-player/`), copie locale des fichiers publiés et des originaux                 |
| Studio web `pages/soundboard*.ts`                  | page Soundboard, éditeur « Ajouter un son / Modifier l'extrait » (`soundboard-editor.ts`, découpe pure dans `soundboard-cut.ts`)          |
| Extension `shared/soundboard-*.js`                 | catalogue du Core (session), favoris et récents (navigateur du viewer), aperçu local (`soundboard-preview.js`)                            |

## 2. Ajouter un son depuis Studio

Studio › Soundboard › **Ajouter un son** :

1. choisir (ou déposer) un fichier local : MP3, WAV, OGG, FLAC, M4A… (50 Mo et 15 min au plus) ;
2. forme d'onde et durée ; deux poignées (souris, flèches ± 10 ms, Maj ± 100 ms) ou les champs Début / Fin ;
3. **Écouter l'extrait** joue exactement le passage choisi ;
4. nom prérempli depuis le fichier ; prix par défaut **500 Jetons / 1 crédit** (le prix habituel d'un son court de la banque) ;
5. **Publier le son**.

**Modifier l'extrait** (pupitre d'un son) rouvre l'éditeur : nom, prix, nouveau passage ou nouveau fichier, **Supprimer**,
et pour un son de la banque recoupé, **Fichier d'origine**. Désactiver reste l'interrupteur « Proposé / Coupé ».

### 2.1 Découpe réelle

Studio décode le fichier (Web Audio, 44,1 kHz), garde les échantillons du passage choisi, ajoute un fondu de 4 ms aux
deux bouts (pas de clic), passe en mono si les deux canaux sont identiques, et encode un **WAV PCM 16 bits**. Le fichier
publié commence donc exactement au point choisi. Bornes : extrait de 0,1 à 20 s, 4 Mo au plus (20 s stéréo tiennent).

### 2.2 Stockage

- **Core** : table `sound_files` (Postgres, donc dans les sauvegardes du Core). Le Core revérifie tout (RIFF complet,
  chunks dans le fichier, PCM 16 bits, 1–2 canaux, 8–48 kHz, durée, taille) et calcule lui-même l'empreinte. Un fichier
  incomplet est refusé (`incomplete_file`), rien n'est publié.
- **Studio** (PC d'Antoni), à côté du journal du profil : `sound-files/<sha256>.wav` (copie, retéléchargée du Core et
  vérifiée si absente) et `sound-sources/` (originaux et position des poignées, pour recouper plus tard ; jamais envoyés).

### 2.3 Catalogue dynamique

`sound_lab_sounds` porte `file_id` (fichier publié), `added_at` (son ajouté dans Studio) et `deleted_at` (supprimé).
Le catalogue = la banque dans son ordre (avec son extrait recoupé s'il y en a un), puis les sons ajoutés, du plus ancien
au plus récent, jamais un son supprimé. L'extension le reçoit déjà du Core à chaque état : **un son publié apparaît
aussitôt** dans la Soundboard des viewers, sans nouveau ZIP. L'aléatoire tire aussi dans les sons ajoutés.

- `preview_url` / `sound_url` : `assets/sounds/<fichier>.mp3` (banque, dans le ZIP) ou `sound-files/<sha256>.wav` (Core).
- Lecteur Studio : `/ext/assets/…` ou `/sound-lab/files/<sha256>.wav` (copie locale) ; toute autre forme est refusée.
- Aperçu dans l'extension : `fetch` de `<EBS>/sound-files/<sha256>.wav` (Core `GET /v1/ext/sound-files/…`, public,
  immuable, CORS `*`) puis lecture en `blob:`. La CSP de Twitch l'autorise sans rien déclarer de plus : le Core est déjà
  dans « Allowlist for URL Fetching Domains » et `media-src` accepte `blob:`. Dans le Lab, Studio sert le même chemin.

### 2.4 Garanties

- Administration : routes Lab (`STUDIO_SECRET`) et cockpit de Production (installation Studio appairée) seulement :
  `sound/files` (seule route du cockpit à 6 Mo), `sound/sounds`, `sound/sounds/<id>`, `sound/sounds/<id>/delete`.
- Pas de doublon : un identifiant choisi une fois par fenêtre (double clic = même son), **un seul son vivant par extrait**
  (index unique partiel), même fichier = même empreinte, stocké une fois. Prouvé sur vrai Postgres (deux Core).
- Pas de double diffusion : achats inchangés (clé d'idempotence, verrou de chaîne, file du Core) ; un achat déjà accepté
  d'un son supprimé ou recoupé est joué avec le fichier de son achat.
- Sons existants conservés : la banque et ses réglages ne changent pas ; « Fichier d'origine » rend le MP3 livré.
- Supprimer : définitif depuis Studio (aussi pour un son de la banque) ; l'historique et le fichier restent.

## 3. Mise en service (rien n'est déployé)

1. **Core** : migration additive `20261205130000_sound_files.sql` (sauvegarde < 60 min, `--migrations-approved`).
   Retour arrière : redéployer le Core précédent ; il ignore les nouvelles colonnes (les sons ajoutés disparaissent du
   catalogue, la banque revient telle quelle).
2. **Studio** : nouvelle version (éditeur, cache, lecteur). Après le Core (un Core ancien refuse `sound/files` : l'éditeur
   le dit, rien n'est publié).
3. **Extension** : **un dernier ZIP** pour l'aperçu des sons ajoutés (`soundboard-preview.js`). Sans lui, un son ajouté
   s'affiche et s'achète déjà, seul son aperçu répond « Aperçu indisponible ». Ensuite plus de ZIP pour un son.
4. Bot : rien.

## 4. Reste (non bloquant)

- Fichiers publiés plus jamais utilisés : jamais effacés (quelques Mo par son) ; un ménage reste à écrire.
- WAV : 5 à 10 fois plus lourd qu'un MP3 (un aperçu de 3 s ≈ 260 Ko en mono). Un encodeur MP3 ou Opus serait une
  dépendance à ajouter.
- Route publique des fichiers sans limite de débit (comme les images de la Boutique) : immuable et en cache navigateur.
- Pas de zoom sur la forme d'onde : pour un long fichier, les champs Début / Fin donnent la précision.
- Un son de la banque supprimé ne se rétablit pas depuis Studio.
