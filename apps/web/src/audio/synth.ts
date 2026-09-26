// The first version of the effects - a few oscillators with an envelope and
// a low-pass filter. It stays as the fallback: until the orchestra samples
// have loaded (or if that never works), a toy sound beats silence.

/** The argument each effect takes; `undefined` = none. */
export interface EffectArgs {
  pin: undefined;
  /** `true` is "go", the last beat. */
  countdown: boolean;
  chat: undefined;
  submit: undefined;
  /** `true` for the last three seconds. */
  tick: boolean;
  /** Offset in seconds from now. */
  stamp: number;
  roundEnd: undefined;
  perfect: undefined;
  knockout: undefined;
  fanfare: undefined;
  finish: undefined;
}
export type EffectName = keyof EffectArgs;
export type EffectTable = { [N in EffectName]: (arg?: EffectArgs[N]) => void };

let ctx: AudioContext | null = null;
let synthOut: GainNode | null = null;

/** Connect once to the shared AudioContext. */
export function attachSynth(context: AudioContext, destination: AudioNode): void {
  ctx = context;
  synthOut = context.createGain();
  synthOut.gain.value = 0.35; // the oscillators are louder than the samples
  synthOut.connect(destination);
}

interface VoiceOptions {
  freq: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  glide?: number | null;
  attack?: number;
  cutoff?: number | null;
}

/**
 * A single voice at an *absolute* time of the audio clock.
 *
 * Without attack it clicks, without release every note sounds cut off. The
 * low-pass takes the edge off sawtooth and square - without it a fanfare
 * sounds like a door buzzer instead of brass.
 */
function voice(c: AudioContext, out: AudioNode, start: number, {
  freq, duration = 0.18, type = 'sine', gain = 0.25, glide = null, attack = 0.012, cutoff = null,
}: VoiceOptions): void {
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, start + duration);

  // The attack must never be longer than the note itself, or it stays silent.
  const rise = Math.min(attack, duration * 0.5);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + rise);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  let node: AudioNode = osc.connect(env);
  if (cutoff) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    node = node.connect(filter);
  }
  node.connect(out);

  osc.start(start);
  osc.stop(start + duration + 0.05);
}

type ToneOptions = VoiceOptions & { at?: number };

/** The same, but relative to now - that is how one thinks about effects. */
function tone({ at = 0, ...rest }: ToneOptions): void {
  if (ctx && synthOut) voice(ctx, synthOut, ctx.currentTime + at, rest);
}

type Shared = Omit<VoiceOptions, 'freq' | 'duration'>;

/** A run or a chord - `notes` are [frequency, start offset, duration]. */
function sequence(notes: readonly [number, number, number][], opts: Shared = {}): void {
  for (const [freq, at, duration] of notes) tone({ ...opts, freq, at, duration });
}

/** Several notes at once - minimally staggered, or it sounds stiff. */
function chord(freqs: readonly number[], at: number, duration: number, opts: Shared): void {
  freqs.forEach((freq, i) => { tone({ ...opts, freq, at: at + i * 0.012, duration }); });
}

// --- The effects --------------------------------------------------------------
//
// Frequencies from equal temperament: C4 = 262, G4 = 392, C5 = 523,
// E5 = 659, G5 = 784, C6 = 1047.

export const SYNTH: EffectTable = {
  /** Pin set - should hardly stand out, it happens often. */
  pin: () => { tone({ freq: 520, duration: 0.05, type: 'triangle', gain: 0.1 }); },

  /** 3-2-1 before the round - `go` is the starting shot, an octave higher. */
  countdown: (go = false) => {
    if (go) sequence([[784, 0, 0.1], [1047, 0.08, 0.28]], { type: 'triangle', gain: 0.32 });
    else tone({ freq: 523, duration: 0.12, type: 'triangle', gain: 0.28 });
  },

  /** New chat message - two quiet notes, more a tap on the shoulder than a signal. */
  chat: () => { sequence([[880, 0, 0.05], [1175, 0.05, 0.07]], { type: 'sine', gain: 0.06 }); },

  /** Guess submitted. */
  submit: () => { sequence([[523, 0, 0.09], [784, 0.06, 0.14]], { type: 'triangle', gain: 0.16 }); },

  /** Ticking in the last ten seconds, the last three higher. */
  tick: (urgent = false) => {
    tone({
      freq: urgent ? 1180 : 880,
      duration: urgent ? 0.07 : 0.045,
      type: 'square',
      gain: urgent ? 0.14 : 0.07,
    });
  },

  /** A stamp lands - short and dull (the orchestra has a bass drum for it). */
  stamp: (at = 0) => { tone({ freq: 110, at, duration: 0.12, type: 'triangle', gain: 0.2, cutoff: 600, attack: 0.003 }); },

  /**
   * Round over.
   *
   * The first version bent the frequency downwards - that sounds like a
   * sagging note, not like a signal. A gong works differently: fixed
   * pitches, a fast attack and a long decay. The two high voices are
   * slightly detuned overtones, which give it its metallic shimmer.
   */
  roundEnd: () => {
    const hit: Shared = { type: 'sine', attack: 0.004, cutoff: 3000 };
    tone({ ...hit, freq: 392, duration: 2.4, gain: 0.22 }); // G4, the fundamental
    tone({ ...hit, freq: 587, duration: 1.8, gain: 0.1 }); // D5, a pure fifth
    tone({ ...hit, freq: 1043, duration: 1.2, gain: 0.05 }); // a high overtone,
    tone({ ...hit, freq: 1061, duration: 1.0, gain: 0.04 }); // slightly off
  },

  /** Bullseye - first the run up, then the chord stays. */
  perfect: () => {
    sequence([[523, 0, 0.13], [659, 0.09, 0.13], [784, 0.18, 0.13]], { type: 'triangle', gain: 0.2, cutoff: 3500 });
    chord([1047, 1319, 1568], 0.28, 1.1, { type: 'triangle', gain: 0.16, cutoff: 3200 });
  },

  /** Duel: your own hit points are used up - short, low, unmistakable. */
  knockout: () => {
    const thud: Shared = { type: 'sawtooth', gain: 0.12, cutoff: 900, attack: 0.008 };
    sequence([[220, 0, 0.16], [185, 0.17, 0.16], [147, 0.34, 0.5]], thud);
    tone({ freq: 73, at: 0.34, duration: 0.7, type: 'triangle', gain: 0.16, cutoff: 500 });
  },

  /**
   * Final standings, and won.
   *
   * A fanfare lives on two things: a pickup of repeated short notes and a
   * *chord* at the end. A single long note getting quieter sounds like a
   * farewell - exactly what the first version was. Now a full C major over
   * three octaves stands at the end.
   */
  fanfare: () => {
    const brass: Shared = { type: 'sawtooth', gain: 0.1, cutoff: 2600 };
    // Pickup: three times G, dotted - the classic "ta-ta-ta".
    sequence([[392, 0, 0.11], [392, 0.16, 0.11], [392, 0.32, 0.13]], brass);
    sequence([[523, 0.5, 0.16], [659, 0.66, 0.16]], brass);

    // Final chord, broad and built up without letting go.
    chord([523, 659, 784, 1047], 0.84, 1.5, { ...brass, gain: 0.085, attack: 0.05 });
    chord([131, 196], 0.84, 1.7, { type: 'triangle', gain: 0.12, cutoff: 900, attack: 0.04 });
  },

  /** Final standings, but someone else was better - friendly, not sad. */
  finish: () => {
    sequence([[392, 0, 0.16], [523, 0.13, 0.16]], { type: 'triangle', gain: 0.14 });
    chord([523, 659, 784], 0.28, 0.9, { type: 'triangle', gain: 0.1, cutoff: 2600, attack: 0.03 });
  },
};
