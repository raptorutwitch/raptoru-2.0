# Vision de Raptoru 2.0

Synthèse de l'intention historique, reconstituée à partir de la documentation du dépôt et du code (05/11/2026). Niveau
d'autorité entre crochets : [1] décision métier explicite récente, [3] contrat technique appliqué, [4] documentation
actuelle, [5] proposition non validée, [6] historique.

## La finalité

Raptoru 2.0 est l'écosystème de streaming personnel d'Antoni. **Le Core décide, le bot parle à Twitch, Studio pilote
OBS et affiche, l'extension et le site parlent aux viewers** [3] (`docs/ARCHITECTURE.md`, spécification d'infrastructure
§ 1, § 26). Antoni veut créer, modifier, fusionner et retirer des fonctionnalités sans reconstruire leur infrastructure
à chaque fois [1] (mission du 05/11).

## Principes fondateurs

1. **Une fonctionnalité existe une seule fois, comme logique du Core**. Le chat, Studio, l'extension et le site la
   déclenchent sans recopier ses règles [3].
2. **Se régler sans code** : prix, recharges, durées, interrupteurs se règlent dans Studio, bornés par le Core ; jamais
   les cotes ni les tables de gains [1] (H10). Les variables d'environnement deviennent un plafond de sécurité [1] (P2-2,
   à construire).
3. **Ne pas refaire SAMMI** : pas de moteur de workflows, de langage de script ni d'éditeur visuel [4].
4. **Studio est un cockpit** : état réel, réglages sûrs, actions nommées, aperçu, activité [4]. Jamais de vert sur une
   simple intention ; un état inconnu se dit inconnu [1].
5. **Production, Lab, Simulation, Aperçu** sont des catégories strictes, fondées sur ce que fait réellement une action [1].
6. **Le Lab teste tout sans Twitch, OBS ni Production** [3] ; l'Extension Lab est essentiel [1].
7. **Économie** : un Wallet canonique, un écrivain par monnaie, une clé d'idempotence sur chaque chemin d'argent, refus
   avant débit, jamais de rejeu d'une exécution commencée, une écriture par intention [3].
8. **Modération** : une console, une implémentation, partagée par l'extension et Studio [3].
9. **Fichiers centraux** (ASTRA-P1-008) : extraction progressive ; un nouveau module a ses propres fichiers et le fichier
   central ne fait que le raccorder ; pas de migration de framework ni de découpage « propreté » [1].
10. **Gouvernance** : aucune action en Production sans GO ; « validé » veut dire testé à la main par Antoni [1].

## Ce que la mission du 05/11 ajoute

- Le critère de réussite : pour un nouveau module, il ne doit rester à écrire **que sa logique propre, son interface
  particulière, ses effets et ses tests** ; Wallet, permissions, modération, navigation, supervision et Lab doivent
  exister déjà.
- La modération est examinée dès la conception de chaque module interactif.
- L'extension fait partie du socle au même titre que Studio.
- Les interfaces restent libres : le socle fournit des primitives, pas une présentation unique.

## Contradictions relevées (à arbitrer, hors de cette mission)

- Prototypes validés « intouchables » (CLAUDE.md, ASTRA-P1-008) contre « tout Studio est refondable » (CONTEXTE § 2) :
  la décision récente vaut pour Studio ; la console de modération est du code partagé avec l'extension, à ne pas forker.
- La spécification d'origine prévoyait un bus d'événements (§ 12) : il n'a jamais été construit ; le système réel
  interroge par HTTP. Ne pas le présenter comme existant.
- Sources introuvables : « Storyboard », livrables d'origine d'Astra (dossier externe), plusieurs documents post-live
  restés non suivis dans le dossier principal.
