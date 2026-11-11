// The beta tester's feedback report (#369): what the Send feedback dialog collects, the report it makes from the
// tester's choices, the reference it names, and the two ways it leaves the page: a POST to the relay (relay/,
// docs/adr/0009) and a downloaded .zip. The report's fields and limits are relay/src/report.ts's, which rejects
// anything else, so a change here is a change there first.
import type { GameError } from './errors';
import { zipStored } from './zip';

export const KINDS = ['bug', 'idea', 'other'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, string> = { bug: 'Bug', idea: 'Idea', other: 'Other' };

/** A report as the relay takes it (relay/src/report.ts); every attachment is optional. */
export interface Report {
  kind: Kind;
  title: string;
  description: string;
  contact?: string;
  version?: string;
  browser?: string;
  errors?: string[];
  logs?: string;
  /** The current game as an .fsg file, base64. */
  save?: string;
}

/** The relay's limits (relay/src/report.ts LIMITS and MAX_BODY_BYTES). */
export const LIMITS = {
  title: 80,
  description: 20_000,
  contact: 200,
  version: 200,
  browser: 1_000,
  errors: 100,
  error: 10_000,
  logs: 2_000_000,
  body: 5 * 1024 * 1024,
} as const;

/** What the tester types. */
export interface Form {
  kind: Kind;
  title: string;
  description: string;
  contact: string;
}

/** Which attachments go with the report. */
export interface Ticks {
  errors: boolean;
  logs: boolean;
  version: boolean;
  browser: boolean;
  save: boolean;
}

/** What the page can attach: the errors the banner lists, the Engines' logs, the build, the browser, the game. */
export interface Facts {
  errors: string[];
  logs: string;
  version: string;
  browser: string;
  /** The current game as .fsg bytes; null when no game is running. */
  save: Uint8Array | null;
}

/** A bug starts with everything ticked; an idea or another kind with only the version and the browser. */
export function defaultTicks(kind: Kind, facts: Pick<Facts, 'errors' | 'save'>): Ticks {
  const bug = kind === 'bug';
  return {
    errors: bug && facts.errors.length > 0,
    logs: bug,
    version: true,
    browser: true,
    save: bug && facts.save !== null,
  };
}

/** An error as one text for the report: its title, how often, and its details (errors.tsx errorText). */
export const errorEntry = (e: GameError) =>
  `${e.title}${e.count > 1 ? ` (${e.count} times)` : ''}\n${e.detail}`.trimEnd();

/** The bytes as base64, in steps the call stack allows. */
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * The report for the form and the ticked attachments. Text past the relay's limits is cut (the logs keep their
 * end, where the last lines are), so a report the tester can see is one the relay takes.
 */
export function buildReport(form: Form, ticks: Ticks, facts: Facts): Report {
  const report: Report = {
    kind: form.kind,
    title: form.title.replace(/\s+/g, ' ').trim().slice(0, LIMITS.title),
    description: form.description.trim().slice(0, LIMITS.description),
  };
  const contact = form.contact.trim().slice(0, LIMITS.contact);
  if (contact) report.contact = contact;
  if (ticks.version) report.version = facts.version.slice(0, LIMITS.version);
  if (ticks.browser) report.browser = facts.browser.slice(0, LIMITS.browser);
  if (ticks.errors && facts.errors.length > 0) {
    report.errors = facts.errors.slice(0, LIMITS.errors).map((e) => e.slice(0, LIMITS.error));
  }
  if (ticks.logs) report.logs = facts.logs.slice(-LIMITS.logs);
  if (ticks.save && facts.save) report.save = toBase64(facts.save);
  return report;
}

/** Whether the report is a complete one: it needs a title and a description. */
export const isComplete = (form: Form) => form.title.trim() !== '' && form.description.trim() !== '';

/** The size of the report as the relay reads it, in bytes: past LIMITS.body the relay turns it away. */
export const bodyBytes = (report: Report) => new TextEncoder().encode(JSON.stringify(report)).length;

/** The letters of a reference, `R-XXXXX`: relay/src/reference.ts's alphabet, without 0/O and 1/I/L. */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERENCE_PATTERN = new RegExp(`^R-[${REFERENCE_ALPHABET}]{5}$`);

/** An integer from 0 to n - 1, evenly: bytes that would favour the low letters are drawn again. */
function randomBelow(n: number): number {
  const limit = 256 - (256 % n);
  const one = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(one);
    if (one[0] < limit) return one[0] % n;
  }
}

/** A new reference for a report downloaded; `pick(n)` gives an integer from 0 to n - 1. */
export function newReference(pick: (n: number) => number = randomBelow): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += REFERENCE_ALPHABET[pick(REFERENCE_ALPHABET.length)];
  return `R-${code}`;
}

/**
 * The relay's URL: the build's VITE_FEEDBACK_URL (the Pages workflow sets it from a repository variable), or none.
 * A build that is not a release also takes ?feedback=URL, so the browser scripts can point the page at a fake.
 */
export function relayUrl(env: { VITE_FEEDBACK_URL?: string; MODE?: string }, search: string): string {
  if (env.MODE !== 'release') {
    const asked = new URLSearchParams(search).get('feedback');
    if (asked) return asked;
  }
  return env.VITE_FEEDBACK_URL?.trim() || '';
}

export const FEEDBACK_URL = relayUrl(import.meta.env, typeof location === 'undefined' ? '' : location.search);

/** Whether the "Beta · Send feedback" tag shows: every build has it unless it is built with VITE_BETA_TAG=off. */
export const BETA_TAG = import.meta.env.VITE_BETA_TAG !== 'off';

export type Sent = { ok: true; reference: string } | { ok: false; error: string };

/** POST the report to the relay (relay/src/handler.ts): 201 with the reference, or why not. */
export async function sendReport(url: string, report: Report, post: typeof fetch = fetch): Promise<Sent> {
  try {
    const res = await post(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    const body: unknown = await res.json().catch(() => null);
    const field = (name: string) =>
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
    const reference = field('reference');
    if (res.status === 201 && typeof reference === 'string' && REFERENCE_PATTERN.test(reference)) {
      return { ok: true, reference };
    }
    const error = field('error');
    return { ok: false, error: typeof error === 'string' ? error : `the relay answered ${res.status}` };
  } catch (ex) {
    return { ok: false, error: ex instanceof Error ? ex.message : String(ex) };
  }
}

/** The file a downloaded report is saved as. */
export const zipName = (reference: string) => `${reference}.zip`;

/**
 * The downloaded report: `report.json` (as the relay keeps it: the report without logs and save), `logs.txt`
 * and `save.fsg` where they are attached, zipped.
 */
export function reportZip(report: Report, save: Uint8Array | null, reference: string, now: Date): Uint8Array {
  const { logs, save: attached, ...rest } = report;
  const saveBytes = attached !== undefined && save ? save : null;
  const entries: Record<string, string | Uint8Array> = {
    'report.json': JSON.stringify(
      {
        reference,
        received: now.toISOString(),
        ...rest,
        logs: logs !== undefined,
        saveBytes: saveBytes ? saveBytes.length : null,
      },
      null,
      2,
    ),
  };
  if (logs !== undefined) entries['logs.txt'] = logs;
  if (saveBytes) entries['save.fsg'] = saveBytes;
  return zipStored(entries);
}
