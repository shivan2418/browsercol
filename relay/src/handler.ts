import { newReference } from './reference.ts';
import { MAX_BODY_BYTES, parseReport, titleSlug, type Report } from './report.ts';

/** The parts of a Lambda Function URL request the relay reads (payload format 2.0). */
export interface UrlRequest {
  requestContext: { http: { method: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface UrlResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Where reports are kept: S3 in the Lambda (s3-store.ts), a map in the tests. */
export interface Store {
  /** Writes the object unless its key is taken; false when it is. */
  putNew(key: string, body: Uint8Array, contentType: string): Promise<boolean>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface Relay {
  store: Store;
  /** The one page origin allowed to post, https://shivan2418.github.io. */
  allowedOrigin: string;
  now?: () => Date;
  reference?: () => string;
}

/** Fresh references tried before giving up; with 31^5 of them, a second is already rare. */
const ATTEMPTS = 5;

/** The Function URL handler: one report in, its reference out. */
export function createHandler({ store, allowedOrigin, now = () => new Date(), reference = newReference }: Relay) {
  return async (request: UrlRequest): Promise<UrlResponse> => {
    const method = request.requestContext.http.method.toUpperCase();
    const origin = header(request, 'origin');
    if (origin !== allowedOrigin) return respond(403, { error: 'origin not allowed' });
    const cors = {
      'access-control-allow-origin': allowedOrigin,
      vary: 'Origin',
    };
    if (method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
        },
        body: '',
      };
    }
    if (method !== 'POST') return respond(405, { error: 'only POST' }, { ...cors, allow: 'POST, OPTIONS' });

    const raw = request.body ?? '';
    const bytes = request.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
    if (bytes.length > MAX_BODY_BYTES) return respond(413, { error: 'report too large' }, cors);
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString('utf8'));
    } catch {
      return respond(400, { error: 'the body is not JSON' }, cors);
    }
    const parsed = parseReport(json);
    if (!parsed.ok) return respond(400, { error: parsed.error }, cors);

    const received = now();
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const ref = reference();
      const folder = reportFolder(received, ref, parsed.report);
      // report.json goes first and only to a free key, so a reference is never written over.
      const written = await store.putNew(
        `${folder}report.json`,
        utf8(JSON.stringify(reportJson(parsed.report, ref, received), null, 2)),
        'application/json',
      );
      if (!written) continue;
      if (parsed.report.logs !== undefined) {
        await store.put(`${folder}logs.txt`, utf8(parsed.report.logs), 'text/plain; charset=utf-8');
      }
      if (parsed.report.save !== undefined) {
        await store.put(`${folder}save.fsg`, Buffer.from(parsed.report.save, 'base64'), 'application/octet-stream');
      }
      return respond(201, { reference: ref }, cors);
    }
    return respond(503, { error: 'no free reference, try again' }, cors);
  };
}

/** `inbox/<date>_R-XXXXX_<kind>_<title-slug>/`: one S3 listing shows every report's gist. */
export function reportFolder(received: Date, reference: string, report: Report): string {
  const date = received.toISOString().slice(0, 10);
  return `inbox/${date}_${reference}_${report.kind}_${titleSlug(report.title)}/`;
}

/** report.json: the report without the logs and save, which have their own files. */
function reportJson(report: Report, reference: string, received: Date) {
  const { logs, save, ...rest } = report;
  return {
    reference,
    received: received.toISOString(),
    ...rest,
    logs: logs !== undefined,
    saveBytes: save === undefined ? null : Buffer.byteLength(save, 'base64'),
  };
}

function header(request: UrlRequest, name: string): string | undefined {
  // Function URLs lowercase header names; a test or proxy may not.
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function respond(statusCode: number, body: object, headers: Record<string, string> = {}): UrlResponse {
  return { statusCode, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function utf8(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}
