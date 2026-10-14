import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard, type RequestUser } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { readRawBody } from '../../uploads/raw-upload.js';
import { UPLOAD_MAX_BYTES } from '../../uploads/uploads.service.js';
import {
  shellPublishSchema,
  shellUploadQuerySchema,
  shellValidateSchema,
  shellWriteSchema,
  type ShellPublishInput,
  type ShellUploadQuery,
  type ShellValidateInput,
  type ShellWriteInput,
} from '../dto/storefront-shell.dto.js';
import { StorefrontShellAssetsService } from '../storefront-shell-assets.service.js';
import { StorefrontShellService } from '../storefront-shell.service.js';

const ADMITTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/webp',
  'image/jpeg',
]);

@Controller('admin/storefront-shell')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('STOREFRONT_SHELL_MANAGE')
export class AdminStorefrontShellController {
  constructor(
    private readonly shell: StorefrontShellService,
    private readonly assets: StorefrontShellAssetsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get() {
    return this.shell.getAdminDraft();
  }

  @Patch()
  save(
    @Body(new ZodValidationPipe(shellWriteSchema)) input: ShellWriteInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shell.saveDraft(
      input.document,
      input.expectedVersion,
      user.userId,
    );
  }

  @Post('validate')
  @Header('Cache-Control', 'private, no-store')
  validate(
    @Body(new ZodValidationPipe(shellValidateSchema)) input: ShellValidateInput,
  ) {
    return this.shell.validateDraft(input);
  }

  @Post('publish')
  publish(
    @Body(new ZodValidationPipe(shellPublishSchema)) input: ShellPublishInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shell.publish(input.expectedVersion, user.userId);
  }

  @Post('upload')
  async upload(
    @Query(new ZodValidationPipe(shellUploadQuerySchema)) query: ShellUploadQuery,
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
  ) {
    const contentType = normalizeContentType(req);
    if (!ADMITTED_IMAGE_TYPES.has(contentType)) {
      throw new BadRequestException({
        code: 'SHELL_ASSET_MIME_NOT_ADMITTED',
        message: 'Content-Type must be image/png, image/webp or image/jpeg',
      });
    }

    const bytes = await readRawBody(req, UPLOAD_MAX_BYTES);
    if (bytes.length === 0) {
      throw new BadRequestException({
        code: 'SHELL_ASSET_INVALID_SIZE',
        message: 'Upload body is empty',
      });
    }
    const asset = await this.assets.processAndStore(
      query.slot === 'horizontal' ? 'HORIZONTAL' : 'SQUARE',
      bytes,
      contentType,
      user.userId,
    );
    const current = await this.shell.getAdminDraft();
    return { version: current.version, issues: current.issues, asset };
  }

  @Get('preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  preview() {
    return this.shell.getSavedPreview();
  }
}

function normalizeContentType(req: Request): string {
  const value = req.headers['content-type'];
  if (Array.isArray(value)) return '';
  return value?.split(';')[0]?.trim().toLowerCase() ?? '';
}
