// FreeCol's music and sound effects in the browser, played by resource key as SoundController plays them:
// music on one player, sound effects on another, and the default playlist whenever no other music plays.
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

export interface SoundPlayerDeps {
  /** The URL of the audio directory, ending in a slash. */
  base: string;
  makeAudio?: () => AudioLike;
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
  const effects = makeAudio();
  let musicOn = false;
  let playlistOn = false;
  let hidden = false;
  let waiting = false;
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
      if (key === null) return effects.pause();
      const sound = manifest.sounds[key];
      if (!sound) return;
      if (sound.music) {
        queue = []; // SoundPlayer.stop: the playlist starts afresh after this music
        startMusic(sound.file);
      } else start(effects, sound.file).catch(() => {});
    },
    setVolumes(v) {
      music.volume = amplitude(v.music);
      effects.volume = amplitude(v.effects);
    },
    setHidden(h) {
      if (h === hidden) return;
      hidden = h;
      if (h) {
        music.pause();
        effects.pause();
      } else if (musicOn && music.src) {
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
    startPlaylist() {
      playlistOn = true;
      if (!musicOn) nextTrack();
    },
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
