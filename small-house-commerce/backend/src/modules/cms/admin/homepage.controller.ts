import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard, type RequestUser } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import {
  publishSchema,
  saveDraftSchema,
  type PublishInput,
  type SaveDraftInput,
} from '../dto/homepage-document.dto.js';
import { HomepageDocumentService } from '../homepage-document.service.js';
import { DOCUMENT_VALIDATOR, type DocumentValidator } from '../homepage-document.js';
import { PREVIEW_TOKEN_TTL_MS, signPreviewToken } from '../homepage-preview-token.js';
import { HomepageService } from '../homepage.service.js';

type AuthenticatedRequest = Request & { user?: RequestUser };

/**
 * Homepage CMS admin routes. Reuses PRODUCT_MANAGE: no dedicated content
 * permission exists in V1 (spec §4.4 decision).
 */
@Controller('admin/homepage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminHomepageController {
  constructor(
    private readonly homepage: HomepageService,
    private readonly docs: HomepageDocumentService,
    @Inject(DOCUMENT_VALIDATOR) private readonly validator: DocumentValidator,
    private readonly config: ConfigService,
  ) {}

  /** Read-only emergency rollback source; the legacy write routes are gone. */
  @Get('sections')
  list() {
    return this.homepage.adminList();
  }

  @Get('draft')
  getDraft() {
    return this.docs.getDraft();
  }

  @Put('draft')
  saveDraft(
    @Body(new ZodValidationPipe(saveDraftSchema)) input: SaveDraftInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.docs.saveDraft(input.draft, input.expectedRev, req.user?.userId ?? null);
  }

  @Post('validate')
  async validate() {
    const snapshot = await this.docs.getDraft();
    return this.validator.validate(snapshot.draft);
  }

  @Post('publish')
  publish(
    @Body(new ZodValidationPipe(publishSchema)) input: PublishInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.docs.publish({ ...input, userId: req.user?.userId ?? null });
  }

  @Get('versions')
  listVersions() {
    return this.docs.listVersions();
  }

  @Get('versions/:id')
  getVersion(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string) {
    return this.docs.getVersion(id);
  }

  @Post('versions/:id/restore')
  restore(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.docs.restoreVersion(id, req.user?.userId ?? null);
  }

  @Post('versions/:id/unpublish')
  unpublish(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string) {
    return this.docs.unpublishVersion(id);
  }

  @Post('preview-token')
  async previewToken() {
    const secret = this.config.get<string>('homepagePreviewSecret') ?? '';
    if (secret.length === 0) {
      throw new ServiceUnavailableException('Homepage preview is not configured');
    }

    const snapshot = await this.docs.getDraft();
    return {
      token: signPreviewToken(snapshot.draftRev, secret, new Date()),
      expiresInMs: PREVIEW_TOKEN_TTL_MS,
    };
  }
}
