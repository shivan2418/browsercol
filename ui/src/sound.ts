// FreeCol's music and sound effects in the browser. FreeCol's resources.properties name each sound key's
// file (sound.event.loadCargo=resources/sound/event/load.ogg), with KEY.type="music" for those GUI.playSound
// plays on the music player rather than the effects player, and sound.music.playlist.default names the
// directory of the music played when nothing else is (SoundPlayer's default playlist).
import { parseProperties, type ArtLayer } from './resources.ts';

/** A sound key's file, relative to the audio directory, and whether it plays as music. */
export interface Sound {
  file: string;
  music: boolean;
}

/** What build-audio.mjs writes as audio.json. */
export interface AudioManifest {
  sounds: Record<string, Sound>;
  /** The default playlist's files, in name order. */
  playlist: string[];
}

const AUDIO = /\.(ogg|wav|mp3|flac)$/i;
const PLAYLIST = 'sound.music.playlist.default';

/**
 * The sound keys of resources.properties layers, later layers overriding earlier ones key by key, as
 * FreeCol's ResourceManager does. A key whose file is missing is left out, as FreeCol plays nothing for it.
 *
 * @param files The audio files there are, each under its layer's directory.
 */
export function audioManifest(layers: ArtLayer[], files: string[]): AudioManifest {
  const have = new Set(files);
  const paths = new Map<string, string>();
  const music = new Map<string, boolean>();
  for (const { dir, props } of layers) {
    for (const [key, value] of parseProperties(props)) {
      if (!key.startsWith('sound.')) continue;
      if (key.endsWith('.type')) music.set(key.slice(0, -'.type'.length), value === '"music"');
      else paths.set(key, `${dir}/${value}`);
    }
  }
  const sounds: Record<string, Sound> = {};
  for (const [key, file] of paths) {
    if (have.has(file) && AUDIO.test(file)) sounds[key] = { file, music: music.get(key) ?? false };
  }
  const list = paths.get(PLAYLIST);
  const playlist = list ? files.filter((f) => f.startsWith(`${list}/`) && AUDIO.test(f)).sort() : [];
  return { sounds, playlist };
}

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
    start(music, file).catch((ex: unknown) => {
      if (!(ex instanceof DOMException && ex.name === 'NotAllowedError')) return;
      const src = music.src;
      afterGesture(() => {
        if (musicOn && music.src === src) void music.play().catch(() => {});
      });
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
      if (sound.music) startMusic(sound.file);
      else start(effects, sound.file).catch(() => {});
    },
    setVolumes(v) {
      music.volume = amplitude(v.music);
      effects.volume = amplitude(v.effects);
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
