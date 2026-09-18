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
import type { PresignUploadInput } from '../dto/upload.dto.js';
import { presignUploadSchema } from '../dto/upload.dto.js';
import { UploadsService } from '../uploads.service.js';

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
   * (Content-Type: image/jpeg|png|webp). main.ts registers an express.raw
   * parser scoped to this path for exactly those types, so req.body is a
   * Buffer here. Zero new dependencies (no multer).
   */
  @Post()
  upload(@Req() req: Request) {
    const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
    const body = req.body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException('Upload body missing — send the image bytes directly');
    }
    return this.uploads.saveLocal(body, contentType);
  }
}
