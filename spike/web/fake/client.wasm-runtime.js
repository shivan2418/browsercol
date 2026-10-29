// Fake client module emulating ClientMain: ready, gameStarted with a small
// map, N rounds each costing one message each way, then finished.
globalThis.TeaVM = { wasmGC: { async load(url) {
  await (await fetch(url)).arrayBuffer();
  const W = 40, H = 24, types = ['model.tile.highSeas', 'model.tile.ocean', 'model.tile.plains', 'model.tile.grassland',
    'model.tile.mixedForest', 'model.tile.hills', 'model.tile.mountains', 'model.tile.tundra', 'model.tile.marsh'];
  let turn = 1, left = 0, round = 0, t = 0;
  const map = () => {
    let tiles = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      tiles += x + y < turn ? '.' : String.fromCharCode(65 + (x < 4 ? 0 : x < 8 ? 1 : (x * 7 + y * 3) % 7 + 2));
    return JSON.stringify({ w: W, h: H, turn: String(turn), types, tiles,
      settlements: [[20, 10, 0xff0000]], units: [[21 + turn % 5, 11, 0x00ff00], [18, 9, 0xff0000]] });
  };
  return { exports: {
    main(args) { setTimeout(() => fcClientEvent('ready', ''), 20); },
    startGame(n) {
      left = n; fcConnect(); fcToServer('<login/>');   // first reply = logged in
    },
    receive(xml) {
      if (t === 0) { t = performance.now(); fcClientEvent('gameStarted', map()); }
      else {
        const ms = Math.round(performance.now() - t); round++; turn++;
        fcClientEvent('round', round + ',' + ms); fcClientEvent('map', map());
        if (round >= left) return fcClientEvent('finished', String(turn));
      }
      t = performance.now();
      setTimeout(() => fcToServer('<newTurn n="' + turn + '"/>'), 30);
    },
  } };
} } };
