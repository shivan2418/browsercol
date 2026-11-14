import { describe, expect, it } from 'vite-plus/test';
import { audioManifest } from './resources';
import { soundPlayer, type EffectsOutput, type SoundPlayerDeps } from './sound';

// Layers as FreeCol loads them: data/base, then the "default" TC.
const base = {
  dir: 'base',
  props: `
sound.intro.general=resources/sound/intro.ogg
sound.intro.general.type="music"
image.mask=resources/images/masks/mask-center.png
`,
};
const tc = {
  dir: 'default',
  props: `
sound.music.playlist.default=resources/music/default
sound.intro.model.nation.dutch=resources/sound/intro/generic.ogg
sound.intro.model.nation.dutch.type="music"
sound.event.loadCargo=resources/sound/event/load.ogg
sound.event.unloadCargo=resources/sound/event/load.ogg
# TODO: sound.attack.foot
sound.attack.naval=resources/sound/attack/naval.ogg
`,
};
const files = [
  'base/resources/sound/intro.ogg',
  'default/resources/sound/intro/generic.ogg',
  'default/resources/sound/event/load.ogg',
  'default/resources/sound/attack/naval.ogg',
  'default/resources/music/default/tailwind.ogg',
  'default/resources/music/default/founders.ogg',
  'default/resources/music/default/README.md',
];

describe('audioManifest', () => {
  const m = audioManifest([base, tc], files);

  it("resolves each sound's resource key to its file, music where FreeCol types it so", () => {
    expect(m.sounds).toEqual({
      'sound.attack.naval': { file: 'default/resources/sound/attack/naval.ogg', music: false },
      'sound.intro.general': { file: 'base/resources/sound/intro.ogg', music: true },
      'sound.intro.model.nation.dutch': { file: 'default/resources/sound/intro/generic.ogg', music: true },
      'sound.event.loadCargo': { file: 'default/resources/sound/event/load.ogg', music: false },
      'sound.event.unloadCargo': { file: 'default/resources/sound/event/load.ogg', music: false },
    });
  });

  it('takes the default playlist from the audio files in its directory', () => {
    expect(m.playlist).toEqual([
      'default/resources/music/default/founders.ogg',
      'default/resources/music/default/tailwind.ogg',
    ]);
  });

  it('lets a later layer override a key', () => {
    const mod = { dir: 'mods/x', props: 'sound.intro.general=resources/other.ogg' };
    const over = audioManifest([base, tc, mod], [...files, 'mods/x/resources/other.ogg']);
    expect(over.sounds['sound.intro.general']).toEqual({ file: 'mods/x/resources/other.ogg', music: true });
  });
});

/** A stand-in for an <audio> element: records what it was told. */
class FakeAudio {
  src = '';
  volume = 1;
  playing = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  blocked = false;
  play(): Promise<void> {
    if (this.blocked) return Promise.reject(new DOMException('no gesture yet', 'NotAllowedError'));
    this.playing = true;
    return Promise.resolve();
  }
  pause() {
    this.playing = false;
  }
  end() {
    this.playing = false;
    this.onended?.();
  }
  /** The file could not be loaded: offline and not cached, say. */
  fail() {
    this.playing = false;
    this.onerror?.();
  }
}

/** A stand-in for the Web Audio effects: a load settles when the test says, and a play is recorded. */
class FakeEffects implements EffectsOutput {
  loads: { url: string; done: (b: unknown) => void; fail: () => void }[] = [];
  played: string[] = [];
  volume = 1;
  suspended = false;
  stops = 0;
  load(url: string) {
    return new Promise<unknown>((ok, no) => this.loads.push({ url, done: ok, fail: () => no(new Error('x')) }));
  }
  play(buffer: unknown) {
    if (!this.suspended) this.played.push(buffer as string);
  }
  stopAll() {
    this.stops++;
  }
  setVolume(a: number) {
    this.volume = a;
  }
  suspend() {
    this.suspended = true;
  }
  resume() {
    this.suspended = false;
  }
  /** Settle every load asked for so far, its buffer the file's name. */
  async decodeAll() {
    for (const l of this.loads.splice(0)) l.done(l.url.replace(/^.*\//, ''));
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('soundPlayer', () => {
  const manifest = audioManifest([base, tc], files);
  const setup = (more: Partial<SoundPlayerDeps> = {}) => {
    const made: FakeAudio[] = [];
    const fx = new FakeEffects();
    let clock = 0;
    let gesture = () => {};
    const player = soundPlayer(manifest, {
      base: 'audio/',
      makeAudio: () => {
        const a = new FakeAudio();
        made.push(a);
        return a;
      },
      makeEffects: () => fx,
      now: () => clock,
      random: () => 0,
      afterGesture: (f) => (gesture = f),
      ...more,
    });
    const playing = () => made.filter((a) => a.playing).map((a) => a.src);
    return { player, made, playing, fx, tick: (ms: number) => (clock += ms), gesture: () => gesture() };
  };

  it('plays music and an effect at once, and a null key stops only the effect', async () => {
    const { player, playing, fx } = setup();
    player.preloadEffects();
    await fx.decodeAll();
    player.play('sound.intro.general');
    player.play('sound.event.loadCargo');
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
    expect(fx.played).toEqual(['load.ogg']);
    player.play(null);
    expect(fx.stops).toBe(1);
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('plays the first effect asked for before it is decoded as soon as it is, if still fresh (#391)', async () => {
    const { player, fx, tick } = setup();
    player.play('sound.event.loadCargo');
    expect(fx.played).toEqual([]);
    tick(100);
    await fx.decodeAll();
    expect(fx.played).toEqual(['load.ogg']);
  });

  it('drops an effect that waited for its decoding too long', async () => {
    const { player, fx, tick } = setup();
    player.play('sound.event.loadCargo');
    tick(400);
    await fx.decodeAll();
    expect(fx.played).toEqual([]);
    player.play('sound.event.loadCargo'); // the buffer is there now
    expect(fx.played).toEqual(['load.ogg']);
  });

  it('lets effects overlap instead of cutting each other off (#391)', async () => {
    const { player, fx } = setup();
    player.preloadEffects();
    await fx.decodeAll();
    player.play('sound.event.loadCargo');
    player.play('sound.attack.naval');
    player.play('sound.event.unloadCargo');
    expect(fx.played).toEqual(['load.ogg', 'naval.ogg', 'load.ogg']);
    expect(fx.stops).toBe(0);
  });

  it('fetches each effect file once, music none, when the game starts', () => {
    const { player, fx } = setup();
    player.preloadEffects();
    player.preloadEffects();
    expect(fx.loads.map((l) => l.url)).toEqual([
      'audio/default/resources/sound/event/load.ogg',
      'audio/default/resources/sound/attack/naval.ogg',
    ]);
  });

  it('lets new music replace the old, and ignores a key with no sound', () => {
    const { player, playing } = setup();
    player.play('sound.intro.general');
    player.play('sound.intro.model.nation.dutch');
    player.play('sound.attack.foot');
    expect(playing()).toEqual(['audio/default/resources/sound/intro/generic.ogg']);
  });

  it('pauses the sound while the page is hidden and goes on from there when it shows again', () => {
    const { player, playing } = setup();
    player.play('sound.intro.general');
    player.setHidden(true);
    expect(playing()).toEqual([]);
    player.setHidden(false);
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('suspends the effects while the page is hidden and plays none then', async () => {
    const { player, fx } = setup();
    player.preloadEffects();
    await fx.decodeAll();
    player.setHidden(true);
    expect(fx.suspended).toBe(true);
    expect(fx.stops).toBe(1);
    player.play('sound.event.loadCargo');
    expect(fx.played).toEqual([]);
    player.setHidden(false);
    expect(fx.suspended).toBe(false);
    player.play('sound.event.loadCargo');
    expect(fx.played).toEqual(['load.ogg']);
  });

  it('holds music asked for while the page is hidden until it shows', () => {
    const { player, playing } = setup();
    player.setHidden(true);
    player.play('sound.intro.general');
    expect(playing()).toEqual([]);
    player.setHidden(false);
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('plays nothing on return if no music was playing', () => {
    const { player, playing } = setup();
    player.setHidden(true);
    player.setHidden(false);
    expect(playing()).toEqual([]);
  });

  it('holds refused music for the start screen choice, not for any click', () => {
    const { player, made, playing, gesture } = setup();
    made[0].blocked = true;
    player.waitForChoice(true);
    player.play('sound.intro.general');
    return Promise.resolve().then(() => {
      gesture(); // any click or key: nothing was waiting on it
      expect(playing()).toEqual([]);
      made[0].blocked = false;
      player.choose();
      expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
    });
  });

  it('plays refused music on the next click once the start screen is done waiting', async () => {
    const { player, made, playing, gesture } = setup();
    made[0].blocked = true;
    player.waitForChoice(true);
    player.choose();
    player.play('sound.intro.general');
    await Promise.resolve();
    made[0].blocked = false;
    gesture();
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('plays the default playlist, shuffled, once the game has started and the music is done', () => {
    const { player, made, playing } = setup();
    const [music] = made;
    player.play('sound.intro.general');
    music.end();
    expect(playing()).toEqual([]); // no playlist before the game starts
    player.play('sound.intro.model.nation.dutch');
    player.startPlaylist();
    expect(playing()).toEqual(['audio/default/resources/sound/intro/generic.ogg']);
    // A shuffle with random() 0 swaps each track with the first: [founders, tailwind] becomes [tailwind, founders].
    music.end();
    expect(playing()).toEqual(['audio/default/resources/music/default/tailwind.ogg']);
    music.end();
    expect(playing()).toEqual(['audio/default/resources/music/default/founders.ogg']);
    music.end(); // and round again
    expect(playing()).toEqual(['audio/default/resources/music/default/tailwind.ogg']);
  });

  it("sets each player to its volume option, at once and on FreeCol's logarithmic curve", () => {
    const { player, made, fx } = setup();
    const [music] = made;
    player.preloadEffects();
    player.play('sound.intro.general');
    player.setVolumes({ music: 50, effects: 100 });
    // FreeCol's gain over -80..0 dB: -80 + 40 log10(50) dB, a quarter of full amplitude.
    expect(music.volume).toBeCloseTo(0.25);
    expect(fx.volume).toBe(1);
    player.setVolumes({ music: 0, effects: 10 });
    expect(music.volume).toBe(0);
    expect(fx.volume).toBeCloseTo(0.01);
  });

  it('starts music the browser refused once the player clicks or presses a key', async () => {
    const { player, made, playing, gesture } = setup();
    made[0].blocked = true;
    player.play('sound.intro.general');
    await Promise.resolve(); // the refusal settles
    expect(playing()).toEqual([]);
    made[0].blocked = false;
    gesture();
    // The music starts.
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('shuffles the playlist afresh after other music interrupts it, as SoundPlayer.stop clears its queue', () => {
    const { player, made, playing } = setup();
    player.startPlaylist(); // tailwind, with founders still to come
    player.play('sound.intro.general');
    made[0].end();
    expect(playing()).toEqual(['audio/default/resources/music/default/tailwind.ogg']);
  });

  it('offline, skips a track the cache lacks without asking for it, and plays one it has', () => {
    const { player, made, playing } = setup({ playable: (url) => url.endsWith('founders.ogg') });
    player.startPlaylist(); // tailwind first, which is not there
    expect(playing()).toEqual(['audio/default/resources/music/default/founders.ogg']);
    expect(made.map((a) => a.src)).toEqual(['audio/default/resources/music/default/founders.ogg']);
  });

  it('waits for the cache to say whether it has a track', async () => {
    const { player, playing } = setup({ playable: (url) => Promise.resolve(url.endsWith('founders.ogg')) });
    player.startPlaylist();
    expect(playing()).toEqual([]);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(playing()).toEqual(['audio/default/resources/music/default/founders.ogg']);
  });

  it('goes on to the next track when one fails to load, rather than stop the music', () => {
    const { player, made, playing } = setup();
    player.startPlaylist();
    expect(playing()).toEqual(['audio/default/resources/music/default/tailwind.ogg']);
    made[0].fail();
    expect(playing()).toEqual(['audio/default/resources/music/default/founders.ogg']);
  });

  it('stays quiet when no track can play, without trying them over and over', () => {
    const asked: string[] = [];
    const { player, made, playing } = setup({ playable: (url) => (asked.push(url), false) });
    player.play('sound.intro.general');
    player.startPlaylist();
    expect(playing()).toEqual([]);
    expect(made[0].src).toBe('');
    expect(asked.length).toBeLessThanOrEqual(4);
  });

  it('starts the playlist at once when no music is playing', () => {
    const { player, playing } = setup();
    player.startPlaylist();
    expect(playing()).toEqual(['audio/default/resources/music/default/tailwind.ogg']);
  });

  it('downloads no music while the music volume is 0, and starts the music asked for when it is raised (#347)', () => {
    const { player, made, playing } = setup();
    player.setVolumes({ music: 0, effects: 100 });
    player.play('sound.intro.general');
    player.startPlaylist();
    expect(made.map((a) => a.src)).toEqual(['']);
    expect(playing()).toEqual([]);
    player.setVolumes({ music: 50, effects: 100 });
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('stops the music when it is silenced, and plays it again when it is raised', () => {
    const { player, playing } = setup();
    player.setVolumes({ music: 50, effects: 100 });
    player.play('sound.intro.general');
    player.setVolumes({ music: 0, effects: 100 });
    expect(playing()).toEqual([]);
    player.setHidden(true);
    player.setHidden(false);
    expect(playing()).toEqual([]);
    player.setVolumes({ music: 50, effects: 100 });
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('downloads no sound effect while the effects volume is 0, and fetches them when it is raised (#347)', () => {
    const { player, fx } = setup();
    player.setVolumes({ music: 50, effects: 0 });
    player.preloadEffects();
    player.play('sound.event.loadCargo');
    expect(fx.loads).toEqual([]);
    player.setVolumes({ music: 50, effects: 50 });
    expect(fx.loads.length).toBe(2);
  });
});
