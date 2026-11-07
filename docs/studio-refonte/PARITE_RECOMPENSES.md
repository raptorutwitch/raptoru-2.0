# Récompenses Twitch : parité réel / Lab / nouveau Studio (07/11/2026)

Vérification ciblée avant la migration. Aucune récompense réelle créée, modifiée, supprimée ni remboursée ; aucun appel à
Twitch ; aucune autorisation renouvelée ; Production non touchée.

## Sources

| Source                                                                                                                                                                                                                                                | Ce qu'elle prouve                                                | Limite                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Code (`apps/twitch-bot/src/channel-points-events.ts`, `twitch/helix.ts`, `apps/core-api/src/channel-points/*`, `packages/schemas/src/channel-points.ts`, `apps/studio/server/src/channel-points/runtime.ts`, `apps/studio/web/src/pages/rewards*.ts`) | la chaîne et les contrats                                        | —                                                                       |
| Base locale `raptoru_prodrestore_gel` (restauration de Production, 20/10 14:51)                                                                                                                                                                       | 39 vraies récompenses (ids Twitch UUID), 9 règles                | instantané de 18 jours : Production a pu changer depuis (Spotify V2…)   |
| Base locale `raptoru_bonk_lab` (Lab relié au vrai Twitch, 20/10 11:42)                                                                                                                                                                                | 37 récompenses, mêmes ids                                        | idem                                                                    |
| Jeton broadcaster local (`apps/twitch-bot/.twitch-tokens.broadcaster.json`)                                                                                                                                                                           | droits `channel:read:redemptions` + `channel:manage:redemptions` | **expiré le 31/10** : non renouvelé, donc aucune lecture Twitch directe |

## Chaîne réelle (prouvé par le code)

- **Liste** : le bot lit « Get Custom Rewards » (GET, sans filtre `only_manageable_rewards`) au démarrage et à chaque
  reconnexion → `POST /v1/bot/channel-points/rewards` (secret du bot) → `syncRewards`. **Toutes** les récompenses de la
  chaîne sont reprises, qu'elles viennent du tableau de bord Twitch, de SAMMI ou de Raptoru. Une récompense absente de la
  liste suivante reste connue, marquée « plus listée » (sa règle est gardée).
- **Clé** : l'id Twitch, jamais le titre (règles, demandes, remboursements). Les routes Studio acceptent un UUID.
- **Champs gardés** : id, titre, coût, description (`prompt`), saisie du viewer obligatoire, disponible ou non.
  Désactivée et en pause sont fusionnées en un seul « non disponible ». **Image et couleur ne sont lues nulle part** (ni par
  le bot, ni par le Core) : l'ancien Studio ne les montrait pas, le nouveau non plus. La tuile des cartes est une icône de
  Raptoru, pas l'apparence Twitch.
- **Créée par Raptoru** : colonne `managed_by_raptoru`, posée seulement par une création Raptoru (Spotify V2). La
  synchronisation ne la touche jamais : une récompense existante n'est **jamais** considérée comme créée par Raptoru.
- **Remboursement** : demandé à Twitch une seule fois, seulement pour une récompense créée par Raptoru (Twitch refuse les
  autres). Les récompenses historiques ne sont jamais remboursées : la page le dit.
- **Demandes** : EventSub `…redemption.add` / `.update` → outbox durable du bot → Core (dédoublonnage par id de demande).
- **Branche** : aucune migration ni changement de contrat sur les récompenses ; seules les règles d'expiration et
  « hors live » (refonte H1/H2) changent dans le Core.

## Nouveau Studio face aux vraies récompenses (testé sur l'instantané, vues pures)

Les 39 récompenses de l'instantané Production passent par les vues de la page : 39 cartes, aucun id ni « undefined »
affiché, apostrophes et `700 000` corrects. 30 sans action, 9 avec règle (toutes coupées le 20/10) ; « Soundboard » →
**Crédits Soundboard** (3), « TTS » → **Crédits TTS** (1), Eren cri → son d'effet, ntm → vidéo d'effet, Couleur Cam, FX cam,
Creepy, BRB, Ban aléatoire → interactions. Aucune supposition « lab- » dans l'interface.

**Corrigé** : 21 récompenses désactivées s'affichaient « En pause sur Twitch » (l'ancien Studio disait « désactivée ») ;
libellé devenu « Désactivée ou en pause sur Twitch », le Core ne distinguant pas les deux.

Le choix « Ajouter une action » couvre les 8 types et les 7 interactions du Core. Les actions à compléter (son, scène,
nombre) sont refusées par le Core tant qu'elles sont vides, comme avant.

## Catalogue fictif du Lab

12 récompenses, ids `lab-…`, écrites par les mêmes portes du Core (`syncRewards`, `saveRule`), dans la base du Lab
seulement. Trois verrous : route Core absente en Production, route Studio `403 lab_only` hors Lab, bouton affiché seulement
quand `environment = lab`. **Aucune correspondance avec le réel** : 7 titres reprennent des titres réels (FX cam, Couleur
Cam, Creepy, Be Right Back, Ban aléatoire, Choisi la prochaine musique !, Skip la musique) avec **d'autres coûts** ; « Crédit
TTS » / « Crédit Soundboard » n'existent pas sur Twitch (les vraies s'appellent « TTS » et « Soundboard » au 20/10).

## À vérifier au moment de la livraison (non vérifiable ici)

1. Studio Production ouvert sur Récompenses : le nombre de cartes = la liste Twitch du jour (39 au 20/10), titres et
   coûts identiques au tableau de bord Twitch.
2. Les règles saisies depuis le 20/10 apparaissent avec leurs actions et leur état (le nouveau Studio lit la même route).
3. La récompense Spotify créée par Raptoru, si elle existe : demande refusée → remboursée ; une récompense historique →
   « non remboursable ».
4. Une vraie demande arrive dans le fil avec son détail.
5. Le bot de Production lit bien la liste (journal « N récompense(s) lue(s) sur Twitch ») : son jeton est celui du VPS,
   pas la copie locale expirée.
