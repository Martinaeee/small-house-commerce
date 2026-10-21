import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { assertManage, scopeFor } from '../../../marketing/marketing-access.js';
import { maxBytesFor, UploadsService } from '../../../uploads/uploads.service.js';
import { readRawBody } from '../../../uploads/raw-upload.js';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { CurrentMarketingAccount, MarketingGuard } from '../../../marketing/marketing.guard.js';
import type { MarketingAccount } from '../../../marketing/marketing-access.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import {
  adminLandingPageQuerySchema, createLandingPageSchema, marketingProductPickerQuerySchema,
  landingDraftCreateSchema, landingDraftWriteSchema, landingVersionSchema, landingSyncSchema, landingAssignOwnerSchema,
  type AdminLandingPageQuery, type CreateLandingPageInput, type MarketingProductPickerQuery,
  type LandingDraftCreateInput, type LandingDraftWriteInput, type LandingVersionInput, type LandingSyncInput, type LandingAssignOwnerInput,
} from '../dto/landing-page.dto.js';
import { LandingPagesService } from '../landing-pages.service.js';

@Controller('admin/landing-pages')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class AdminLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService, private readonly uploads: UploadsService) {}

  @Post(':id/uploads')
  @Header('Cache-Control', 'private, no-store')
  async uploadMedia(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentMarketingAccount() account: MarketingAccount) {
    const page = await this.landingPages.getDraft(id, account);
    assertManage(scopeFor(account), page.ownerUserId);
    const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
    const body = await readRawBody(req, maxBytesFor(contentType));
    if (body.length === 0) throw new BadRequestException('Upload body missing — send the file bytes directly');
    return this.uploads.saveLocal(body, contentType);
  }

  @Get()
  list(@Query(new ZodValidationPipe(adminLandingPageQuerySchema)) query: AdminLandingPageQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.adminList(query, account);
  }

  @Post()
  create(@Body(new ZodValidationPipe(landingDraftCreateSchema)) input: LandingDraftCreateInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.createDraft(input.productId, input, account);
  }

  @Get('product-options')
  productOptions(@Query(new ZodValidationPipe(marketingProductPickerQuerySchema)) query: MarketingProductPickerQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.productOptions(query, account);
  }

  @Get('owner-options')
  ownerOptions(@CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.ownerOptions(account);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.getDraft(id, account);
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(landingDraftWriteSchema)) input: LandingDraftWriteInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.saveDraft(id, input.content, input.expectedVersion, account, input.name);
  }

  @Get(':id/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  preview(@Param('id', new ParseUUIDPipe()) id: string, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.getPreview(id, account);
  }

  @Post(':id/validate')
  @Header('Cache-Control', 'private, no-store')
  validate(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(landingDraftWriteSchema.pick({ content: true }))) input: Pick<LandingDraftWriteInput, 'content'>, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.validateDraft(id, input.content, account);
  }

  @Get(':id/source')
  source(@Param('id', new ParseUUIDPipe()) id: string, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.sourceComparison(id, account);
  }

  @Post(':id/sync')
  sync(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(landingSyncSchema)) input: LandingSyncInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.resync(id, input.sourceKeys, input.expectedVersion, account, input.insertBeforeId);
  }

  @Post(':id/publish')
  publish(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(landingVersionSchema)) input: LandingVersionInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.publish(id, input.expectedVersion, account);
  }

  @Post(':id/assign-owner')
  @Header('Cache-Control', 'private, no-store')
  assignOwner(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(landingAssignOwnerSchema)) input: LandingAssignOwnerInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.assignOwner(id, input.ownerUserId, input.expectedVersion, account);
  }

  @Post(':id/disable')
  disable(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(landingVersionSchema)) input: LandingVersionInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.disable(id, input.expectedVersion, account);
  }
}

@Controller('admin/products')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class AdminProductLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService) {}

  @Get(':productId/landing-pages')
  listForProduct(@Param('productId', new ParseUUIDPipe()) productId: string, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.adminListForProduct(productId, account);
  }

  @Post(':productId/landing-pages')
  create(@Param('productId', new ParseUUIDPipe()) productId: string, @Body(new ZodValidationPipe(createLandingPageSchema)) input: CreateLandingPageInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.landingPages.createDraft(productId, { name: input.name, slug: input.slug }, account);
  }
}
