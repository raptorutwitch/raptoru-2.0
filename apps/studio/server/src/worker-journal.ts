// Journal ownership shared by the Bonk, Soundboard and TTS workers (ASTRA-P1-019 lot 2). Same worker
// semantics in both Studio profiles; only the transport, the route base and the Studio instance
// differ. A journal is marked with its profile: a Lab worker never reads a Production journal, a
// Production worker never adopts a Lab journal with pending work (it belongs to another instance).

export interface WorkerTransport {
  /** Route base on Core, e.g. `/v1/studio/tts` (Production); Lab default `/v1/lab/<module>`. */
  base?: string;
  /** Production: the authenticated Studio installation is the Studio instance. */
  studioId?: string;
}

export function bindJournal(
  state: { studio: string; entries: unknown[]; profile?: 'production' },
  options: WorkerTransport,
): void {
  if (!options.studioId) {
    if (state.profile === 'production')
      throw new Error('journal_profile_mismatch');
    return;
  }
  if (state.studio !== options.studioId) {
    // Work claimed under another identity (or by the Lab) cannot be acknowledged by this one.
    if (state.entries.length)
      throw new Error(
        state.profile === 'production'
          ? 'journal_studio_mismatch'
          : 'journal_profile_mismatch',
      );
    state.studio = options.studioId;
  }
  state.profile = 'production';
}

/** Production wiring of a module runtime (Bonk, Soundboard, TTS); absent = the Lab defaults. */
export interface RuntimeWiring {
  core: <T>(
    path: string,
    body?: unknown,
    options?: { timeoutMs?: number },
  ) => Promise<T>;
  /** Production journal file (never the Lab one). */
  journal: string;
  transport: Required<WorkerTransport>;
}
