import { describe, expect, it } from 'vite-plus/test';
import { createHandler, type Store, type UrlRequest } from './handler.ts';
import { newReference, REFERENCE_ALPHABET, REFERENCE_PATTERN } from './reference.ts';
import { MAX_BODY_BYTES, titleSlug } from './report.ts';

const ORIGIN = 'https://shivan2418.github.io';
const NOW = new Date('2026-11-10T12:34:56Z');

/** An in-memory bucket, with every write in order. */
function memoryStore() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const store: Store = {
    async putNew(key, body, contentType) {
      if (objects.has(key)) return false;
      objects.set(key, { body: Buffer.from(body), contentType });
      return true;
    },
    async put(key, body, contentType) {
      objects.set(key, { body: Buffer.from(body), contentType });
    },
  };
  return { store, objects };
}

function relay(references: string[] = ['R-ABCDE']) {
  const { store, objects } = memoryStore();
  const queue = [...references];
  const handler = createHandler({
    store,
    allowedOrigin: ORIGIN,
    now: () => NOW,
    reference: () => queue.shift() ?? 'R-ZZZZZ',
  });
  return { handler, objects };
}

function post(body: unknown, headers: Record<string, string> = { origin: ORIGIN }): UrlRequest {
  return {
    requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

const SAVE = Buffer.from('PK\u0003\u0004 a FreeCol save');
const BUG = {
  kind: 'bug',
  title: 'Colonist vanished after "Build road"!',
  description: 'I told a pioneer to build a road and he was gone.',
  contact: 'u/tester',
  version: 'build 12 · 44cb97d',
  browser: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/145.0',
  errors: ['TypeError: unit is undefined'],
  logs: 'client: turn 3\nserver: turn 3\n',
  save: SAVE.toString('base64'),
};

describe('a good report', () => {
  it('writes report.json, logs.txt and save.fsg in one folder and returns the reference', async () => {
    const { handler, objects } = relay();
    const response = await handler(post(BUG));

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({ reference: 'R-ABCDE' });
    const folder = 'inbox/2026-11-10_R-ABCDE_bug_colonist-vanished-after-build-road/';
    expect([...objects.keys()].sort()).toEqual([`${folder}logs.txt`, `${folder}report.json`, `${folder}save.fsg`]);

    expect(JSON.parse(objects.get(`${folder}report.json`)!.body.toString())).toEqual({
      reference: 'R-ABCDE',
      received: '2026-11-10T12:34:56.000Z',
      kind: 'bug',
      title: BUG.title,
      description: BUG.description,
      contact: BUG.contact,
      version: BUG.version,
      browser: BUG.browser,
      errors: BUG.errors,
      logs: true,
      saveBytes: SAVE.length,
    });
    expect(objects.get(`${folder}logs.txt`)!.body.toString()).toBe(BUG.logs);
    expect(objects.get(`${folder}save.fsg`)!.body).toEqual(SAVE);
  });

  it('writes only report.json when the logs and save are unticked', async () => {
    const { handler, objects } = relay();
    const idea = { kind: 'idea', title: 'Zoom with the wheel', description: 'Please.', version: 'build 12' };
    const response = await handler(post(idea));

    expect(response.statusCode).toBe(201);
    const key = 'inbox/2026-11-10_R-ABCDE_idea_zoom-with-the-wheel/report.json';
    expect([...objects.keys()]).toEqual([key]);
    expect(JSON.parse(objects.get(key)!.body.toString())).toMatchObject({ logs: false, saveBytes: null });
  });

  it('reads a body the Function URL passes base64-encoded', async () => {
    const { handler, objects } = relay();
    const request = post(BUG);
    request.body = Buffer.from(request.body!).toString('base64');
    request.isBase64Encoded = true;

    expect((await handler(request)).statusCode).toBe(201);
    expect(objects.size).toBe(3);
  });

  it('draws a new reference when the folder is taken', async () => {
    const { handler, objects } = relay(['R-ABCDE', 'R-ABCDE', 'R-FGHJK']);
    await handler(post(BUG));
    const second = await handler(post(BUG));

    expect(JSON.parse(second.body)).toEqual({ reference: 'R-FGHJK' });
    expect(objects.size).toBe(6);
  });
});

describe('a bad report', () => {
  const cases: [string, unknown][] = [
    ['not JSON', '{"kind":'],
    ['a list', [BUG]],
    ['an unknown kind', { ...BUG, kind: 'rant' }],
    ['no title', { ...BUG, title: undefined }],
    ['a blank title', { ...BUG, title: '   ' }],
    ['a title of two lines', { ...BUG, title: 'one\ntwo' }],
    ['a title over 80 characters', { ...BUG, title: 'x'.repeat(81) }],
    ['no description', { ...BUG, description: '' }],
    ['a description too long', { ...BUG, description: 'x'.repeat(20_001) }],
    ['a contact too long', { ...BUG, contact: 'x'.repeat(201) }],
    ['a number for the version', { ...BUG, version: 12 }],
    ['errors that are not a list', { ...BUG, errors: 'boom' }],
    ['an error that is not a string', { ...BUG, errors: [{ message: 'boom' }] }],
    ['too many errors', { ...BUG, errors: Array.from({ length: 101 }, () => 'boom') }],
    ['a save that is not base64', { ...BUG, save: 'not base64!' }],
    ['an empty save', { ...BUG, save: '' }],
    ['an unknown field', { ...BUG, admin: true }],
  ];

  it.each(cases)('is rejected with 400 when it has %s, and nothing is written', async (_, body) => {
    const { handler, objects } = relay();
    const response = await handler(post(body));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toEqual(expect.any(String));
    expect(objects.size).toBe(0);
  });

  it('is rejected with 413 when the body is over 5 MB', async () => {
    const { handler, objects } = relay();
    const response = await handler(post({ ...BUG, logs: 'x'.repeat(MAX_BODY_BYTES) }));

    expect(response.statusCode).toBe(413);
    expect(objects.size).toBe(0);
  });
});

describe('CORS', () => {
  it('answers a preflight from the game page', async () => {
    const { handler } = relay();
    const response = await handler({ requestContext: { http: { method: 'OPTIONS' } }, headers: { origin: ORIGIN } });

    expect(response.statusCode).toBe(204);
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    });
  });

  it('names the game page on every answer to it, errors included', async () => {
    const { handler } = relay();
    for (const response of [await handler(post(BUG)), await handler(post({ ...BUG, kind: 'rant' }))]) {
      expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    }
  });

  it.each([
    ['another site', { origin: 'https://example.com' }],
    ['a look-alike host', { origin: 'https://shivan2418.github.io.example.com' }],
    ['no origin at all', {}],
  ])('turns away %s, with no CORS header and nothing written', async (_, headers) => {
    const { handler, objects } = relay();
    for (const method of ['OPTIONS', 'POST']) {
      const response = await handler({ ...post(BUG, headers), requestContext: { http: { method } } });
      expect(response.statusCode).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(objects.size).toBe(0);
  });

  it('refuses a method other than POST', async () => {
    const { handler } = relay();
    const response = await handler({ requestContext: { http: { method: 'GET' } }, headers: { origin: ORIGIN } });

    expect(response.statusCode).toBe(405);
  });
});

describe('the reference', () => {
  it('is R- and five letters from an alphabet without 0/O or 1/I/L', () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(new Set(REFERENCE_ALPHABET).size).toBe(REFERENCE_ALPHABET.length);
    for (let i = 0; i < 200; i++) expect(newReference()).toMatch(REFERENCE_PATTERN);
    expect(newReference(() => 0)).toBe('R-22222');
    expect(newReference((n) => n - 1)).toBe('R-ZZZZZ');
  });
});

describe('the title slug', () => {
  it.each([
    ['Colonist vanished after "Build road"!', 'colonist-vanished-after-build-road'],
    ['Señor Cortés’ ships', 'senor-cortes-ships'],
    ['  --Trailing--  ', 'trailing'],
    ['A very long title that runs on well past forty characters', 'a-very-long-title-that-runs-on-well-past'],
    ['ends on a hyphen at character forty-one!!', 'ends-on-a-hyphen-at-character-forty-one'],
    ['????', 'untitled'],
    ['日本語', 'untitled'],
  ])('%j becomes %j', (title, slug) => {
    expect(titleSlug(title)).toBe(slug);
    expect(slug).toMatch(/^[a-z0-9-]{1,40}$/);
  });
});
