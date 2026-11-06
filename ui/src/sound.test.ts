import { describe, expect, it } from 'vite-plus/test';
import { audioManifest } from './resources';
import { soundPlayer } from './sound';

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
  'default/resources/music/default/tailwind.ogg',
  'default/resources/music/default/founders.ogg',
  'default/resources/music/default/README.md',
];

describe('audioManifest', () => {
  const m = audioManifest([base, tc], files);

  it("resolves each sound's resource key to its file, music where FreeCol types it so", () => {
    expect(m.sounds).toEqual({
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
}

describe('soundPlayer', () => {
  const manifest = audioManifest([base, tc], files);
  const setup = () => {
    const made: FakeAudio[] = [];
    let gesture = () => {};
    const player = soundPlayer(manifest, {
      base: 'audio/',
      makeAudio: () => {
        const a = new FakeAudio();
        made.push(a);
        return a;
      },
      random: () => 0,
      afterGesture: (f) => (gesture = f),
    });
    const playing = () => made.filter((a) => a.playing).map((a) => a.src);
    return { player, made, playing, gesture: () => gesture() };
  };

  it('plays music and an effect at once, and a null key stops only the effect', () => {
    const { player, playing } = setup();
    player.play('sound.intro.general');
    player.play('sound.event.loadCargo');
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg', 'audio/default/resources/sound/event/load.ogg']);
    player.play(null);
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
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
    player.play('sound.event.loadCargo');
    player.setHidden(true);
    expect(playing()).toEqual([]);
    player.setHidden(false);
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']); // the effect is stale by now
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
    const { player, made } = setup();
    const [music, effects] = made;
    player.play('sound.intro.general');
    player.setVolumes({ music: 50, effects: 100 });
    // FreeCol's gain over -80..0 dB: -80 + 40 log10(50) dB, a quarter of full amplitude.
    expect(music.volume).toBeCloseTo(0.25);
    expect(effects.volume).toBe(1);
    player.setVolumes({ music: 0, effects: 10 });
    expect(music.volume).toBe(0);
    expect(effects.volume).toBeCloseTo(0.01);
  });

  it('starts music the browser refused once the player clicks or presses a key', async () => {
    const { player, made, playing, gesture } = setup();
    made[0].blocked = true;
    made[1].blocked = true;
    player.play('sound.intro.general');
    player.play('sound.event.loadCargo');
    await Promise.resolve(); // the refusals settle
    expect(playing()).toEqual([]);
    made[0].blocked = false;
    made[1].blocked = false;
    gesture();
    // The effect is stale by then and is dropped; the music starts.
    expect(playing()).toEqual(['audio/base/resources/sound/intro.ogg']);
  });

  it('shuffles the playlist afresh after other music interrupts it, as SoundPlayer.stop clears its queue', () => {
    const { player, made, playing } = setup();
    player.startPlaylist(); // tailwind, with founders still to come
    player.play('sound.intro.general');
    made[0].end();
    expect(playing()).toEqual(['audio/default/resources/music/default/tailwind.ogg']);
  });

  it('starts the playlist at once when no music is playing', () => {
    const { player, playing } = setup();
    player.startPlaylist();
    expect(playing()).toEqual(['audio/default/resources/music/default/tailwind.ogg']);
  });
});
