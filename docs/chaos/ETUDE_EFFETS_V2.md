# Chaos V2 — bibliothèque d'effets (étude, choix, état)

Mandat du 24/11 (« grand mandat nocturne »). Douze effets ajoutés au moteur Chaos V2 (C#, Direct3D 11, Windows
Graphics Capture, DirectComposition), contrôlés depuis Studio › Chaos. Ce document dit, pour chaque effet, ce qui est
recherché, la technique retenue, ce qu'elle coûte et ce qui reste à vérifier. Les études OBS sont à part :
[ETUDE_OBS_WASTED.md](ETUDE_OBS_WASTED.md) et [ETUDE_OBS_REPLAY.md](ETUDE_OBS_REPLAY.md).

Vocabulaire des statuts :

- **développé** : code, registre, fiche Studio, tests automatiques ;
- **vérifié hors écran** : rendu réel examiné image par image (planches `--render-effects`, bandes `--strip`) ;
- **non vu en vrai** : aucun effet n'a encore été affiché sur un écran réel ni pendant un jeu. La garde de jeu a vu
  une application plein écran au premier plan toute la nuit.
- **validé** : seulement après l'essai d'Antoni.

## 0. État par effet

| Effet             | Statut                                   | Technique                                                        | Capture       | Variantes (préréglages)                                                                     | Limites connues                                                                     |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Miroir            | développé, vérifié hors écran            | transformation affine (retournement de carte), demi-tour         | oui           | gauche ↔ droite, haut ↔ bas, alternance, instantané                                         | carte qui passe par une ligne noire à mi-animation (≈ 60 ms)                        |
| Tremblement       | développé, vérifié hors écran            | « trauma » + bruit de gradient continu, surcadrage dosé          | oui           | léger, secousse, impact, par rafales, séisme, vibration                                     | fluidité à juger en mouvement réel (planches = images fixes)                        |
| Zoom chaotique    | développé, vérifié hors écran            | transformation affine, échelle logarithmique, Catmull-Rom ≥ ×1,8 | oui           | progressif, brutal, zoom et dézoom, pulsations, intermittent, très gros zoom                | au-delà de ×6, le jeu est volontairement illisible (pixels du jeu agrandis)         |
| Écran ivre        | développé, vérifié hors écran            | transformation lente + déformation, double vision, flou mip      | oui           | pompette, ivre, ivre mort, vertige                                                          | 2 passes ; sensation à juger en vrai (mal des transports)                           |
| Vision tunnel     | développé, vérifié hors écran            | zoom vers un point + masque à distance signée (calque)           | oui           | focus doux, marqué, extrême, zoom dramatique, cinéma, regard qui dérive                     | le curseur suit le zoom, pas le masque                                              |
| Clignement        | développé, vérifié hors écran            | calque shader « paupières » (amande vue de l'intérieur)          | **non**       | naturel, rapide, lent, yeux fermés, plusieurs, fatigue, paupières qui résistent, irrégulier | n'assombrit pas un jeu en plein écran exclusif (aucun calque ne le peut)            |
| Flash aveuglant   | développé, vérifié hors écran            | une image retenue + calque blanc et image fantôme                | **une image** | court, intense, récupération longue                                                         | départ après la 1ʳᵉ image capturée (≈ 50 à 150 ms) ; délai de 4 s entre deux flashs |
| Brouillard        | développé, vérifié hors écran (voir § 3) | calque shader : 2 nappes de fBm déformé + voile, ½ résolution    | **non**       | brume, dense, très opaque, bancs mouvants, arrive peu à peu, se dissipe                     | **à juger en mouvement** avant d'être déclaré réussi (exigence du mandat)           |
| Flou              | développé, vérifié hors écran            | pyramide de mipmaps + lecture B-spline, niveau continu           | oui           | léger, moyen, intense, extrême, pulsé, progressif                                           | flou « de mipmaps » : très fort, il peut légèrement onduler sur un jeu qui bouge    |
| Pixelisation      | développée, vérifiée hors écran          | blocs ancrés au centre, moyenne par mip, tailles entières        | oui           | légère, forte, très gros blocs, progressive, intermittente, rétro                           | —                                                                                   |
| Filtre de couleur | développé, vérifié hors écran            | une passe : luminance en lumière linéaire, modes                 | oui           | noir et blanc, film noir, sépia, inversion (balayage), délavé, saturé, monochrome rouge     | —                                                                                   |
| VHS / glitch      | développé, vérifié hors écran            | une passe : défauts de signal un par un (YIQ, tracking, têtes)   | oui           | légère, abîmée, tracking instable, glitch bref, glitch violent                              | rendu à juger en mouvement (les défauts sont temporels)                             |

Coûts GPU : **non mesurés en 1440p** cette nuit (garde de jeu active). Banc prêt : `ChaosEngine.exe --bench-effects`
(§ 5). Estimations par nombre de lectures de texture dans le § 2.

## 1. Architecture : un moteur, plusieurs familles

Rien n'a été refondu. Les primitives existantes (`Transform`, `Filter`, calques) ont été prolongées là où un effet en
avait besoin :

| Primitive (FrameBuilder)                | Nouveau                                                                                                                                                                                               | Pour                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `Transform(rot, sx, sy, tx, ty, fill)`  | chaîne de transformations : le curseur dessiné suit leur **composition** (zoom puis secousse, miroir puis demi-tour) ; image du curseur retournée par un miroir ; lecture Catmull-Rom au-delà de ×1,8 | miroir, tremblement, zoom, ivre, tunnel |
| `Filter(shader, u[32], mips, lod, aux)` | 32 constantes (u0..u7) ; seconde texture `aux`                                                                                                                                                        | flou, pixelisation, couleur, VHS, ivre  |
| `Overlay(shader, u, scale, aux, …)`     | **calque shader plein écran sans capture**, en alpha prémultiplié, éventuellement en résolution réduite puis agrandi                                                                                  | paupières, brouillard, masque du tunnel |
| `Retain(RetainedImage)`                 | **image retenue** : copie de l'entrée et de ses mipmaps, une fois ; l'effet rend ensuite la capture (`NeedsCapture = false`) et la fenêtre redevient transparente                                     | flash                                   |

Registre (`packages/schemas/src/chaos-registry.json`, version 3) :

- nouvel emplacement **`camera`** (2 effets à la fois : zoom, tunnel, tremblement, ivre), entre `transform` (1 : flip,
  miroir) et `filter` (3) ; `overlay` (4) inchangé ;
- `order` par effet : la chaîne est zoom (14) → tunnel (15) → ivre (16) → tremblement (18) → filtres → calques ;
- `capture: "snapshot"` (flash), `cooldown_ms` (délai minimal entre deux activations sur une cible, appliqué par
  l'ordonnanceur), `photosensitive` (refusé en mode sûr) ;
- variantes = préréglages complets (paramètres, et facultativement durée et transitions), vérifiées au démarrage comme
  une demande (bornes, durées) ;
- paramètres : `advanced` (repliés dans Studio), `step`, `widget: point` (point visé) ;
- `viewer` : préparation de la boutique (§ 4).

**Superpositions.** Elles suivent l'ordre ci-dessus. Les combinaisons cohérentes marchent, par exemple brouillard +
noir et blanc, tremblement + pixelisation, zoom + vision tunnel, flou + VHS. Les incompatibilités sont tranchées par les
emplacements, sans code :

- deux orientations (flip et miroir) passent l'une après l'autre (file) ;
- au-delà de 2 effets de caméra ou de 3 filtres sur une cible, les suivants attendent ;
- un même effet ne joue qu'une fois par cible.

Les calques sont dessinés après toutes les passes. Le brouillard et les paupières ne sont donc ni floutés ni
pixelisés, ce qui est voulu. Le budget de passes du profil de performances (`max_passes`) retire l'effet qui le
dépasserait, avec un refus explicite (`too_costly`), jamais une image cassée.

**Ce qui ne coûte rien au repos.** C'est inchangé : aucune fenêtre, aucune capture, aucun rendu sans effet. Les effets
sans capture (clignement, brouillard) n'ouvrent jamais de capture. Le jeu se voit directement sous la fenêtre
transparente, sans latence ajoutée.

## 2. Effet par effet

### A. Tremblement

- **Recherché** : une secousse de caméra crédible, pas un clignotement spatial.
- **Technique** : modèle « trauma » de S. Eiserloh (GDC 2016) :
  - une force 0..1 dont le carré donne l'amplitude, pour que la fin s'éteigne en douceur ;
  - x, y et le roulis lus dans un bruit de gradient 1D continu au temps × fréquence, décorrélés ;
  - plus une composante basse fréquence (grondement).
- **Régularité** : de 0 (sinus pur, vibration mécanique) à 1 (bruit, secousse).
- **Modes** :
  - continu ;
  - impact (frappe immédiate, puis décroissance exponentielle) ;
  - par rafales (impulsions tirées de la graine) ;
  - séisme (monte, gronde, s'apaise).
- **Bords** : léger surcadrage, calculé à chaque image sur l'amplitude possible en cours (il suit la force, donc ne
  « pompe » pas), ou prolongement flou, ou bord étiré.
- **Coût** : 1 passe, 1 lecture par pixel.
- **Transitions** : entrée 150 ms, sortie 600 ms (la secousse s'éteint).

### B. Zoom chaotique

- **Technique** : facteur interpolé en échelle logarithmique, pour qu'un zoom de ×1 à ×8 paraisse aller à vitesse
  constante.
- **Cadrage** : vers un point choisi (`Fx.ZoomFrame`). Le recentrage va de 0 (le point reste à sa place) à 1 (il vient
  au centre). La fenêtre de lecture est toujours bornée dans l'image : aucun bord découvert (test unitaire sur 3 000
  cadrages).
- **Échantillonnage** : un agrandissement n'a pas de scintillement (c'est la réduction qui en produit). Il devient
  flou au-delà de ×2 : lecture **Catmull-Rom à 9 lectures** à partir de ×1,8, plus nette que le bilinéaire, au coût de
  9 lectures au lieu d'une.
- **Modes** :
  - progressif (aux vitesses des transitions) ;
  - brutal (coup de zoom en 90 ms puis rebond amorti) ;
  - pulsations (nombre, montée, maintien, retour, variation contrôlée du moment et de la force).

### C. Miroir

- **Rendu** : `Transform` avec une échelle négative.
- **Entrée et sortie** : retournement de carte, l'échelle passe par zéro sur fond sombre.
- **Alternance** : passe d'un axe à l'autre par un **demi-tour**. Un miroir horizontal est un demi-tour du miroir
  vertical : l'image n'est jamais écrasée, et la vitesse reste sous le plafond de 520°/s.
- **Curseur** : un seul, son image retournée avec l'image. Les entrées de Windows ne changent pas.

### D. Clignement des paupières

- **Ancien (V1)** : deux bandes droites en dégradé CSS (`overlay.js:155`, Halloween). Bonnes courbes de temps
  (fermeture qui accélère, ouverture rapide au départ, durées variées), mais aucune forme de paupière.
- **Forme** : vue de l'intérieur, l'ouverture de l'œil est une **amande**, deux arcs qui se rejoignent aux coins.
  - Grand ouverte, elle déborde largement de l'écran ; elle se resserre en se fermant, et la courbure des paupières
    apparaît à mesure qu'elles entrent dans le champ.
  - La paupière haute fait l'essentiel du trajet ; la basse remonte un peu, et plus tard.
- **Bord** : très flou (la paupière est hors de la mise au point) et irrégulier (cils : bruit étiré verticalement,
  atténué quand l'œil est presque clos).
- **Lumière** :
  - fermées, les paupières laissent passer une lueur chaude réglable (teinte brun-rouge) ;
  - l'image s'assombrit vers les bords à mesure que l'œil se ferme.
- **Motif** : précalculé au départ à partir de la graine de l'activation, chaque déclenchement est donc un peu
  différent, dans les bornes réglées. Comportements :
  - naturel (parfois doublé) ;
  - série ;
  - yeux fermés ;
  - somnolence : paupières lourdes qui tombent, clignements lents, deux micro-sommeils avec réveil en sursaut ;
  - paupières qui résistent : ouvertures partielles lentes, tremblement d'effort, retombées, réussite à la fin.
- **Coût** : calque sans capture, environ 12 opérations de bruit par pixel. Rien n'est dessiné les yeux ouverts : une
  image identique n'est ni redessinée ni présentée.
- **Sortie** : un arrêt les yeux fermés rouvre les yeux en 260 ms.

### E. Flash aveuglant avec rémanence

- **Image retenue** : à la 1ʳᵉ image, le moteur copie ce que la cible affiche (entrée de la chaîne, ou sortie des
  passes si un autre effet transforme l'image), avec ses mipmaps. **Puis la capture est rendue** : le jeu se voit de
  nouveau directement.
- **Séquence** :
  1. montée rapide (60 ms) ;
  2. blanc tenu (aveuglement) : pas un aplat, un peu plus intense au centre ;
  3. récupération : le blanc se retire en découvrant l'image fantôme de l'instant, imprimée par-dessus le jeu
     (mélange proche d'un « écran » : les zones claires restent) ;
  4. l'image fantôme se délave, se floute de plus en plus et s'efface plus lentement que le blanc.
- **Sécurité visuelle** :
  - une seule montée de luminance par flash ;
  - intensité plafonnée à 1 ;
  - **4 s au moins** entre deux flashs sur une cible : l'ordonnanceur met le suivant en file, ou le refuse ;
  - `on_conflict: reject` : un flash pendant un flash est refusé ;
  - refus en mode sûr.
  - Référence : WCAG 2.3.1, pas plus de 3 flashs par seconde. Ici, au plus 1 toutes les 4 s.

### F. Écran ivre

- **Pas un tremblement** : aucune fréquence au-delà de 0,6 Hz, même à la vitesse maximale.
- **Passe 1, transformation lente** :
  - balancement (sinus lent + bruit) ;
  - dérive ;
  - respiration du zoom ;
  - surcadrage.
- **Passe 2, déformation continue** :
  - ondulation par bruit de gradient (deux octaves) ;
  - double vision qui converge et diverge (composant interne, pas un effet du catalogue) ;
  - léger flou de mipmaps ;
  - bords assombris.
- **Progression** : l'ivresse peut monter de sobre à pleine au fil de l'effet.

### G. Brouillard dynamique

- **Pourquoi le V1 donnait des « taches »** : `.fx-fog` (`overlay.css:77`) était quelques `radial-gradient`
  elliptiques **fixes**, dont seule l'opacité changeait :
  - aucune structure multi-échelle, aucune évolution des formes ;
  - un contraste réduit uniformément ;
  - donc des taches pâles posées sur l'écran.
- **V2, deux nappes à des profondeurs différentes, plus un voile uniforme** :
  - la nappe lointaine a des structures plus fines, bouge plus lentement et paraît plus claire (perspective
    atmosphérique) ;
  - la nappe proche a de grandes volutes, bouge plus vite et paraît plus dense.
- **Formes de chaque nappe** :
  - un **fBm** (somme fractale de bruit de gradient, octaves tournées) **déformé par un autre fBm** (« domain warping »,
    I. Quilez) ;
  - le champ de déformation dérive lui-même : les formes se tordent et évoluent au lieu de glisser ;
  - le bruit n'est pas périodique : rien ne se répète.
- **Relief** : la nappe proche est éclairée par le haut, d'après l'écart de densité vers la lumière.
- **Variations de densité** :
  - bancs : variation très lente de la densité d'un endroit à l'autre ;
  - plus dense en bas (brouillard au sol).
- **Arrivée et départ** :
  - arrivée par un front irrégulier venu du côté d'où souffle le vent ;
  - dissipation : le seuil monte, la nappe se défait en filaments, puis s'efface.
- **Modes** : stable, s'épaissit pendant tout l'effet, bancs qui passent, se dissipe.
- **Coût** : environ 30 bruits de gradient par pixel, calculés en **½ résolution** (¼ des pixels), puis agrandis : le
  brouillard est doux, la perte ne se voit pas. Qualité « économie » (⅓) et « haute » (¾) dans les réglages avancés ;
  le palier 1 de surcharge passe à ⅓.
- **Verdict honnête** :
  - images fixes : la brume dense et le brouillard très opaque montrent de vraies nappes en volutes au sol et un
    effacement crédible de la ville ;
  - la brume légère reste discrète, et le haut de l'écran tend vers un voile uniforme ;
  - le critère du mandat (« pas de taches, pas de répétition, des nappes qui bougent ») **ne peut se juger qu'en
    mouvement**. L'effet est développé et intégré, mais **à confirmer par Antoni** ; s'il ressemble encore à des
    taches en vrai, il repasse en expérimental.

### H. Vision tunnel / focus cinématique

- **Zoom** : même cadrage que le zoom (point visé, recentrage).
- **Masque** : calque à **distance signée** autour de la position du point **après** le zoom. Formes : cercle,
  ellipse ou rectangle arrondi, avec allongement réglable.
- **Contour** : très doux (lissage + queue exponentielle), ombre intérieure légère, couleur du voile réglable.
- **Entrée** : le champ se referme depuis l'extérieur de l'écran pendant que le zoom avance.
- **Modes** : fixe, se rétrécit, regard qui dérive (bruit lent).
- **Ergonomie** : le point visé se choisit d'un clic dans un écran miniature de la fiche, ou aux flèches. Les
  coordonnées sont relatives (0..1), donc valables à toutes les résolutions.
- **Pistes non retenues cette nuit** :
  - choisir le point sur l'écran réel : il faudrait un calque cliquable, donc qui intercepte la souris, ce qui est
    contraire aux règles des entrées ;
  - une miniature capturée du vrai écran : une capture ponctuelle est possible (même mécanisme que le flash), à faire
    si l'écran miniature ne suffit pas.

### I. Flou progressif

- **Comparaison** :

  | Méthode                             | Coût                                        | Rayon continu (animable)         | Qualité                                                         |
  | ----------------------------------- | ------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
  | Gaussien séparable plein écran      | 2 passes, ∝ rayon (60+ lectures à r = 30)   | oui                              | référence                                                       |
  | Dual Kawase (Bjørge, SIGGRAPH 2015) | 2 × log₂(r) passes réduites                 | non : le nombre de passes change | excellente                                                      |
  | Mipmaps + bilinéaire                | 1 passe, 1 lecture                          | oui                              | blocs visibles                                                  |
  | **Mipmaps + B-spline (retenu)**     | mipmaps (1 par image) + 1 passe, 8 lectures | **oui**                          | lisse, sans blocs ; ondule un peu en mouvement à très fort flou |

- **Retenu** : la méthode B-spline. Un niveau de flou fractionnaire passe en fondu entre deux niveaux voisins, et le
  coût reste constant de 1 à 300 px.
- **Échelle** : l'intensité 0..100 est un niveau de 1080p corrigé pour la résolution réelle.
- **Si l'ondulation se voit en vrai** : remplacer la génération des mipmaps de Direct3D par un sous-échantillonnage à
  13 lectures (Jimenez, Call of Duty AW, SIGGRAPH 2014). Plus de passes, mêmes paramètres.

### J. Pixelisation

- **Blocs** : carrés, ancrés au centre de l'écran (une taille qui change grandit depuis le centre).
- **Couleur** : moyenne du bloc par 4 lectures au niveau de mip de la demi-taille.
- **Tailles** : **entières**, sans flou entre deux tailles, géométriques pendant les transitions.
- **Rétro** : grille et palette réduite (4 à 8 niveaux).
- **Coût** : distinct du flou dans Studio, mais il partage la même pyramide de mipmaps de la capture.

### K. VHS / glitch

- **Signal** : défauts reproduits un par un, chacun à sa propre échelle de temps :
  - base de temps instable : gigue ligne à ligne et ondulation lente ;
  - bande de tracking qui roule, avec déchirure et parasites ;
  - commutation des têtes en bas de l'image ;
  - chrominance de faible bande passante : floue et retardée, en espace YIQ (NTSC) ;
  - grain ;
  - pertes de bande : courts traits blancs ;
  - noirs relevés, blancs adoucis, barre de ronflement lente.
- **Glitchs** : rafales courtes (blocs de lignes décalés, couleurs séparées : l'aberration chromatique n'est ici qu'un
  composant interne). Leurs instants et leur force sont tirés de la graine : imprévisibles d'une fois à l'autre, mais à
  la fréquence et à la force réglées.

### L. Filtres de couleur

- **Noir et blanc**, priorité du mandat : luminance Rec. 709 calculée **en lumière linéaire**, puis réencodée. Les verts
  ne sont pas assombris ni les bleus éclaircis comme avec une moyenne sur les valeurs sRGB.
- **Autres modes** :
  - sépia (dégradé brun → crème) ;
  - inversion, qui entre par un **balayage diagonal** : un fondu passerait par un gris uni ;
  - délavé ;
  - saturé ;
  - monochrome teinté.
- **Réglages** : contraste ; force animée par les transitions.

## 3. Méthode de vérification visuelle (sans rien afficher)

- **Planches** : `ChaosEngine.exe --render-effects <dossier>` produit une planche par effet, une ligne par variante,
  une colonne par instant (entrée, maintien, sortie).
  - La chaîne est réelle (registre, effets, FrameBuilder, shaders), appliquée à une **scène de jeu de synthèse qui
    panoramique** (ville, sol en perspective, personnage, interface).
  - Le panoramique est indispensable pour l'image fantôme du flash : sur une image fixe, elle se confond avec le
    direct.
- **Bandes** : `--strip <dossier> <effet> <variante> <t0> <t1> <n>` donne l'évolution image par image (un clignement
  de 0,15 à 0,65 s, un flash de 0 à 6,5 s). Avec n = 1, l'image est en pleine taille.
- **Corrections apportées après examen** :

  | Effet      | Défaut vu                                      | Correction                                 |
  | ---------- | ---------------------------------------------- | ------------------------------------------ |
  | Brouillard | densité comptée deux fois (brume invisible)    | densité appliquée une seule fois           |
  | Brouillard | volutes « marbrées »                           | déformation réduite                        |
  | Brouillard | sortie trop brusque                            | dissipation progressive                    |
  | Brouillard | front venu du mauvais côté                     | front corrigé                              |
  | Paupières  | paupières lourdes réduites à des coins sombres | amande qui se resserre en se fermant       |
  | Paupières  | cils en « peigne » à presque clos              | cils atténués quand l'œil est presque clos |
  | Zoom       | flou à ×6                                      | lecture Catmull-Rom                        |
  | Inversion  | passage par un gris uni                        | balayage diagonal                          |
  | Impact     | montée de 150 ms qui retardait le choc         | frappe immédiate                           |
  | Flash      | blanc plat                                     | blanc un peu plus intense au centre        |

## 4. Préparation de l'achat par les viewers (rien n'est en boutique)

Chaque effet public porte un bloc `viewer` dans le registre :

- `durations_ms` : durées proposées (5, 10, 20, 30 s ; flash : 3, 6, 9 s) ;
- `tiers` : paliers proposés, chacun **une variante** (ex. tremblement : léger, secousse, séisme) ;
- `preview` : la variante qui sert d'aperçu ;
- `intensity_affects_price` : faux pour un choix purement esthétique (miroir, clignement, couleur).

Les **prix ne sont pas dans le registre** : le Core les fixera (coefficients par durée et par palier), côté serveur.
Le client Twitch n'envoie qu'un effet, une variante et une durée de la liste. Le moteur revalide tout de toute façon :

- bornes de chaque paramètre ;
- paramètres non exposés refusés à une source communautaire ;
- durée maximale ;
- 4 effets au plus en même temps (sécurité) ;
- emplacements et file ;
- délais entre activations ;
- mode sûr ;
- effet désactivé dans sa fiche.

**Aperçus.** `--preview-anim` rend l'effet **avec le même code** et les mêmes réglages : l'aperçu ne peut pas
promettre autre chose que ce que l'effet fera.

- Format : une grille JPEG de 320×180 à 15 i/s, le début (3,2 s) puis la dernière seconde.
- Studio l'utilise déjà dans chaque fiche (processus court et séparé, hors écran, mis en cache).
- Pour l'extension, la même commande pourra produire les aperçus de chaque palier une fois pour toutes. Une image par
  palier et par version du registre suffit, rien n'est rendu à la demande d'un viewer.

**Variété.** Chaque activation a sa graine (empreinte de son identifiant) : clignements, rafales, glitchs, dérive du
tunnel et formes du brouillard diffèrent d'une fois à l'autre. L'aléatoire reste borné : dix secondes de brouillard
dense restent dix secondes de brouillard dense.

## 5. Performances

- **Principes respectés** :
  - aucune capture pour le clignement et le brouillard ;
  - une seule image capturée pour le flash ;
  - une passe par effet, sauf l'écran ivre (2) ;
  - aucune allocation par image dans les effets (tableaux réutilisés) ;
  - cibles intermédiaires du pool, rendues au repos ;
  - shaders compilés au démarrage du moteur et gardés sur disque ;
  - le brouillard en ½ résolution ;
  - une image identique n'est ni redessinée ni présentée (paupières ouvertes, effet figé).
- **Estimations, non mesurées** (lectures de texture par pixel) :
  - couleur : 1 ;
  - zoom ×2 : 1 (9 au-delà de ×1,8) ;
  - tremblement et miroir : 1 ;
  - pixelisation : 4 ;
  - flou : 8 + mipmaps ;
  - VHS : ≈ 12 + mipmaps ;
  - ivre : 2 passes, 2 lectures ;
  - tunnel : 1 + masque sans lecture ;
  - paupières et brouillard : calcul seul, brouillard sur ¼ des pixels.
- **Mesure** : `ChaosEngine.exe --bench-effects [--w 2560 --h 1440 --frames 300]` donne le temps GPU par passe de
  chaque effet, sur une image fixe de la taille donnée. **Non lancé cette nuit** : la garde de jeu a vu une
  application plein écran toute la nuit, et un banc charge le GPU. À lancer jeu fermé ; résultats à reporter ici et
  dans [PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md).
- **Aucune mesure en jeu.** L'impact sur Overwatch reste à mesurer, effet par effet, avec le banc A–F existant.

## 6. Tests

- Unitaires du moteur : **33/33** (+6), qui couvrent :
  - catalogue : variantes, paliers viewers, aperçu, STOP ALL, curseur, flash ;
  - variantes : durée et transitions, ordre variante / préréglage / demande ;
  - registre invalide refusé : variante hors bornes, capture inconnue, délai négatif ;
  - délai entre flashs (file ou refus) ;
  - bruit continu sans saut ;
  - cadrage du zoom jamais découvert.
- Studio, API Chaos : **13/13**, dont le vrai moteur. L'aperçu est rendu, mis en cache, refusé hors bornes, et un
  effet interne est refusé.
- Parcours de la page sans affichage : **24/24**, dans un Lab isolé, avec le vrai moteur et un vrai navigateur :
  - catalogue de 13 effets ;
  - préréglages en un clic, enregistrés et montrés actifs ;
  - réglages avancés ;
  - point visé à la souris et au clavier ;
  - aperçu rendu par le moteur ;
  - refus hors bornes.
  - Sur 5 passages, l'un a donné 2 échecs non identifiés ; les 4 autres, 24/24.
- **Pas lancé (garde de jeu)** : la partie visible (Tester / Activer / Arrêter / STOP ALL à l'écran), chaque effet
  affiché en vrai, le curseur qui suit le zoom et le tremblement, OBS.

## 7. Sources (techniques reprises, code réécrit ; aucun code copié)

- S. Eiserloh, « Math for Game Programmers: Juicing Your Cameras With Math », GDC 2016 (trauma, bruit pour la
  secousse) : <https://www.gdcvault.com/play/1023557/Math-for-Game-Programmers-Juicing>
- K. Perlin, « Improving Noise », SIGGRAPH 2002 (interpolation quintique) : <https://mrl.cs.nyu.edu/~perlin/paper445.pdf>
- I. Quilez, « domain warping » et « fbm » (articles) : <https://iquilezles.org/articles/warp/>,
  <https://iquilezles.org/articles/fbm/>
- D. Hoskins, « Hash without Sine » (licence MIT, fonctions de hachage reprises dans le prélude HLSL) :
  <https://www.shadertoy.com/view/4djSRW>
- C. Sigg, M. Hadwiger, « Fast Third-Order Texture Filtering », GPU Gems 2 ch. 20 (B-spline en 4 lectures) :
  <https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-20-fast-third-order-texture-filtering>
- Catmull-Rom en 9 lectures bilinéaires (M. Pettineo, licence MIT) :
  <https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1>
- M. Bjørge, « Bandwidth-Efficient Rendering », SIGGRAPH 2015 (dual Kawase, comparé, non retenu) ;
  J. Jimenez, « Next Generation Post Processing in Call of Duty: Advanced Warfare », SIGGRAPH 2014 (sous-
  échantillonnage 13 lectures, piste si le flou ondule).
- W3C, WCAG 2.1 critère 2.3.1 (trois flashs ou moins) :
  <https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html>
- Microsoft, `ID3D11DeviceContext::GenerateMips` :
  <https://learn.microsoft.com/windows/win32/api/d3d11/nf-d3d11-id3d11devicecontext-generatemips>

Les adresses ont été citées de mémoire et n'ont pas été rouvertes pendant cette session.
