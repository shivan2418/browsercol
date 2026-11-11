/**
 * A feedback report as the game's Send feedback dialog posts it (#369), and
 * the check that a request body is one. Every attachment is optional: the
 * tester can untick each, and the Start screen has no game to save.
 */
export interface Report {
  kind: Kind;
  title: string;
  description: string;
  /** "Reddit username or email, if we may ask you follow-up questions". */
  contact?: string;
  /** The build the page names, "build N · <commit>". */
  version?: string;
  /** The user agent. */
  browser?: string;
  /** What the error banner lists. */
  errors?: string[];
  /** Both Engines' log tails. */
  logs?: string;
  /** The current game as an .fsg file, base64. */
  save?: string;
}

export const KINDS = ['bug', 'idea', 'other'] as const;
export type Kind = (typeof KINDS)[number];

/** The largest request body the relay reads, in bytes: a save is a few hundred KB, the logs less. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export const LIMITS = {
  title: 80,
  description: 20_000,
  contact: 200,
  version: 200,
  browser: 1_000,
  errors: 100,
  error: 10_000,
  logs: 2_000_000,
  save: MAX_BODY_BYTES,
} as const;

const KEYS = new Set<string>([
  'kind',
  'title',
  'description',
  'contact',
  'version',
  'browser',
  'errors',
  'logs',
  'save',
]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type Parsed = { ok: true; report: Report } | { ok: false; error: string };

/** The report in `value`, or why it is not one. */
export function parseReport(value: unknown): Parsed {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('the body is not a JSON object');
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => !KEYS.has(key));
  if (unknown !== undefined) return fail(`unknown field ${unknown}`);

  if (!KINDS.includes(body.kind as Kind)) return fail(`kind must be one of ${KINDS.join(', ')}`);
  const title = text(body.title, 'title', LIMITS.title, true);
  if (typeof title !== 'string') return title;
  if (/[\r\n]/.test(title)) return fail('title must be one line');
  const description = text(body.description, 'description', LIMITS.description, true);
  if (typeof description !== 'string') return description;

  const report: Report = { kind: body.kind as Kind, title, description };
  for (const key of ['contact', 'version', 'browser', 'logs'] as const) {
    if (body[key] === undefined) continue;
    const value = text(body[key], key, LIMITS[key], false);
    if (typeof value !== 'string') return value;
    report[key] = value;
  }
  if (body.errors !== undefined) {
    if (!Array.isArray(body.errors)) return fail('errors must be a list of strings');
    if (body.errors.length > LIMITS.errors) return fail(`errors may hold at most ${LIMITS.errors} entries`);
    const errors: string[] = [];
    for (const error of body.errors) {
      const value = text(error, 'each error', LIMITS.error, false);
      if (typeof value !== 'string') return value;
      errors.push(value);
    }
    report.errors = errors;
  }
  if (body.save !== undefined) {
    if (typeof body.save !== 'string' || body.save.length === 0 || !BASE64.test(body.save)) {
      return fail('save must be base64');
    }
    if (body.save.length > LIMITS.save) return fail('save is too large');
    report.save = body.save;
  }
  return { ok: true, report };
}

function text(value: unknown, name: string, max: number, required: boolean): string | Parsed {
  if (typeof value !== 'string') return fail(`${name} must be a string`);
  if (required && value.trim() === '') return fail(`${name} is required`);
  if (value.length > max) return fail(`${name} may be at most ${max} characters`);
  return value;
}

function fail(error: string): Parsed {
  return { ok: false, error };
}

/**
 * The title as an S3 key part: lowercase ASCII letters, digits and hyphens,
 * at most 40 characters, `untitled` when nothing is left.
 */
export function titleSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug === '' ? 'untitled' : slug;
}
