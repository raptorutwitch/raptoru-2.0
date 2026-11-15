# Livraison du 15/11/2026 (soir) : finitions de Level Up V2

GO d'Antoni (« Dernières finitions Level Up V2 ») : corriger, tester, fusionner, déployer. Journal daté ; le
fonctionnement est dans [../LEVEL_UP_V2.md](../LEVEL_UP_V2.md) (§ 5 et § 13), l'état courant dans
[../REPRISE.md](../REPRISE.md).

## 1. Ce qui a changé

| Point                 | Avant                                                     | Maintenant                                                                                                                                            |
| --------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Annonce               | message normal `@Pseudo vient d'atteindre le niveau 25 !` | **vraie annonce Twitch** (Send Chat Announcement, bandeau coloré) : `🚀 LEVEL UP — Aouh [Loup-Garou] (57) · Calypso (23)`                             |
| Mention               | `@pseudo` (notifie le viewer)                             | pseudo sans @, un séparateur invisible (U+2060) après la première lettre : personne n'est notifié                                                     |
| Regroupement          | une ligne au plus toutes les 30 s                         | fenêtre de **5 min** ouverte par le premier Level Up, une annonce à sa fin ; 8 pseudos et 450 caractères au plus ; le reste une minute après          |
| Titre                 | absent                                                    | le titre **équipé** sur raptoru.fr, s'il est possédé, actif et publié (la règle des classements) ; rien sans titre                                    |
| Test Studio           | message `[TEST] …`                                        | vraie annonce `[TEST] 🚀 LEVEL UP — …`, confirmation tapée, titre du catalogue au choix                                                               |
| Pseudos du classement | 483 identifiants numériques                               | pseudo actuel demandé à Twitch par l'identifiant (démarrage du Core + 2 min, chaque jour, bouton Studio)                                              |
| Viewers avec son      | aucune vue                                                | Studio › Level Up › « Viewers avec son activé » (lecture seule)                                                                                       |
| Son                   | joué tout de suite, un par viewer                         | **un seul son par annonce, 3 s avant le bandeau** (réglable de 0 à 5 s), seulement si un viewer nommé l'a activé ; sinon l'annonce part tout de suite |

## 1 bis. Le son juste avant le bandeau (décision du 15/11)

Antoni a d'abord demandé un son synchronisé avec le bandeau, puis « légèrement AVANT, pour l'anticipation ». Livré :

- à la fin de la fenêtre, si au moins un viewer nommé a activé le son (sons de la chaîne allumés, dernier son il y a
  60 s au moins), l'annonce est mise en file **en attente de son son** ;
- la source OBS de Studio (elle demande toutes les 2 s) prend le son : il est joué **une fois**, et l'annonce est
  rendue disponible **3 s après** (réglage `level_up_sound_lead_s`, 0 à 5 s) — dans la même transaction, seulement si
  LeCroupier\_ ne l'a pas encore prise : **jamais un son après le bandeau** ;
- pas de source OBS dans les 3 s : l'annonce part sans son (« aucune source OBS à temps ») ;
- personne à l'écoute : l'annonce part tout de suite, sans attendre ;
- relance du bot, accusé rejoué, reconnexion de la source : le son n'est jamais rejoué ; pendant l'attente, les autres
  réponses du bot passent devant ;
- conséquence assumée de l'ordre choisi : si Twitch refuse ensuite le bandeau, le son a déjà été joué (l'échec est noté) ;
- le test Studio « Envoyer une vraie annonce test » prend exactement ce chemin et affiche l'heure du son et du bandeau ;
- stockage : `progression_announcements` (migration additive `20261127130000_level_up_announcements.sql`, une ligne par
  annonce), `progression_level_events.announcement_id`.

## 2. Cause des pseudos numériques

- Le classement affiche `display_name ?? login ?? identifiant` de l'annuaire du Core (`viewers`).
- **483 comptes sur 1 129 classés n'avaient aucune ligne dans l'annuaire** : des historiques WizeBot rattachés par
  l'identifiant exact que donne WizeBot, pour des viewers jamais revus depuis le 20/10. Personne ne les avait écrits dans
  l'annuaire (la présence, le chat, le Daily et le Wallet l'écrivent ; l'import WizeBot non).
- Les « anciens pseudos » : le chat et la connexion au site gardaient la première version d'un pseudo (`on conflict do
nothing`) ; la présence, elle, le mettait à jour.
- Correctif : le Core demande à Twitch (Helix Get Users, application Twitch du Core) le pseudo actuel de chaque compte
  par son identifiant ; le chat et la connexion au site écrivent désormais le pseudo du jour.
- Un identifiant que Twitch ne connaît plus (compte supprimé ou suspendu) garde son état : le classement montre le
  pseudo WizeBot **de ce même identifiant**, sinon le numéro. Jamais un pseudo rapproché par ressemblance, jamais un
  rattachement, aucune XP, aucun niveau, aucun badge changé.

## 3. Droit Twitch des annonces

`moderator:manage:announcements` est déjà dans le jeton de LeCroupier\_ :

- le bot de Production l'exige à son démarrage dès que la sortie chat est active ;
- 127 annonces `announce` réussies en Production avant cette livraison (Jeu des mots 107, Tombola 17, `!song` 2,
  mini-jeux 1).

Aucune autorisation nouvelle n'est nécessaire. Si Twitch refusait une annonce, le même texte part une fois en message
normal (comme `!song`).

## 4. Tests

- Core, suite Level Up V2 (PGlite et PostgreSQL réel) :
  - fenêtre, limites, titres, fusion, expiration, interrupteurs ;
  - concurrence tick + message, repli en message normal ;
  - liste des sons, pseudos Twitch.
- Core, son avant le bandeau :
  - rien avant la fin de la fenêtre, puis un son ;
  - le bandeau exactement 3 000 ms après, jamais avant ;
  - annonce silencieuse sans attente ;
  - pas de source OBS : son manqué, jamais après le bandeau ;
  - relance et accusé rejoué : pas de second son ;
  - réglage 0 / 5 s (6 refusé), délai entre sons, préférence importée ;
  - test Studio par le même chemin, sans XP ni événement.
- Migrations : ordre, comptes et retour arrière par l'en-tête (PostgreSQL réel).
- Bot : 296/296 (couleur transmise, couleur inconnue écartée).
- e2e Lab `progression-v2-level-up` (vrais navigateurs) :
  - rien au Level Up ;
  - en fin de fenêtre, un son sans rien à l'écran, puis l'annonce disponible 3 s après ;
  - le viewer dans « Viewers avec son activé » ;
  - annonce `[TEST]` réelle, son d'abord ;
  - aucune XP touchée.

## 5. Production

| Étape      | Résultat                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Fusions    | PR #73 → `d4b69252`, PR #74 → `main` = `d2fd5bb7` (CI des PR et de `main` vertes : quality, core, e2e, studio, bot, extension, images) |
| Sauvegarde | 14:02:53 UTC, `success`, 9 712 396 octets (et 13:00:36 UTC avant)                                                                      |
| Core       | **`d2fd5bb7`** (Coolify ~14:22 UTC, 105 s), migration `20261127130000_level_up_announcements.sql` appliquée, `/health` `/ready` OK     |
| Bot        | **`d2fd5bb7`** (~14:26 UTC, 141 s), bail tenu, EventSub bot et diffuseur actifs                                                        |
| Site       | inchangé (lit les pseudos du Core : corrigés d'office)                                                                                 |
| Studio     | **0.1.35** publiée par le workflow « Studio — construire / publier » (installation : Antoni)                                           |
| Extension  | inchangée (publication en attente de la ligne de validation d'Antoni)                                                                  |

- Le script de déploiement du Core a conclu « ÉCHEC » parce qu'il n'a pas trouvé la sortie du migrateur dans le
  journal Coolify. Vérification faite : la nouvelle table répond, le Core sert `d2fd5bb7` et il est sain. Aucun retour
  arrière n'était nécessaire.
- Réglages appliqués : fenêtre 300 s, texte `🚀 LEVEL UP — {liste}`, couleur de la chaîne, son 3 s avant le bandeau.
  Courbe, gains, normalisation et badges inchangés.
- Pseudos : 1 840 comptes vérifiés, 1 083 ajoutés, 132 mis à jour, 1 inconnu de Twitch. Classement : 1 129 viewers,
  0 identifiant numérique.
- Viewers avec son activé : 5, tous d'origine « ancienne extension ».
- Aucun message public envoyé par le déploiement ; l'annonce `[TEST]` réelle reste le geste d'Antoni.
- Retour arrière : `deploy core f04b41a2… --rollback --go`, `deploy bot 13969a8c… --rollback --go` (la migration
  reste, additive), puis la sauvegarde de 14:02 UTC en dernier recours.
