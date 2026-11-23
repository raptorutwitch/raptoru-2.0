import type { ChatboxMessage } from './visibility.js';

// Chatbox Raptoru — the parity matrix (docs/CHATBOX.md § 7) as data: every case is a message of the demonstration AND
// a test case (test/chatbox-*.test.*). The viewers are fictional; the emotes are the channel's real ones (7TV, BTTV),
// FFZ / Twitch globals, so the demonstration shows what the stream will show. The badge images are Twitch's global
// ones (the Core gives the channel's real images at jalon 2).

const BADGE = (id: string) => `https://static-cdn.jtvnw.net/badges/v1/${id}/3`;
const B = {
  broadcaster: {
    set: 'broadcaster',
    version: '1',
    url: BADGE('5527c58c-fb7d-422d-b71b-f309dcb85cc1'),
  },
  moderator: {
    set: 'moderator',
    version: '1',
    url: BADGE('3267646d-33f0-4b17-b3df-f923a41db1d0'),
  },
  // Illustration: the Lead Moderator image comes with the Core's badge catalogue (jalon 2).
  lead_moderator: {
    set: 'lead_moderator',
    version: '1',
    url: BADGE('3267646d-33f0-4b17-b3df-f923a41db1d0'),
  },
  vip: {
    set: 'vip',
    version: '1',
    url: BADGE('b817aba4-fad8-49e2-b88a-7cc744dfa6ec'),
  },
  subscriber: {
    set: 'subscriber',
    version: '12',
    url: BADGE('5d9f2208-5dd8-11e7-8513-2ff4adfae661'),
  },
};

export const DEMO_USERS = {
  streamer: {
    id: '83603689',
    login: 'raptoru_',
    name: 'Raptoru_',
    color: '#ff6b3d',
    badges: [B.broadcaster],
  },
  mimi: {
    id: '9000001',
    login: 'mimi_croquette',
    name: 'Mimi_Croquette',
    color: '#ff69b4',
    badges: [B.subscriber],
  },
  duc: {
    id: '9000002',
    login: 'legrandduc',
    name: 'LeGrandDuc',
    color: '#4fc3f7',
    badges: [B.vip, B.subscriber],
  },
  // The Aouh case: a Twitch Lead Moderator (badge lead_moderator, no « moderator » badge).
  lead: {
    id: '9000003',
    login: 'modo_lead',
    name: 'Modo_Lead',
    color: '#9be8a0',
    badges: [B.lead_moderator, B.subscriber],
  },
  // A Raptoru supermod without any Twitch moderation badge: the Core's staff role confirms it.
  staff: {
    id: '9000004',
    login: 'super_modo',
    name: 'Super_Modo',
    color: '#c792ea',
    badges: [],
    staff: 'supermod' as const,
  },
  noColor: {
    id: '9000005',
    login: 'pixel_boulanger',
    name: 'pixel_boulanger',
    color: null,
    badges: [],
  },
  dark: {
    id: '9000006',
    login: 'nuitnoire',
    name: 'NuitNoire',
    color: '#1c1c6e',
    badges: [],
  },
  longName: {
    id: '9000007',
    login: 'le_pseudo_beaucoup_trop_long',
    name: 'Le_Pseudo_Beaucoup_Trop_Long_Pour_La_Carte',
    color: '#f6c85f',
    badges: [B.subscriber],
  },
  troll: {
    id: '9000008',
    login: 'troll_du_dimanche',
    name: 'Troll_Du_Dimanche',
    color: '#8a9cff',
    badges: [],
  },
  croupier: {
    id: '9000009',
    login: 'lecroupier_',
    name: 'LeCroupier_',
    color: '#f2c14e',
    badges: [B.moderator],
  },
  nightbot: {
    id: '9000010',
    login: 'nightbot',
    name: 'Nightbot',
    color: '#7c7cff',
    badges: [B.moderator],
  },
} satisfies Record<string, ChatboxMessage['user']>;
type U = keyof typeof DEMO_USERS;

export type DemoMessage = Omit<ChatboxMessage, 'id' | 'at' | 'user'> & {
  user: U;
};
const t = (text: string) => ({ t: 'text' as const, text });
const e = (id: string, text: string) => ({ t: 'emote' as const, id, text });

export interface ParityCase {
  id: string;
  label: string;
  message: DemoMessage;
}

/** One case per characteristic (P-numbers of docs/CHATBOX.md § 7); a few lines carry several messages. */
export const PARITY: ParityCase[] = [
  {
    id: 'P01',
    label: 'Emotes Twitch',
    message: {
      user: 'mimi',
      fragments: [
        t('Coucou tout le monde '),
        e('30259', 'HeyGuys'),
        t(' trop contente d’être là '),
        e('41', 'Kreygasm'),
      ],
    },
  },
  {
    id: 'P02',
    label: '7TV, BTTV, FFZ par nom',
    message: {
      user: 'duc',
      fragments: [t('Ce dessin est incroyable 199Poggies KEKW ZreknarF')],
    },
  },
  {
    id: 'P03',
    label: 'Zero-width 7TV empilées',
    message: {
      user: 'lead',
      fragments: [
        t('Au trou 199Pray 199Jail 199Sparkles et on n’en parle plus'),
      ],
    },
  },
  {
    id: 'P03b',
    label: 'Zero-width : emote seule empilée',
    message: { user: 'staff', fragments: [t('199CatDance 199Chapeau')] },
  },
  {
    id: 'P04',
    label: 'GIF et WebP animés',
    message: { user: 'noColor', fragments: [t('OOOO 199Dance PETTHEMODS')] },
  },
  {
    id: 'P05',
    label: 'Emojis Unicode',
    message: {
      user: 'mimi',
      fragments: [t('On y va 🔥🔥 vive la 🇫🇷 team 👩‍🎨 👍🏽')],
    },
  },
  {
    id: 'P06a',
    label: 'Emote seule agrandie',
    message: { user: 'duc', fragments: [t('199Poggies')] },
  },
  {
    id: 'P06b',
    label: 'Trois emotes seules',
    message: { user: 'dark', fragments: [t('KEKW KEKW KEKW')] },
  },
  {
    id: 'P06c',
    label: 'Six emotes seules (réduction)',
    message: {
      user: 'mimi',
      fragments: [t('199Dance 199Dance 199Dance 199Dance 199Dance 199Dance')],
    },
  },
  {
    id: 'P07',
    label: 'Emote Twitch dans le texte, badges',
    message: {
      user: 'streamer',
      fragments: [t('Merci pour le raid tout le monde '), e('25', 'Kappa')],
    },
  },
  {
    id: 'P09',
    label: '/me',
    message: {
      user: 'duc',
      action: true,
      fragments: [t('prend un café et revient tout de suite')],
    },
  },
  {
    id: 'P10',
    label: 'Pseudo trop long, mot trop long',
    message: {
      user: 'longName',
      fragments: [
        t(
          'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaah le jeu est trop bien',
        ),
      ],
    },
  },
  {
    id: 'P11a',
    label: 'Sans couleur Twitch (palette de secours)',
    message: {
      user: 'noColor',
      fragments: [t('Première fois que je passe ici, bonne ambiance')],
    },
  },
  {
    id: 'P11b',
    label: 'Couleur très sombre',
    message: {
      user: 'dark',
      fragments: [t('Mon pseudo est presque noir, on le lit quand même ?')],
    },
  },
  {
    id: 'P12a',
    label: 'Rôle : streamer (rouge)',
    message: {
      user: 'streamer',
      fragments: [t('Petite pause de 5 minutes et on reprend')],
    },
  },
  {
    id: 'P12b',
    label: 'Rôle : Lead Moderator (vert, cas Aouh)',
    message: {
      user: 'lead',
      fragments: [t('Je surveille le chat, tout va bien')],
    },
  },
  {
    id: 'P12c',
    label: 'Rôle : supermod Raptoru sans badge (vert)',
    message: {
      user: 'staff',
      fragments: [t('Rappel : on reste bienveillants')],
    },
  },
  {
    id: 'P12d',
    label: 'Rôle : VIP (rose)',
    message: { user: 'duc', fragments: [t('GG pour la partie !')] },
  },
  {
    id: 'P13',
    label: 'Réponse et mention',
    message: {
      user: 'mimi',
      reply: { name: 'LeGrandDuc', text: 'GG pour la partie !' },
      fragments: [
        t('merci '),
        { t: 'mention', text: '@LeGrandDuc' },
        t(' 199Pray'),
      ],
    },
  },
  {
    id: 'P19a',
    label: 'Commande Raptoru (masquée)',
    message: {
      user: 'mimi',
      fragments: [t('!roue')],
      command: { name: 'roue', known: true },
    },
  },
  {
    id: 'P19b',
    label: 'Réaction !!!!! (visible)',
    message: { user: 'duc', fragments: [t('!!!!!')] },
  },
  {
    id: 'P19c',
    label: 'Réaction !?!? (visible)',
    message: { user: 'noColor', fragments: [t('!?!? quoi')] },
  },
  {
    id: 'P19d',
    label: 'Commande inconnue (visible par défaut)',
    message: { user: 'troll', fragments: [t('!uptime')] },
  },
  {
    id: 'P19e',
    label: 'Nightbot (masqué par défaut)',
    message: {
      user: 'nightbot',
      fragments: [t('Le stream est en ligne depuis 2 h 14 min.')],
    },
  },
];

/** LeCroupier_'s families and Twitch's special messages (docs/CHATBOX.md § 6.3, § 6.4). */
export const SPECIALS: ParityCase[] = [
  {
    id: 'C01',
    label: 'Croupier : réponse à une commande',
    message: {
      user: 'croupier',
      fragments: [
        t('@Mimi_Croquette la Roue du Sub tourne dans 30 secondes !'),
      ],
      croupier: { family: 'commands:reply:roue' },
    },
  },
  {
    id: 'C02',
    label: 'Croupier : refus (cooldown)',
    message: {
      user: 'croupier',
      fragments: [t('@LeGrandDuc attends encore 40 s avant de rejouer.')],
      croupier: { family: 'commands:refusal:slot' },
    },
  },
  {
    id: 'C03',
    label: 'Croupier : mini-jeux',
    message: {
      user: 'croupier',
      fragments: [
        t('🎰 Mimi_Croquette gagne 1 200 Jetons à la machine à sous !'),
      ],
      croupier: { family: 'mini_game:reply' },
    },
  },
  {
    id: 'C04',
    label: 'Croupier : Level Up',
    message: {
      user: 'croupier',
      type: 'announcement',
      accent: 'purple',
      fragments: [t('LeGrandDuc passe niveau 25 ! Bravo 199Poggies')],
      croupier: { family: 'module:level_up' },
    },
  },
  {
    id: 'C05',
    label: 'Croupier : non catégorisé',
    message: {
      user: 'croupier',
      fragments: [t('Message envoyé à la main depuis le compte du bot.')],
      croupier: { family: null },
    },
  },
  {
    id: 'S01',
    label: 'Annonce Twitch',
    message: {
      user: 'streamer',
      type: 'announcement',
      accent: 'blue',
      fragments: [t('Ce soir à 21 h : tournoi de dessin avec le chat !')],
    },
  },
  {
    id: 'S02',
    label: 'Message mis en avant (points de chaîne)',
    message: {
      user: 'mimi',
      type: 'highlighted',
      fragments: [t('Je voulais juste dire que ce stream me fait du bien 💜')],
    },
  },
  {
    id: 'S03',
    label: 'Premier message',
    message: {
      user: 'noColor',
      type: 'first',
      fragments: [t('Bonjour, je découvre la chaîne !')],
    },
  },
];
