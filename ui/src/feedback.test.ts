import { describe, expect, it } from 'vite-plus/test';
import { REFERENCE_ALPHABET as RELAY_ALPHABET } from '../../relay/src/reference.ts';
import { zipEntry } from './fsg';
import {
  LIMITS,
  REFERENCE_ALPHABET,
  REFERENCE_PATTERN,
  buildReport,
  defaultTicks,
  errorEntry,
  newReference,
  relayUrl,
  reportZip,
  sendReport,
  toBase64,
  type Facts,
  type Form,
} from './feedback';

const form: Form = { kind: 'bug', title: ' The  colony\nvanished ', description: 'It was gone.', contact: '' };
const facts: Facts = {
  errors: ['Ending turn 3\ntrace'],
  logs: 'Server Engine\nline',
  version: 'build 12 · abc1234',
  browser: 'Firefox',
  save: new Uint8Array([1, 2, 3, 250]),
};

describe('defaultTicks', () => {
  it('ticks everything for a bug, and only what exists', () => {
    expect(defaultTicks('bug', facts)).toEqual({ errors: true, logs: true, version: true, browser: true, save: true });
    expect(defaultTicks('bug', { errors: [], save: null })).toEqual({
      errors: false,
      logs: true,
      version: true,
      browser: true,
      save: false,
    });
  });
  it('ticks only the version and the browser for an idea or another kind', () => {
    for (const kind of ['idea', 'other'] as const) {
      expect(defaultTicks(kind, facts)).toEqual({
        errors: false,
        logs: false,
        version: true,
        browser: true,
        save: false,
      });
    }
  });
});

describe('buildReport', () => {
  it('holds every attachment of a bug, with the title on one line and the save in base64', () => {
    expect(buildReport(form, defaultTicks('bug', facts), facts)).toEqual({
      kind: 'bug',
      title: 'The colony vanished',
      description: 'It was gone.',
      version: 'build 12 · abc1234',
      browser: 'Firefox',
      errors: ['Ending turn 3\ntrace'],
      logs: 'Server Engine\nline',
      save: 'AQID+g==',
    });
  });
  it('leaves out each attachment that is unticked', () => {
    const all = defaultTicks('bug', facts);
    expect(buildReport(form, { ...all, errors: false }, facts)).not.toHaveProperty('errors');
    expect(buildReport(form, { ...all, logs: false }, facts)).not.toHaveProperty('logs');
    expect(buildReport(form, { ...all, version: false }, facts)).not.toHaveProperty('version');
    expect(buildReport(form, { ...all, browser: false }, facts)).not.toHaveProperty('browser');
    expect(buildReport(form, { ...all, save: false }, facts)).not.toHaveProperty('save');
  });
  it('sends an idea with only the version and the browser', () => {
    const idea: Form = { ...form, kind: 'idea', contact: ' u/someone ' };
    expect(buildReport(idea, defaultTicks('idea', facts), facts)).toEqual({
      kind: 'idea',
      title: 'The colony vanished',
      description: 'It was gone.',
      contact: 'u/someone',
      version: 'build 12 · abc1234',
      browser: 'Firefox',
    });
  });
  it('leaves out the save when there is no game, even if it is ticked', () => {
    const none = { ...facts, save: null };
    expect(buildReport(form, { ...defaultTicks('bug', facts), save: true }, none)).not.toHaveProperty('save');
  });
  it('cuts what is past the relay limits, keeping the end of the logs', () => {
    const long: Facts = {
      ...facts,
      errors: Array.from({ length: 120 }, () => 'e'.repeat(LIMITS.error + 5)),
      logs: 'x'.repeat(LIMITS.logs) + 'END',
    };
    const report = buildReport(
      { ...form, title: 't'.repeat(200), description: 'd'.repeat(LIMITS.description + 1) },
      defaultTicks('bug', long),
      long,
    );
    expect(report.title).toHaveLength(LIMITS.title);
    expect(report.description).toHaveLength(LIMITS.description);
    expect(report.errors).toHaveLength(LIMITS.errors);
    expect(report.errors![0]).toHaveLength(LIMITS.error);
    expect(report.logs).toHaveLength(LIMITS.logs);
    expect(report.logs!.endsWith('END')).toBe(true);
  });
});

describe('errorEntry', () => {
  it('names an error with its count and details', () => {
    expect(errorEntry({ title: 'It broke', detail: 'trace', count: 2 })).toBe('It broke (2 times)\ntrace');
    expect(errorEntry({ title: 'It broke', detail: '', count: 1 })).toBe('It broke');
  });
});

describe('toBase64', () => {
  it('handles a save bigger than one step', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
    expect(Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});

describe('references', () => {
  it('uses the relay alphabet, without look-alikes', () => {
    expect(REFERENCE_ALPHABET).toBe(RELAY_ALPHABET);
    expect(REFERENCE_ALPHABET).toHaveLength(31);
    for (const c of '01OIL') expect(REFERENCE_ALPHABET).not.toContain(c);
  });
  it('makes R- and five letters of the alphabet', () => {
    for (let i = 0; i < 200; i++) expect(newReference()).toMatch(REFERENCE_PATTERN);
    expect(newReference((n) => n - 1)).toBe('R-ZZZZZ');
    expect(newReference(() => 0)).toBe('R-22222');
  });
  it('reaches every letter', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const c of newReference().slice(2)) seen.add(c);
    expect(seen.size).toBe(31);
  });
});

describe('relayUrl', () => {
  it('is none without a URL in the build, as in local and test builds', () => {
    expect(relayUrl({}, '')).toBe('');
    expect(relayUrl({ VITE_FEEDBACK_URL: ' ' }, '')).toBe('');
  });
  it('is the build URL', () => {
    expect(relayUrl({ VITE_FEEDBACK_URL: 'https://relay.example/', MODE: 'release' }, '')).toBe(
      'https://relay.example/',
    );
  });
  it('takes the page address only in a build that is not a release', () => {
    expect(relayUrl({ MODE: 'development' }, '?feedback=https://fake.test/')).toBe('https://fake.test/');
    expect(relayUrl({ MODE: 'release' }, '?feedback=https://fake.test/')).toBe('');
  });
});

describe('sendReport', () => {
  const report = buildReport(form, defaultTicks('bug', facts), facts);
  const answer = (status: number, body: unknown) =>
    (() => Promise.resolve(Response.json(body, { status }))) as typeof fetch;
  it('posts the report as JSON and returns the relay reference', async () => {
    let sent: { url: string; init?: RequestInit } | null = null;
    const post = ((url: string, init?: RequestInit) => {
      sent = { url, init };
      return Promise.resolve(Response.json({ reference: 'R-AB234' }, { status: 201 }));
    }) as typeof fetch;
    expect(await sendReport('https://relay.test/', report, post)).toEqual({ ok: true, reference: 'R-AB234' });
    expect(sent!.url).toBe('https://relay.test/');
    expect(sent!.init!.method).toBe('POST');
    expect(JSON.parse(sent!.init!.body as string)).toEqual(report);
  });
  it('gives the relay reason for a refusal', async () => {
    expect(await sendReport('u', report, answer(400, { error: 'title is required' }))).toEqual({
      ok: false,
      error: 'title is required',
    });
    expect(await sendReport('u', report, answer(503, {}))).toEqual({ ok: false, error: 'the relay answered 503' });
  });
  it('does not take a reference that is not one', async () => {
    expect((await sendReport('u', report, answer(201, { reference: 'R-00000' }))).ok).toBe(false);
  });
  it('fails, with the reason, when the relay cannot be reached', async () => {
    const down = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    expect(await sendReport('u', report, down)).toEqual({ ok: false, error: 'Failed to fetch' });
  });
});

describe('reportZip', () => {
  const read = async (zip: Uint8Array, name: string) => {
    const entry = await zipEntry(zip, name);
    return entry && new TextDecoder().decode(entry);
  };
  it('holds report.json, logs.txt and save.fsg', async () => {
    const report = buildReport(form, defaultTicks('bug', facts), facts);
    const zip = reportZip(report, facts.save, 'R-AB234', new Date('2026-11-10T12:00:00Z'));
    expect(JSON.parse((await read(zip, 'report.json'))!)).toEqual({
      reference: 'R-AB234',
      received: '2026-11-10T12:00:00.000Z',
      kind: 'bug',
      title: 'The colony vanished',
      description: 'It was gone.',
      version: 'build 12 · abc1234',
      browser: 'Firefox',
      errors: ['Ending turn 3\ntrace'],
      logs: true,
      saveBytes: 4,
    });
    expect(await read(zip, 'logs.txt')).toBe('Server Engine\nline');
    expect(await zipEntry(zip, 'save.fsg')).toEqual(facts.save);
  });
  it('leaves out the files of what is not attached', async () => {
    const idea = buildReport({ ...form, kind: 'idea' }, defaultTicks('idea', facts), facts);
    const zip = reportZip(idea, facts.save, 'R-AB234', new Date(0));
    expect(await zipEntry(zip, 'logs.txt')).toBeNull();
    expect(await zipEntry(zip, 'save.fsg')).toBeNull();
    expect(JSON.parse((await read(zip, 'report.json'))!)).toMatchObject({ logs: false, saveBytes: null });
  });
});
