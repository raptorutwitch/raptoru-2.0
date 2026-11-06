import { mountBonkLab } from './bonk-lab.js';
import { moduleFrame, whenProfile } from './module-frame.js';
import { mountSoundConfig } from './sound-config.js';
import { mountSoundLab } from './sound-lab.js';
import { mountTtsConfig } from './tts-config.js';
import { mountTtsLab } from './tts-lab.js';

// The pages of the modules whose controls live on the PC. Same cards in the Lab and in Production (their `production`
// option says which wording and controls apply); the Extension Lab keeps its own copy of the cards next to the surfaces.

type Card = { setVisible(v: boolean): void };

export function mountTtsPage(root: HTMLElement) {
  const frame = moduleFrame(root, {
    id: 'tts',
    title: 'TTS',
    lead: 'Les messages lus à l’antenne : la file, la source OBS, les prix et les limites.',
    tabs: [
      ['live', 'Direct'],
      ['rules', 'Prix et limites'],
    ],
  });
  const rules = mountTtsConfig(frame.panel('rules'));
  let card: Card | null = null;
  let visible = false;
  void whenProfile().then((p) => {
    card = mountTtsLab(frame.panel('live'), { production: p === 'production' });
    card.setVisible(visible);
  });
  frame.onTab((id) => {
    if (id === 'rules') void rules.refresh();
  });
  return {
    setVisible(v: boolean) {
      visible = v;
      card?.setVisible(v);
      if (v && frame.current() === 'rules') void rules.refresh();
    },
  };
}

export function mountBonkPage(root: HTMLElement) {
  const frame = moduleFrame(root, {
    id: 'bonk',
    title: 'Bonk',
    lead: 'Les impacts lancés par les viewers : connexion OBS, overlay, zone visée, prix.',
  });
  let card: Card | null = null;
  let visible = false;
  void whenProfile().then((p) => {
    card = mountBonkLab(frame.panel(), { production: p === 'production' });
    card.setVisible(visible);
  });
  return {
    setVisible(v: boolean) {
      visible = v;
      card?.setVisible(v);
    },
  };
}

/**
 * Soundboard: the bank, and in Production the player, loaded at launch (the Core refuses a purchase while it is absent).
 * In the Lab the player is the Extension Lab's: the page says so, a second player would double the sounds.
 */
export function mountSoundPage(root: HTMLElement) {
  const player = document.createElement('div');
  const bank = document.createElement('div');
  root.append(player, bank);
  const config = mountSoundConfig(bank);
  let card: Card | null = null;
  let visible = false;
  void whenProfile().then((p) => {
    if (p === 'production') {
      player.className = 'rs-page rs-sound-player';
      card = mountSoundLab(player, { production: true });
      card.setVisible(visible);
    }
  });
  return {
    setVisible(v: boolean) {
      visible = v;
      card?.setVisible(v);
      config.setVisible(v);
    },
  };
}
