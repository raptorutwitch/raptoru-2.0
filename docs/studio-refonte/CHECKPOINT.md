# Refonte de Raptoru Studio — checkpoint

**Mis à jour : 04/11/2026, après la consolidation documentaire.**
Lire ensuite [CONTEXTE.md](CONTEXTE.md) (décisions, règles, architecture) puis [ROADMAP.md](ROADMAP.md) (état par lot).

## Où

- Branche **`feat/studio-ux`** (locale, jamais poussée), worktree
  `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux`. Base : `docs/site-hub-delivered` (68420a0) → `main`
  8a897a5.
- Production : Core 8a897a5, bot 4ba9243, site 74f7542, Studio **0.1.25 publiée** (sans la refonte ; installation sur
  le PC à confirmer). À revérifier soi-même : `docs/REPRISE.md` § 2.
- Vérifier d'abord : `git -C "<worktree>" status --short` et `git log --oneline -8` (attendu : arbre propre).

## Derniers commits (plus récent en haut)

`377e726` kit de revue · `4282312` palette + petite largeur des vues historiques · `f5c5b0d` Progression ·
`b1aab1f` Régie étape 2 · `1d8992a` Régie étape 1 · `a08a249` lots 0-4 — puis le commit de cette consolidation.

## État

- **Refondu (code + tests automatiques)** : shell / navigation, Défis, Boutique, Progression, Régie live (partielle),
  Récompenses Twitch (partielle : pages modules, déclencheurs, coupure confirmée).
- **Seulement habillé** (palette, petite largeur) : Alertes, Soundboard, TTS, Bonk, Tombola, Commandes, Modération,
  Jeu des mots, Halloween, Simulation, Test Lab, Extension Lab, Système.
- **Rien n'est validé par Antoni ni publié.**
- Tests au dernier lot : typecheck, build, lint, Prettier ; unitaires `studio-shell` (15), `challenges-form`,
  `supervision*`, `control-center`, `prod-bot-status` ; E2E `challenges`, `cosmetic-*` (3), `halloween-*`,
  `progression-studio`, `alerts`. Aucun échec non expliqué ; instables connus relancés seuls (CONTEXTE § 15).

## Règles à respecter (résumé, détail CONTEXTE § 7, 10-12)

- Tout Studio peut être refondu (prototypes validés compris) ; capacités métier conservées ; aucune duplication de
  handler ; pas de septième destination.
- PRODUCTION / LAB / SIMULATION / APERÇU LOCAL selon le comportement réel ; jamais d'état inconnu maquillé.
- Extension Lab essentiel ; simulations inutiles retirées seulement après vérification des usages.
- Aucune action Production, push, release sans GO d'Antoni. Données fictives uniquement. Pas de contenu métier inventé.

## Ouvert

Questions Défis (3), Storyboard introuvable, classement des simulations — CONTEXTE § 13.

## Prochaine action

**Lot 5 — refonte d'Alertes** (éditeur, aperçu local, calibrage, file, source OBS, événements réels, variantes,
StreamElements) sur les primitives `rs-`, sans perte de capacité ; E2E `alerts` vert. Puis Soundboard, TTS, Bonk.

## Reprendre

```text
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux"
git status --short ; git log --oneline -8
npm run build -w @raptoru/schemas
cd apps/studio/web && npx tsc -p tsconfig.json
cd ../server && npx vitest run test/studio-shell.test.ts
dev\apercu-refonte-studio.cmd    (aperçu navigateur, données fictives)
```

Mettre à jour ce fichier et ROADMAP.md à chaque lot commité ; le détail daté va dans JOURNAL.md.
