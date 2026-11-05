import { type ModuleDefinition, ModuleError } from './kit.js';

// Démonstration A (architecture socle, Lab only): a simple admin module — identity, navigation, settings, persistence,
// state, an admin action, history, supervision. Everything else (routes, settings storage and screen, journal, audit,
// Control Center) comes from the host. Fictional: a goal counter for the evening, no viewer action, no money.

export const objectifSoiree: ModuleDefinition = {
  id: 'objectif_soiree',
  label: 'Objectif de soirée',
  description:
    'Un compteur d’objectif pour le live (démonstration du socle, Lab uniquement) : une cible réglable, des ajouts et une remise à zéro.',
  category: 'outils',
  labOnly: true,
  capabilities: ['settings', 'admin', 'history', 'supervision', 'chat'],
  // « !objectif » in the chat: LeCroupier_ answers the progress (the host's chat door: switch, reserved word, origin).
  chatWords: ['objectif'],
  chat: (ctx) => ({
    name: 'objectif_soiree',
    async chat(msg) {
      if (!/^!objectif(\s|$)/i.test(msg.text.trim())) return { outcome: 'ignored' };
      return ctx.db.tx(async (q) => {
        const points = (await ctx.state.get<number>(q, msg.channel_id, 'points')) ?? 0;
        const cible = await ctx.setting(q, msg.channel_id, 'cible');
        const written = await ctx.say(q, msg.channel_id, {
          key: `msg:${msg.message_id}`,
          text: `Objectif de soirée : ${points} / ${cible} points.`,
        });
        return { outcome: 'objective_said', replayed: written === 0 };
      });
    },
  }),
  settings: {
    cible: {
      label: 'Cible de l’objectif',
      unit: 'points',
      default: 50,
      min: 1,
      max: 10_000,
    },
  },
  admin: {
    ajouter: {
      label: 'Ajouter des points',
      input: {
        key: 'points',
        label: 'Combien de points ?',
        min: 1,
        max: 1_000,
      },
      async run(ctx, q, { channelId, input }) {
        const n = Number((input as { points?: unknown } | null)?.points);
        if (!Number.isInteger(n) || n < 1 || n > 1_000)
          throw new ModuleError(400, 'invalid_points', { min: 1, max: 1_000 });
        const now = (await ctx.state.get<number>(q, channelId, 'points')) ?? 0;
        await ctx.state.set(q, channelId, 'points', now + n);
        return { points: now + n };
      },
    },
    remettre_a_zero: {
      label: 'Remettre à zéro',
      confirm:
        'Remettre le compteur de l’objectif à zéro ? L’historique est conservé.',
      async run(ctx, q, { channelId }) {
        await ctx.state.set(q, channelId, 'points', 0);
        return { points: 0 };
      },
    },
  },
  async status(ctx, channelId) {
    const points =
      (await ctx.state.get<number>(ctx.db, channelId, 'points')) ?? 0;
    const cible = await ctx.setting(ctx.db, channelId, 'cible');
    return {
      intention: 'on',
      observed: 'ready',
      summary: `${points} / ${cible} points${points >= cible ? ' · objectif atteint' : ''}`,
      reasons: [],
      activity: points >= cible ? 'Objectif atteint' : null,
    };
  },
};
