import { promises as fs, createReadStream, type ReadStream } from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// C3 local-disk storage abstraction. Future swap to S3/MinIO is a single
// service replacement; consumers see the same { saveBuffer / readStream /
// remove } API.

@Injectable()
export class StorageService {
  private readonly rootPath: string;

  constructor(private readonly config: ConfigService) {
    this.rootPath = path.resolve(this.config.get<string>('STORAGE_LOCAL_PATH') ?? './storage');
  }

  /**
   * Tenant + patient prefixed key. UUID-based filename keeps collisions zero
   * and removes PII from path (no patient name on disk).
   */
  buildKey(tenantId: string, patientId: string, photoId: string, mimeType: string): string {
    const ext = mimeToExtension(mimeType);
    return path.posix.join(tenantId, patientId, `${photoId}${ext}`);
  }

  /**
   * #1049 — Hasta-dışı scope'lu key (personel dökümanı, doktor fotoğrafı).
   * Örn. `<tenantId>/staff/<subjectId>/<uuid>.pdf`,
   * `<tenantId>/doctors/<doctorId>/<uuid>.webp`.
   */
  buildScopedKey(tenantId: string, scope: string, id: string, mimeType: string): string {
    const ext = mimeToExtension(mimeType);
    return path.posix.join(tenantId, scope, `${id}${ext}`);
  }

  async saveBuffer(key: string, buffer: Buffer): Promise<void> {
    const target = this.absolutePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  }

  readStream(key: string): ReadStream {
    return createReadStream(this.absolutePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.absolutePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.unlink(this.absolutePath(key));
    } catch (err: unknown) {
      // Already deleted: idempotent; soft-delete may run twice.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private absolutePath(key: string): string {
    // Block path traversal; key arrives from server-built UUIDs but defense
    // in depth is cheap.
    const normalized = path.posix.normalize(key);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path.join(this.rootPath, normalized);
  }
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
  // #1049 — personel dökümanları (CV/diploma): doc + docx
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

function mimeToExtension(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? '.bin';
}
