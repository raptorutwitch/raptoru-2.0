# Design system « Coulisses »

Direction D, validée par Antoni le 06/11/2026. Référence artistique : `prototypes/studio-redesign/d-coulisses/` (dans ce worktree
seulement). Référence d'implémentation : la page TTS (`apps/studio/web/src/pages/tts.ts`).

## Principes

- On voit ce qu'on pilote. Studio montre le résultat final et se règle dessus.
- Les interfaces sont vivantes et manipulables : tirer, déplacer, écrire et voir le résultat.
- Une composition par module. Un éditeur de commandes, une file musicale, une tombola et une interface de sanctions n'ont pas le
  même gabarit. Seuls le cadre (`page()`), les jetons et les contrôles sont communs.
- Les réglages avancés sont à portée sans envahir l'écran : sur l'objet d'abord, puis dans le panneau à la demande, avec recherche.
- Le Core décide. Une page montre et transmet ; elle ne calcule aucune règle métier.
- Jamais de `confirm()`, `alert()` ou `prompt()` natifs. Un interrupteur ordinaire agit tout de suite. Une action sensible ou
  irréversible a une confirmation explicite (`confirmBox`, `choiceBox`). Tout ce qui touche l'argent dit clairement ce qu'il fait.
- Pas de croix ambiguë : des verbes clairs (« Retirer et rembourser », « Retirer sans rembourser »).
- Aucun état inconnu maquillé. Pas de vert sur une intention seule. Chaque page a ses états vide, erreur, chargement et Core injoignable.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/ds/ds.css` | Jetons et composants, préfixe `d-` |
| `src/ds/ds.ts` | Contrôles, surcouches, cadre de page, relevés |
| `src/ds/icons.ts` | La seule famille d'icônes (`ic(nom)`) |
| `src/mod/mod.ts` | Modération native : détail d'une demande, fiche viewer, blocage, cooldown, Wallet, purge, état d'un module |
| `src/shell/` | Coque, navigation, palette Ctrl+K, supervision |
| `src/pages/<module>.ts` et `.css` | Les pages |

Le préfixe `d-` évite toute collision avec le CSS de l'extension, chargé dans Studio. Chaque page préfixe ses propres classes
(`tts-…`, `tb-…`). Une page ne définit pas de couleur en dur : elle utilise les jetons.

## Jetons

Fonds `--void --sheet --sheet2 --raise --raise2 --raise3`. Filets `--hair --hair2 --hair3`. Remplissages `--fill --fill2`. Encres
`--ink --ink2 --ink3`. Temps `--e` (sortie douce), `--spring`. Chiffres et titres `--num` (Bahnschrift des overlays, chiffres
tabulaires), texte `--text` (Inter de raptoru.fr).

La couleur signifie toujours quelque chose :

| Couleur | Sens |
|---|---|
| `--teal` | Action principale, état sain, chat, sélection |
| `--rose` | Extension Twitch, uniquement |
| `--gold` | Gros gains, Super, jackpot, Full, uniquement |
| `--amber` | Attention, 10 dernières secondes |
| `--red` | Danger, sanction, échec |
| `--mod` | Teinte discrète du module : `data-mod` sur la page (`tts`, `tombola`, `alerts`, `soundboard`, `bonk`, `spotify`, `commands`, `wheel`, `rewards`, `sanction`) |

Deux signatures : le cadre de visée `.d-vf` pour la sélection, jamais une grosse bordure ; la règle graduée pour le temps et les prix.
Pas de grosses cartes identiques, pas de dégradés décoratifs, pas d'ombres lourdes, pas d'éléments énormes.

## Une page

```ts
import { page, stateChip, panelBtn, poller, patch, keyed, grp, row, numrow, fld, sw, seg, ic } from '../ds/ds.js';

export function mountX(root: HTMLElement) {
  const p = page(root, { title: 'Soundboard', mod: 'soundboard', panel: true });
  p.body.innerHTML = `…la composition propre au module…`;
  const tick = poller(read, 2000);
  return { setVisible: (v: boolean) => (v ? tick.start() : tick.stop()) };
}
```

- `page()` : titre, `p.state`, `p.actions`, `p.body`, `p.panel` (`set`, `open(section)`, `close`, `toggle`). Le clic sur
  `[data-panel]` ouvre le panneau ; `panelBtn(ouvert)` donne ce bouton.
- Un seul relevé par page, seulement quand elle est visible (`poller`). `patch` et `keyed` ne réécrivent que ce qui change : le focus,
  le survol et le défilement restent en place. Une saisie en cours n'est jamais écrasée par un relevé.
- `setVisible(v)` obligatoire. `setFocus(ancre)` si la vue porte plusieurs pages.
- `grp`, `row`, `numrow`, `fld`, `sw`, `seg`, `pp` (visage d'un viewer), `ring`, `stateChip`.
- `pop`, `menu`, `drawer`, `confirmBox`, `choiceBox`, `toast(texte, { undo })`, `run(bouton, action, message)`, `errText`, `copy`, `scrub`.
- La largeur utile va de 1024 × 768 à 1920 × 1080 et plus. Sous 1180 px, la barre latérale passe aux icônes.
- `prefers-reduced-motion` est géré par `ds.css`. Les boutons d'icône ont un `aria-label`, le clavier suit (flèches sur les poignées).

## Un nouveau module

Un fichier `pages/<module>.ts` construit avec `page()`, une ligne dans `main.ts`, une entrée dans `shell/registry.ts` (ou rien pour un
module du socle : sa page vient du catalogue du Core). Il obtient d'office la navigation, la recherche Ctrl+K, le catalogue, les états,
les notifications, les confirmations, le panneau de réglages et la modération commune (`openItem`, `openViewer`, `removeMenu`, `purge`,
`setModuleState`).

Ne pas utiliser : `confirm`, `alert`, `prompt`, `<table>` de formulaire, cases à cocher natives, `rs-page`, classes historiques.
