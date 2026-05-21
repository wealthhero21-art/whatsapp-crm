// Storage abstraction. Disk for local dev; S3 + SSE-KMS for production.
//
// SSE-KMS notes:
//   - Every PutObject uses ServerSideEncryption='aws:kms' with the configured key.
//   - The IAM role/user the app runs as must have kms:Encrypt and kms:Decrypt
//     on that key (in addition to s3:PutObject / s3:GetObject on the bucket).
//   - We never produce a public URL; the API streams content through
//     /api/files/:id/download (which checks scope) or returns a short-lived
//     presigned URL via storage.url() if a caller asks for one explicitly.

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

export interface StorageDriver {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  url(key: string): Promise<string>;       // presigned URL when remote, file:// for disk
  stream(key: string): Promise<NodeJS.ReadableStream>;
  exists(key: string): Promise<boolean>;
}

// ---------- Disk driver ----------
class DiskDriver implements StorageDriver {
  constructor(private root: string) {}

  private abs(key: string) {
    return join(this.root, key);
  }

  async put(key: string, body: Buffer) {
    const p = this.abs(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string) {
    return readFile(this.abs(key));
  }

  async url(key: string) {
    // We proxy disk files through /api/files/:id/download in the API.
    return `disk://${key}`;
  }

  async stream(key: string) {
    return createReadStream(this.abs(key));
  }

  async exists(key: string) {
    try { await stat(this.abs(key)); return true; }
    catch { return false; }
  }
}

// ---------- S3 driver (SSE-KMS) ----------
class S3Driver implements StorageDriver {
  private client: S3Client;
  private bucket: string;
  private kmsKeyId: string;

  constructor() {
    if (!config.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    if (!config.S3_KMS_KEY_ID) throw new Error('S3_KMS_KEY_ID is required when STORAGE_DRIVER=s3 (SSE-KMS)');
    this.bucket = config.S3_BUCKET;
    this.kmsKeyId = config.S3_KMS_KEY_ID;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            }
          : undefined, // falls back to the standard AWS credential chain (IAM role, env, ~/.aws)
    });
  }

  async put(key: string, body: Buffer, mimeType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: this.kmsKeyId,
      })
    );
  }

  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async url(key: string) {
    // 5-minute presigned download URL. The bucket itself has no public access.
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 300 }
    );
  }

  async stream(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageDriver =
  config.STORAGE_DRIVER === 's3' ? new S3Driver() : new DiskDriver(config.DISK_STORAGE_PATH);
