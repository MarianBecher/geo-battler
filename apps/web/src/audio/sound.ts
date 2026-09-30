// Sounds and music - a small orchestra.
//
// The samples (VSCO-2 CE, public domain) and the sampler come from
// tiny-orchestra and are served locally under /audio - the game runs on the
// LAN, nothing is fetched from a CDN. What is played lives in music.ts; this
// module is only about the when: which music belongs to which situation, and
// what the effects sound like.
//
// Three levels, because music is a matter of taste and effects are not:
// "full" (music and effects), "effects" (effects only), "off".
//
// Browsers only allow audio after a user gesture. The AudioContext is still
// created when the page loads: it stays silent until the first click
// unlocks it, but it may already load and decode samples - otherwise loading
// would only start with the click, and the music would come late. Loading
// happens in stages (see startLoading); until the effect instruments are in,
// the old synth effects stand in.

import { Orchestra, type Bus, type InstrumentName, type Performance, type Score } from 'tiny-orchestra';
import type { Anthem, AnthemIndex } from 'anthem-scores';
import { t } from '../i18n/index.ts';
import * as music from './music.ts';
import { SYNTH, attachSynth, type EffectArgs, type EffectName, type EffectTable } from './synth.ts';

export type { EffectArgs, EffectName };

const KEY = 'geo-battle-sound';
export const MODES = ['full', 'effects', 'off'] as const;
export type SoundMode = (typeof MODES)[number];
export type Mood = 'lobby' | 'game' | 'reveal';

/** "Music + sound" / "Sound only" / "Sound off", in the active language. */
export function modeLabel(mode: SoundMode): string {
  return t(`sound.mode.${mode}`);
}

const isMode = (value: unknown): value is SoundMode => MODES.some((m) => m === value);

function loadMode(): SoundMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (isMode(raw)) return raw;
    // The first version only knew on/off - "on" becomes "full".
    return raw === 'off' ? 'off' : 'full';
  } catch {
    return 'full'; // private mode or the like - then with everything
  }
}

function storeMode(): void {
  try { localStorage.setItem(KEY, mode); } catch { /* not a problem */ }
}

interface Engine {
  ctx: AudioContext;
  orch: Orchestra;
  /** Bus of the effects. */
  fx: Bus;
  sounds: EffectTable;
}

let engine: Engine | null = null;
let effectsReady = false; // effect instruments loaded - until then the synth effects play
let allLoaded = false; // everything loaded, including the brass for anthems and fanfare
let mode: SoundMode = loadMode();

function audio(): Engine | null {
  if (engine) return engine;
  if (typeof AudioContext === 'undefined') return null;

  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // Catches the peaks when drums, effects and the orchestra pile up (the
  // last seconds of a round) - below the threshold it does nothing.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);
  attachSynth(ctx, master);

  const orch = new Orchestra(ctx, { baseUrl: 'audio/samples/', destination: master });
  const fx = orch.bus({ gain: 1, reverb: 0.18 });
  engine = { ctx, orch, fx, sounds: orchestraSounds(ctx, orch, fx) };
  startLoading(orch);
  return engine;
}

// What the frequent effects need (pin, tick, countdown, submit, stamp).
const EFFECT_INSTRUMENTS: readonly InstrumentName[] = [
  'glockenspiel', 'marimba', 'harp', 'violinsPizz', 'celliPizz',
  'timpani', 'cymbal', 'bassdrum', 'woodblock',
];

/**
 * Everything at once would be a good 200 files, and the lobby theme needs
 * only a quarter of them. So first the theme that is due right now, then
 * the effects, then the rest - each theme starts as soon as *its*
 * instruments are there.
 */
function startLoading(orch: Orchestra): void {
  orch.load(themeInstruments(THEME[mood ?? 'lobby']))
    .then(() => { if (musicWanted()) resumeMusic(); })
    .then(() => orch.load(EFFECT_INSTRUMENTS))
    .then(() => { effectsReady = true; })
    .then(() => orch.load())
    .then(() => {
      allLoaded = true;
      if (musicWanted()) resumeMusic();
    })
    .catch((err: unknown) => { console.warn('[sound] samples not loaded', err); });
}

// --- Effects -----------------------------------------------------------------
//
// Everything in D major, or in the key of the anthem that is playing -
// effects lie on top of the music, and a bell note that fits the harmony does
// not grate even on the twentieth pin.

/** The key being played in right now - the anthem moves it. */
let key: music.MusicKey = music.HOME_KEY;

const pcIn = (pc: number, lo: number): number => lo + ((((pc - lo) % 12) + 12) % 12);
const triad = (k: music.MusicKey, lo: number): number[] =>
  [0, k.mode === 'minor' ? 3 : 4, 7].map((i) => pcIn(k.tonic + i, lo)).sort((a, b) => a - b);

// When the entry stamp visibly lands: .18 s delay plus a good half of its
// animation (style.css, .stamp.press).
const ARRIVAL_S = 0.42;

function orchestraSounds(ctx: AudioContext, orch: Orchestra, fx: Bus): EffectTable {
  /** One note, `at` relative to now. */
  const n = (instrument: InstrumentName, midi: number | null, at = 0, duration = 0.5, velocity = 0.6, variant?: string): void => {
    orch.note({ instrument, midi, at: ctx.currentTime + at, duration, velocity, out: fx, variant });
  };
  const hit = (instrument: InstrumentName, variant: string | undefined, at = 0, velocity = 0.6): void => {
    n(instrument, null, at, 1, velocity, variant);
  };
  /** Harp glissando - the notes shortly one after another, each may ring on. */
  const gliss = (notes: readonly number[], at = 0, step = 0.035, velocity = 0.45): void => {
    notes.forEach((m, i) => { n('harp', m, at + i * step, 1.5, velocity); });
  };
  const stamp = (at = 0): void => {
    hit('bassdrum', undefined, at, 0.35);
    hit('woodblock', undefined, at + 0.005, 0.18);
  };

  return {
    /** Pin set - a bell note from the pentatonic scale, a different one each time. */
    pin: () => {
      const scale = [0, 2, 4, 7, 9].map((i) => pcIn(key.tonic + i, 84));
      n('glockenspiel', scale[Math.floor(Math.random() * scale.length)] ?? 86, 0, 1, 0.22);
    },

    /**
     * 3-2-1 before the round: timpani on the fifth, `go` lands on the
     * tonic. Loud, because the travel theme is already playing - and a
     * pluck of the celli gives the timpani the attack it lacks on its own.
     */
    countdown: (go = false) => {
      if (!go) {
        n('timpani', 45, 0, 1, 0.85);
        n('celliPizz', 45, 0, 0.5, 0.6);
        return;
      }
      n('timpani', 50, 0, 1.5, 1);
      n('celliPizz', 50, 0, 0.5, 0.7);
      for (const m of [62, 66, 69, 74]) n('violinsPizz', m, 0, 0.5, 0.75);
      hit('cymbal', 'soft', 0, 0.45);
    },

    /** New chat message - two glockenspiel notes, clear enough to be heard over the reveal music. */
    chat: () => {
      n('glockenspiel', 88, 0, 0.6, 0.6);
      n('glockenspiel', 93, 0.09, 0.8, 0.55);
    },

    /** Guess submitted - a short harp glissando upwards. */
    submit: () => {
      gliss([62, 66, 69, 74, 78, 81, 86]);
      n('celliPizz', 50, 0, 0.5, 0.5);
    },

    /** Ticking seconds: pizzicato, the last three higher and with a woodblock. */
    tick: (urgent = false) => {
      if (urgent) {
        n('violinsPizz', 86, 0, 0.3, 0.6);
        hit('woodblock', undefined, 0, 0.45);
      } else {
        n('violinsPizz', 81, 0, 0.3, 0.38);
      }
    },

    /** A stamp lands - dull, short, with a bit of wood. */
    stamp,

    /** Round over: a timpani roll, then the entry stamp lands. */
    roundEnd: () => {
      n('timpani', 45, 0, ARRIVAL_S, 0.35, 'roll');
      n('timpani', 50, ARRIVAL_S, 2, 0.7);
      hit('cymbal', 'crash', ARRIVAL_S, 0.32);
      stamp(ARRIVAL_S);
    },

    /** Bullseye - bells and harp in the key that is about to come. */
    perfect: () => {
      const chord = triad(key, 72);
      gliss([...triad(key, 60), ...chord, ...triad(key, 84)], 0, 0.04, 0.4);
      [...chord, chord[0]! + 12].forEach((m, i) => { n('glockenspiel', m + 12, 0.1 + i * 0.09, 1.2, 0.3); });
      for (const m of chord) n('violins', m, 0.3, 0.9, 0.4);
    },

    /** Duel: hit points used up - low trombones going down, then the timpani. */
    knockout: () => {
      const lo = pcIn(key.tonic, 43);
      const fall: [number, number, number][] = [[lo + 7, 0, 0.3], [lo + 3, 0.2, 0.3], [lo, 0.4, 1.1]];
      for (const [m, at, len] of fall) n('trombone', m, at, len, 0.55);
      n('tuba', lo - 12, 0.4, 1.2, 0.45);
      n('timpani', pcIn(key.tonic, 41), 0.4, 1.5, 0.6);
    },

    /** Final standings, won: a fanfare with a pickup, then the whole orchestra. */
    fanfare: () => {
      for (const at of [0, 0.16, 0.32]) n('trumpet', 69, at, 0.13, 0.65);
      n('trumpet', 74, 0.5, 0.16, 0.7);
      n('trumpet', 78, 0.66, 0.16, 0.72);
      const at = 0.84;
      for (const m of [69, 74, 78]) n('trumpet', m, at, 1.6, 0.7);
      for (const m of [62, 66]) n('horn', m, at, 1.7, 0.6);
      for (const m of [57, 62]) n('trombone', m, at, 1.7, 0.55);
      for (const m of [86, 90]) n('violins', m, at, 1.8, 0.5);
      n('celli', 50, at, 1.8, 0.55);
      n('tuba', 38, at, 1.8, 0.5);
      n('timpani', 50, at - 0.3, 0.3, 0.45, 'roll');
      n('timpani', 50, at, 2, 0.8);
      hit('cymbal', 'crash', at, 0.55);
      hit('bassdrum', undefined, at, 0.5);
    },

    /** Final standings, but someone else was better - friendly, not sad. */
    finish: () => {
      n('horn', 69, 0, 0.35, 0.45);
      n('horn', 74, 0.3, 1.4, 0.45);
      for (const m of [74, 78]) n('violins', m, 0.6, 1.3, 0.35);
      for (const m of [62, 66, 69]) n('violas', m, 0.6, 1.3, 0.3);
      n('celli', 50, 0.6, 1.4, 0.4);
      gliss([62, 66, 69, 74, 78], 0.6, 0.06, 0.35);
    },
  };
}

// --- Music -------------------------------------------------------------------

// How loud each situation may be. While guessing the music steps back - the
// ticking has to come through there. The reveal plays the lobby theme, but
// quieter: people read and talk there.
// The samples are normalised to peak level and played softly - hence the
// values above 1.
const LEVEL = { lobby: 1.8, game: 2.2, reveal: 1.0, anthem: 1.8 } as const;
type ThemeName = 'lobby' | 'game';
const THEME: Record<Mood, ThemeName> = { lobby: 'lobby', reveal: 'lobby', game: 'game' };
const BUILD: Record<ThemeName, () => Score> = { lobby: music.lobbyTheme, game: music.travelTheme };
const scores: Partial<Record<ThemeName, Score>> = {};

const scoreOf = (name: ThemeName): Score => (scores[name] ??= BUILD[name]());
const themeInstruments = (name: ThemeName): InstrumentName[] =>
  [...new Set(scoreOf(name).parts.filter((p) => p.notes.length).map((p) => p.instrument))];
const themeReady = (orch: Orchestra, name: ThemeName): boolean => themeInstruments(name).every((i) => orch.has(i));

interface Playing {
  perf: Performance | null;
  bus: Bus;
}

let mood: Mood | null = null;
let theme: (Playing & { name: ThemeName; level: number }) | null = null;
let anthem: Playing | null = null; // the anthem that is playing
let arrival = 0; // counts up, so an old arrival cannot interfere
let revealFallback: ReturnType<typeof setTimeout> | undefined;
let firstTheme = true; // the very first music of the page fades in longer
const FIRST_FADE_S = 4;

function musicWanted(): boolean {
  return mode === 'full' && mood !== null;
}

function fadeOut(part: Playing | null, seconds: number): void {
  if (!part) return;
  part.perf?.stop(seconds);
  part.bus.fade(0, seconds);
  setTimeout(() => { part.bus.dispose(); }, seconds * 1000 + 500);
}

function stopTheme(seconds = 0.9): void {
  stopPressure(seconds);
  fadeOut(theme, seconds);
  theme = null;
}

// --- Time pressure -------------------------------------------------------------
//
// In the last seconds of a round a second performance joins the travel
// theme: driving strings, a heartbeat, the timpani (music.pressureLayer).
// It comes in on the theme's next bar line so both stay in step, starts
// quietly and grows to its full level exactly when time runs out.

let pressure: Playing | null = null;
// Bus level of the layer at its entry and when time runs out. It starts well
// below its end, so the thirty seconds keep growing; the stages add their
// own crescendo on top (music.pressureLayer).
const PRESSURE_FROM = 1.1;
const PRESSURE_TO = 2.6;
// Meanwhile the calm theme steps back, and harp and glockenspiel leave it
// entirely - they should not idyllically carry on over the drums.
const THEME_DUCK = 0.3;
const CALM_INSTRUMENTS: readonly InstrumentName[] = ['harp', 'glockenspiel'];

/** Fade the calm parts of the running theme to `gain`. */
function fadeCalm(gain: number, seconds: number): void {
  if (!theme?.perf) return;
  scoreOf(theme.name).parts.forEach((p, i) => {
    if (CALM_INSTRUMENTS.includes(p.instrument)) theme?.perf?.part(i)?.fade(gain, seconds);
  });
}

function stopPressure(seconds = 0.9): void {
  if (!pressure) return;
  fadeOut(pressure, seconds);
  pressure = null;
  if (theme) theme.bus.fade(theme.level, seconds);
  fadeCalm(1, seconds);
}

function startPressure(secondsLeft: number, from: number): void {
  if (pressure || !engine || !theme?.perf || theme.name !== 'game') return;
  const { ctx, orch } = engine;
  const perf = theme.perf;
  // The next bar line of the running theme - at least a moment ahead, so
  // the scheduler still gets the downbeat. The theme keeps its tempo, so
  // the bar number follows from the time.
  const at = perf.nextBar(ctx.currentTime + 0.15);
  const bar = Math.round((at - perf.startTime) / (perf.beatsPerBar * 60 / perf.bpm));
  // Not before `from` seconds are left - the entry blow marks exactly that moment.
  if (secondsLeft - (at - ctx.currentTime) > from) return;
  const score = music.pressureLayer(bar % music.GAME_BARS);
  if (!score.parts.every((p) => !p.notes.length || orch.has(p.instrument))) return;

  const lead = Math.max(0.2, at - ctx.currentTime);
  const bus = orch.bus({ gain: 0, reverb: 0.25 });
  bus.fade(PRESSURE_FROM, lead);
  theme.bus.fade(theme.level * THEME_DUCK, lead + 1);
  fadeCalm(0, lead + 1);
  // The crescendo: from the entry up to the end of the round.
  const rise = Math.max(1, secondsLeft - lead);
  setTimeout(() => { if (pressure?.bus === bus) bus.fade(PRESSURE_TO, rise); }, lead * 1000);
  pressure = { perf: orch.play(score, { at, out: bus, loop: true }), bus };
}


function stopAnthem(seconds = 1.2): void {
  arrival++; // an anthem that is still loading should not come in afterwards
  fadeOut(anthem, seconds);
  anthem = null;
  key = music.HOME_KEY;
}

/** Play the theme for the situation - if the right one is running, only adjust the level. */
function playTheme(forMood: Mood | null): void {
  if (!forMood || !engine) return;
  const { ctx, orch } = engine;
  const name = THEME[forMood];
  if (!themeReady(orch, name)) return;
  const level = LEVEL[forMood];
  if (theme?.name === name) {
    // Only when the level changes - otherwise the first click would replace
    // the running fade-in with a short one.
    if (theme.level !== level) theme.bus.fade(level, 1.2);
    theme.level = level;
    return;
  }
  stopTheme();
  const bus = orch.bus({ gain: 0, reverb: 0.35 });
  // Slowly the first time - music that stands there at full volume with the
  // first click startles more than it invites.
  bus.fade(level, firstTheme ? FIRST_FADE_S : 1.5);
  firstTheme = false;
  const perf = orch.play(scoreOf(name), { at: ctx.currentTime + 0.1, out: bus, loop: true });
  theme = { name, perf, bus, level };
}

/** After unlocking, loading or switching: catch up on the music for the situation. */
function resumeMusic(): void {
  if (mood === 'reveal' && anthem) return; // the anthem is playing, it brings the theme back itself
  playTheme(mood);
}

// --- Anthems -----------------------------------------------------------------
//
// The data comes from anthem-scores: per country a few bars of melody, bass
// and inner voices. It is only loaded once the country is known - on the
// LAN that is faster than the timpani roll.

let anthemIndex: Promise<AnthemIndex> | null = null;
const anthemCache = new Map<string, Promise<Anthem | null>>();

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  const res = await fetch(url);
  return res.ok ? ((await res.json()) as T) : fallback;
}

async function loadAnthem(code: string | null | undefined): Promise<Anthem | null> {
  if (!code) return null;
  try {
    anthemIndex ??= fetchJson<AnthemIndex>('audio/anthems/index.json', {});
    const entry = (await anthemIndex)[code.toUpperCase()];
    if (!entry) return null;
    let cached = anthemCache.get(entry.file);
    if (!cached) {
      cached = fetchJson<Anthem | null>(`audio/anthems/${entry.file}`, null);
      anthemCache.set(entry.file, cached);
    }
    return await cached;
  } catch (err) {
    console.warn('[sound] anthem not loaded', code, err);
    return null;
  }
}

// The sequence after the stamp lands: the anthem's dominant chord swells,
// then the anthem comes in. A bullseye (at 0.4 s) has died away by then, a
// knockout (at 1.4 s) gets a little more room.
const DOMINANT_S = 1.6;
const ANTHEM_S = 2.7;
const KNOCKOUT_EXTRA_S = 1.1;
const ANTHEM_GIVE_UP_S = 6; // if the anthem takes longer to load, rather go straight to the theme

/**
 * Arrival in the reveal: roll, stamp, then the anthem of the country the
 * place was in. Without an anthem (sea, no data) a small cadence.
 */
export function arrive(countryCode: string | null | undefined, { knockedOut = false }: { knockedOut?: boolean } = {}): void {
  clearTimeout(revealFallback);
  play('roundEnd');
  if (!musicWanted() || !allLoaded || !engine) {
    if (musicWanted()) playTheme('reveal');
    return;
  }
  const { ctx, orch } = engine;

  const id = ++arrival;
  const t0 = ctx.currentTime + (knockedOut ? KNOCKOUT_EXTRA_S : 0);
  fadeOut(anthem, 0.3);
  const bus = orch.bus({ gain: LEVEL.anthem, reverb: 0.4 });
  const part: Playing = { perf: null, bus };
  anthem = part;

  void loadAnthem(countryCode).then((data) => {
    if (id !== arrival) return;
    const late = ctx.currentTime - t0 > ANTHEM_GIVE_UP_S;
    const usable = late ? null : data;
    key = usable ? usable.key : music.HOME_KEY;

    // The transition - right away when late, otherwise in its place.
    const start = Math.max(ctx.currentTime + 0.05, t0 + DOMINANT_S);
    const { bass, mid, top } = music.dominantOf(key);
    const swell = (instrument: InstrumentName, midi: number, velocity: number): void => {
      orch.note({ instrument, midi, at: start, duration: ANTHEM_S - DOMINANT_S, velocity, out: bus });
    };
    swell('celli', bass, 0.4);
    swell('basses', bass - 12, 0.3);
    for (const m of mid) swell('horn', m, 0.35);
    swell('violins', top, 0.35);
    [bass + 12, ...mid, top, top + 5].forEach((m, i) => orch.note({
      instrument: 'harp', midi: m, at: start + 0.6 + i * 0.05, duration: 1.5, velocity: 0.35, out: bus,
    }));

    const score = usable ? music.anthemScore(usable) : music.cadenceScore();
    const perf = orch.play(score, { at: start + (ANTHEM_S - DOMINANT_S), out: bus });
    part.perf = perf;

    // Afterwards the lobby theme may quietly come back.
    const rest = Math.max(0, perf.endTime - ctx.currentTime) + 1.5;
    setTimeout(() => {
      if (id !== arrival || mood !== 'reveal') return;
      fadeOut(anthem, 1.5);
      anthem = null;
      key = music.HOME_KEY;
      playTheme('reveal');
    }, rest * 1000);
  });
}

// --- Public ------------------------------------------------------------------

/** Play an effect; `arg` is what that effect takes (see EffectArgs). */
export function play<N extends EffectName>(name: N, arg?: EffectArgs[N]): void {
  if (mode === 'off') return;
  try {
    // After a tab switch the context is sometimes left "suspended".
    if (engine?.ctx.state === 'suspended') void engine.ctx.resume().catch(() => {});
    const e = audio();
    if (!e) return;
    const table: EffectTable = effectsReady ? e.sounds : SYNTH;
    table[name](arg);
  } catch (err) {
    console.warn('[sound]', err);
  }
}

/**
 * Which situation holds right now - the screens report it, the music
 * follows. `null` means silence (final standings: the fanfare has that
 * moment to itself). "reveal" only ends the round music; what comes after is
 * decided by `arrive()` once the country is known.
 */
export function setMood(next: Mood | null): void {
  if (mood === next) return;
  mood = next;
  clearTimeout(revealFallback);

  if (next !== 'reveal' && anthem) stopAnthem();
  if (!musicWanted()) {
    stopTheme();
    return;
  }
  if (next === 'reveal') {
    stopTheme(0.8);
    // After a reload into the reveal no arrive() comes - then straight to the theme.
    revealFallback = setTimeout(() => {
      if (mood === 'reveal' && !anthem) playTheme('reveal');
    }, 2500);
    return;
  }
  playTheme(next);
}

/**
 * How much earlier than `from` to start calling `hurry`: the layer enters on
 * the first bar line of the theme within the last `from` seconds, and a bar
 * lasts about 3.6 s - called only at `from`, the blow would come up to a bar late.
 */
export const HURRY_LOOKAHEAD_S = 4;

/**
 * Time is running out: `secondsLeft` until the round ends, or `null` when
 * the pressure is off again (pause, new round). The layer comes in on the
 * first bar line with at most `from` seconds left. The timer calls this on
 * every tick - once the layer runs, further calls change nothing, and when
 * its instruments are not loaded yet, a later call tries again.
 */
export function hurry(secondsLeft: number | null, from = 30): void {
  if (secondsLeft === null) {
    stopPressure(1.5);
    return;
  }
  // At zero it keeps going: the switch to the reveal ends it, right into the timpani roll.
  if (secondsLeft <= 0 || !musicWanted() || mood !== 'game') return;
  try {
    startPressure(secondsLeft, from);
  } catch (err) {
    console.warn('[sound]', err);
  }
}

/** Samples loaded? Until then only the synth effects sound. */
export function samplesReady(): boolean {
  return allLoaded;
}

export function currentMood(): Mood | null {
  return mood;
}

export function currentMode(): SoundMode {
  return mode;
}

/** In turn: music + sound -> sound only -> off. */
export function cycleMode(): SoundMode {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? 'full';
  storeMode();

  if (musicWanted()) {
    audio();
    resumeMusic();
  } else {
    stopTheme(0.4);
    if (anthem) stopAnthem(0.4);
  }

  // Brief feedback that something happened - except when switching off.
  if (mode !== 'off') play('pin');
  return mode;
}

/**
 * Browsers only release audio after a user gesture. We create the context
 * right away so the samples load; the first click or key press unlocks it,
 * and the music starts as soon as its theme has loaded.
 */
export function unlockOnFirstGesture(): void {
  if (mode !== 'off') audio();
  const unlock = (): void => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (mode === 'off') return;
    const e = audio();
    if (!e) return;
    e.ctx.resume()
      .then(() => { if (musicWanted()) resumeMusic(); })
      .catch(() => { /* then next time */ });
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
