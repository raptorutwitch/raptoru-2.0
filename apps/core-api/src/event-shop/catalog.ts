import type { EventShopItem } from '@raptoru/schemas';

// The Halloween catalogue seeded on a channel's first use (docs/HALLOWEEN.md). Studio changes everything afterwards
// (prices, cooldowns, on / off, names); this list only gives sensible starting values. Media ids are those of Studio's
// import (apps/studio/server/scripts/halloween-import.mjs): an item whose media Studio does not hold is not sold.
// Prices in Bonbons, for a conversion of 1 000 Jetons = 1 Bonbon capped at 10 per hour: a viewer converting at the cap
// affords ~3 small effects or one screamer per hour.

type Seed = Omit<EventShopItem, 'enabled' | 'sort' | 'params' | 'description'> &
  Partial<Pick<EventShopItem, 'enabled' | 'params' | 'description'>>;

const effect = (
  item_id: string,
  label: string,
  description: string,
  price: number,
  params: EventShopItem['params'] = {},
): Seed => ({
  item_id,
  kind: 'effect',
  media_id: null,
  effect: item_id as EventShopItem['effect'],
  label,
  description,
  price,
  cooldown_ms: 60_000,
  params,
});

const media = (
  kind: 'screamer' | 'apparition',
  item_id: string,
  label: string,
  price: number,
  extra: Partial<Seed> = {},
): Seed => ({
  item_id,
  kind,
  media_id: item_id,
  effect: null,
  label,
  price,
  cooldown_ms: kind === 'screamer' ? 600_000 : 120_000,
  ...extra,
});

const SEEDS: Seed[] = [
  effect('blink', 'Clignement', 'Ses yeux se ferment… puis se rouvrent.', 2, {
    durationMs: 900,
  }),
  effect('fog', 'Brouillard', 'Une brume épaisse envahit son écran.', 3, {
    durationMs: 9000,
  }),
  effect(
    'glitch',
    'Signal corrompu',
    'L’image se dérègle quelques secondes.',
    3,
    { durationMs: 2500 },
  ),
  effect(
    'tunnel',
    'Vision tunnel',
    'Les ténèbres se referment autour de sa vue.',
    3,
    { durationMs: 6000 },
  ),
  effect(
    'eyes',
    'Yeux dans le noir',
    'Quelque chose l’observe dans l’obscurité.',
    4,
    { durationMs: 5000 },
  ),
  effect(
    'silhouette',
    'Silhouette',
    'Une ombre l’observe depuis un coin de l’écran.',
    4,
    { durationMs: 4000 },
  ),
  media('apparition', 'chauves-souris', 'Chauves-souris', 5, {
    description: 'Une nuée traverse son écran.',
  }),
  media('apparition', 'araignee', 'Araignée', 5, {
    description: 'Une araignée se promène sur son écran.',
  }),
  media('apparition', 'ghost-girl', 'Fille fantôme', 6, {
    description: 'Elle apparaît… et s’approche.',
  }),
  media('apparition', 'bonnie-walking', 'Bonnie rôde', 6, {
    description: 'Bonnie passe longuement devant lui.',
    enabled: false,
  }),
  ...(
    [
      ['golden-freddy', 'Golden Freddy'],
      ['foxy', 'Foxy'],
      ['bonnie', 'Bonnie'],
      ['puppet', 'Puppet'],
      ['puppet-2', 'Puppet 2'],
      ['balloon-boy', 'Balloon Boy'],
      ['mickey', 'Mickey'],
      ['mickey-2', 'Mickey 2'],
      ['mickey-stare', 'Mickey te fixe'],
      ['cuphead', 'Cuphead'],
      ['huggy-wuggy', 'Huggy Wuggy'],
      ['clown', 'Clown'],
      ['clown-side', 'Clown de côté'],
      ['crane', 'Crâne'],
      ['glitch', 'Glitch'],
      ['stare-glitch', 'Regard glitché'],
      ['baby', 'Bébé'],
      ['enfant', 'Enfant'],
      ['enfant-2', 'Enfant 2'],
      ['chat', 'Chat'],
      ['hibou', 'Hibou'],
      ['castor', 'Castor'],
      ['castor-mutant', 'Castor mutant'],
      ['brique', 'Brique bizarre'],
      ['oeuf', 'Œuf'],
      ['tete-de-trou', 'Tête de trou'],
    ] as const
  ).map(([id, label]) =>
    // A media item id may equal an effect id (glitch): screamers are prefixed so both coexist.
    media('screamer', `s-${id}`, label, 10, {
      media_id: id,
      description: 'Screamer plein écran, avec son.',
    }),
  ),
];

export function defaultItems(): EventShopItem[] {
  return SEEDS.map((s, i) => ({
    description: '',
    enabled: true,
    params: {},
    ...s,
    sort: i * 10,
  }));
}

/** The thumbnail shipped with the extension (assets/halloween/): the media's, or the effect's drawing. */
export function thumbOf(item: Pick<EventShopItem, 'media_id' | 'effect'>) {
  return item.media_id
    ? `assets/halloween/${item.media_id}.jpg`
    : `assets/halloween/fx-${item.effect}.svg`;
}
