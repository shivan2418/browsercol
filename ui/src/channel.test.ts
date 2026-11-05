import { describe, expect, it } from 'vite-plus/test';
import { serveWorker, startPage, type ClientExports, type ServerExports } from './channel';
import { fakeSaveStore } from './fake-saves';
import type { GuiHandlers } from './webgui';

// The Engine modules are faked: each calls the same globals the Java side
// calls (WorkerMain's fcPost/fcServerEvent, ClientMain's fcToServer,
// fcConnect, fcClientEvent and the WebGUI's fcAsk), so the routing is tested
// end to end over a real MessageChannel (Node's global one) standing in for
// the Worker.

type Scope = Record<string, any>;

function fakeServer(scope: Scope, log: string[]): ServerExports {
  return {
    setLanguage: (id) => log.push(`server language ${id}`),
    main: (args) => log.push(`server main ${args.length}`),
    startGame: (rules, preset) => {
      log.push(`server start ${rules} ${preset}`);
      scope.fcServerEvent('started', '12');
    },
    connect: () => log.push('server connect'),
    receive: (xml) => {
      log.push(`server got ${xml}`);
      scope.fcPost('<loginReply/>');
    },
    saveGame: (active) => {
      log.push(`server save ${active}`);
      scope.fcSaved(new Int8Array([1, 2, 3]));
      scope.fcServerEvent('saved', '{"turn":4,"year":1495,"nation":"Dutch","owner":"me","ms":9}');
    },
    debug: (request) => {
      log.push(`server debug ${request}`);
      scope.fcServerEvent('debug', '{"action":"addGold"}');
    },
    setup: () => {
      log.push('server setup');
      scope.fcServerEvent('debug', '{"action":"addColony"}');
    },
    loadGame: (bytes) => {
      log.push(`server load ${[...bytes].join(',')}`);
      scope.fcServerEvent('owner', 'Ana');
      scope.fcServerEvent('loaded', '5,Turn 4');
    },
  };
}

function fakeClient(scope: Scope, log: string[]): ClientExports {
  return {
    activeUnitId: () => 'unit:42',
    colony: () => 'null',
    setLanguage: (id) => log.push(`client language ${id}`),
    main: (args) => {
      log.push(`client main ${args.length}`);
      queueMicrotask(() => scope.fcClientEvent('ready', ''));
    },
    startGame: (rounds, name) => {
      log.push(`client start ${rounds}${name ? ` as ${name}` : ''}`);
      scope.fcConnect();
      scope.fcToServer('<login/>');
    },
    receive: (xml) => {
      log.push(`client got ${xml}`);
      // As a controller would: ask the player before going on.
      scope.fcAsk(
        7,
        'confirm',
        '{"text":"Go on?","ok":"Yes","cancel":"No","defaultOk":true,"tile":null,"object":null,"header":null}',
      );
    },
    answer: (id, value) => {
      log.push(`client answer ${id} ${value}`);
      scope.fcClientEvent('finished', '1');
    },
    skipTurns: (rounds) => log.push(`client skip ${rounds}`),
    debugApplied: (answer) => log.push(`client applied ${answer}`),
    click: () => {},
    goTo: () => {},
    pathTo: () => 'null',
    move: () => {},
    nextUnit: () => {},
    buildColony: () => {},
    endTurn: () => {},
    declareIndependence: () => {},
    showEurope: () => {},
    showGameOptions: () => {},
    retire: () => {},
    showHighScores: () => {},
    showMapGeneratorOptions: () => {},
    showDifficulty: () => {},
    recruitUnit: () => {},
    trainUnit: () => {},
    boardShip: () => {},
    buyGoods: () => {},
    sellGoods: () => {},
    leaveShip: () => {},
    loadGoods: () => {},
    unloadGoods: () => {},
    sailToNewWorld: () => {},
    fortify: () => {},
    sentry: () => {},
    skip: () => {},
    disband: () => {},
    plow: () => {},
    work: () => {},
    putOutsideColony: () => {},
    changeWorkType: () => {},
    setBuildQueue: () => {},
    payForBuilding: () => {},
    warehouse: () => {},
    stepColony: () => {},
    closeColonyPanel: () => {},
    clearForest: () => {},
    road: () => {},
    selectDestination: () => {},
    tradeRoutes: () => {},
    tileMenu: () => 'null',
    unitMenu: () => 'null',
    colonyTileMenu: () => 'null',
    goodsMenu: () => 'null',
    menuEntry: () => {},
    report: () => {},
    reportDetail: () => {},
    showColony: () => {},
    saveTradeRoute: () => {},
    deleteTradeRoute: () => {},
    assignTradeRoute: () => {},
    reportGroupBy: () => {},
    clientOptionValues: () => '{}',
    setClientOption: () => true,
    refreshMap: () => {},
    reportFilter: () => {},
    reportIgnore: () => {},
  };
}

const sayYes: GuiHandlers = {
  events: {},
  questions: {
    event: () => true,
    confirm: () => true,
    choice: () => null,
    input: () => null,
    goods: () => null,
    negotiation: () => null,
    names: () => null,
    father: () => null,
    warehouse: () => null,
    endTurn: () => null,
    preCombat: () => false,
    amount: () => null,
  },
};

describe('the Worker channel', () => {
  it('starts a game, carries protocol XML both ways and answers the WebGUI', async () => {
    const { port1: page, port2: worker } = new MessageChannel();
    const log: string[] = [];
    const workerScope: Scope = {};
    const pageScope: Scope = {};
    const data = ['data/a.xml', '<a/>', 'data/b.xml', '<b/>'];

    serveWorker(worker, async () => fakeServer(workerScope, log), workerScope, fakeSaveStore());
    const events: string[] = [];
    const finished = new Promise<void>((done) =>
      startPage({
        worker: page,
        loadClient: async () => fakeClient(pageScope, log),
        data,
        language: 'de',
        rules: 'classic',
        preset: '{"seed":1}',
        autoplay: 3,
        scope: pageScope,
        gui: sayYes,
        onEvent: (name) => {
          events.push(name);
          if (name === 'finished') done();
        },
      }),
    );
    await finished;
    page.close();

    // The two modules load concurrently, so their mains may run in either order; each is told the
    // language first.
    const side = (who: string) => log.slice(0, 4).filter((l) => l.startsWith(who));
    expect(side('server')).toEqual(['server language de', 'server main 4']);
    expect(side('client')).toEqual(['client language de', 'client main 4']);
    expect(log.slice(4)).toEqual([
      'server start classic {"seed":1}',
      'client start 3',
      'server connect',
      'server got <login/>',
      'client got <loginReply/>',
      'client answer 7 true',
    ]);
    expect(events).toEqual(['ready', 'started', 'finished']);
  });

  /** The two ends joined, the page's game started, with a fake store. */
  function joined(load?: number) {
    const { port1: page, port2: worker } = new MessageChannel();
    const log: string[] = [];
    const workerScope: Scope = {};
    const pageScope: Scope = {};
    const store = fakeSaveStore();
    serveWorker(worker, async () => fakeServer(workerScope, log), workerScope, store);
    const events: [string, string][] = [];
    const waiting: [string, () => void][] = [];
    const exports = startPage({
      worker: page,
      loadClient: async () => fakeClient(pageScope, log),
      data: [],
      language: 'en',
      rules: 'classic',
      load,
      autoplay: 0,
      scope: pageScope,
      gui: sayYes,
      onEvent: (name, detail) => {
        events.push([name, detail]);
        for (const w of waiting.filter(([n]) => n === name)) w[1]();
      },
    });
    const seen = (name: string) =>
      new Promise<void>((done) => (events.some(([n]) => n === name) ? done() : waiting.push([name, done])));
    return { page, store, log, events, exports, seen, pageScope };
  }

  it('saves the game with the active unit into the store, and tells the page', async () => {
    const t = joined();
    await t.seen('started');
    t.page.postMessage({ k: 'save', active: (await t.exports).activeUnitId(), name: 'my save' });
    await t.seen('saved');
    t.page.close();

    expect(t.log).toContain('server save unit:42');
    const [meta] = await t.store.list();
    expect(meta).toMatchObject({ id: 1, name: 'my save', turn: 4, year: 1495, nation: 'Dutch', size: 3 });
    expect([...t.store.blobs.get(1)!]).toEqual([1, 2, 3]);
    const saved = t.events.find(([n]) => n === 'saved')!;
    expect(JSON.parse(saved[1])).toEqual(meta);
  });

  it('names a save after its nation and turn when the player gives no name', async () => {
    const t = joined();
    await t.seen('started');
    t.page.postMessage({ k: 'save', active: '', name: '  ' });
    await t.seen('saved');
    t.page.close();
    expect((await t.store.list())[0].name).toBe('Dutch, turn 4 (1495)');
  });

  it('loads a save in place of a new game and logs the client in', async () => {
    const { port1: page, port2: worker } = new MessageChannel();
    const log: string[] = [];
    const workerScope: Scope = {};
    const pageScope: Scope = {};
    const store = fakeSaveStore();
    const saved = await store.put(
      { name: 'old', date: 1, turn: 4, year: 1495, nation: 'Dutch' },
      new Uint8Array([7, 8, 9]),
    );
    serveWorker(worker, async () => fakeServer(workerScope, log), workerScope, store);
    const events: string[] = [];
    await new Promise<void>((done) =>
      startPage({
        worker: page,
        loadClient: async () => fakeClient(pageScope, log),
        data: [],
        language: 'en',
        rules: 'classic',
        load: saved.id,
        autoplay: 3,
        scope: pageScope,
        gui: sayYes,
        onEvent: (name) => {
          events.push(name);
          if (name === 'finished') done();
        },
      }),
    );
    page.close();
    expect(log.filter((l) => !l.endsWith(' main 0') && !l.includes(' language '))).toEqual([
      'server load 7,8,9',
      'client start 0 as Ana',
      'server connect',
      'server got <login/>',
      'client got <loginReply/>',
      'client answer 7 true',
    ]);
    expect(events).toEqual(['ready', 'owner', 'loaded', 'finished']);
  });

  it('sends a debug request to the server Engine and hands its answer to the client Engine', async () => {
    const t = joined();
    await t.seen('started');
    t.page.postMessage({ k: 'debug', request: '{"action":"addGold","amount":5}' });
    await t.seen('debug');
    t.page.close();
    expect(t.log).toContain('server debug {"action":"addGold","amount":5}');
    expect(t.log).toContain('client applied {"action":"addGold"}');
  });

  it("asks the server Engine for the preset's setup once, when a new game has started", async () => {
    const t = joined();
    await t.seen('started');
    t.pageScope.fcClientEvent('gameStarted', '{}');
    t.pageScope.fcClientEvent('gameStarted', '{}');
    await t.seen('debug');
    t.page.close();
    expect(t.log.filter((l) => l === 'server setup')).toHaveLength(1);
  });

  it('does not run the setup for a loaded game', async () => {
    const t = joined(99);
    await t.seen('loadFailed');
    t.pageScope.fcClientEvent('gameStarted', '{}');
    await new Promise((done) => setTimeout(done, 20));
    t.page.close();
    expect(t.log).not.toContain('server setup');
  });

  it('reports a save that is not there', async () => {
    const t = joined(99);
    await t.seen('loadFailed');
    t.page.close();
    expect(t.events.find(([n]) => n === 'loadFailed')![1]).toBe('no save 99');
  });
});
