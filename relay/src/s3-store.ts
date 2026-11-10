import { PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { Store } from './handler.ts';

/**
 * The relay's bucket. "Is this key free?" is a conditional write
 * (If-None-Match: *), so the Lambda needs PutObject and nothing else: it
 * cannot read, list or delete a report.
 */
export function s3Store(bucket: string, client = new S3Client({})): Store {
  return {
    async putNew(key, body, contentType) {
      try {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: '*' }),
        );
        return true;
      } catch (error) {
        // 412: the key exists. 409: a concurrent conditional write to it is in flight.
        const status = error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
        if (status === 412 || status === 409) return false;
        throw error;
      }
    },
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
  };
}
