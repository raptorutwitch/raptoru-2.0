# UX / UI — module Mini-jeux et Random Ban

12/11/2026. Conception active, alignée sur la [SPEC](SPEC_RANDOM_BAN_V2.md) (règles décidées : prix progressif
récupéré par paliers de 5 min, Sniper 30 min, séquence hybride, stats). Codé (Lab) : le format des montants et la pastille de
gain (§ 9), la vue Random Ban avec jauge, Sniper et « Mes stats », le rouleau « Le Viseur » (§ 6).

Cadre imposé par le socle v2 ([`docs/extension/SOCLE.md`](../extension/SOCLE.md)) :
- composition de référence 651×434, échelles `--g` et `--kt`, planchers de texte ;
- cibles de 24 px au moins (32 px en tactile) ;
- action principale dans le pied de la vue, jamais coupée ;
- aucune dépendance externe, aucune mesure de fenêtre.

## 1. Le conteneur « Mini-jeux »

- **Identifiant :** `arcade` côté extension, libellé « Mini-jeux ». Côté Core, `mini_games` désigne déjà Roulette, Slot
  et Duel dans le chat : on évite ainsi deux modules qui portent le même nom.
- **Avec un seul jeu**, la carte du Hub ouvre **directement** Random Ban. Un écran de choix avec une seule tuile serait
  un clic inutile.
- **À partir de 2 jeux**, une barre d'onglets apparaît en tête de la vue. Il suffit d'ajouter un jeu à la liste de
  l'entrée du module : aucun nouveau module, aucune ligne dans `app/panel.js`.
- **Pas de framework de jeux.** Un jeu = une petite vue avec `{ id, label, icon, view(ctx) }`. Le conteneur ne fait que
  les onglets et le cadre, en un seul fichier.

## 2. Direction artistique

**Retenu (12/11) : un rose poudré sur nuit.**
- L'extension est sombre (fond `#0f0a1c`, accent violet `#a855f7`).
- Un module **entièrement clair** casserait l'en-tête commun (porte-monnaie, navigation) et ferait un flash blanc à
  chaque ouverture.
- On garde donc la nuit, et le module est **teinté de rose**. Le rose clair est réservé à l'élément central : le
  « ticket » du jeu.

| Rôle | Jeton | Couleur | Contraste (WCAG) |
| --- | --- | --- | --- |
| Fond du module | `--mj-bg` | `#24142c` (prune nuit) | — |
| Accent et bouton principal | `--mj-accent` | `#f7b2cf` (rose poudré) | texte `#2b1020` sur l'accent : **10,2:1** ; accent sur fond : **10,1:1** |
| Rose clair (titres, cadre du tirage) | `--mj-accent-soft` | `#ffd6e7` | 13,2:1 sur fond |
| Ticket (carte claire) | `--mj-ticket` | `#ffe3ef`, encre `#2b1020` | **14,6:1** ; texte secondaire `#5c3b52` : 7,9:1 |
| Secondaire Sniper | `--mj-sniper` | `#7fd8c9` (menthe) | 10,4:1 ; ressort sur le rose sans être une couleur d'état |
| Jetons | `--rx-token` | `#f2c65f` (existant) | 10,8:1 |
| Désactivé | `--mj-off` | `#9b8a9f`, bouton en **contour** (jamais rempli) | 5,4:1 |
| Erreur | `--rx-danger` | `#ff7a8a` (existant) | 6,9:1 |

**Règles :**
- **Le rose de l'accent est proche du rouge d'erreur.** Une erreur n'est donc jamais signalée par la couleur seule :
  elle a toujours une icône (⚠), un texte et un fond distinct (bandeau sombre bordé).
- Les états passent par la forme autant que par la couleur : plein = action ; contour = indisponible ; pastille = état.
- Pas de dégradés multiples, de paillettes ou de cœurs. Une seule texture : le ticket a un bord **perforé**, en motif
  CSS, qui évoque un billet de fête foraine sans tomber dans l'enfantin.
- Typographie : celle de l'extension. Le prix est en chiffres tabulaires, de taille `--fs-15` au moins.

## 3. Disposition

### 3.1 Composant vidéo (651×434 et échelles)

```text
┌──────────────────────────────────────────────────────────────┐
│ ← Hub      Mini-jeux · Random Ban          🪙 48 200 Jetons    │  en-tête du shell
├───────────────────────────────┬──────────────────────────────┤
│ ┌───────────────────────────┐ │ 🎯 Viser quelqu'un (Sniper)  │
│ │ 🎲 RANDOM BAN       ticket │ │ ┌──────────────────────────┐ │
│ │ Un viewer du chat tiré     │ │ │ 🔍 Rechercher un viewer… │ │
│ │ au hasard · 3 à 5 min      │ │ └──────────────────────────┘ │
│ │ 42 viewers dans le chat    │ │ Kiwi · @kiwi_42        ✕     │
│ │ ⓘ Les règles               │ │ ne change pas le tirage ·    │
│ └───────────────────────────┘ │ +2 000 si tu tombes dessus   │
│ Ma dernière demande :          │ Sniper : ● prêt               │
│ ✔ Moustache banni 5 min       │                              │
│ Derniers tirages ▸             │                              │
├───────────────────────────────┴──────────────────────────────┤
│ 50 000 ▕██████████░░░░▏ 30 000 dans 6:12 · normal dans 16:12  │  jauge (§ 4.7), seulement en série
│  [   Lancer — 50 000 Jetons   ]                               │  pied (toujours visible)
└──────────────────────────────────────────────────────────────┘
```

- **Profil `compact`** : les deux colonnes se resserrent. Sous la largeur de composition, le Sniper passe en tiroir
  « 🎯 Viser… » au-dessus du pied.

### 3.2 Panneau et mobile (étroit, 318 px)

```text
┌───────────────────────────┐
│ ← Mini-jeux   🪙 48 200     │
│ ┌───────────────────────┐ │
│ │ 🎲 RANDOM BAN          │ │
│ │ 42 viewers dans le chat│ │
│ │ ⓘ Les règles           │ │
│ └───────────────────────┘ │
│ 🎯 Viser quelqu'un   ▸     │  ouvre la recherche en plein écran du module
│ Ma dernière demande ▸      │
├───────────────────────────┤
│ [ Lancer — 25 000 ]        │  pied collant
└───────────────────────────┘
```

## 4. Interactions

1. **Achat en deux temps** (`purchase.js`) :
   - le premier appui transforme le bouton en « Confirmer — 25 000 Jetons », avec le récapitulatif au-dessus :
     « Vise Kiwi · Sniper prêt » ;
   - le second appui envoie la demande ;
   - Échap, ou 5 s sans action, revient à l'état initial.
2. **Pendant l'envoi**, le bouton est désactivé et affiche un indicateur. Un double-clic envoie la **même clé** : une
   seule demande.
3. **Suivi :** une barre d'étapes compacte remplace le bouton tant que la demande n'est pas finie :

   ```text
   ● Payé ─ ● En file (2ᵉ) ─ ○ Tirage ─ ○ Résultat
   ```

   Une nouvelle demande reste possible, dans la limite de 2 en attente.
4. **Recherche de la cible :**
   - champ avec liste déroulante, navigation au clavier (↑ ↓ Entrée Échap) ;
   - 8 résultats au plus ;
   - « Personne trouvé parmi les viewers présents » si rien ne correspond ;
   - la sélection devient une puce supprimable avant la confirmation ;
   - après la confirmation, la puce est **verrouillée** et accompagnée d'un cadenas.
5. **Règles (ⓘ)** : une feuille courte.
   - Qui est éligible, avec la définition honnête : SPEC § 6.
   - La chance réduite de l'acheteur, le prix de série et le Sniper.
   - « Le tirage est fait par le serveur ; l'animation montre un échantillon. »
6. **Clavier :** tout est atteignable à la tabulation, dans l'ordre visuel. Le focus est visible (anneau rose clair de
   2 px). Les annonces d'état passent par une zone `aria-live="polite"`.
7. **Jauge de récupération du prix** (seulement quand ton prix est au-dessus du normal) :
   - à gauche, le **prix actuel** en gros ; à droite, le **prochain prix** et son délai ; dessous, « tarif normal dans
     16 min 12 s » ;
   - une barre rose qui **se vide en continu** pendant les 5 min du palier en cours, puis repart pleine pour le palier
     suivant ; 4 encoches discrètes montrent les paliers restants. Le prix, lui, ne change **que par paliers** ;
   - l'heure vient du Core (`server_now`, `next_drop_at`, `normal_at`) ; la barre n'est qu'une interpolation locale,
     et l'écran relit le Core dès qu'un palier tombe : le prix affiché est toujours celui du serveur ;
   - au retour au tarif normal : la jauge se replie et laisse « ✔ Tarif normal » 3 s ;
   - lecteurs d'écran : un texte « Prix actuel 50 000 Jetons. 30 000 dans 6 minutes. Tarif normal dans 16 minutes. »,
     mis à jour à chaque palier seulement (pas toutes les secondes) ;
   - mouvement réduit : la barre avance par pas d'une minute, sans animation.
8. **Prix confirmé :** le bouton de confirmation affiche le montant exact (« Confirmer — 50 000 Jetons ») ; si le prix
   a baissé avant l'envoi, le reçu dit « Payé 30 000 (le prix avait baissé) » ; s'il a monté, rien n'est débité et le
   bouton revient avec le nouveau prix.

## 5. États de la vue

| État | Ce qu'on voit |
| --- | --- |
| Chargement | squelette du ticket, bouton en contour « Chargement… » |
| Disponible | bouton plein, prix |
| Prix de série | prix actuel et jauge de récupération (§ 4.7) |
| Solde insuffisant | bouton en contour « Il te manque 7 300 Jetons » ; le prix reste affiché |
| Indisponible (bot absent, hors live, pause) | bandeau sombre ⓘ avec la raison ; bouton désactivé |
| Bloqué ou délai personnel | pastilles existantes de `viewer-restrictions.js`, avec Random Ban ajouté |
| 2 demandes en attente | « Attends que tes Random Ban passent » |
| Prix changé | « Le prix vient de changer : 37 500 Jetons » ; nouvelle confirmation |
| Résultat | carte de résultat 6 s, puis elle rejoint l'historique |
| Remboursé | « Rien n'a pu être fait · 25 000 Jetons remboursés » |
| À vérifier | « Résultat incertain · un modérateur vérifie » (pas de faux succès) |
| Erreur réseau | « Connexion perdue, on réessaie… » : la même clé est renvoyée |

## 6. Animation sur le stream (lecteur d'effets de Studio)

Séquence et règles d'honnêteté : SPEC § 5.3.

**Direction : « Le Viseur », ban synchronisé sur l'arrêt** (séquence hybride, SPEC § 5).
- Un rouleau horizontal d'avatars ronds (16 au plus, 96 px) défile derrière une **lunette** centrale (anneau rose clair,
  réticule menthe).
- Il accélère, puis ralentit doucement, en 3,2 s. Il s'arrête **exactement** sur la cible : le réticule se resserre,
  un « clic » sec, et « Tiré au sort : **Kiwi** ». Le ban part à cet instant (décalé de la latence du stream).
- Le tampon « **BANNI 5 min** » et la vidéo de ban existante n'arrivent **qu'après** la confirmation de Twitch. On
  garde les médias historiques, qui sont l'identité de Random Ban. Refus de Twitch : « Esquivé ! » à la place.
- **Pourquoi pas une roue :** elle tourne autour d'un centre, ce qui la rend illisible avec 16 visages. Elle est aussi
  déjà associée à la Roue du Sub. La lunette rejoint le thème Sniper, et le rouleau reste lisible sur un petit écran
  de téléphone.
- **Sniper réussi :** le réticule devient menthe, puis tampon « SNIPER ! » et « +2 000 Jetons », 1,5 s. C'est la seule
  célébration : pas de confettis.
- **Prédiction ratée :** rien sur le stream. Il n'y a pas d'humiliation publique d'un pari qui n'a rien coûté.
- **Sobriété :** aucun flash plein écran, aucun tremblement de caméra, une seule source sonore à la fois, volume de
  0,5 comme les vidéos existantes.

**Ce que fait la V1 codée (12/11)** (`studio/server/effects-player/reel.js`, vu dans Chromium à 1920×1080) : bande de
26 avatars ronds de 120 px (initiales sur une couleur tirée de l'identifiant ; pas encore les vraies photos), lunette
rose foncé à réticule, défilement de 4,5 s qui ralentit (courbe « ease-out ») et s'arrête sur la cible, puis
« Tiré au sort : Kiwi » (« CSC ! Kiwi s'est tiré lui-même ») 1,4 s ; carte « Esquivé ! » 2,2 s ; mouvement réduit :
arrêt direct sur la cible. Pas encore : le « clic », le tampon « SNIPER ! », le réticule menthe. Silencieux (aucun son).

## 7. Composants réutilisés

- **Shell v2 :**
  - en-tête et porte-monnaie ;
  - `createPurchaseButton` et `createIntent` ;
  - `createPoller` et `everySecond` ;
  - `errorLabel` ;
  - pastilles de restrictions ;
  - zones de clic (`targets.css`).
- **Studio :** lecteur d'effets (nouvelle couche `rb-reel`), médias Random Ban existants.
- **Nouveaux composants, petits et propres au module :**
  - ticket ;
  - recherche de viewer : un composant réutilisable plus tard (Duel, cadeaux) ;
  - barre d'étapes ;
  - carte de résultat.

## 8. Améliorations proposées

| Proposition | Bénéfice | Classe |
| --- | --- | --- |
| Ouverture directe du jeu tant qu'il est seul | un clic en moins | **V1** |
| Barre d'étapes de la demande | le viewer sait toujours où il en est | **V1** |
| Rappel « Sniper prêt » sur la carte du Hub | donne envie, sans pousser à la rafale | souhaitable |
| « Tableau de chasse » personnel : tes Snipers et tes CSC | se raconte bien en live | souhaitable |
| Avatar de la cible dans la puce Sniper | identification immédiate | souhaitable : avatars via le bot, en cache dans le Core |
| Défi secret « Double Sniper » (2 dans le même stream) | relance l'intérêt sans changer le jeu | plus tard, avec le système de défis existant |
| Stinger « Revanche ! » quand une victime relance contre son bourreau dans les 10 min | moment fort, aucun impact sur les chances | plus tard |
| Ralenti « photo-finish » sur le dernier avatar | suspense | **rejeté** : ressemble à un faux presque-gagnant |

## 9. Montants et solde (toute l'extension)

- **Un seul format abrégé** (`formatCompactAmount`, `shared/currency.js`) : 6 K · 125 K · 1 M · 6,1 M · 6,25 M.
  Virgule française, espace fine insécable avant l'unité, **tronqué** (jamais au-dessus du solde réel). 3 chiffres
  significatifs ; 2 dans la case de 40 px de l'en-tête (6,2 M).
- **Le solde exact** reste lisible : infobulle au survol ou au focus, `aria-label`. Les prix et les reçus sont toujours
  en entier (« 50 000 Jetons »).
- **Gain visible :** quand le solde augmente entre deux lectures, une pastille « +40 » apparaît 2,6 s à gauche du
  solde (montant exact sous 1 000, abrégé au-dessus). Rien pour une dépense : le reçu de l'achat le dit déjà.
- **« Mes stats »** (Random Ban) : une feuille sous l'historique — lancers, victimes, CSC, Snipers tentés / récompensables
  / réussis, Jetons dépensés, primes reçues. Chiffres en entier.
