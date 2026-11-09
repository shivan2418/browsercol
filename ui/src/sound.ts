// FreeCol's music and sound effects in the browser, played by resource key as SoundController plays them:
// music on an <audio> element, sound effects as buffers decoded ahead and played on one long-lived Web Audio
// context (each its own source, so effects overlap and the first one needs no download, #391), and the default
// playlist whenever no other music plays.
// The keys resolve through the audio manifest (resources.ts, audioManifest).
import type { AudioManifest } from './resources';

/** The part of an <audio> element the player uses. */
export interface AudioLike {
  src: string;
  volume: number;
  onended: ((ev: Event) => void) | null;
  play(): Promise<void>;
  pause(): void;
}

/**
 * The sound effects' output: one long-lived Web Audio context behind the effects volume. A buffer is whatever
 * load() resolves to; play() starts it as a source of its own, so plays overlap.
 */
export interface EffectsOutput {
  /** Fetch and decode a file. */
  load(url: string): Promise<unknown>;
  /** Start a decoded buffer now; nothing plays while the output is suspended or still waiting for a gesture. */
  play(buffer: unknown): void;
  /** Stop every effect that is playing. */
  stopAll(): void;
  setVolume(amplitude: number): void;
  /** Hold the output (the page is hidden) or let it run; resume() also needs the player's first gesture. */
  suspend(): void;
  resume(): void;
}

/** How long an effect asked for before it is decoded may wait for that: later it would be stale. */
export const EFFECT_WAIT_MS = 300;

export interface SoundPlayerDeps {
  /** The URL of the audio directory, ending in a slash. */
  base: string;
  makeAudio?: () => AudioLike;
  makeEffects?: () => EffectsOutput;
  now?: () => number;
  /** A number in [0, 1), for shuffling the playlist. */
  random?: () => number;
  /** Run a function once the player next clicks or presses a key: the browser lets a page play sound only then. */
  afterGesture?: (f: () => void) => void;
}

export interface SoundPlayer {
  /** GUI.playSound: a music key on the music player, any other on the effects player; null stops the effect. */
  play(key: string | null): void;
  /** SoundController.setDefaultPlaylist, as the game starts: the playlist, shuffled, whenever no music plays. */
  startPlaylist(): void;
  /**
   * The game has started: fetch and decode every sound effect file, so the first play of an effect needs no
   * download (#391). Nothing is fetched while the effects volume is 0; raising it fetches them.
   */
  preloadEffects(): void;
  /** The music and sound effects volume options, as percentages. */
  setVolumes(v: { music: number; effects: number }): void;
  /** The page is hidden or minimised (true): the sound pauses, and goes on from where it was once it shows again. */
  setHidden(hidden: boolean): void;
  /**
   * The start screen is up (true): music the browser refuses waits for choose() instead of the next click or key
   * anywhere. choose() is the player's New Game or Continue click: music that waited starts now, inside that click.
   */
  waitForChoice(wait: boolean): void;
  choose(): void;
}

/**
 * SoundPlayer.changeVolume's gain, min + (max - min)/2 * log10(vol) for a percentage vol, as an amplitude
 * with the gain running from -80 dB to 0 dB: (vol/100)^2.
 */
export const amplitude = (percent: number): number => (Math.max(0, Math.min(100, percent)) / 100) ** 2;

export function soundPlayer(manifest: AudioManifest, deps: SoundPlayerDeps): SoundPlayer {
  const makeAudio: () => AudioLike = deps.makeAudio ?? (() => new Audio());
  const random = deps.random ?? Math.random;
  const afterGesture = deps.afterGesture ?? onFirstGesture;
  const music = makeAudio();
  let effectsOut: EffectsOutput | null = null;
  const effects = () => {
    if (!effectsOut) {
      effectsOut = (deps.makeEffects ?? webAudioEffects)();
      effectsOut.setVolume(effectsVolume);
    }
    return effectsOut;
  };
  const now = deps.now ?? (() => performance.now());
  let effectsVolume = 1;
  /** Decoded effect buffers by file, the files being fetched, and the effects waiting for theirs, with when asked. */
  const buffers = new Map<string, unknown>();
  const loading = new Set<string>();
  const askedAt = new Map<string, number>();
  let preloadWanted = false;
  let gestureHooked = false;
  const loadEffect = (file: string) => {
    if (buffers.has(file) || loading.has(file)) return;
    loading.add(file);
    effects()
      .load(deps.base + file)
      .then(
        (buf) => {
          loading.delete(file);
          buffers.set(file, buf);
          const when = askedAt.get(file);
          askedAt.delete(file);
          if (when !== undefined && !effectsQuiet && !hidden && now() - when <= EFFECT_WAIT_MS) effects().play(buf);
        },
        () => {
          loading.delete(file);
          askedAt.delete(file);
        },
      );
  };
  const preload = () => {
    if (!preloadWanted || effectsQuiet) return;
    hookGesture();
    for (const { file, music } of Object.values(manifest.sounds)) if (!music) loadEffect(file);
  };
  /** The context starts suspended until the player's first click or key: it is resumed then, as music is. */
  const hookGesture = () => {
    if (gestureHooked) return;
    gestureHooked = true;
    effects().resume();
    afterGesture(() => {
      if (!hidden) effects().resume();
    });
  };
  let musicOn = false;
  let playlistOn = false;
  let hidden = false;
  let waiting = false;
  /** A volume of 0 (muted): nothing of that kind is fetched, as a file nobody can hear is bytes for nothing (#347). */
  let musicQuiet = false;
  let effectsQuiet = false;
  /** The music file asked for, while it plays or while the music is quiet; it starts when the music is audible again. */
  let current: string | null = null;
  /** Music the browser refused while the start screen waited for a choice. */
  let pending: (() => void) | null = null;
  /** The playlist's tracks still to play this round. */
  let queue: string[] = [];
  /** Start a file; an effect the browser refuses is dropped, as it would be stale by the time it could play. */
  const start = (a: AudioLike, file: string) => {
    a.pause();
    a.src = deps.base + file;
    return a.play();
  };
  /** Music the browser refuses, as it does until the player has clicked or pressed a key, starts after that. */
  const startMusic = (file: string) => {
    musicOn = true;
    current = file;
    // Music asked for while the volume is 0 is not downloaded: it starts when the volume is raised.
    if (musicQuiet) return;
    // Music asked for while the page is hidden waits for it to show.
    if (hidden) {
      music.pause();
      music.src = deps.base + file;
      return;
    }
    start(music, file).catch((ex: unknown) => {
      if (!(ex instanceof DOMException && ex.name === 'NotAllowedError')) return;
      const src = music.src;
      const run = () => {
        if (musicOn && !hidden && music.src === src) void music.play().catch(() => {});
      };
      if (waiting) pending = run;
      else afterGesture(run);
    });
  };
  /** SoundPlayerThread.run: the next track, the playlist shuffled afresh once it has all played. */
  const nextTrack = () => {
    if (!playlistOn || manifest.playlist.length === 0) return;
    if (queue.length === 0) queue = shuffled(manifest.playlist, random);
    startMusic(queue.shift()!);
  };
  music.onended = () => {
    musicOn = false;
    nextTrack();
  };
  return {
    play(key) {
      if (key === null) return effectsOut?.stopAll();
      const sound = manifest.sounds[key];
      if (!sound) return;
      if (sound.music) {
        queue = []; // SoundPlayer.stop: the playlist starts afresh after this music
        startMusic(sound.file);
      } else if (!effectsQuiet) {
        hookGesture();
        const buf = buffers.get(sound.file);
        if (buf !== undefined) {
          if (!hidden) effects().play(buf);
        } else {
          askedAt.set(sound.file, now());
          loadEffect(sound.file);
        }
      }
    },
    setVolumes(v) {
      music.volume = amplitude(v.music);
      effectsVolume = amplitude(v.effects);
      effectsQuiet = v.effects <= 0;
      effectsOut?.setVolume(effectsVolume);
      if (effectsQuiet) {
        effectsOut?.stopAll();
        askedAt.clear();
      } else preload();
      const quiet = v.music <= 0;
      if (quiet === musicQuiet) return;
      musicQuiet = quiet;
      if (quiet) {
        // Silenced: the track stops, and starts again from its beginning once the music is back.
        music.pause();
      } else if (musicOn && current) startMusic(current);
    },
    setHidden(h) {
      if (h === hidden) return;
      hidden = h;
      if (!h) effectsOut?.resume();
      if (h) {
        music.pause();
        effectsOut?.stopAll();
        effectsOut?.suspend();
        askedAt.clear();
      } else if (musicOn && music.src && !musicQuiet) {
        music.play().catch((ex: unknown) => {
          if (!(ex instanceof DOMException && ex.name === 'NotAllowedError')) return;
          afterGesture(() => {
            if (musicOn && !hidden) void music.play().catch(() => {});
          });
        });
      }
    },
    waitForChoice(wait) {
      waiting = wait;
    },
    choose() {
      waiting = false;
      const run = pending;
      pending = null;
      run?.();
    },
    preloadEffects() {
      preloadWanted = true;
      preload();
    },
    startPlaylist() {
      playlistOn = true;
      if (!musicOn) nextTrack();
    },
  };
}

/** The effects on the browser's Web Audio: one context and one gain node for the effects volume. */
function webAudioEffects(): EffectsOutput {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const live = new Set<AudioBufferSourceNode>();
  // A context starts suspended and a browser resumes it only inside the activation of a click or key press
  // (Firefox does not count a pointerdown): every such event tries, until the context runs.
  const events = ['pointerup', 'click', 'keydown'];
  const tryResume = () => void ctx.resume().catch(() => {});
  ctx.onstatechange = () => {
    if (ctx.state === 'running') for (const e of events) removeEventListener(e, tryResume, true);
  };
  for (const e of events) addEventListener(e, tryResume, true);
  return {
    async load(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    },
    play(buffer) {
      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => {});
        return; // before the first gesture: stale by the time it could play
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer as AudioBuffer;
      src.connect(gain);
      live.add(src);
      src.onended = () => live.delete(src);
      src.start();
    },
    stopAll() {
      for (const src of live) {
        try {
          src.stop();
        } catch {
          // already ended
        }
      }
      live.clear();
    },
    setVolume: (a) => void (gain.gain.value = a),
    suspend: () => void ctx.suspend().catch(() => {}),
    resume: () => void ctx.resume().catch(() => {}),
  };
}

/** Run a function once, on the page's next click or key press. */
function onFirstGesture(f: () => void) {
  const once = () => {
    removeEventListener('pointerdown', once, true);
    removeEventListener('keydown', once, true);
    f();
  };
  addEventListener('pointerdown', once, true);
  addEventListener('keydown', once, true);
}

/** Collections.shuffle: Fisher-Yates from the end. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
