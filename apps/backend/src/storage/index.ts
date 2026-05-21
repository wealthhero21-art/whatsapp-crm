// Storage abstraction. Disk-backed in production (Coolify-managed persistent
// volume at /var/crm/docs). The interface is kept generic so we can swap to
// S3/R2 later by adding another driver — no call-site changes.

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from '../config.js';

export interface StorageDriver {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  url(key: string): Promise<string>;
  stream(key: string): Promise<NodeJS.ReadableStream>;
  exists(key: string): Promise<boolean>;
}

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
    // We never expose direct file URLs; the API streams content through
    // /api/files/:id/download which checks scope. This is here for API
    // symmetry with future remote drivers.
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

export const storage: StorageDriver = new DiskDriver(config.DISK_STORAGE_PATH);
