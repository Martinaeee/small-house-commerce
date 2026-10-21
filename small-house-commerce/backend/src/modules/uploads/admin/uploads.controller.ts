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
import { maxBytesFor } from '../uploads.service.js';
import type { PresignUploadInput } from '../dto/upload.dto.js';
import { presignUploadSchema } from '../dto/upload.dto.js';
import { UploadsService } from '../uploads.service.js';

import { readRawBody } from '../raw-upload.js';

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
   * (Content-Type: image/jpeg|png|webp or video/mp4|webm|quicktime). The
   * size cap follows the media kind — 5 MB images, 100 MB videos.
   */
  @Post()
  async upload(@Req() req: Request) {
    const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
    const body = await readRawBody(req, maxBytesFor(contentType));
    if (body.length === 0) {
      throw new BadRequestException('Upload body missing — send the file bytes directly');
    }
    return this.uploads.saveLocal(body, contentType);
  }
}
