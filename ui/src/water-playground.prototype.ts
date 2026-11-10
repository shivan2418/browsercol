// PROTOTYPE, throwaway (#409): the water playground, ?playground=water on the game page (with ?tileset=freecol-plus).
// A panel over the real map to tune FreeCol+'s shader water live: the wave model, the climate palettes, the shore,
// presets, and a Copy settings button that gives the shader.water.* block for ui/tilesets/freecol-plus. The settings
// stay in this browser's localStorage. Plain DOM, no React, so it adds next to nothing to the frame it measures.
import {
  CLIMATES,
  CLIMATE_OF,
  waterPlayground,
  type Climate,
  type Palette,
  type ShoreModel,
  type WaterLook,
  type WaterRecipe,
  type WaveModel,
} from './map-water';

interface Host {
  /** Centre the map on a tile at a zoom (a scale, 0.25 to 2; 0 keeps it). */
  jump(x: number, y: number, zoom: number): void;
  zoom(steps: number): void;
  zoomNow(): number;
  showFps(): void;
}

const STORE = 'freecol.water-playground';
type Settings = WaterLook;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const fromHex = (s: string) => parseInt(s.slice(1), 16);
const clone = <T>(v: T): T => structuredClone(v);

const VARIANTS = ['Default', 'A', 'B', 'C', 'D', 'E'] as const;
type Variant = (typeof VARIANTS)[number];
const RECIPES: Record<Exclude<Variant, 'Default'>, WaterRecipe> = {
  A: {
    shallows: 'turquoise',
    shore: 'drawn',
    motion: 'bands',
    deep: 'plain',
    depth: 'deeper',
    bandSpeed: 5,
    bandSpacing: 40,
    driftSpeed: 2,
    shelfWidth: 90,
    climateBlend: 3,
    clip: 0,
    clipAt: 2,
  },
  B: {
    shallows: 'climate',
    shore: 'drawn',
    motion: 'bands',
    deep: 'plain',
    depth: 'deeper',
    bandSpeed: 5,
    bandSpacing: 40,
    driftSpeed: 2,
    shelfWidth: 90,
    climateBlend: 3,
    clip: 0,
    clipAt: 2,
  },
  C: {
    shallows: 'climate',
    shore: 'art',
    motion: 'bands',
    deep: 'plain',
    depth: 'deeper',
    bandSpeed: 5,
    bandSpacing: 40,
    driftSpeed: 2,
    shelfWidth: 90,
    climateBlend: 3,
    clip: 0,
    clipAt: 2,
  },
  D: {
    shallows: 'climate',
    shore: 'art',
    motion: 'foam',
    deep: 'plain',
    depth: 'deeper',
    bandSpeed: 5,
    bandSpacing: 40,
    driftSpeed: 2,
    shelfWidth: 90,
    climateBlend: 3,
    clip: 0,
    clipAt: 2,
  },
  E: {
    shallows: 'climate',
    shore: 'art',
    motion: 'bands',
    deep: 'climate',
    depth: 'deeper',
    bandSpeed: 5,
    bandSpacing: 40,
    driftSpeed: 2,
    shelfWidth: 90,
    climateBlend: 3,
    clip: 0,
    clipAt: 2,
  },
};

/** The starting looks: each a change to the Tileset's own (the first look, PR #418). */
const PALETTES: Record<string, Record<Climate, Palette>> = {
  muted: {
    cold: { deep: 0x1b2a33, shallow: 0x44565c, foam: 0xc4cdd0, foamAmount: 0.3 },
    temperate: { deep: 0x123640, shallow: 0x3e625c, foam: 0xd3dbd0, foamAmount: 0.75 },
    tropical: { deep: 0x0c3a4c, shallow: 0x2f8586, foam: 0xe6eee6, foamAmount: 1 },
  },
  vivid: {
    cold: { deep: 0x172733, shallow: 0x3f5763, foam: 0xd0d9de, foamAmount: 0.35 },
    temperate: { deep: 0x0f3a48, shallow: 0x3b6e66, foam: 0xdfe6da, foamAmount: 0.9 },
    tropical: { deep: 0x064259, shallow: 0x22a3a3, foam: 0xf2f7f0, foamAmount: 1.1 },
  },
};
const PRESETS: Record<string, (base: Settings) => Settings> = {
  'First look (PR #418)': (b) => b,
  'Painted calm': (b) => ({
    ...b,
    waves: 'warp',
    speed: 0.6,
    lakeSpeed: 0.3,
    warp: 0.3,
    flowSize: 1600,
    flowSpeed: 0.3,
    wander: 0.5,
    gust: 0.25,
    swellAmount: 0.45,
    chopAmount: 0.6,
    crest: 0.3,
    shore: 'art',
    shallowWidth: 30,
    foamWidth: 5,
    climate: true,
    palettes: clone(PALETTES.muted),
    ice: 0.5,
    highSeasShade: 0.75,
  }),
  Lively: (b) => ({
    ...b,
    waves: 'flow',
    speed: 1,
    lakeSpeed: 0.4,
    warp: 0.45,
    flowSize: 1200,
    flowStrength: 0.3,
    flowSpeed: 0.5,
    wander: 0.9,
    gust: 0.45,
    swellAmount: 0.55,
    chopAmount: 1.1,
    crest: 0.75,
    shore: 'art',
    shallowWidth: 36,
    foamWidth: 7,
    climate: true,
    palettes: clone(PALETTES.muted),
    ice: 0.6,
    highSeasShade: 0.7,
    roughness: { ...b.roughness, ocean: 0.55, highSeas: 0.9 },
  }),
  'Civ-like': (b) => ({
    ...b,
    waves: 'flow',
    speed: 0.8,
    lakeSpeed: 0.35,
    swellSize: 900,
    chopSize: 160,
    warp: 0.4,
    flowSize: 1400,
    flowStrength: 0.25,
    flowSpeed: 0.4,
    wander: 0.7,
    gust: 0.35,
    swellAmount: 0.6,
    chopAmount: 0.8,
    crest: 0.55,
    shore: 'art',
    shallowWidth: 44,
    foamWidth: 7,
    climate: true,
    palettes: clone(PALETTES.vivid),
    ice: 0.7,
    highSeasShade: 0.65,
  }),
};

/** The shader.water.* block a Tileset takes for these settings. */
export function propertiesOf(s: Settings): string {
  const K = 'shader.water.';
  const col = (k: string, c: number) => `${K}${k}=urn:color:0x${c.toString(16).padStart(6, '0')}`;
  const num = (k: string, n: number | string | boolean) =>
    `${K}${k}="${typeof n === 'number' ? +n.toFixed(3) : String(n)}"`;
  const lines = [
    `# Water (#409), from the water playground.`,
    `${K}swell=resources/water/swell.png`,
    `${K}chop=resources/water/chop.png`,
    num('swellSize', s.swellSize),
    num('chopSize', s.chopSize),
    col('ocean', s.ocean),
    col('highSeas', s.highSeas),
    col('lake', s.lake),
    col('shallow', s.shallow),
    col('foam', s.foam),
    col('light', s.light),
    ...(['ocean', 'highSeas', 'lake'] as const).flatMap((k) => [
      num(`${k}.roughness`, s.roughness[k]),
      num(`${k}.foam`, s.foamStrength[k]),
    ]),
    num('ocean.speed', s.speed),
    num('lake.speed', s.lakeSpeed),
    `# Waves: slide, warp or flow.`,
    num('waves', s.waves),
    num('flowSize', s.flowSize),
    num('warp', s.warp),
    num('flowStrength', s.flowStrength),
    num('flowSpeed', s.flowSpeed),
    num('wander', s.wander),
    num('gust', s.gust),
    num('swellAmount', s.swellAmount),
    num('chopAmount', s.chopAmount),
    num('crest', s.crest),
    `# Shore: blur, signed or art; widths in map pixels from the art's edge.`,
    num('shore', s.shore),
    num('shallowWidth', s.shallowWidth),
    num('foamWidth', s.foamWidth),
    `# Climate: the colours by the nearest land's climate.`,
    num('climate', s.climate),
    num('highSeasShade', s.highSeasShade),
    num('ice', s.ice),
    ...CLIMATES.flatMap((k) => [
      col(`${k}.deep`, s.palettes[k].deep),
      col(`${k}.shallow`, s.palettes[k].shallow),
      col(`${k}.foam`, s.palettes[k].foam),
      num(`${k}.foamAmount`, s.palettes[k].foamAmount),
    ]),
    ...(s.recipe ? Object.entries(s.recipe).map(([k, v]) => num(`recipe.${k}`, v)) : []),
  ];
  return lines.join('\n');
}

/** FreeCol's Direction steps: [dx, dy] on odd rows, then on even rows (tileset.ts STEPS). */
const STEPS: [string, number, number, number, number][] = [
  ['N', 0, -2, 0, -2],
  ['NE', 1, -1, 0, -1],
  ['E', 1, 0, 1, 0],
  ['SE', 1, 1, 0, 1],
  ['S', 0, 2, 0, 2],
  ['SW', 0, 1, -1, 1],
  ['W', -1, 0, -1, 0],
  ['NW', 0, -1, -1, -1],
];

/** Tiles worth looking at, by kind, from the map the water was made from. */
export function findSpots(): Record<string, [number, number][]> {
  const map = waterPlayground.map;
  const out: Record<string, [number, number][]> = {
    cold: [],
    temperate: [],
    tropical: [],
    corner: [],
    island: [],
    strait: [],
    lake: [],
    'river mouth': [[100, 52]],
    'high seas edge': [[9, 58]],
  };
  if (!map) return out;
  const type = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return null;
    const c = map.tiles.charCodeAt(y * map.w + x) - 65;
    return c >= 0 ? map.types[c] : null;
  };
  const near = (x: number, y: number) =>
    STEPS.map(([d, ox, oy, ex, ey]) => {
      const [dx, dy] = y % 2 ? [ox, oy] : [ex, ey];
      return [d, type(x + dx, y + dy)] as const;
    });
  for (let y = 2; y < map.h - 2; y++)
    for (let x = 1; x < map.w - 1; x++) {
      const t = type(x, y);
      if (!t) continue;
      const n = near(x, y);
      const lands = n.filter(([, b]) => b?.land);
      if (t.land) {
        // A single tile of land: water all round, bar at most one corner.
        if (n.every(([, b]) => b) && lands.length <= 1 && lands.every(([d]) => ['N', 'E', 'S', 'W'].includes(d)))
          out.island.push([x, y]);
        continue;
      }
      if (t.id === 'model.tile.lake' && lands.length >= 3) out.lake.push([x, y]);
      if (t.id !== 'model.tile.ocean' || !lands.length) continue;
      const is = (d: string) => n.find(([e]) => e === d)?.[1]?.land;
      if (lands.length === 1 && ['N', 'E', 'S', 'W'].includes(lands[0][0])) out.corner.push([x, y]);
      if ((is('NE') && is('SW') && !is('NW') && !is('SE')) || (is('NW') && is('SE') && !is('NE') && !is('SW')))
        out.strait.push([x, y]);
      if (lands.length >= 3) {
        const zones = lands.map(([, b]) => CLIMATE_OF[b!.id]);
        const z = zones[0];
        if (z && zones.every((v) => v === z)) out[z].push([x, y]);
      }
    }
  // Nearest the middle of the map first, so the first of each kind is on screen ground.
  const mid = (a: [number, number]) => Math.abs(a[0] - map.w / 2) + Math.abs(a[1] - map.h / 2) / 2;
  for (const k of Object.keys(out))
    if (!['river mouth', 'high seas edge'].includes(k)) out[k].sort((a, b) => mid(a) - mid(b));
  return out;
}

const STYLE = `
.wp { position: fixed; top: 8px; right: 8px; width: 330px; max-height: calc(100vh - 16px); overflow-y: auto; z-index: 9999;
  background: rgba(20, 24, 28, 0.93); color: #e6e6e6; font: 12px/1.35 system-ui, sans-serif; border-radius: 8px;
  box-shadow: 0 4px 18px rgba(0,0,0,.5); padding: 8px 10px; }
.wp.min > :not(header) { display: none; }
.wp header { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 4px; }
.wp header span { flex: 1; }
.wp h4 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9fc8cc; }
.wp label { display: grid; grid-template-columns: 108px 1fr 44px; align-items: center; gap: 6px; margin: 2px 0; }
.wp label.wide { grid-template-columns: 108px minmax(0, 1fr); }
.wp select { width: 100%; min-width: 0; }
.wp input[type=range] { width: 100%; }
.wp output { text-align: right; font-variant-numeric: tabular-nums; color: #bbb; }
.wp button, .wp select { background: #2c3440; color: #eee; border: 1px solid #47525f; border-radius: 4px; padding: 3px 7px;
  font: inherit; cursor: pointer; }
.wp button:hover { background: #3a4554; }
.wp button.on { background: #2f6f73; border-color: #4aa; }
.wp .row { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.wp .pal { display: grid; grid-template-columns: 70px repeat(3, 34px) 1fr; gap: 4px; align-items: center; margin: 2px 0; }
.wp .pal input[type=color] { width: 32px; height: 22px; padding: 0; border: 0; background: none; }
.wp .note { color: #9aa; font-size: 11px; margin: 2px 0 4px; }
.wp textarea { width: 100%; height: 120px; font: 11px monospace; background: #111; color: #cfc; }
.wp-fps { position: fixed; left: 8px; bottom: 8px; z-index: 9999; background: rgba(0,0,0,.7); color: #7f7;
  font: 13px monospace; padding: 3px 7px; border-radius: 4px; pointer-events: none; }
`;

export function waterPlaygroundPanel(host: Host) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const panel = document.createElement('div');
  panel.className = 'wp';
  document.body.append(panel);
  // An fps readout of its own, always on: frames over the last second, and the worst frame.
  const fps = document.createElement('div');
  fps.className = 'wp-fps';
  document.body.append(fps);
  {
    let last = 0;
    let since = 0;
    let ivs: number[] = [];
    const tick = (now: number) => {
      requestAnimationFrame(tick);
      if (last) ivs.push(now - last);
      last = now;
      if (!since) since = now;
      if (now - since >= 1000) {
        const total = ivs.reduce((a, b) => a + b, 0);
        fps.textContent = `${Math.round((ivs.length * 1000) / total)} fps · worst ${Math.round(Math.max(...ivs))} ms`;
        ivs = [];
        since = now;
      }
    };
    requestAnimationFrame(tick);
  }

  let base: Settings | null = null;
  let s: Settings | null = null;
  let paused = false;
  let rate = 1;
  let view = 0;
  let busy: Promise<unknown> = Promise.resolve();
  const spotIndex: Record<string, number> = {};
  let spots: Record<string, [number, number][]> = {};
  const params = new URLSearchParams(location.search);
  let variant = params.get('water') ?? 'A';
  let split = params.has('split') ? Math.max(0, Math.min(1, Number(params.get('split')) || 0)) : 0;
  const badge = document.createElement('div');
  badge.style.cssText =
    'position:fixed;left:12px;top:44px;z-index:9000;background:#18232ddd;color:white;padding:4px 8px;font:12px system-ui;pointer-events:none';
  document.body.append(badge);
  const divider = document.createElement('div');
  divider.style.cssText =
    'position:fixed;z-index:9001;width:8px;margin-left:-4px;border-left:2px solid white;cursor:ew-resize;touch-action:none';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Default and variant divider');
  document.body.append(divider);
  const showVariant = () => {
    const box = document.querySelector('#map canvas')?.getBoundingClientRect();
    badge.textContent = `${split && variant !== 'Default' ? 'Default | ' : ''}${variant}${surface() ? '' : ' (flipbook fallback)'}`;
    divider.hidden = !split || variant === 'Default';
    if (box) {
      divider.style.left = `${box.left + box.width * split}px`;
      divider.style.top = `${box.top}px`;
      divider.style.height = `${box.height}px`;
    }
    const url = new URL(location.href);
    url.searchParams.set('water', variant);
    if (split) url.searchParams.set('split', String(+split.toFixed(3)));
    else url.searchParams.delete('split');
    history.replaceState(null, '', url);
    return waterPlayground.compare?.(split, variant === 'Default');
  };
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const box = document.querySelector('#map canvas')!.getBoundingClientRect();
    split = Math.max(0.02, Math.min(0.98, (e.clientX - box.left) / box.width));
    void showVariant();
  });
  addEventListener('resize', showVariant);

  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* private window: the settings last for the page only */
    }
  };
  const surface = () => waterPlayground.surface?.() ?? null;
  const structural = (a: Settings, b: Settings) =>
    a.waves !== b.waves ||
    a.shore !== b.shore ||
    a.climate !== b.climate ||
    !!a.recipe !== !!b.recipe ||
    a.recipe?.shore !== b.recipe?.shore ||
    a.recipe?.climateBlend !== b.recipe?.climateBlend;
  /** Apply the settings: a new shader and field when the model changed, else only its uniforms. */
  const apply = (rebuild: boolean, preset = false) => {
    if (!preset) {
      variant = 'custom';
      refresh();
    }
    save();
    const next = clone(s!);
    const run = async () => {
      const sf = surface();
      if (!rebuild && sf && !structural(sf.look, next)) sf.setLook(next);
      else {
        const t0 = performance.now();
        const ok = await waterPlayground.restart?.(next);
        console.log(
          `[water] ${next.waves}/${next.shore}/${next.climate ? 'climate' : 'flat'}: ${ok ? 'ok' : 'FAILED'} in ${Math.round(performance.now() - t0)} ms`,
        );
      }
      const now = surface();
      if (now) {
        now.rate = paused ? 0 : rate;
        now.view = view;
      }
      await showVariant();
    };
    busy = busy.then(run, run);
  };

  // UI building helpers.
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, unknown> = {},
    ...kids: (Node | string)[]
  ): HTMLElementTagNameMap[K] => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const h4 = (t: string) => el('h4', { textContent: t });
  const note = (t: string) => el('div', { className: 'note', textContent: t });
  const slider = (
    name: string,
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    step: number,
    title = '',
  ) => {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), title });
    const out = el('output');
    const show = () => {
      input.value = String(get());
      out.textContent = String(+get().toFixed(3));
    };
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = String(+Number(input.value).toFixed(3));
      apply(false);
    });
    refreshers.push(show);
    return el('label', { title }, el('span', { textContent: name }), input, out);
  };
  const select = <T extends string>(
    name: string,
    get: () => T,
    set: (v: T) => void,
    options: [T, string][],
    title = '',
  ) => {
    const sel = el('select', { title });
    for (const [v, t] of options) sel.append(el('option', { value: v, textContent: t }));
    sel.addEventListener('change', () => {
      set(sel.value as T);
      apply(true);
    });
    refreshers.push(() => (sel.value = get()));
    return el('label', { className: 'wide', title }, el('span', { textContent: name }), sel);
  };
  const color = (get: () => number, set: (v: number) => void, title: string) => {
    const input = el('input', { type: 'color', title });
    input.addEventListener('input', () => {
      set(fromHex(input.value));
      apply(false);
    });
    refreshers.push(() => (input.value = hex(get())));
    return input;
  };
  const check = (name: string, get: () => boolean, set: (v: boolean) => void, title = '') => {
    const input = el('input', { type: 'checkbox', title });
    input.addEventListener('change', () => {
      set(input.checked);
      apply(true);
    });
    refreshers.push(() => (input.checked = get()));
    return el('label', { className: 'wide', title }, el('span', { textContent: name }), input);
  };
  const button = (text: string, on: () => void, title = '') => {
    const b = el('button', { textContent: text, title });
    b.addEventListener('click', on);
    return b;
  };
  const refreshers: (() => void)[] = [];
  const refresh = () => refreshers.forEach((r) => r());
  const choose = (name: Variant) => {
    variant = name;
    s = {
      ...clone(base!),
      recipe: {
        ...clone(RECIPES[name === 'Default' ? 'A' : name]),
        // ?clip=1&clipAt=2 turns the clipped beach on from the URL, for the shot scripts.
        ...(params.has('clip') ? { clip: Number(params.get('clip')) || 0 } : {}),
        ...(params.has('clipAt') ? { clipAt: Number(params.get('clipAt')) || 0 } : {}),
      },
      shore: 'signed',
      shallow: 0x52b9b5,
      foam: 0xe0e8df,
      foamWidth: 7,
      speed: 1,
      palettes: {
        cold: { ...PALETTES.muted.cold, shallow: 0x5a7378 },
        temperate: { ...PALETTES.muted.temperate, shallow: 0x4d7268 },
        tropical: { ...PALETTES.muted.tropical, shallow: 0x40c6b9 },
      },
    };
    refresh();
    apply(false, true);
    return busy;
  };
  addEventListener(
    'keydown',
    (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,select,textarea,[contenteditable]')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const index = VARIANTS.indexOf(variant as Variant);
      void choose(VARIANTS[(index + (e.key === 'ArrowRight' ? 1 : -1) + VARIANTS.length) % VARIANTS.length]);
    },
    true,
  );

  const build = () => {
    panel.replaceChildren();
    refreshers.length = 0;
    const min = button('–', () => panel.classList.toggle('min'), 'Fold the panel');
    panel.append(el('header', {}, el('span', { textContent: 'Water playground (#409)' }), min));
    const variants = el('div', { className: 'row' });
    for (const name of VARIANTS) {
      const b = button(name, () => void choose(name));
      refreshers.push(() => b.classList.toggle('on', variant === name));
      variants.append(b);
    }
    panel.append(variants, note('Left/right arrows cycle variants. Pick axes to combine looks.'));
    const axis = <K extends 'shallows' | 'shore' | 'motion' | 'deep' | 'depth'>(
      name: string,
      key: K,
      choices: WaterRecipe[K][],
    ) =>
      select(
        name,
        () => s!.recipe?.[key] ?? RECIPES.A[key],
        (v) => {
          s!.recipe ??= clone(RECIPES.A);
          s!.recipe[key] = v;
        },
        choices.map((v) => [v, v]),
      );
    panel.append(
      axis('Shallows', 'shallows', ['turquoise', 'climate']),
      axis('Shore', 'shore', ['drawn', 'art']),
      axis('Motion', 'motion', ['bands', 'foam']),
      axis('Deep water', 'deep', ['plain', 'climate']),
      axis('Depth', 'depth', ['normal', 'deeper']),
      button('Side by side', () => {
        split = split ? 0 : 0.5;
        void showVariant();
      }),
    );
    for (const [name, key, min, max, step] of [
      ['Band speed px/s', 'bandSpeed', 0, 20, 0.5],
      ['Band spacing px', 'bandSpacing', 16, 100, 1],
      ['Drift px/s', 'driftSpeed', 0, 5, 0.1],
      ['Shelf width px', 'shelfWidth', 24, 192, 2],
      ['Climate blend tiles', 'climateBlend', 1, 6, 0.25],
      ['Clip beach (0 off, 1 on)', 'clip', 0, 1, 1],
      ['Clip at px', 'clipAt', -6, 16, 0.5],
    ] as const)
      panel.append(
        slider(
          name,
          () => s!.recipe?.[key] ?? RECIPES.A[key],
          (v) => {
            s!.recipe ??= clone(RECIPES.A);
            s!.recipe[key] = v;
          },
          min,
          max,
          step,
        ),
      );

    // Presets and output.
    panel.append(h4('Presets'));
    const presets = el('div', { className: 'row' });
    for (const [name, make] of Object.entries(PRESETS))
      presets.append(
        button(name, () => {
          s = clone(make(clone(base!)));
          refresh();
          apply(true);
        }),
      );
    panel.append(presets);
    const out = el('textarea', { readOnly: true, hidden: true });
    panel.append(
      el(
        'div',
        { className: 'row' },
        button(
          'Copy settings',
          () => {
            out.value = propertiesOf(s!);
            out.hidden = false;
            out.select();
            void navigator.clipboard?.writeText(out.value).catch(() => {});
          },
          'The shader.water.* block for ui/tilesets/freecol-plus/resources.properties',
        ),
        button('Reset to the tileset', () => {
          s = clone(base!);
          refresh();
          apply(true);
        }),
      ),
      out,
    );

    // Where to look.
    panel.append(h4('Go to'));
    const go = el('div', { className: 'row' });
    for (const kind of Object.keys(findSpots())) {
      go.append(
        button(
          kind,
          () => {
            // Found when first asked: the map may still have been revealing when the panel was built.
            if (!spots[kind]?.length) spots = findSpots();
            const list = spots[kind] ?? [];
            if (!list.length) return void (status.textContent = `no ${kind} on this map`);
            const i = (spotIndex[kind] = ((spotIndex[kind] ?? -1) + 1) % list.length);
            const [x, y] = list[i];
            host.jump(x, y, 0);
            status.textContent = `${kind} ${i + 1}/${list.length}: tile ${x},${y}`;
          },
          'Click again for the next one',
        ),
      );
    }
    panel.append(go);
    const status = note('Click a kind again for the next one.');
    panel.append(status);
    const pauseBtn = button(paused ? 'Play' : 'Pause', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Play' : 'Pause';
      const sf = surface();
      if (sf) sf.rate = paused ? 0 : rate;
    });
    panel.append(
      el(
        'div',
        { className: 'row' },
        button('Zoom −', () => host.zoom(-1)),
        button('Zoom +', () => host.zoom(1)),
        pauseBtn,
      ),
    );
    panel.append(
      slider(
        'Time rate',
        () => rate,
        (v) => {
          rate = v;
        },
        0.1,
        5,
        0.1,
        'How fast water time runs here (not saved in the settings)',
      ),
    );
    panel.append(
      select(
        'Show',
        () => String(view) as '0',
        (v) => (view = Number(v)),
        [
          ['0', 'Water'],
          ['1', "Field: red cover, blue shore, yellow the cover's edge"],
          ['2', 'Climate: red cold, green temperate, blue tropical'],
          ['3', 'Swirl (warp/flow)'],
        ] as ['0', string][],
      ),
    );

    // Waves.
    panel.append(h4('Waves'));
    panel.append(
      select<WaveModel>(
        'Model',
        () => s!.waves,
        (v) => (s!.waves = v),
        [
          ['slide', 'Slide (first look): 2 ripple reads'],
          ['warp', 'Warp: swirl-bent ripples, 3 reads'],
          ['flow', 'Flow: carried chop + crossing swells, 5 reads'],
        ],
      ),
      note(
        'Slide: two textures in straight lines. Warp/Flow: a slow swirl bends and carries them, heading and pace wander.',
      ),
      slider(
        'Speed (sea)',
        () => s!.speed,
        (v) => (s!.speed = v),
        0,
        3,
        0.05,
      ),
      slider(
        'Speed (lakes)',
        () => s!.lakeSpeed,
        (v) => (s!.lakeSpeed = v),
        0,
        2,
        0.05,
      ),
      slider(
        'Swell size px',
        () => s!.swellSize,
        (v) => (s!.swellSize = v),
        128,
        2048,
        16,
      ),
      slider(
        'Chop size px',
        () => s!.chopSize,
        (v) => (s!.chopSize = v),
        32,
        512,
        8,
      ),
      slider(
        'Swell tilt',
        () => s!.swellAmount,
        (v) => (s!.swellAmount = v),
        0,
        2,
        0.05,
        'How much the long swell tilts the light',
      ),
      slider(
        'Chop tilt',
        () => s!.chopAmount,
        (v) => (s!.chopAmount = v),
        0,
        2,
        0.05,
        'How much the short chop tilts the light',
      ),
      slider(
        'Crest light',
        () => s!.crest,
        (v) => (s!.crest = v),
        0,
        1.5,
        0.05,
        'Light caught on the crests',
      ),
      slider(
        'Swirl size px',
        () => s!.flowSize,
        (v) => (s!.flowSize = v),
        256,
        6000,
        50,
        'How big the eddies of the swirl are',
      ),
      slider(
        'Warp',
        () => s!.warp,
        (v) => (s!.warp = v),
        0,
        1.5,
        0.01,
        'How hard the swirl bends the ripples',
      ),
      slider(
        'Flow carry',
        () => s!.flowStrength,
        (v) => (s!.flowStrength = v),
        0,
        1,
        0.01,
        'Flow only: how far the swirl carries the chop each phase',
      ),
      slider(
        'Swirl speed',
        () => s!.flowSpeed,
        (v) => (s!.flowSpeed = v),
        0,
        3,
        0.05,
        'How fast the swirl drifts and the flow phases turn over',
      ),
      slider(
        'Wander',
        () => s!.wander,
        (v) => (s!.wander = v),
        0,
        2,
        0.05,
        'How far the drift heading wanders, in radians',
      ),
      slider(
        'Gusts',
        () => s!.gust,
        (v) => (s!.gust = v),
        0,
        0.9,
        0.05,
        'How much the drift speed rises and falls',
      ),
      slider(
        'Rough: ocean',
        () => s!.roughness.ocean,
        (v) => (s!.roughness.ocean = v),
        0,
        2,
        0.05,
      ),
      slider(
        'Rough: high seas',
        () => s!.roughness.highSeas,
        (v) => (s!.roughness.highSeas = v),
        0,
        2,
        0.05,
      ),
      slider(
        'Rough: lakes',
        () => s!.roughness.lake,
        (v) => (s!.roughness.lake = v),
        0,
        2,
        0.05,
      ),
    );

    // Shore.
    panel.append(h4('Shore'));
    panel.append(
      select<ShoreModel>(
        'Distance',
        () => s!.shore,
        (v) => (s!.shore = v),
        [
          ['blur', 'Blur (first look)'],
          ['signed', 'Signed, texel field (Astra)'],
          ['art', 'Art edge, fine field (new)'],
        ],
      ),
      slider(
        'Shallows px',
        () => s!.shallowWidth,
        (v) => (s!.shallowWidth = v),
        2,
        48,
        1,
        'Signed/Art: how far out the shallows reach',
      ),
      slider(
        'Foam px',
        () => s!.foamWidth,
        (v) => (s!.foamWidth = v),
        0,
        24,
        0.5,
        'Signed/Art: how far out the foam laps',
      ),
      slider(
        'Foam: ocean',
        () => s!.foamStrength.ocean,
        (v) => (s!.foamStrength.ocean = v),
        0,
        2,
        0.05,
      ),
      slider(
        'Foam: high seas',
        () => s!.foamStrength.highSeas,
        (v) => (s!.foamStrength.highSeas = v),
        0,
        2,
        0.05,
      ),
      slider(
        'Foam: lakes',
        () => s!.foamStrength.lake,
        (v) => (s!.foamStrength.lake = v),
        0,
        2,
        0.05,
      ),
    );

    // Climate.
    panel.append(h4('Climate'));
    panel.append(
      check(
        'Tint by climate',
        () => s!.climate,
        (v) => (s!.climate = v),
        'Off: the flat colours below for every coast',
      ),
      note(
        'Cold: tundra, arctic, boreal. Temperate: plains, grassland, prairie, mixed, conifer. Tropical: savannah, desert, marsh, swamp and their forests, broadleaf. Open sea: by latitude.',
      ),
    );
    const head = el(
      'div',
      { className: 'pal' },
      el('span'),
      el('span', { textContent: 'deep' }),
      el('span', { textContent: 'shal' }),
      el('span', { textContent: 'foam' }),
      el('span', { textContent: 'foam amount' }),
    );
    panel.append(head);
    for (const k of CLIMATES) {
      const amount = el('input', { type: 'range', min: '0', max: '1.5', step: '0.05' });
      amount.addEventListener('input', () => {
        s!.palettes[k].foamAmount = Number(amount.value);
        apply(false);
      });
      refreshers.push(() => (amount.value = String(s!.palettes[k].foamAmount)));
      panel.append(
        el(
          'div',
          { className: 'pal' },
          el('span', { textContent: k }),
          color(
            () => s!.palettes[k].deep,
            (v) => (s!.palettes[k].deep = v),
            `${k} deep`,
          ),
          color(
            () => s!.palettes[k].shallow,
            (v) => (s!.palettes[k].shallow = v),
            `${k} shallows`,
          ),
          color(
            () => s!.palettes[k].foam,
            (v) => (s!.palettes[k].foam = v),
            `${k} foam`,
          ),
          amount,
        ),
      );
    }
    panel.append(
      slider(
        'Ice (cold)',
        () => s!.ice,
        (v) => (s!.ice = v),
        0,
        1,
        0.05,
        'A pale ice shelf along cold coasts',
      ),
      slider(
        'High seas shade',
        () => s!.highSeasShade,
        (v) => (s!.highSeasShade = v),
        0.3,
        1.2,
        0.01,
        "With climate: the high seas' colour as a share of the deep colour",
      ),
    );
    panel.append(h4('Flat colours (climate off)'));
    panel.append(
      el(
        'div',
        { className: 'row' },
        ...(['ocean', 'highSeas', 'lake', 'shallow', 'foam', 'light'] as const).map((k) =>
          el(
            'label',
            { className: 'wide' },
            el('span', { textContent: k }),
            color(
              () => s![k],
              (v) => (s![k] = v),
              k,
            ),
          ),
        ),
      ),
    );
    refresh();
  };

  // Wait for the water to start, then build the panel.
  const start = () => {
    const look = waterPlayground.look;
    if (!look || !waterPlayground.map) return void setTimeout(start, 300);
    base = clone(look);
    let saved: Settings | null = null;
    try {
      const raw = localStorage.getItem(STORE);
      saved = raw ? (JSON.parse(raw) as Settings) : null;
    } catch {
      saved = null;
    }
    s = saved ? { ...clone(base), ...saved } : clone(base);
    build();
    if (VARIANTS.includes(variant as Variant)) void choose(variant as Variant);
    else apply(true, true);
    host.showFps();
    expose();
  };
  start();

  // For scripts (ui/scripts/water-playground-shots.ts), once the water runs.
  const expose = () =>
    ((window as unknown as { fcWaterPlayground: unknown }).fcWaterPlayground = {
      spots: () => findSpots(),
      jump: (x: number, y: number, zoom: number) => host.jump(x, y, zoom),
      variant: (name: Variant) => choose(name),
      split: (fraction: number) => {
        split = Math.max(0, Math.min(1, fraction));
        return showVariant();
      },
      renderer: () => (surface() ? 'WebGL shader' : 'flipbook fallback'),
      preset: (name: string) => {
        s = clone(PRESETS[name](clone(base!)));
        refresh();
        apply(true);
        return busy;
      },
      set: (patch: Partial<Settings>) => {
        s = { ...s!, ...clone(patch) };
        refresh();
        apply(true);
        return busy;
      },
      view: (v: number) => {
        view = v;
        const sf = surface();
        if (sf) sf.view = v;
      },
      pause: (p: boolean) => {
        paused = p;
        const sf = surface();
        if (sf) sf.rate = p ? 0 : rate;
      },
      settings: () => s,
      properties: () => propertiesOf(s!),
      ready: () => busy,
    });
}
