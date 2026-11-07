import { CpRewardsSync, type CpRuleInput } from '@raptoru/schemas';
import type { ChannelPointsService } from '../channel-points/service.js';
import { CpError } from '../channel-points/service.js';

// The Lab has no Twitch: its Récompenses page would be empty and untestable. This fictional catalogue goes through the Core's
// own doors (syncRewards as for the list Twitch sends, saveRule as for the Studio editor), so every reward and action obeys
// the real contracts. Only the Lab Core exposes it (http/channel-points-routes.ts). Ids carry `lab-`: nothing real looks like them.

type Reward = CpRewardsSync['rewards'][number] & {
  actions: CpRuleInput['actions'];
};

export const LAB_REWARDS: readonly Reward[] = [
  {
    id: 'lab-song-request',
    title: 'Choisi la prochaine musique !',
    cost: 1500,
    prompt: 'Titre + artiste, ou lien Spotify',
    is_enabled: true,
    user_input_required: true,
    actions: [{ type: 'interaction', interaction: 'song_request' }],
  },
  {
    id: 'lab-song-skip',
    title: 'Skip la musique',
    cost: 3000,
    is_enabled: true,
    actions: [{ type: 'interaction', interaction: 'song_skip' }],
  },
  {
    id: 'lab-fx-cam',
    title: 'FX cam',
    cost: 1000,
    prompt: 'Nom de l’effet',
    is_enabled: true,
    user_input_required: true,
    actions: [{ type: 'interaction', interaction: 'fx_cam' }],
  },
  {
    id: 'lab-color-cam',
    title: 'Couleur Cam',
    cost: 800,
    prompt: 'Nom de la couleur',
    is_enabled: true,
    user_input_required: true,
    actions: [{ type: 'interaction', interaction: 'color_cam' }],
  },
  {
    id: 'lab-creepy',
    title: 'Creepy',
    cost: 2500,
    is_enabled: true,
    actions: [{ type: 'interaction', interaction: 'creepy' }],
  },
  {
    id: 'lab-brb',
    title: 'Be Right Back',
    cost: 5000,
    is_enabled: true,
    actions: [{ type: 'interaction', interaction: 'brb' }],
  },
  {
    id: 'lab-random-ban',
    title: 'Ban aléatoire',
    cost: 20000,
    is_enabled: true,
    actions: [{ type: 'interaction', interaction: 'random_ban' }],
  },
  {
    id: 'lab-credits-tts',
    title: 'Crédit TTS',
    cost: 2000,
    is_enabled: true,
    actions: [{ type: 'credits', currency: 'credits_tts', amount: 1 }],
  },
  {
    id: 'lab-credits-sound',
    title: 'Crédit Soundboard',
    cost: 500,
    is_enabled: true,
    actions: [{ type: 'credits', currency: 'credits_soundboard', amount: 1 }],
  },
  {
    id: 'lab-obs-scene',
    title: 'Scène pause (OBS fictif)',
    cost: 4000,
    is_enabled: true,
    actions: [{ type: 'obs_scene', scene: 'Pause', duration_ms: 10_000 }],
  },
  {
    id: 'lab-obs-filter',
    title: 'Filtre caméra (OBS fictif)',
    cost: 1200,
    is_enabled: true,
    actions: [
      {
        type: 'obs_filter',
        source: 'Caméra',
        filter: 'Couleur',
        enabled: true,
        duration_ms: 10_000,
      },
    ],
  },
  {
    id: 'lab-paused',
    title: 'Récompense en pause sur Twitch',
    cost: 100,
    is_enabled: true,
    is_paused: true,
    actions: [{ type: 'credits', currency: 'credits_tts', amount: 1 }],
  },
];

/** The catalogue as Twitch lists it: no rule. */
export const labRewardList = () =>
  LAB_REWARDS.map((r) => ({
    id: r.id,
    title: r.title,
    cost: r.cost,
    prompt: r.prompt,
    is_enabled: r.is_enabled,
    is_paused: r.is_paused,
    user_input_required: r.user_input_required,
  }));

/** Lists the catalogue as Twitch would, and writes a rule only where none exists: a rule edited in the Lab stays. */
export async function loadLabRewards(
  cp: ChannelPointsService,
  channelId: string,
) {
  const rewards = labRewardList();
  await cp.syncRewards({ channel_id: channelId, rewards });
  let rules = 0;
  for (const { id, actions } of LAB_REWARDS)
    try {
      await cp.saveRule(channelId, id, { enabled: true, actions });
      rules += 1;
    } catch (e) {
      if (!(e instanceof CpError) || e.status !== 409) throw e;
    }
  return { rewards: rewards.length, rules };
}
