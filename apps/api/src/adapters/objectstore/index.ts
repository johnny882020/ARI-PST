import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStorePort } from '@ari/domain';
import type { Config } from '../../config.js';

export class MemoryObjectStore implements ObjectStorePort {
  readonly data = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array): Promise<void> { this.data.set(key, body); }
  async get(key: string): Promise<Uint8Array | null> { return this.data.get(key) ?? null; }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}
export class LocalFsObjectStore implements ObjectStorePort {
  constructor(private readonly dir: string) {}
  private path(key: string): string {
    const p = resolve(join(this.dir, key));
    if (!p.startsWith(resolve(this.dir) + sep)) throw new Error('bad key');
    return p;
  }
  async put(key: string, body: Uint8Array): Promise<void> { const p = this.path(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, body, { mode: 0o600 }); }
  async get(key: string): Promise<Uint8Array | null> { try { return await readFile(this.path(key)); } catch { return null; } }
  async delete(key: string): Promise<void> { await rm(this.path(key), { force: true }); }
}
export class S3ObjectStore implements ObjectStorePort {
  private s3: S3Client;
  constructor(private readonly bucket: string, region: string, endpoint?: string, forcePathStyle = false) {
    this.s3 = new S3Client({ region, ...(endpoint ? { endpoint } : {}), forcePathStyle });
  }
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  }
  async get(key: string): Promise<Uint8Array | null> {
    try { const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); return r.Body ? await r.Body.transformToByteArray() : null; } catch { return null; }
  }
  async delete(key: string): Promise<void> { await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}
export function createObjectStore(cfg: Config): ObjectStorePort {
  if (cfg.objectStore.kind === 's3' && cfg.objectStore.s3) { const s = cfg.objectStore.s3; return new S3ObjectStore(s.bucket, s.region, s.endpoint, s.forcePathStyle); }
  if (cfg.objectStore.kind === 'localfs') return new LocalFsObjectStore(cfg.objectStore.localDir);
  return new MemoryObjectStore();
}
