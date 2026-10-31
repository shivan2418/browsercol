import { describe, expect, it } from 'vite-plus/test';
import { serveWorker, startPage, type ClientExports, type ServerExports } from './channel';
import type { GuiHandlers } from './webgui';

// The Engine modules are faked: each calls the same globals the Java side
// calls (WorkerMain's fcPost/fcServerEvent, ClientMain's fcToServer,
// fcConnect, fcClientEvent and the WebGUI's fcAsk), so the routing is tested
// end to end over a real MessageChannel (Node's global one) standing in for
// the Worker.

type Scope = Record<string, any>;

function fakeServer(scope: Scope, log: string[]): ServerExports {
  return {
    main: (args) => log.push(`server main ${args.length}`),
    startGame: (rules) => {
      log.push(`server start ${rules}`);
      scope.fcServerEvent('started', '12');
    },
    connect: () => log.push('server connect'),
    receive: (xml) => {
      log.push(`server got ${xml}`);
      scope.fcPost('<loginReply/>');
    },
  };
}

function fakeClient(scope: Scope, log: string[]): ClientExports {
  return {
    main: (args) => {
      log.push(`client main ${args.length}`);
      queueMicrotask(() => scope.fcClientEvent('ready', ''));
    },
    startGame: (rounds) => {
      log.push(`client start ${rounds}`);
      scope.fcConnect();
      scope.fcToServer('<login/>');
    },
    receive: (xml) => {
      log.push(`client got ${xml}`);
      // As a controller would: ask the player before going on.
      scope.fcAsk(
        7,
        'confirm',
        '{"text":"Go on?","ok":"Yes","cancel":"No","defaultOk":true,"tile":null,"object":null}',
      );
    },
    answer: (id, value) => {
      log.push(`client answer ${id} ${value}`);
      scope.fcClientEvent('finished', '1');
    },
    click: () => {},
    move: () => {},
    nextUnit: () => {},
    buildColony: () => {},
    endTurn: () => {},
    fortify: () => {},
    sentry: () => {},
    skip: () => {},
    disband: () => {},
    plow: () => {},
    clearForest: () => {},
    road: () => {},
    selectDestination: () => {},
  };
}

const sayYes: GuiHandlers = {
  events: {},
  questions: { confirm: () => true, choice: () => null, input: () => null, goods: () => null },
};

describe('the Worker channel', () => {
  it('starts a game, carries protocol XML both ways and answers the WebGUI', async () => {
    const { port1: page, port2: worker } = new MessageChannel();
    const log: string[] = [];
    const workerScope: Scope = {};
    const pageScope: Scope = {};
    const data = ['data/a.xml', '<a/>', 'data/b.xml', '<b/>'];

    serveWorker(worker, async () => fakeServer(workerScope, log), workerScope);
    const events: string[] = [];
    const finished = new Promise<void>((done) =>
      startPage({
        worker: page,
        loadClient: async () => fakeClient(pageScope, log),
        data,
        rules: 'classic',
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

    // The two modules load concurrently, so their mains may run in either order.
    expect(log.slice(0, 2).sort()).toEqual(['client main 4', 'server main 4']);
    expect(log.slice(2)).toEqual([
      'server start classic',
      'client start 3',
      'server connect',
      'server got <login/>',
      'client got <loginReply/>',
      'client answer 7 true',
    ]);
    expect(events).toEqual(['ready', 'started', 'finished']);
  });
});
