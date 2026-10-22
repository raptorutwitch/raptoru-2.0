# Votekick V2 + Caution

**Statut (22/10/2026) : DÉVELOPPÉ EN ISOLATION (worktree `feat/votekick-v2`, commits locaux) / TESTS AUTOMATISÉS
RÉUSSIS / NON RACCORDÉ AU CORE NI À STUDIO / NON VALIDÉ PAR ANTONI / RIEN DÉPLOYÉ.** Développé pendant un live :
aucune action sur OBS, Twitch, SAMMI, StreamElements ni la Production. SAMMI reste le Votekick en service.

Reprise des boutons SAMMI du deck « Points de chaine » (`decks_data.json`, lu le 22/10/2026) : `VK_START`, `VK_VOTE`,
`VK_FINISH`, `VK_MUTE_BROADCASTER`, `VK_SEND_STATS`, `VK_RESET`, `CAUTION_START`, `CAUTION_CONFIRM`,
`CAUTION_FINISH`, plus l'overlay `votekick-overlay.html` et les shaders OBS du mute.

## 1. Règles exactes (code : `packages/schemas/src/votekick.ts`, tests `votekick-rules.test.ts`)

| Règle               | SAMMI (vérifié dans le deck)                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lancement           | `!votekick pseudo` (`@` retiré) ; un seul vote à la fois ; `!votekick` seul = aide                                                                                                                                                    |
| Cooldown            | 1 lancement / heure / initiateur, compté **dès l'ouverture** du vote (même s'il finit sans quorum)                                                                                                                                    |
| Cibles refusées     | soi-même ; un modérateur (liste Twitch ; illisible → vote annulé par sécurité) ; le streamer **déjà muté**                                                                                                                            |
| Streamer            | ciblable ; s'il perd : **jamais de timeout Twitch**, mute OBS de `min(300, max(30, durée du timeout en s / 12))` s                                                                                                                    |
| Vote                | 60 s ; `!kick` / `!save` exacts (sensibles à la casse) ; l'initiateur compte KICK d'office et ne vote pas ; on peut changer d'avis                                                                                                    |
| Pas de quorum       | moins de 3 votes (initiateur compris) → personne                                                                                                                                                                                      |
| Majorité KICK       | la cible : `round(5 + (KICK − 2) × 25 / 18)` min, entre 5 et 30                                                                                                                                                                       |
| Perfect             | majorité KICK **sans aucun SAVE** (celui de la cible elle-même ne compte pas) → durée **×2**                                                                                                                                          |
| Égalité (≥ 4 votes) | pile ou face : la cible ou l'initiateur, durée selon le nombre de KICK (non doublée)                                                                                                                                                  |
| Backfire            | seul le KICK de l'initiateur contre ≥ 2 SAVE → **l'initiateur**, durée selon le nombre de SAVE **×2**                                                                                                                                 |
| Sinon               | sauvé, personne                                                                                                                                                                                                                       |
| Verdict             | 7 s à l'écran puis effacement                                                                                                                                                                                                         |
| Caution             | `!caution pseudo` : 1 000 Jetons par minute entamée restante ; devis 30 s ; seul le payeur répond `oui` / `non` ; jamais sa propre caution ; un devis à la fois ; ban permanent non rachetable ; marche aussi sur le mute du streamer |

« Double peine conditionnelle » = Perfect et Backfire (×2). Textes du chat : ceux de SAMMI, à l'identique.

## 2. Bandeau MUTED qui réagit après le démute — cause

Chaîne OBS réelle (collection active du 22/10, lue sur disque) : sur la scène **« overlay cam shushu »**, les filtres
« Votekick Zoom » (shader `votekick-zoom.shader`, uniforme `zoom`) puis « Votekick Mute » (shader
`votekick-mute-B-bandeau.shader`) ; sur l'entrée audio **« Micro (Obsolète) »**, le filtre Move « Votekick Zoom Drive »
(Audio Move) qui écrit `zoom` selon la voix. Le shader du bandeau ne lit aucun son : la partie « réactive » est le
zoom piloté par le drive.

1. **Ordre de restauration** (`VK_MUTE_BROADCASTER` 16–20, `CAUTION_FINISH` 6–10) : SAMMI rétablit le micro
   **d'abord**, puis coupe le drive, remet le zoom, coupe le zoom et enfin le bandeau → la voix revient alors que la
   caméra réagit encore et que le bandeau est encore là (et une dernière écriture du drive arrive après sa coupure).
2. **Deux horloges** : le bandeau finit sur l'horloge du shader (`mute_duration`, depuis l'activation du filtre) ; le
   micro, à la fin de la boucle SAMMI (1 s + le temps des commandes par tour, qui dérive). Le bandeau disparaît donc
   **avant** la fin réelle du mute pendant que la caméra continue de zoomer avec la voix (symptôme principal) ; une
   caution coupe le bandeau net, sans son animation de sortie.
3. **Aucune restauration** si SAMMI redémarre ou si sa boucle est interrompue (`VK_INIT` ne remet que des variables) :
   drive, zoom et bandeau restent actifs.
4. **À vérifier absolument** : SAMMI coupe et écoute **« Micro (Obsolète) »**, masqué dans toutes les scènes ; le micro
   réellement utilisé est **« Micro »** (autre périphérique). En l'état, un mute du streamer par SAMMI ne couperait pas
   le vrai micro.

## 3. Correction (code : `apps/studio/server/src/votekick/mute-controller.ts`, tests `votekick-mute.test.ts`)

Une seule séquence par mute, identifiée par son id (un ordre tardif ou répété d'un ancien mute ne fait rien) :

- **début** : instantané des 4 éléments possédés (micro, drive, zoom, bandeau) **écrit sur disque avant toute
  modification** → micro coupé en premier → zoom remis à 1 → zoom, bandeau (`mute_duration` = le mute) et drive
  activés ;
- **fin** : drive coupé → zoom remis à 1 et **relu** (une écriture tardive du drive est remise à 1) puis coupé →
  bandeau : sortie jouée maintenant (`mute_duration` = temps écoulé + `anim_out_time`) puis coupé → **micro rétabli en
  dernier** (seulement s'il était ouvert avant le vote) → chaque élément relu et remis à son instantané (une reprise) ;
- garde-fous : chien de garde (fin non reçue du Core + 5 s) ; OBS absent → rejoué en entier quand il revient ; Studio
  redémarré → le mute sauvegardé est terminé à l'échéance ; démarrage et fin jamais entrelacés ; aucun autre filtre
  touché (vérifié : « prison » intact).
- Le shader n'est pas modifié (originaux conservés dans `apps/studio/server/votekick-overlay/legacy/`).
- Noms OBS : ceux de SAMMI par défaut (`SAMMI_MUTE_FX`), configurables (point 4 ci-dessus).

Simulateur : `src/votekick/sim-obs.ts` rejoue aussi la séquence SAMMI ; le test montre ses réactions après le démute
et leur absence en V2.

## 4. Moteur (code : `apps/core-api/src/votekick/engine.ts`, tests `votekick-engine.test.ts`)

Un moteur déterministe par chaîne (horloge injectée, `tick()` au lieu de minuteries cachées), tout l'extérieur par
des ports : Twitch (utilisateur, modérateur, timeout, levée, sanction active), Wallet (débit / remboursement
idempotents), mute OBS (Studio), chat, overlay. Simulateurs explicites : `src/votekick/simulators.ts`.

Écarts V2 (sécurité) : session + numéro de séquence sur chaque événement d'overlay ; une livraison Twitch vue deux fois
compte une fois ; deux `!votekick` simultanés ouvrent un seul vote ; un vote arrivé après les 60 s ne compte pas ;
caution re-vérifiée **avant** tout débit, deux `oui` simultanés = un débit ; levée refusée ou sans effet → remboursée
une fois ; résultat inconnu → « à vérifier », jamais remboursé automatiquement ; le streamer n'est jamais envoyé en
timeout Twitch (SAMMI l'envoyait, sans effet) ; OBS injoignable au moment du mute → annoncé, aucun mute enregistré ;
timeout refusé par Twitch → annoncé. Historique des 50 derniers votes dans le moteur (remplace l'envoi `LOG_EVENT`).

## 5. Overlay (code : `apps/studio/server/votekick-overlay/`)

- `votekick.html` + `model.js` (modèle pur testé, `votekick-overlay-model.test.js`) : même contrat que la page SAMMI
  (événement `votekick_update` via obs-browser `emit_event`, ou paramètres `?vk=…`), fonctionne en `file://`.
- Direction : même ambiance (doré, rouge KICK / vert SAVE, dramatique) mais panneau sombre translucide lisible sur
  toute scène, hiérarchie titre → « lancé par » → portrait + anneau 60 s continu (rouge les 10 dernières s) → pseudo →
  barre « tir à la corde » KICK / SAVE avec pourcentages. Verdicts dédiés : Condamné (tampon), **Perfect** (doré,
  étincelles, ×2), **Backfire** (secousse, initiateur, ×2), **Pile ou face** (pièce qui tourne puis tombe sur KICK ou
  SAVE), Mute streamer (micro barré), Sauvé, Égalité, Annulé.
- Robustesse : un événement plus ancien de la même session est ignoré ; rien d'une session terminée n'est réappliqué
  (une mise à jour en retard ne rouvre jamais un vote jugé) ; un verdict d'une autre session ne couvre jamais un vote
  en cours ; une seule boucle d'animation, arrêtée au verdict / clear ; chaque étape différée est annulée au
  changement d'écran (la page SAMMI masquait un **nouveau** vote ouvert dans les 6,5 s après un verdict) ; seuls
  `transform` et `opacity` sont animés ; `prefers-reduced-motion` respecté.
- Corrigé au passage : la page SAMMI affichait la **cible** comme « réduite au silence » quand le streamer muté était
  l'initiateur (Backfire) ; V2 reçoit `punished`.
- Mode démo (aucun paramètre `vk`) : tous les scénarios, rafale de 20 votes, événement en retard, fonds de test.
- Originaux conservés à l'octet près : `legacy/votekick-overlay.html` + les 4 shaders (retour arrière).

## 6. Aperçu avant / après

`node apps/studio/server/votekick-overlay/preview-server.mjs` → ouvrir l'URL affichée (127.0.0.1, port libre). Les
deux overlays reçoivent **les mêmes** événements : vote complet, chaque verdict, rafale, nouveau vote pendant le
verdict, événement en retard, clear, fonds. « Mute lab » : fin normale et caution, SAMMI vs V2 sur caméra simulée
(retard de la boucle SAMMI réglable).

## 7. Reste à faire (non commencé)

1. Persistance Core (tables Lab + migration, cooldowns, vote en cours, devis, historique) et routes ; raccordement au
   routeur chat (`!votekick`, `!kick`, `!save`, `!caution`, `oui` / `non`) ; adaptateur Wallet (`EconomyPort`) avec
   tests PostgreSQL réels de concurrence / idempotence.
2. Exécuteur Twitch dans le bot (comme Random Ban) : lecture utilisateur, modérateurs (jeton raptoru\_
   `moderation:read`), timeout / levée (LeCroupier\_ `moderator:manage:banned_users`), sanctions actives.
3. Studio : héberger `MuteController` (connexion OBS existante), canal de tâches Core → Studio pour le mute, servir
   l'overlay, section de réglages (noms OBS) et tests « sans timeout ».
4. Son de lancement (`fears-to-fathom-notification-sound.mp3`, joué par SAMMI hors overlay) : à reprendre.

## 8. À valider par Antoni (après le live)

1. **Quel micro couper** : « Micro » (utilisé dans les scènes) ou « Micro (Obsolète) » (SAMMI) ; et sur quelle entrée
   placer le drive audio.
2. Mute de bout en bout dans OBS (scène de test, sans live) : fin normale et caution — bandeau, zoom et voix
   finissent ensemble, la voix en dernier.
3. Direction visuelle de l'overlay (aperçu § 6), lisibilité sur la vraie scène, coût GPU dans OBS.
4. Arrondi : SAMMI (GameMaker) arrondit-il 17,5 à 17 ou 18 (seul le cas de 11 votes est concerné) ?
5. Garder le cooldown d'une heure même quand le vote finit sans quorum (comportement SAMMI conservé).
