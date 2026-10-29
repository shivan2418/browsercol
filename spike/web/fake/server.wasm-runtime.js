// Fake server module for exercising the page and harness without the real
// Wasm: same TeaVM.wasmGC.load shape, exports that emulate WorkerMain.
globalThis.TeaVM = { wasmGC: { async load(url) {
  await (await fetch(url)).arrayBuffer();   // pay for the (dummy) download like the real one
  return { exports: {
    main(args) { if (args.length % 2) fcServerEvent('failed', 'odd data args'); },
    startGame(rules) { setTimeout(() => fcServerEvent('started', '50'), 50); },
    connect() { fcPost('<connected/>'); },
    // Answer every client message with a bigger one, like a real update.
    receive(xml) { fcPost('<reply>' + 'x'.repeat(2000) + '</reply>'); },
  } };
} } };
