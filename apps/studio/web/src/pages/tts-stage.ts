// La scène TTS dans Studio : le VRAI décor du lecteur OBS (`tts-player/stage.js`, ses médias, sa bulle, ses sous-titres), monté
// à l'échelle sur un fond transparent. Rien n'est redessiné ici : une seule façon d'afficher un TTS. Deux usages :
// - miroir : il suit le message en cours, au mot que le lecteur signale ;
// - essai : lecture locale d'un texte avec un personnage, par les mêmes fonctions de voix, sans passer par le Core.

interface Character {
  id: string;
  displayName: string;
  accent: string;
  voicePool: { voiceProfileId: string; weight: number; category: string }[];
  timing: { mouthHoldMs: number };
}
interface Cast {
  ok: boolean;
  character: { id: string };
  voice: {
    id: string;
    lang: string;
    rate: number;
    pitch: number;
    variationRate?: number;
    variationPitch?: number;
    label: string;
  };
  category: string;
}
interface Stage {
  load(c: Character, o?: { mouthHoldMs?: number }): void;
  enter(): Promise<void>;
  showBubble(who: string, text: string, estimatedMs?: number): void;
  spokenAt(at: number): void;
  pulse(): void;
  finish(): Promise<void>;
  stop(): Promise<void>;
  reset(): void;
}
interface Mods {
  CharacterStage: new (
    el: HTMLElement,
    o: { assetBase: string; onMediaError?: (f: string) => void },
  ) => Stage;
  CHARACTERS: Character[];
  CHARACTERS_BY_ID: Record<string, Character>;
  VOICE_PROFILES: Record<string, Cast['voice']>;
  resolveCast(c: { character_id: string; voice_profile_id: string }): Cast;
  splitSpeech(t: string): string[];
  voiceFor(
    v: SpeechSynthesisVoice[],
    p: Cast['voice'],
  ): SpeechSynthesisVoice | null;
  narratorVoice(v: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null;
}

let loading: Promise<Mods> | null = null;
/** Les modules du lecteur, servis par Studio : aucune copie, aucun second moteur. */
function loadPlayer() {
  return (loading ??= (async () => {
    if (!document.querySelector('link[data-tts-stage]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = '/tts-lab/stage.css';
      l.dataset.ttsStage = '1';
      document.head.append(l);
    }
    const url = (p: string) => p;
    const [stage, chars, speech] = await Promise.all([
      import(/* @vite-ignore */ url('/tts-lab/stage.js')),
      import(/* @vite-ignore */ url('/ext/shared/tts-characters.js')),
      import(/* @vite-ignore */ url('/tts-lab/speech.js')),
    ]);
    return { ...stage, ...chars, ...speech } as Mods;
  })());
}

export interface Reading {
  interaction_id: string;
  viewer_display_name: string;
  message: string;
  estimated_duration_ms: number;
  cast: { character_id: string; voice_profile_id: string };
  delivery?: { started_at?: string };
}

export async function mountScene(host: HTMLElement) {
  const m = await loadPlayer();
  const fit = document.createElement('div');
  fit.className = 'd-scn__fit';
  host.append(fit);
  const stage = new m.CharacterStage(fit, { assetBase: '/ext/' });
  const scale = () => {
    fit.style.transform = `scale(${host.clientWidth / 1920})`;
  };
  new ResizeObserver(scale).observe(host);
  scale();

  let shown: string | null = null;
  let session = 0;
  let test = false;
  let hadSignal = false;

  const show = async (r: Reading) => {
    const cast = m.resolveCast(r.cast);
    const c = m.CHARACTERS_BY_ID[cast.character?.id ?? r.cast.character_id];
    if (!c) return;
    const s = ++session;
    stage.load(c);
    await stage.enter();
    if (s !== session) return;
    stage.showBubble(r.viewer_display_name, r.message, r.estimated_duration_ms);
    stage.pulse();
  };

  return {
    characters: m.CHARACTERS,
    voices: m.VOICE_PROFILES,
    /** Suit le message en cours. `at` : le caractère signalé par le lecteur, sinon estimé sur la durée. */
    follow(r: Reading | null, at: number | null) {
      if (test) return;
      if (!r) {
        if (shown) {
          shown = null;
          session += 1;
          void stage.stop();
        }
        return;
      }
      if (shown !== r.interaction_id) {
        shown = r.interaction_id;
        hadSignal = false;
        void show(r);
        return;
      }
      if (at !== null) {
        hadSignal = true;
        stage.spokenAt(at);
        stage.pulse();
      } else if (!hadSignal && r.delivery?.started_at) {
        const p =
          (Date.now() - Date.parse(r.delivery.started_at)) /
          Math.max(1000, r.estimated_duration_ms);
        stage.spokenAt(Math.min(1, p) * r.message.length);
        stage.pulse();
      }
    },
    /**
     * Essai local : personnage, voix, bulle, comme à l'antenne. Aucune demande n'est créée, aucun Jeton ne bouge. `onEnd` à la
     * fin ou à l'interruption.
     */
    async tryRead(
      o: { pseudo: string; message: string; character: string; voice: string },
      onEnd: () => void,
    ) {
      const s = ++session;
      test = true;
      const end = () => {
        if (s === session) {
          test = false;
          shown = null;
        }
        onEnd();
      };
      const synth = window.speechSynthesis;
      const c = m.CHARACTERS_BY_ID[o.character]!;
      const profile = m.VOICE_PROFILES[o.voice]!;
      stage.load(c);
      await stage.enter();
      if (s !== session) return end();
      stage.showBubble(o.pseudo, o.message);
      const voices = synth?.getVoices() ?? [];
      const voice = m.voiceFor(voices, profile);
      if (!voice) {
        // Sans voix sur ce PC, la scène reste juste : même bulle, sans son.
        await new Promise((r) => setTimeout(r, 3500));
        if (s === session) await stage.finish();
        return end();
      }
      let base = 0;
      for (const chunk of m.splitSpeech(o.message)) {
        if (s !== session) return end();
        const from = base;
        base += chunk.length;
        await new Promise<void>((done) => {
          const u = new SpeechSynthesisUtterance(chunk);
          u.voice = voice;
          u.lang = profile.lang;
          u.rate = profile.rate;
          u.pitch = profile.pitch;
          u.onboundary = (e) => {
            if (s !== session) return;
            stage.spokenAt(from + e.charIndex);
            stage.pulse();
          };
          u.onend = u.onerror = () => done();
          synth.speak(u);
        });
      }
      if (s === session) await stage.finish();
      end();
    },
    /** Le sous-titre à l'antenne, lisible sous la scène : une copie de la bulle, jamais un second calcul. */
    copySubtitle(to: HTMLElement) {
      const from = fit.querySelector<HTMLElement>('.tts-bubble');
      const on = from?.classList.contains('is-shown') ?? false;
      to.classList.toggle('is-spoken', !!from?.classList.contains('is-spoken'));
      const html = on
        ? (from?.querySelector('.tts-bubble__text')?.innerHTML ?? '')
        : '';
      if (to.innerHTML !== html) to.innerHTML = html;
    },
    stopTest() {
      if (!test) return;
      session += 1;
      window.speechSynthesis?.cancel();
      test = false;
      shown = null;
      void stage.stop();
    },
  };
}
export type Scene = Awaited<ReturnType<typeof mountScene>>;
