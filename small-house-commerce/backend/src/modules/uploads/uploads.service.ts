import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { PresignUploadInput } from './dto/upload.dto.js';
import { buildR2PresignedPutUrl, type PresignResult, type R2Settings } from './r2-presign.js';

const EXTENSION_BY_TYPE: Record<PresignUploadInput['contentType'], 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
}
