import { DEMO_USERS, type DemoMessage, PARITY, SPECIALS } from './parity.js';
import type { ChatboxMessage } from './visibility.js';

// Chatbox Raptoru — the simulator (docs/CHATBOX.md § 9.1): representative scenarios played into the DEMO feed only
// (Studio's preview and the demonstration), never into a live OBS page. Same messages for the three profiles.

export type BusEvent =
  | { type: 'msg'; message: ChatboxMessage }
  | { type: 'delete'; id: string }
  | { type: 'clear_user'; userId: string }
  | { type: 'clear' };

type Step = { wait: number } & (
  | { message: DemoMessage; key?: string }
  | { delete: string }
  | { clearUser: keyof typeof DEMO_USERS }
  | { clear: true }
);

const seq = (cases: { message: DemoMessage }[], wait: number): Step[] =>
  cases.map((c) => ({ wait, message: c.message }));

const visible = PARITY.filter((c) => !c.id.startsWith('P19'));
const text = (s: string) => [{ t: 'text' as const, text: s }];

export const SCENARIOS: { id: string; label: string; steps: () => Step[] }[] = [
  {
    id: 'parite',
    label: 'Parité (toutes les caractéristiques)',
    steps: () => seq(PARITY, 1300),
  },
  {
    id: 'speciaux',
    label: 'Croupier et messages spéciaux',
    steps: () => seq(SPECIALS, 1500),
  },
  {
    id: 'rafale',
    label: 'Rafale',
    steps: () =>
      Array.from({ length: 36 }, (_, i) => ({
        wait: 110,
        message: visible[(i * 7) % visible.length]!.message,
      })),
  },
  {
    id: 'moderation',
    label: 'Modération',
    steps: () => [
      {
        wait: 400,
        message: { user: 'mimi', fragments: text('Bonsoir le chat 199Pray') },
      },
      {
        wait: 900,
        key: 'spam1',
        message: {
          user: 'troll',
          fragments: text('ACHETEZ MES FOLLOWERS PAS CHERS'),
        },
      },
      {
        wait: 700,
        message: {
          user: 'troll',
          fragments: text('vraiment pas chers du tout'),
        },
      },
      { wait: 700, message: { user: 'duc', fragments: text('Euh… modo ?') } },
      { wait: 1800, delete: 'spam1' },
      { wait: 1600, clearUser: 'troll' },
      {
        wait: 1200,
        message: {
          user: 'lead',
          fragments: text('C’est réglé, bonne soirée à tous'),
        },
      },
      { wait: 2600, clear: true },
      {
        wait: 1200,
        message: {
          user: 'streamer',
          fragments: text('Chat vidé, on repart propre !'),
        },
      },
    ],
  },
  {
    id: 'calme',
    label: 'Chat calme (disparition)',
    steps: () => [
      { wait: 300, message: visible[0]!.message },
      { wait: 3000, message: visible[1]!.message },
      { wait: 3000, message: visible[2]!.message },
    ],
  },
];

export class DemoRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private n = 0;
  playing: string | null = null;

  constructor(
    private readonly emit: (e: BusEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** A message of the simulator as the chatbox receives it. */
  message(m: DemoMessage, id = `demo-${++this.n}`): ChatboxMessage {
    const { user, ...rest } = m;
    return {
      ...structuredClone(rest),
      id,
      at: this.now(),
      user: structuredClone(DEMO_USERS[user]),
    };
  }

  /** One case of the parity matrix (or a special message), now: Studio's « envoyer ce message », the tests. */
  emitCase(id: string): string | null {
    const c = [...PARITY, ...SPECIALS].find((x) => x.id === id);
    if (!c) return null;
    const m = this.message(c.message);
    this.emit({ type: 'msg', message: m });
    return m.id;
  }

  play(id: string) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) return false;
    this.stop();
    this.playing = id;
    const steps = sc.steps();
    const keys = new Map<string, string>();
    const next = (i: number) => {
      const step = steps[i];
      if (!step) {
        this.playing = null;
        this.timer = null;
        return;
      }
      this.timer = setTimeout(() => {
        if ('message' in step) {
          const m = this.message(step.message);
          if (step.key) keys.set(step.key, m.id);
          this.emit({ type: 'msg', message: m });
        } else if ('delete' in step) {
          const target = keys.get(step.delete);
          if (target) this.emit({ type: 'delete', id: target });
        } else if ('clearUser' in step)
          this.emit({
            type: 'clear_user',
            userId: DEMO_USERS[step.clearUser].id,
          });
        else this.emit({ type: 'clear' });
        next(i + 1);
      }, step.wait);
      this.timer.unref?.();
    };
    next(0);
    return true;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.playing = null;
  }
}
