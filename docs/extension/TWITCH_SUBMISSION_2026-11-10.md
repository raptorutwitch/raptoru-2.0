# Raptoru Live — dossier de soumission Twitch (livraison du 10/11/2026)

> Préparé par l'agent. **Rien n'est téléversé, en Hosted Test, soumis ni publié.** Les étapes de la console Twitch
> sont celles d'Antoni (§ 4). Procédure complète : [EXTENSION_NEXT_PUBLICATION.md](EXTENSION_NEXT_PUBLICATION.md).

## 1. Ce que contient cette version

- **Interface v2 (Extension Next)** : `--shell v2`. L'ancienne interface reste dans le zip (repli par une nouvelle
  soumission `--shell legacy`).
- **Correctifs de l'audit du 09/11** :
  - un achat renvoyé après une réponse perdue garde sa clé : un seul débit (Soundboard, Bonk, Événements) ;
  - la session n'est plus effacée quand Twitch renouvelle le jeton pendant une lecture ;
  - un TTS incertain est revérifié tout seul.
- **Lot 1** :
  - plus aucun bouton coupé (paiement TTS, bas du Hub, participants de la Tombola, TTS mobile) ;
  - message « Connexion à Twitch impossible » au lieu d'un écran gris.
- **Music Hub** : le module est dans le zip, mais **invisible en Production**. Le Core ne le propose qu'en Lab
  (`session.music.offered`). Son ouverture demande une décision de conformité et une nouvelle livraison du Core.
- **Domaines** : aucun nouveau. Les appels vont uniquement à `https://core.raptoru.fr` (déjà autorisé). Les images
  Spotify (`i.scdn.co`) ne serviront que le jour où Music Hub ouvrira : ne pas les ajouter maintenant.
- **Permissions Twitch** : inchangées. Pas de Bits ; les paiements sont en Jetons (monnaie de fidélité de la chaîne).

## 2. Changelog (champ « Version Changelog » de la console)

**English (for Twitch):**

> Interface refresh and reliability fixes. Lighter first load, larger and more readable text and touch targets, every
> button reachable at the 65 % video-component size and on mobile. A purchase retried after a lost network answer is
> charged once. The viewer's session survives a Twitch token refresh. A clear "cannot connect to Twitch" message with
> a retry button replaces the previous blank screen. No new permission, no Bits, no new external domain.

**Français (pour Antoni) :**

> Interface rafraîchie, plus légère à l'ouverture, plus lisible et plus facile à toucher. Tous les boutons sont
> accessibles à 65 % et sur mobile. Un achat renvoyé après une coupure réseau n'est débité qu'une fois. La session tient
> au renouvellement du jeton Twitch. Un message clair avec « Réessayer » remplace l'écran gris. Aucune permission
> nouvelle, aucun Bits, aucun nouveau domaine.

## 3. Guide de revue (champ « Review Walkthrough Guide »)

**English (for Twitch reviewers):**

> Raptoru Live is the companion of the channel raptoru_. Viewers spend the channel's own loyalty currency
> ("Jetons", earned by watching; never purchased, no Bits) on stream interactions: Soundboard (play a sound on
> stream), Bonk (throw an emote at the streamer's camera), TTS (a text read on stream), Raffle (join), Commands, and
> seasonal modules shown only while an event is open. Moderators also get a moderation console (TTS queue, viewer
> restrictions). Paid interactions are only accepted while the channel is live; outside a live the modules show their
> state and say so.
>
> 1. Open the video component overlay (or the mobile view). The Hub lists the modules.
> 2. Open Soundboard: preview a sound locally, then "Jouer" (requires Jetons and a live stream).
> 3. Open TTS: write a text, choose the payment, confirm.
> 4. Open Bonk: choose an emote and throw it.
> 5. Open Tombola when a raffle is open: join, see the participants.
>
> All requests go to https://core.raptoru.fr (our backend) with the Twitch extension JWT. No external script, no
> inline script, the Twitch helper is loaded first.

## 4. Ce qu'Antoni doit faire dans la console Twitch

1. **Prouver la version servie** : console › Extensions › Raptoru Live › Versions, relever la version « Released ».
   Si ce n'est pas `0bf7907`, me le dire : `PUBLISHED` et l'inventaire seront refaits.
2. **Relire l'inventaire** `apps/twitch-extension/release-inventory/INVENTAIRE-<sha>.md`, puis écrire seul, sur sa
   propre ligne, « Validé par Antoni : oui ».
3. **Emballer** (une commande, dans `apps/twitch-extension` du worktree de livraison) :
   `node scripts/package.mjs --target production --shell v2`, puis `node scripts/verify-package.mjs release/<zip>`.
4. **Créer la nouvelle version** dans la console (numéro suivant), téléverser le zip, garder la même allowlist.
5. **Hosted Test** sur vrais appareils (PC 65 %, iPhone, Android), en suivant le tableau du § 3 de
   EXTENSION_NEXT_PUBLICATION.md.
   - **Écart assumé avec la procédure du 08/11.** Elle prévoyait un zip _staging_ pour le Hosted Test. Mais le Core de
     staging est resté au 22/10 (`c7f20de`, relevé du 10/11) : il ne connaît ni l'hôte de modules ni les corrections.
   - Le Hosted Test se fait donc avec le zip de Production, contre le Core de Production livré le 10/11. Les achats
     d'essai débitent de vrais Jetons des comptes de test.
   - L'autre voie : redéployer d'abord le Core de staging, sur GO.
6. **Soumettre à la revue**, avec le changelog et le guide ci-dessus. Délai annoncé : 8 à 14 jours.
7. Après approbation : « Release », puis me demander de mettre `PUBLISHED` à jour.
