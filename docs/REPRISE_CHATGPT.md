# Reprise ChatGPT : message à copier-coller

À coller tel quel au début d'une nouvelle conversation ChatGPT (ou de tout assistant sans accès au dépôt). Mis à jour
le 20/11/2026. Source complète : [REPRISE.md](REPRISE.md) ; il fait foi en cas d'écart.

```text
Contexte : je suis Antoni, streamer Twitch raptoru_. Tu reprends le suivi de mon projet Raptoru 2.0 (état au 20/11/2026).
Réponds en français, brièvement et concrètement. Je suis débutant/intermédiaire en technique.

1) Le projet
Raptoru 2.0 est ma plateforme de stream auto-hébergée (dépôt GitHub public raptorutwitch/raptoru-2.0, branche de
référence main). Je décide seul ; « validé » veut dire testé à la main par moi, jamais un test automatique.
- Core API (Node, Fastify, PostgreSQL 17, sur un VPS via Coolify) : décide de tout (Jetons, règles, files).
- Bot LeCroupier_ (VPS) : seul lien avec Twitch (EventSub, chat). C'est le bot opérationnel.
- Raptoru Studio (application Electron sur mon PC) : pilote OBS, affiche les overlays, configure les modules.
- Extension Twitch « Raptoru Live » (shell v2) : interface des viewers. Site raptoru.fr (dépôt séparé).
- SAMMI est abandonné et ne doit jamais revenir. Les Jetons n'ont aucune valeur monétaire.

2) Modules en Production
Wallet/Jetons, Daily, fidélité, présence, progression (XP, niveaux, badges, classements, Level Up V2), mini-profil,
Commandes Chat V2.1, modération, Tombola, Jeu des mots, Roulette/Slot/Duel du chat, Mini-jeux V5 (Random Ban, Sniper),
Soundboard, TTS, Bonk, alertes Twitch, récompenses de points de chaîne et effets, Roue du Sub V3, Votekick, Caution,
Spotify V2, Music Hub, Dock OBS, boutique cosmétique (catalogue vide), Studio « Coulisses ».

3) Versions livrées (relevé du 20/11)
Core 1f05b97c · bot 2c04a5db · Studio 0.1.42 publié et installé · extension publique be1744e75f63
(prouvée dans la console Twitch le 20/11).

4) Casino V1 : PAS encore disponible pour tous
4 jeux : machine à fruits + Coffre du Raptor, roulette, machine à émotes, blackjack multijoueur avec spectateurs.
Déployé côté Core ; réglages ouverts (CASINO_EXTENSION=on, casino.open=1, 4 jeux) ; refusé hors live (stream_offline).
L'extension publique ne contient pas le Casino : la version 2e2eaf3ae34a est en Hosted Test (inventaire validé).
Aucune partie réelle avec de vrais viewers, aucune revue Twitch pour l'instant.
Plafonds : machine 20–10 000, émotes 20–1 000, roulette 100 000 par tour, blackjack mise min 100 et gain net
1 000 000 par manche, gain max par partie 1 000 000, annonces automatiques des gros gains coupées.

5) Niveaux : restauration WizeBot du 20/11 (définitive, ne jamais la rejouer)
1 159 comptes examinés, 432 restaurés (363 WizeBot + 69 touchés par l'ancienne courbe), 3 441 niveaux rendus,
727 inchangés, aucun badge perdu. Règles : 1 000 XP par niveau, un message récompensé toutes les 120 s au plus,
badges tous les 25 niveaux. Les anciennes annulations (« normalisation », « import ») sont supprimées pour de bon.
Un ancien viewer rattaché plus tard récupère son niveau WizeBot entier + l'XP gagnée depuis, une seule fois.
Exports et fichier de retour arrière : dossier privé sur mon PC, jamais dans Git.

6) Prochaines priorités (dans l'ordre)
a. Vérifier le ZIP Casino en Hosted Test HORS live sur un compte testeur (un Hosted Test activé pendant un live retire
   l'extension à tous les autres viewers, et le Casino refuse hors live).
b. Décider avant la publication : CASINO_EXTENSION=testers:<ids> (essai réel restreint, recommandé) ou on (tous).
c. Soumettre la version Casino à la revue Twitch (8 à 14 jours).
d. Après approbation : publier, puis essai réel en live (mises, gains, remboursements, spectateurs, blackjack à
   plusieurs) ; corriger seulement les problèmes observés.
e. Ensuite : Chaos V2 lot 0 (mesures, sans code) ; validations en live en attente (premier tirage de la Roue V3, vraie
   annonce Level Up, commande d'Aouh, parcours Music Hub) ; finitions de Studio.

7) Règles
- Rien en Production (déploiement, variable, migration, release, Twitch, OBS, soldes) sans mon GO explicite.
- Aucun secret, token, export ou donnée de viewer dans le dépôt public.
- Ne jamais rejouer la restauration des niveaux, ni la normalisation du 15/11, ni l'import économique du 20/10.
- Projet SUSPENDU, à ne pas relancer ni proposer : la personnalité IA conversationnelle de LeCroupier_ (aucun modèle,
  test, fine-tuning ni budget). En pause aussi : le Panthéon (concept), l'étude Collection.
- Un test automatique, un déploiement ou un Hosted Test n'est jamais une validation.

8) Documents à demander à Claude Code (dans le dépôt) si besoin
docs/REPRISE.md (point d'entrée, état exact, prochaines tâches) · docs/ROADMAP.md (état de chaque module, pauses) ·
docs/PROJECT_STATUS.md (versions, tests, problèmes ouverts) · docs/CASINO_V1_INTEGRATION.md et docs/CASINO.md ·
docs/LEVEL_UP_V2.md § 14–15 (niveaux) · docs/DECISIONS_TECHNIQUES.md · docs/INVENTAIRE_RELEASES.md (versions et ZIP) ·
CLAUDE.md et docs/AGENT_WORKFLOW.md (règles des agents).
```
