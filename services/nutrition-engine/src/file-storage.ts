/**
 * File Storage Adapter
 *
 * Abstract storage interface for file uploads (local, S3, R2).
 * Environment-driven configuration. UI/API must use this adapter,
 * not provider-specific code.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StorageConfig {
  provider: "local" | "s3" | "r2";
  basePath?: string;      // local provider: base directory
  bucket?: string;        // S3/R2: bucket name
  region?: string;        // S3: region
  endpoint?: string;      // R2/custom S3: endpoint URL
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface UploadResult {
  storageProvider: string;
  storageBucket: string | null;
  storageKey: string;
  sizeBytes: number;
  checksum: string;
  mimeType: string;
}

export interface StorageAdapter {
  upload(key: string, data: Buffer, mimeType: string): Promise<UploadResult>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): string | null;
}

/**
 * Local filesystem storage adapter.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
    }
  }

  async upload(key: string, data: Buffer, mimeType: string): Promise<UploadResult> {
    const filePath = join(this.basePath, key);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, data);
    const checksum = createHash("sha256").update(data).digest("hex");
    return {
      storageProvider: "local",
      storageBucket: null,
      storageKey: key,
      sizeBytes: data.length,
      checksum,
      mimeType,
    };
  }

  async read(key: string): Promise<Buffer> {
    const filePath = join(this.basePath, key);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }
    return readFileSync(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.basePath, key);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(join(this.basePath, key));
  }

  getUrl(key: string): string | null {
    return `/files/${key}`;
  }
}

/**
 * Stub S3/R2 adapter — implements the interface for future cloud storage.
 * Throws descriptive errors until cloud credentials are configured.
 */
export class CloudStorageAdapter implements StorageAdapter {
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  async upload(_key: string, _data: Buffer, _mimeType: string): Promise<UploadResult> {
    throw new Error(
      `Cloud storage (${this.config.provider}) is not yet configured. ` +
      `Set STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, and STORAGE_SECRET_ACCESS_KEY environment variables.`,
    );
  }

  async read(_key: string): Promise<Buffer> {
    throw new Error(`Cloud storage (${this.config.provider}) read not yet implemented.`);
  }

  async delete(_key: string): Promise<void> {
    throw new Error(`Cloud storage (${this.config.provider}) delete not yet implemented.`);
  }

  async exists(_key: string): Promise<boolean> {
    throw new Error(`Cloud storage (${this.config.provider}) exists not yet implemented.`);
  }

  getUrl(key: string): string | null {
    if (this.config.endpoint && this.config.bucket) {
      return `${this.config.endpoint}/${this.config.bucket}/${key}`;
    }
    return null;
  }
}

/**
 * Create a storage adapter from environment configuration.
 */
export function createStorageAdapter(config?: Partial<StorageConfig>): StorageAdapter {
  const provider = config?.provider ?? (process.env.STORAGE_PROVIDER as StorageConfig["provider"]) ?? "local";

  if (provider === "local") {
    const basePath = config?.basePath ?? process.env.STORAGE_LOCAL_PATH ?? "./uploads";
    return new LocalStorageAdapter(basePath);
  }

  return new CloudStorageAdapter({
    provider,
    bucket: config?.bucket ?? process.env.STORAGE_BUCKET,
    region: config?.region ?? process.env.STORAGE_REGION,
    endpoint: config?.endpoint ?? process.env.STORAGE_ENDPOINT,
    accessKeyId: config?.accessKeyId ?? process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: config?.secretAccessKey ?? process.env.STORAGE_SECRET_ACCESS_KEY,
  });
}

/**
 * Generate a unique storage key for a file upload.
 */
export function generateStorageKey(
  organizationId: string,
  clientId: string,
  originalName: string,
): string {
  const timestamp = Date.now();
  const hash = createHash("sha256")
    .update(`${organizationId}:${clientId}:${originalName}:${timestamp}`)
    .digest("hex")
    .slice(0, 12);
  const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : "";
  return `${organizationId}/${clientId}/${timestamp}-${hash}${ext}`;
}

/**
 * Validate a MIME type against allowed document types.
 */
export function isAllowedMimeType(mimeType: string): boolean {
  const allowed = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/json",
    "text/plain",
  ];
  return allowed.includes(mimeType);
}

/**
 * Maximum file size in bytes (20 MB).
 */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * Validate file size against maximum.
 */
export function isFileSizeValid(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_FILE_SIZE_BYTES;
}
