# Reprise ChatGPT : message à copier-coller

À coller tel quel au début d'une nouvelle conversation ChatGPT (ou de tout assistant sans accès au dépôt). Mis à jour
le 22/11/2026. Source complète : [REPRISE.md](REPRISE.md) ; il fait foi en cas d'écart.

```text
Contexte : je suis Antoni, streamer Twitch raptoru_. Tu reprends le suivi de mon projet Raptoru 2.0 (état au 22/11/2026).
Réponds en français, brièvement et concrètement. Je suis débutant/intermédiaire en technique.

1) Le projet
Raptoru 2.0 est ma plateforme de stream auto-hébergée (dépôt GitHub public raptorutwitch/raptoru-2.0, branche de
référence main). Je décide seul ; « validé » veut dire testé à la main par moi, jamais un test automatique.
- Core API (Node, Fastify, PostgreSQL 17, sur un VPS via Coolify) : décide de tout (Jetons, règles, files).
- Bot LeCroupier_ (VPS) : seul lien avec Twitch (EventSub, chat). C'est le bot opérationnel.
- Raptoru Studio (application Electron sur mon PC) : pilote OBS, affiche les overlays, configure les modules.
- Extension Twitch « Raptoru Live » (shell v2) : interface des viewers. Site raptoru.fr (dépôt séparé).
- StreamElements garde les dons et l'affichage du chat dans OBS. SAMMI est abandonné pour toujours. Les Jetons n'ont
  aucune valeur monétaire.

2) Modules en Production
Wallet/Jetons, Daily, fidélité, présence, progression (XP, niveaux, badges, classements, Level Up V2), mini-profil,
Commandes Chat V2.1, modération, Tombola, Jeu des mots, Roulette/Slot/Duel du chat, Mini-jeux V5 (Random Ban, Sniper),
Soundboard, TTS, Bonk, alertes Twitch, récompenses de points de chaîne et effets, Roue du Sub V3, Votekick, Caution,
Spotify V2, Music Hub, Dock OBS, boutique cosmétique (catalogue vide), Studio « Coulisses ».

3) Versions (relevé du 22/11)
Core a94d1081 (déployé le 22/11) · bot 2c04a5db · Studio 0.1.42 publié et installé · extension publique be1744e75f63
(prouvée dans la console Twitch le 20/11, sans Casino).

4) Casino V1 : terminé et déployé côté Core, PAS encore public
4 jeux : machine à fruits + Coffre du Raptor, roulette, machine à émotes, blackjack multijoueur (spectateurs, solo,
Split jusqu'à 4 mains, assurance, historique et bilan, partage, nouvelles tables publiques, 7 réactions avec anti-spam
5 puis 1 toutes les 2 s, croupier qui réagit d'une émote). Réglages ouverts, refusé hors live.
ZIP prêt à publier, PAS encore téléversé dans Twitch : raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip
(SHA-256 1ec79c2a…66d76039, 20 commits, inventaire validé par moi le 22/11). Aucune partie réelle avec de vrais viewers.
Décisions : quitter une table ne confisque jamais une mise engagée ; « remettre le bilan à zéro » n'efface rien dans
le Wallet ; les tables créées restent publiques ; aucune IA dans les réactions ; pas d'annonce de table dans le chat
si le réglage n'a jamais été activé.

5) Niveaux : restauration WizeBot du 20/11 (définitive, ne jamais la rejouer)
432 comptes restaurés, aucun badge perdu. Règles : 1 000 XP par niveau, un message récompensé toutes les 120 s au
plus, badges tous les 25 niveaux. Exports privés sur mon PC, jamais dans Git.

6) PRIORITÉ DE DÉVELOPPEMENT : les Chatbox
Remplacer progressivement mes 3 chatbox StreamElements par une chatbox Raptoru (moteur partagé, 3 profils, réglages
par scène, source navigateur OBS, prévisualisation locale, configuration dans Studio si utile). Rien n'est spécifié ni
développé ; je veux d'abord revoir ce qu'on garde ou change.
- Just Chatting (source OBS « Boîte de chat ») : chat permanent, ~50 messages, police Figtree, cartes sombres, glissement.
- React (« ChatReact », scènes PS5 et Fullscreen) : effet verre transparent, textes plus grands, disparaît ~10 s
  après le dernier message, dépliage.
- Dessin (« Chatbox Dessin ») : compact, barre de couleur selon le rôle, ~65 messages, disparaît ~15 s, dépliage.
À garder partout : emotes Twitch, 7TV (y compris superposées), BTTV, FFZ, GIF, emojis, commandes « ! » masquées,
messages supprimés par la modération, couleurs des rôles. Une reconnaissance détaillée existe (rapport privé sur
mon PC ; résumé dans docs/CHATBOX.md). Les URL des overlays StreamElements contiennent une clé : ne jamais les recopier.

7) Casino : mes gestes restants
a. Téléverser le ZIP en Hosted Test HORS live, essayer sur un compte testeur (PC et application Twitch du téléphone).
b. Décider : CASINO_EXTENSION=testers:<ids> (essai réel restreint, recommandé) ou on (tous dès la publication).
c. Soumettre à la revue Twitch (8 à 14 jours) ; après approbation, publier, puis essai réel en live.
Ensuite : Chaos V2 lot 0 (mesures) ; validations en live en attente (Roue V3, annonce Level Up, commande d'Aouh,
Music Hub) ; finitions de Studio.

8) Règles
- Rien en Production (déploiement, variable, migration, release, Twitch, OBS, StreamElements, soldes) sans mon GO.
- Aucun secret, token, export, URL d'overlay ou donnée de viewer dans le dépôt public.
- Ne jamais rejouer la restauration des niveaux, ni la normalisation du 15/11, ni l'import économique du 20/10.
- Projet SUSPENDU, à ne pas relancer ni proposer : la personnalité IA conversationnelle de LeCroupier_. En pause
  aussi : le Panthéon (concept), l'étude Collection.
- Un test automatique, un déploiement, un ZIP construit ou un Hosted Test n'est jamais une validation ni une
  publication.
- Méthode des agents : lire le checkpoint, ne pas refaire les audits, tests ciblés, travail autonome en lots.

9) Documents à demander à Claude Code (dans le dépôt) si besoin
docs/REPRISE.md (point d'entrée, état exact, prochaines tâches) · docs/CHATBOX.md (chantier Chatbox) ·
docs/ROADMAP.md (état de chaque module, pauses) · docs/PROJECT_STATUS.md · docs/CASINO.md et
docs/CASINO_V1_INTEGRATION.md · docs/INVENTAIRE_RELEASES.md (versions et ZIP) · docs/DECISIONS_TECHNIQUES.md ·
CLAUDE.md et docs/AGENT_WORKFLOW.md (règles des agents).
```
