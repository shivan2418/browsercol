// The Lambda's entry point (template.yaml: Handler index.handler).
import { createHandler } from './handler.ts';
import { s3Store } from './s3-store.ts';

const bucket = process.env.BUCKET;
const allowedOrigin = process.env.ALLOWED_ORIGIN;
if (!bucket || !allowedOrigin) throw new Error('BUCKET and ALLOWED_ORIGIN must be set');

export const handler = createHandler({ store: s3Store(bucket), allowedOrigin });
