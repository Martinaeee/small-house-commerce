import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { UPLOAD_MAX_BYTES } from '../uploads.service.js';
import type { PresignUploadInput } from '../dto/upload.dto.js';
import { presignUploadSchema } from '../dto/upload.dto.js';
import { UploadsService } from '../uploads.service.js';

/**
 * Collects the raw request body as a Buffer with a hard size cap. Hand-rolled
 * instead of express.raw/multer: express is not a direct dependency (pnpm
 * strict layout) and multer would be a new package — plain Node streams need
 * neither. The default express.json/urlEncoded parsers never touch image/*
 * content types, so the stream is still unconsumed when this runs.
 */
function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new BadRequestException('图片超过 5MB 限制'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err: Error) => reject(new BadRequestException(err.message)));
  });
}

@Controller('admin/uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  presign(@Body(new ZodValidationPipe(presignUploadSchema)) body: PresignUploadInput) {
    return this.uploads.presign(body.contentType, body.fileName);
  }

  /**
   * Local-disk upload: the file bytes arrive as the raw request body
   * (Content-Type: image/jpeg|png|webp).
   */
  @Post()
  async upload(@Req() req: Request) {
    const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
    const body = await readRawBody(req, UPLOAD_MAX_BYTES);
    if (body.length === 0) {
      throw new BadRequestException('Upload body missing — send the image bytes directly');
    }
    return this.uploads.saveLocal(body, contentType);
  }
}
