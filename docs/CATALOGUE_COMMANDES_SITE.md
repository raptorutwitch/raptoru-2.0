# Catalogue public des commandes sur raptoru.fr : conception

**Statut : conception seulement (11/11/2026).** Rien n'est construit, rien n'est publié. Le mandat post-live demande de
ne pas publier de catalogue complet sur raptoru.fr et de ne publier aucune consigne permanente du type « demande ton
inscription pour utiliser l'extension ». Inventaire de départ : [INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md).

## 1. Principe

Le catalogue n'est **jamais écrit à la main** : il est une **projection publique** de ce que le Core sait déjà, pour
qu'une commande renommée, coupée ou ajoutée change le site sans intervention.

```text
registres des modules (Core)  ─┐
Commands V2 (listed && enabled) ┼─► Core : catalogue public (lecture seule, sans donnée admin) ─► GET /v1/site/commands ─► raptoru.fr
couche de description publique ─┘
```

## 2. Les trois sources

1. **Commandes des modules** (codées en dur aujourd'hui : TTS, Random Ban, Caution, Tombola, Musique…). Chaque module
   exposerait une entrée `publicCommands` à côté de ses `chatWords` (nom, alias, syntaxe, coût, interrupteur qui la
   rend disponible). Le Core ne publie une commande que si **son interrupteur de Production est actif** (ex.
   `CAUTION_CHAT`, réglage du module, mode v2 de la Roue).
2. **Commands V2** : ce qui existe déjà — `admission.publicList` (route Lab `/v1/lab/commands/:c/public`) ne garde que
   `listed AND enabled` et renvoie nom, alias (sans mots réservés), description, syntaxe, groupes, cooldown, quota,
   `when`, `available_now`. À réutiliser tel quel.
3. **Couche de description publique** (nouvelle, petite table ou réglage Studio) : par mot, un texte pour les viewers,
   une catégorie d'affichage, un ordre, et un drapeau **`public`** **désactivé par défaut**. Une commande n'apparaît
   sur le site que si Antoni l'a explicitement rendue publique.

## 3. Ce qui ne sort jamais

- Les commandes d'équipe : `!addpoints`, `!removepoints`, `!crediter`, `!debiter`, `!wallet`, `!annuletombola`,
  `!songremove`, `!songskip` (filtrées par catégorie « équipe », pas seulement par le drapeau).
- Les permissions, grants, identités, soldes, listes d'autorisation, réglages internes.
- Les commandes Lab seulement (`!objectif`) et celles dont l'interrupteur est coupé.

## 4. Hosted Test et accès à l'extension

Le Hosted Test (extension visible des seuls testeurs) est **temporaire**. Le catalogue ne doit contenir aucune phrase
qui en fasse une règle permanente (« demande ton inscription »). Si une mention est nécessaire pendant l'essai, elle
vient d'un bandeau daté, piloté par un réglage du Core et retiré à la publication publique.

## 5. Lots proposés (sur GO d'Antoni)

1. Core : `publicCommands` par module + `GET /v1/site/commands` (projection, cache court, aucune donnée admin) ;
   tests : rien d'équipe, rien de coupé, Commands V2 `listed` seulement.
2. Studio : écran « Catalogue public » (texte, catégorie, ordre, interrupteur `public`), aperçu exact du site.
3. raptoru.fr : page lisant la route, sans texte en dur ; publication = décision d'Antoni.

Prérequis conseillés avant le lot 1 : corriger le tutoriel de l'extension et réserver les mots des modules
([INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md) § 5).
