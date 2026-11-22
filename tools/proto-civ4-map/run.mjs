// THROWAWAY (#405): screenshots and benchmarks of the prototype in headless Chromium and Firefox.
// Run in the browser image:  DEV_VARIANT=web ./dev.sh node tools/proto-civ4-map/run.mjs shots|bench [out dir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// HOST=1 runs on the host's own browsers and GPUs (playwright-core from ui/node_modules); otherwise in the browser image
const HOST = process.env.HOST === '1';
const { chromium, firefox } = HOST ? createRequire(new URL('../../ui/package.json', import.meta.url))('playwright-core') : createRequire(import.meta.url)('playwright');

const root = path.dirname(new URL(import.meta.url).pathname);
const mode = process.argv[2] ?? 'shots';
const out = process.argv[3] ?? path.join(root, 'out');
fs.mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const chromiumArgs = HOST ? (process.env.CHROME_ARGS ?? '--use-gl=angle --use-angle=gl --ignore-gpu-blocklist').split(' ')
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
async function open(browserType, { w, h, dpr, throttle = 1, query }) {
  const browser = await browserType.launch({ args: browserType === chromium ? chromiumArgs : [], ...(HOST && browserType === chromium ? { executablePath: process.env.CHROME ?? '/usr/bin/google-chrome' } : {}),
    ...(HOST && browserType === firefox ? { executablePath: process.env.FIREFOX } : {}),
    ...(browserType === firefox ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.enable-webgl2': true, 'webgl.disabled': false, 'webgl.software-rendering': true } } : {}) });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  if (throttle > 1 && browserType === chromium) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  const t0 = Date.now();
  await page.goto(`${base}?${query}`);
  try { await page.waitForFunction('window.protoReady === true', null, { timeout: 120000 }); } catch (e) { console.log(logs.join('\n')); throw e; }
  return { browser, page, wall: Date.now() - t0, logs };
}

if (mode === 'shots') {
  // three zoom levels in both views, grid off, on both maps (Chromium)
  const cases = [['topdown', 'topdown', 'topdown'], ['isometric', 'iso', 'isometric'], ['topdown', 'tilt', 'tilt'], ['topdown', 'oblique', 'oblique']];
  for (const [map, view, tag] of cases) {
    const { browser, page } = await open(chromium, { w: 1280, h: 720, dpr: 1, query: `map=${map}&view=${view}&hud=0${process.env.QX ?? ''}` });
    const c = await page.evaluate(() => [window.proto.W, window.proto.H]);
    const focus = view === 'oblique' ? [30, 34] : view === 'tilt' ? [24, 40] : map === 'topdown' ? [30, 34] : [46, 46];
    for (const [name, px] of [['near', 96], ['mid', 40], ['far', 0]]) {
      await page.evaluate(([px, fx, fy]) => { if (px) { window.proto.setZoom(px); window.proto.lookAt(fx, fy); } else window.proto.fit(); }, [px, ...focus]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
    }
    // the same mid view with the grid on
    await page.evaluate(([fx, fy]) => { window.proto.setGrid(true); window.proto.setZoom(40); window.proto.lookAt(fx, fy); }, focus);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${tag}-mid-grid.png`) });
    console.log(tag, JSON.stringify(await page.evaluate(() => window.proto.stats())));
    await browser.close();
  }
  // a fix attempt for the visible patches: a wider band plus a noise-wobbled border (&band=0.34&warp=0.5)
  for (const view of ['oblique', 'tilt']) {
    const { browser, page } = await open(chromium, { w: 1280, h: 720, dpr: 1, query: `map=topdown&view=${view}&hud=0&band=0.34&warp=0.5` });
    await page.evaluate(() => { window.proto.setZoom(40); window.proto.lookAt(view_x(), 34); function view_x() { return window.proto.W / 2 - 4; } });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${view}-mid-softer.png`) });
    await browser.close();
  }
  // the other combination: the Top-down-shaped map seen in Isometric and the reverse (what #559 says draws as a diamond)
  for (const [map, view, tag] of [['topdown', 'iso', 'topdownmap-in-iso'], ['isometric', 'topdown', 'isometricmap-in-topdown']]) {
    const { browser, page } = await open(chromium, { w: 1280, h: 720, dpr: 1, query: `map=${map}&view=${view}&hud=0` });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${tag}-far.png`) });
    await browser.close();
  }
}

if (mode === 'far') {
  // whole map on screen, a small pan, in each camera: the far-zoom cost of the perspective tilt
  const rows = [];
  for (const [w, h] of [[1280, 720], [1920, 1080]]) for (const dpr of [1, 2]) for (const [map, view] of [['topdown', 'topdown'], ['topdown', 'tilt'], ['topdown', 'oblique'], ['isometric', 'iso']]) {
    const { browser, page } = await open(chromium, { w, h, dpr, query: `map=${map}&view=${view}&hud=0` });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => window.proto.runBench(6, true));
    const st = await page.evaluate(() => window.proto.stats());
    const row = { size: `${w}x${h}`, dpr, map, view, ...r, calls: st.calls, triangles: st.triangles, renderer: st.renderer };
    rows.push(row); console.log(JSON.stringify(row));
    await browser.close();
  }
  fs.writeFileSync(path.join(out, (process.env.TAG ?? 'far') + '.json'), JSON.stringify(rows, null, 1));
}

if (mode === 'bench') {
  const rows = [];
  const secs = +(process.argv[4] ?? 6);
  const plan = [];
  const views = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [['topdown', 'topdown'], ['isometric', 'iso'], ['topdown', 'tilt']];
  for (const [bt, bn] of (process.env.ONLY === 'firefox' ? [[firefox, 'firefox']] : [[chromium, 'chromium'], [firefox, 'firefox']])) {
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      for (const dpr of [1, 2]) {
        for (const throttle of bn === 'chromium' ? [1, 6] : [1]) {
          for (const [map, view] of views) plan.push({ bt, bn, w, h, dpr, throttle, map, view });
        }
      }
    }
  }
  for (const p of (process.env.QX ? plan.filter((p) => p.bn === 'chromium' && p.w === 1920 && p.dpr === 2 && p.throttle === 1) : plan)) {
    const load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0];
    const { browser, page, wall } = await open(p.bt, { ...p, query: `map=${p.map}&view=${p.view}&hud=0${process.env.QX ?? ''}` });
    await page.waitForTimeout(500);
    const r = await page.evaluate((s) => window.proto.runBench(s), secs);
    const st = await page.evaluate(() => ({ ...window.proto.stats(), timing: window.proto.timing }));
    const row = { browser: p.bn, size: `${p.w}x${p.h}`, dpr: p.dpr, throttle: p.throttle, map: p.map, view: p.view, load1: +load, wallLoadMs: wall, ...r, ...st };
    rows.push(row);
    console.log(JSON.stringify(row));
    await browser.close();
  }
  fs.writeFileSync(path.join(out, (process.env.TAG ?? 'bench') + '.json'), JSON.stringify(rows, null, 1));
}
server.close();
