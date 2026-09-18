import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PresignUploadInput } from './dto/upload.dto.js';
import { buildR2PresignedPutUrl, type PresignResult, type R2Settings } from './r2-presign.js';

const EXTENSION_BY_TYPE: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 5 MB per image — catalog photos and review photos are far below this. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  // fileName is accepted for API stability but deliberately not used in the
  // key: keys are year/uuid only, so no path traversal or odd bytes survive.
  presign(contentType: PresignUploadInput['contentType'], _fileName: string): PresignResult {
    const r2 = this.config.get<Partial<R2Settings> | null>('r2');
    if (
      !r2 ||
      !r2.accountId ||
      !r2.accessKeyId ||
      !r2.secretAccessKey ||
      !r2.bucket ||
      !r2.publicBaseUrl
    ) {
      // Boot is intentionally allowed without R2; only presigning is unavailable.
      throw new ServiceUnavailableException('图片直传未配置（R2），可直接粘贴图片 URL');
    }
    const year = new Date().getUTCFullYear();
    const key = `catalog/${year}/${randomUUID()}.${EXTENSION_BY_TYPE[contentType]}`;
    return buildR2PresignedPutUrl(r2 as R2Settings, key, contentType, 600);
  }

  /**
   * Local-disk upload (default path when R2 is not configured): write the
   * bytes under UPLOAD_DIR and return the site-relative URL the backend
   * itself serves at /uploads/*. Keys mirror the R2 layout (catalog/<year>/
   * <uuid>.<ext>) so a later switch to object storage changes nothing but the
   * base URL.
   */
  async saveLocal(buffer: Buffer, contentType: string): Promise<{ url: string; key: string }> {
    const ext = EXTENSION_BY_TYPE[contentType];
    if (!ext) {
      throw new BadRequestException(`Unsupported image type: ${contentType}`);
    }
    if (buffer.length === 0) {
      throw new BadRequestException('Empty upload body');
    }
    if (buffer.length > UPLOAD_MAX_BYTES) {
      throw new BadRequestException('Image exceeds the 5 MB limit');
    }

    const dir = this.config.get<string>('upload.dir') ?? join(process.cwd(), 'uploads');
    const year = new Date().getUTCFullYear();
    const key = `catalog/${year}/${randomUUID()}.${ext}`;
    const abs = join(dir, key);
    await mkdir(join(dir, `catalog/${year}`), { recursive: true });
    await writeFile(abs, buffer);
    return { url: `/uploads/${key}`, key };
  }
}
