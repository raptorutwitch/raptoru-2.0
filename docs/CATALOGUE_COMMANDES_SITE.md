# Catalogue public des commandes sur raptoru.fr : conception

**Statut au 11/11/2026 : conçu seulement.** Rien n'est développé, rien n'est publié, aucune route n'existe. Le mandat
demande de ne pas publier de catalogue complet avant qu'Antoni ait choisi les commandes conservées, et de ne publier
aucune consigne permanente du type « demande ton inscription pour utiliser l'extension ». Inventaire de départ :
[INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md).

| Étape                        | État        |
| ---------------------------- | ----------- |
| Inventaire                   | fait (doc)  |
| Contrat et modèle de données | conçu (§ 3) |
| Route Core                   | non         |
| Écran Studio                 | non         |
| Page raptoru.fr              | non         |
| Publication                  | non (GO)    |

## 1. Principe

Le catalogue n'est **jamais écrit à la main** : c'est une **projection publique** de ce que le Core sait déjà. Une
commande renommée, coupée ou ajoutée change le site sans intervention, et une commande n'y apparaît que si Antoni l'a
explicitement rendue publique.

```text
registres des modules (Core) ───┐
Commands V2 (listed && enabled) ┼─► Core : projection publique (lecture seule) ─► GET /v1/site/commands ─► raptoru.fr
fiches publiques (Studio) ──────┘
```

## 2. Les trois sources

1. **Commandes des modules** (codées dans le Core : TTS, Random Ban, Caution, Tombola, Musique…). Chaque module
   déclare `publicCommands` à côté de ses `chatWords` : mot, alias, syntaxe, module, et une fonction `available()` qui
   lit l'interrupteur réel (`CAUTION_CHAT`, réglage du module, mode v2 de la Roue, live). Le prix et le délai sont lus
   dans les réglages du module (`module-settings`), jamais recopiés.
2. **Commands V2** : `admission.publicList` existe déjà (route Lab `/v1/lab/commands/:c/public`) : nom, alias sans mots
   réservés, description, syntaxe, groupes, cooldown, quota, `when`, `available_now`, filtré `listed AND enabled`. À
   réutiliser tel quel.
3. **Fiches publiques** (nouvelle petite table, réglée dans Studio) : par mot, un texte pour les viewers, une catégorie
   d'affichage, un ordre, un exemple, et un drapeau `public` **désactivé par défaut**.

## 3. Contrat proposé

```jsonc
// GET /v1/site/commands — public, sans authentification, cache 60 s, aucune donnée d'équipe
{
  "updated_at": "2026-11-11T20:00:00Z",
  "categories": [
    {
      "id": "economie",
      "label": "Jetons",
      "commands": [
        {
          "word": "!daily",
          "aliases": [],
          "module": "daily",
          "summary": "Ta récompense du stream, une fois par live.",
          "syntax": "!daily",
          "example": "!daily",
          "cost": null, // { "amount": 7500, "currency": "Jetons" } quand payant, lu dans les réglages
          "cooldown_s": null,
          "audience": "everyone", // everyone | followers | subs | vips
          "when": "live", // always | live | offline
          "available_now": true,
        },
      ],
    },
  ],
}
```

Modèle de la table des fiches (migration à préparer **au moment du lot 1**, pas avant) :

```sql
create table site_command_cards (
  channel_id text not null,
  word text not null,              -- le mot sans « ! », clé de la commande (module ou Commands V2)
  public boolean not null default false,
  category text not null,          -- economie | jeux | interactions | musique | tombola | evenements
  position int not null default 0,
  summary text not null check (char_length(summary) <= 160),
  example text check (char_length(example) <= 80),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (channel_id, word)
);
```

## 4. Catégories proposées

Jetons (`!daily`, `!streak`, `!solde`, `!give`) · Jeux (`!mots`, `!roulette`, `!slots`, `!duel`) · Interactions
payantes (`!tts`, `!rb`, `!fxcam`, `!caution`) · Communauté (`!votekick`) · Musique (`!song`, `!songqueue`, `!mysong`,
`!songcancel`) · Tombola (`!join`) · Événements (`!bonbons`, `!peur`, seulement pendant l'événement).

## 5. Règles de publication

- Jamais : commandes d'équipe (`!addpoints`, `!removepoints`, `!crediter`, `!debiter`, `!wallet`, `!annuletombola`,
  `!songremove`, `!songskip`) — filtrées par catégorie « équipe » côté Core, pas seulement par le drapeau.
- Jamais : permissions, grants, identités, soldes, listes d'autorisation, adresses internes, secrets.
- Jamais : commandes Lab (`!objectif`), coupées par leur interrupteur, ou expérimentales non activées.
- Une commande sans fiche publique n'apparaît pas, même si elle existe.
- Le prix affiché est celui des réglages à l'instant de la lecture ; `available_now` dit si elle répond maintenant.

## 6. Hosted Test et accès à l'extension

Le Hosted Test (extension visible des seuls testeurs) est **temporaire**. Le catalogue ne contient aucune phrase qui en
fasse une règle permanente. Si une mention est utile pendant l'essai, elle vient d'un bandeau daté, piloté par un réglage
du Core, retiré à la publication publique de l'extension.

## 7. Interface proposée (raptoru.fr)

Une page « Commandes » dans le style V2 du site : une barre de catégories, une carte par commande (mot en gros, résumé,
syntaxe copiable, coût et délai en pastilles, « disponible maintenant » / « pendant le live »), une recherche. Aucun
texte en dur : tout vient de la route.

## 8. Lots proposés (sur GO d'Antoni)

1. Core : `publicCommands` par module + table `site_command_cards` + `GET /v1/site/commands` ; tests : rien d'équipe,
   rien de coupé, Commands V2 `listed` seulement, prix lus dans les réglages.
2. Studio : écran « Catalogue public » (fiche, catégorie, ordre, interrupteur `public`), aperçu exact du site.
3. raptoru.fr : la page ; publication = décision d'Antoni.

Prérequis conseillés : réserver les mots des modules et choisir le sort de `!solde @x`
([INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md) § 4 et § 6).
