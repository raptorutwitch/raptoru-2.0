# Retournement de l'écran : incident de performances du 22/11 et comparaison des méthodes

22/11/2026, soir. Rien ici n'a été validé en jeu.

Statut : la bascule d'orientation par Windows est **expérimentale et coupée par défaut**. Le retournement par défaut
est de nouveau le calque sur la fenêtre du jeu.

## 1. L'incident

**Ce qui s'est passé :**

- Antoni jouait à Overwatch sur l'écran principal, OBS ouvert.
- Au même moment, mes contrôles automatiques retournaient l'écran secondaire (DISPLAY2) par Windows.
- **À chaque bascule d'orientation, Overwatch descendait à environ 17 images/s.** Le jeu devenait difficilement
  jouable.

**Ce que mes essais ont fait entre 16:03 et 16:50 :**

- environ 130 bascules d'orientation, par rafales :
  - une série « écran entier » = 12 bascules en 25 s ;
  - 7 séries seules, 3 séries complètes, 3 parcours de la page, des sondes ;
- à chaque série complète, environ une minute de calques sur la mire, sans bascule.

**Ma faute de méthode :**

- J'ai vérifié qu'OBS ne diffusait pas, mais pas qu'un jeu tournait. À 16:02, Overwatch n'était pas lancé, et je n'ai
  plus revérifié avant les séries suivantes.
- Corrigé : une garde refuse désormais tout essai visible si un jeu ou une application plein écran est actif (§ 7).

**Non mesuré :** la cadence d'Overwatch elle-même. Les 17 images/s sont l'observation d'Antoni, aucun relevé n'existe.

## 2. Ce que disent les mesures existantes

| Mesure (22/11, RTX 3070, Windows 11 26200)                    | Valeur                                         | Ce qu'elle montre                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Bascule d'orientation de DISPLAY2 (`ChangeDisplaySettingsEx`) | 117 à 143 ms                                   | l'écran change en un peu plus d'un dixième de seconde                                               |
| Retour (écran rétabli à l'œil)                                | 64 à 140 ms                                    | —                                                                                                   |
| Retour de l'appel à Windows                                   | jusqu'à environ 300 ms après le rétablissement | Windows prévient **toutes** les fenêtres ouvertes du changement d'affichage avant de rendre la main |
| Boucle du moteur pendant une bascule                          | jusqu'à 515 ms d'arrêt                         | le moteur attend Windows ; cela ne touche que son propre processus                                  |
| Coût GPU d'une passe de retournement (1080p, 1440p)           | 0,02 à 0,04 ms                                 | **le shader n'est pas en cause**                                                                    |
| Calque plein écran pendant une rotation animée                | environ 60 images/s, traitement 0,3 ms         | le calque se cale sur l'écran principal (60 Hz)                                                     |
| Carte graphique (OBS ouvert, sans jeu)                        | 13 % d'utilisation                             | aucune saturation                                                                                   |

Les mesures du moteur ne voient que le moteur. **Aucune ne dit ce que subit le jeu** : c'est le manque principal.

## 3. Causes plausibles, de la plus probable à la moins probable

1. **Le changement d'orientation reconfigure l'affichage de tout le PC.** C'est très probablement la cause
   principale.
   - L'orientation fait partie de la configuration d'affichage : la changer reprogramme la sortie vidéo.
   - DWM, le compositeur de Windows, réévalue alors tous les écrans : affichage direct des jeux (« independent
     flip »), plans de superposition, G-Sync.
   - Windows envoie `WM_DISPLAYCHANGE` à toutes les fenêtres, jeu compris, même sur l'autre écran. Beaucoup de jeux
     réagissent en relisant les écrans ou en recréant leur chaîne d'images, d'où un à-coup.
   - Cela colle avec les faits : « à chaque bascule », jeu sur **l'autre** écran, appel qui attend que tout le monde
     ait traité le message.
   - En rafale (12 bascules en 25 s), le jeu n'avait jamais le temps de se remettre.
2. **OBS**, contribution probable :
   - une capture d'écran se réinitialise à chaque changement d'affichage ;
   - une capture de jeu se raccroche si le jeu recrée sa chaîne d'images ;
   - OBS partage la carte graphique avec le jeu.
3. **Le pilote NVIDIA**, cause possible : la reprogrammation d'une sortie peut figer brièvement les autres.
4. **Le calque et la capture du moteur**, peu probables comme cause des chutes aux bascules.
   - Sur l'écran entier, la capture à 144 Hz et le calque exclu des captures obligent DWM à composer cet écran deux
     fois.
   - Ce serait un coût constant, pas des chutes alignées sur les bascules. À mesurer quand même (§ 6).
5. **Le calcul GPU du moteur** : non. 0,02 à 0,04 ms par image, et ses arrêts de boucle restent dans son processus.

## 4. Les méthodes comparées

| Méthode                                                         | Curseur et clics                                                                                       | Changement d'affichage | Effet attendu sur le jeu                                                                                                                               | OBS (capture d'écran)                              | Statut                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ----------------------- |
| **Calque sur la fenêtre du jeu**                                | vrai curseur, non retourné : le clic tombe au point symétrique de ce que l'on voit                     | aucun                  | pendant l'effet, DWM compose le jeu avec le calque : perte probable de l'affichage direct et de G-Sync (une image de latence au pire) ; aucune bascule | voit l'effet                                       | **par défaut**          |
| Calque sur l'écran entier                                       | idem                                                                                                   | aucun                  | idem, plus une double composition de l'écran (calque exclu des captures)                                                                               | **ne voit pas** le calque                          | diagnostic              |
| **Windows (orientation)**                                       | vrai curseur unique, souris inversée, clic juste                                                       | **deux par effet**     | à-coups à chaque bascule, pour **tous** les jeux et écrans (observé : 17 images/s) ; pendant l'effet, DWM compose l'écran retourné                     | probablement l'écran retourné, sans les animations | **expérimental, coupé** |
| **Calque + curseur affiché par le calque** (candidat, non codé) | l'image du vrai curseur, à sa vraie position, retournée avec l'écran : clic juste, mouvements inversés | aucun                  | comme le calque ; plus 1 à 2 images de retard du curseur affiché                                                                                       | voit l'effet et le curseur retourné                | à décider (§ 5)         |

## 5. Éviter le changement d'affichage : pistes étudiées

| Piste                                             | Verdict                                                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retourner sans reconfigurer l'affichage           | impossible : l'orientation fait partie de la configuration d'affichage. L'autre interface de Windows (`SetDisplayConfig`) reconfigure aussi ; moins brutale ? non mesuré, peu probable |
| Loupe de Windows (`MagSetFullscreenTransform`)    | agrandissement et décalage seulement, aucune rotation : écarté                                                                                                                         |
| Intercepter puis réinjecter la souris             | interdit (anti-triche) et ne corrige pas les clics : écarté                                                                                                                            |
| Pilote d'écran virtuel                            | installer un pilote et déplacer le jeu : écarté                                                                                                                                        |
| Écran retourné en permanence, compensé hors effet | tout serait doublé en permanence, curseur compris : écarté                                                                                                                             |
| **Calque + curseur affiché par le calque**        | **candidat retenu**, détail ci-dessous                                                                                                                                                 |

**Candidat : calque + curseur affiché par le calque.**

1. La capture Windows sait inclure le curseur (`IsCursorCaptureEnabled = true`). Le calque l'affiche alors retourné
   avec l'image, exactement au-dessus de ce que le clic touchera. Les mouvements paraissent inversés, comme demandé.
2. Pendant l'effet, le curseur matériel doit être masqué. L'API Loupe de Windows le prévoit pour les loupes qui
   dessinent leur propre curseur (`MagShowSystemCursor`) : c'est documenté, sans crochet et sans injection.
3. Aucun changement d'affichage : pas d'à-coup aux bascules, pour aucun jeu.

**Questions à vérifier par un court essai, avec ton accord et sans jeu lancé :**

- La capture dessine-t-elle encore le curseur quand il est masqué ? Sinon, le calque dessine lui-même la forme du
  curseur, lue dans Windows.
- Le curseur revient-il si le moteur plante ? Sinon, le gardien le rétablit ; au pire, il revient à la fermeture de
  session.
- Le retard de 1 à 2 images du curseur affiché se sent-il ?
- Pendant l'effet, le curseur serait masqué aussi sur l'autre écran.

**Le compromis à trancher :** le curseur visible serait dessiné par Chaos, avec la forme et la position du vrai
curseur, mais ce ne serait plus le curseur matériel. Ta spécification disait « le vrai curseur système ». **C'est ta
décision.**

## 6. Mesurer ce que subit le jeu

- **Événement daté** : `engine.input` (`applied`, `restored`, `lost`), avec l'instant exact de chaque bascule
  (compteur haute précision de Windows) et la durée de l'appel.
- **Banc** `chaos-bench.exe` (refait le 23/11 : scénarios A à F, temps GPU par processus, deux versions comparées,
  vrai jeu avec `--game` ; voir [PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md) § 6 et § 9). Description d'origine :
  - un « jeu témoin » (fenêtre Direct3D plein écran, 240 images/s visées) note l'instant de chaque image ;
  - le banc déclenche chaque méthode : base, calque, écran, windows ;
  - pour chaque phase (avant, entrée, pendant, sortie, après), il donne : images/s, médiane, p99, pire image,
    à-coups (plus de 3 × la médiane et plus de 20 ms) et pire cadence sur 250 ms ;
  - `--probe-screen other` reproduit l'incident (témoin sur l'autre écran) ;
  - sortie à l'écran et en JSON.
- **PresentMon sur le vrai jeu**, en option du banc : `--presentmon <PresentMon.exe> --process Overwatch.exe`.
  - Il donne la cadence réelle et le **mode de présentation** du jeu : affichage direct ou composé, ce qui dit si un
    effet fait perdre l'affichage direct au jeu.
  - PresentMon n'est pas installé ici. Il demande probablement les droits administrateur ou l'appartenance au groupe
    « Utilisateurs du journal de performances » : à vérifier.
  - La lecture de son relevé est testée ; l'enchaînement complet ne l'est pas.

**Protocole proposé** (avec ton accord, aucun autre jeu lancé, hors direct) :

1. `chaos-bench.exe` : témoin et effet sur l'écran secondaire, les 4 méthodes (environ 1 minute).
2. `chaos-bench.exe --probe-screen other` : le témoin sur l'écran principal (scénario de l'incident).
3. Overwatch dans le champ de tir, avec PresentMon : calque puis Windows, deux effets chacun.

## 7. Ce qui a changé dans le code

- **Garde de jeu** (`N.GameActivity`, `ChaosEngine.exe --game-check`). Contrôles, parcours de la page et banc refusent
  tout essai visible si :
  - un jeu connu tourne ;
  - une application est au premier plan en plein écran ;
  - une fenêtre couvre un écran entier.
    Elle est revérifiée avant chaque rotation. Seule l'option `--autorise-pendant-un-jeu` la lève, sur ton accord. Les
    essais non lancés sont signalés (code de sortie 2).
- **Windows devient expérimental** (configuration v4) :
  - `engine.input_effects` est coupé par défaut ;
  - la cible par défaut revient à la fenêtre (`default_mode` = `window`) ;
  - Studio propose « Calque » ou « Windows (expérimental) », avec l'avertissement de l'incident.
- **Diagnostic** :
  - l'événement `engine.input` ;
  - le journal de la page affiche les bascules ;
  - le banc et PresentMon (§ 6).
- **Outillage** : `npm run chaos:lab` recompile le moteur avant de démarrer, pour ne jamais tourner avec un moteur
  périmé.

## 8. Ce qu'il faut décider

Aucune méthode ne réunit aujourd'hui les quatre exigences :

- performances du jeu préservées ;
- curseur matériel ;
- clics justes ;
- souris inversée.

| Option                                                     | Ce qu'on gagne                                                     | Ce qu'on cède                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **A. Calque + curseur affiché par le calque** (recommandé) | aucune bascule ; clics justes ; souris inversée ; OBS voit l'effet | le curseur visible est dessiné par Chaos (1 à 2 images de retard) |
| B. Windows (orientation)                                   | le curseur matériel, la cohérence parfaite                         | deux à-coups par effet pour tout le PC (observé : 17 images/s)    |
| C. Calque seul (état actuel par défaut)                    | aucune bascule, le curseur matériel                                | clics au point symétrique, souris non inversée                    |

Recommandation : **A**. Si tu acceptes le curseur affiché par Chaos :

1. un court essai, avec ton accord, pour lever les questions du § 5 ;
2. le prototype ;
3. le banc pour comparer A, B et C avec des chiffres ;
4. ta décision en jeu.
