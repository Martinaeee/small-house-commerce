import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PresignUploadInput } from './dto/upload.dto.js';
import { buildR2PresignedPutUrl, type PresignResult, type R2Settings } from './r2-presign.js';

const EXTENSION_BY_TYPE: Record<string, 'jpg' | 'png' | 'webp' | 'mp4' | 'webm' | 'mov'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Gallery entries can be short product videos, not just photos.
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** 5 MB per image — catalog photos and review photos are far below this. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** 100 MB per video — short product clips; still well under a small VPS's
 * memory when buffered, and guarded against abuse by the throttle. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export function maxBytesFor(contentType: string): number {
  return VIDEO_TYPES.has(contentType) ? VIDEO_MAX_BYTES : UPLOAD_MAX_BYTES;
}

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
      throw new BadRequestException(`Unsupported media type: ${contentType}`);
    }
    if (buffer.length === 0) {
      throw new BadRequestException('Empty upload body');
    }
    const maxBytes = maxBytesFor(contentType);
    if (buffer.length > maxBytes) {
      throw new BadRequestException(
        VIDEO_TYPES.has(contentType)
          ? '视频超过 100MB 限制'
          : 'Image exceeds the 5 MB limit',
      );
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
