// Registre de présentation de l’extension.
//
// Les contrats métier restent côté EBS. Ce fichier ne décide jamais d’un coût
// ou d’un droit : il décrit seulement comment une fonctionnalité s’insère dans
// le shell (navigation, tutoriel, thème et notifications).

import {
  getNotifications,
  notificationCenter,
  syncNotificationCenter,
} from './notifications.js';

export { syncNotificationCenter };

export const MODULE_PRESENTATION = Object.freeze({
  tts: Object.freeze({ shortLabel: 'TTS', accent: 'violet', homeDescription: 'Fais lire ton message' }),
  soundboard: Object.freeze({ shortLabel: 'Sons', accent: 'blue', homeDescription: 'Joue un son en direct' }),
  bonk: Object.freeze({ shortLabel: 'Bonk', accent: 'gold', homeDescription: 'Lance une emote à l’écran' }),
  raffle_join: Object.freeze({ shortLabel: 'Tombola', accent: 'green', homeDescription: 'Participe au tirage du stream' }),
  actions: Object.freeze({ shortLabel: 'Actions', accent: 'violet', homeDescription: 'Consulte tes interactions récentes' }),
  moderation: Object.freeze({ shortLabel: 'Modération', accent: 'moderation', homeDescription: 'Gère l’activité du stream' }),
});

// Un thème est toujours choisi dans cette liste. Le serveur pourra demander
// `halloween` ou `winter`, mais ne pourra jamais injecter du CSS arbitraire.
export const THEME_REGISTRY = Object.freeze({
  default: Object.freeze({ id: 'default', label: 'Raptoru Live' }),
  halloween: Object.freeze({ id: 'halloween', label: 'Halloween' }),
  winter: Object.freeze({ id: 'winter', label: 'Fêtes d’hiver' }),
});

export const CORE_TUTORIAL = Object.freeze({
  id: 'core',
  version: 2,
  title: 'Bien démarrer avec Raptoru Live',
  steps: Object.freeze([
    Object.freeze({
      id: 'welcome',
      icon: '✦',
      title: 'Interagis sans écrire dans le chat',
      body: 'Choisis une action puis lance-la directement depuis le live.',
      highlights: Object.freeze([
        Object.freeze({ label: 'JETONS', tone: 'gold' }),
        Object.freeze({ label: 'POINTS DE CHAÎNE', tone: 'violet' }),
      ]),
    }),
    Object.freeze({
      id: 'tokens',
      icon: '◆',
      kicker: 'À découvrir ensuite',
      title: 'Les jetons',
      body: 'Une monnaie secondaire pour garder tes points de chaîne. Gagne-les en regardant, avec un follow (+500), un abonnement, les dons, les bits et les jeux.',
      command: '!jetons pour voir ton solde',
    }),
    Object.freeze({
      id: 'games',
      icon: '✚',
      kicker: 'Comment en gagner davantage',
      title: 'Les jeux du stream',
      body: 'Daily, tombolas, mots, roulette, slots et duels récompensent ta participation. Une tombola reste ouverte 60 secondes : clique Rejoindre ou tape !join.',
      command: '!daily · !roulette 500 · !slot 500 · !duel @pseudo',
    }),
    Object.freeze({
      id: 'spend',
      icon: '↗',
      kicker: 'À toi de jouer',
      title: 'Dépenser ses jetons',
      body: 'Bonk 200 · Soundboard selon le son · TTS 2 000 · RandomBan 25 000. Les boutons indiquent toujours le coût avant l’envoi.',
      command: '!bonk · !soundboard · !tts · !rb',
    }),
    Object.freeze({
      id: 'more',
      icon: '⌘',
      kicker: 'Les commandes utiles',
      title: 'Quelques raccourcis',
      body: '!cashin convertit tes points de chaîne en jetons. !oracle répond à tes questions. !votekick lance un vote du chat, une fois par heure.',
    }),
    Object.freeze({
      id: 'bonk-emotes',
      icon: '☺',
      kicker: 'Bonk · dernière étape',
      title: 'Autoriser tes emotes',
      body: 'Pour voir tes emotes personnelles et celles des chaînes où tu es abonné, valide la demande Twitch puis reviens dans l’onglet Bonk.',
      action: 'identity',
    }),
    Object.freeze({
      id: 'finish',
      icon: '★',
      title: 'Amuse-toi bien !',
      body: 'Teste les interactions, propose tes idées et mentionne @Raptoru_ si tu as une question.',
    }),
  ]),
});

export function modulePresentation(moduleId) {
  return MODULE_PRESENTATION[moduleId] ?? Object.freeze({ shortLabel: moduleId, accent: 'violet', homeDescription: '' });
}

function safeTutorial(raw) {
  if (!raw || !Array.isArray(raw.steps) || !raw.steps.length) return CORE_TUTORIAL;
  const steps = raw.steps.slice(0, 8).map((step, index) => ({
    id: String(step?.id ?? `step-${index + 1}`),
    icon: String(step?.icon ?? '✦').slice(0, 4),
    kicker: String(step?.kicker ?? '').slice(0, 80),
    title: String(step?.title ?? '').slice(0, 80),
    body: String(step?.body ?? '').slice(0, 280),
    command: String(step?.command ?? '').slice(0, 120),
    action: step?.action === 'identity' ? 'identity' : null,
    highlights: Array.isArray(step?.highlights)
      ? step.highlights.slice(0, 3).map((highlight) => ({
        label: String(highlight?.label ?? '').slice(0, 32),
        tone: ['gold', 'violet', 'blue', 'green'].includes(highlight?.tone) ? highlight.tone : 'violet',
      })).filter((highlight) => highlight.label)
      : [],
  })).filter((step) => step.title && step.body);
  if (!steps.length) return CORE_TUTORIAL;
  return {
    id: String(raw.id ?? 'custom').slice(0, 40),
    version: Math.max(1, Number.parseInt(raw.version, 10) || 1),
    title: String(raw.title ?? 'Bien démarrer avec Raptoru Live').slice(0, 80),
    steps,
  };
}

export function resolveExperience(session) {
  const requestedTheme = String(session?.experience?.theme_id ?? 'default');
  return {
    theme: THEME_REGISTRY[requestedTheme] ?? THEME_REGISTRY.default,
    tutorial: safeTutorial(session?.experience?.tutorial),
  };
}

// Seules les entrées explicites de session.notifications sont persistantes.
// pending_actions, raffle.open et les files de modération sont des états
// runtime, chacun gardant sa propre surface métier.
export function notificationsFor(session, moduleId = null) {
  if (session) syncNotificationCenter(session);
  return getNotifications(moduleId);
}

export function notificationCount(session, moduleId = null) {
  if (session) syncNotificationCenter(session);
  return notificationCenter.unreadCount(moduleId);
}
