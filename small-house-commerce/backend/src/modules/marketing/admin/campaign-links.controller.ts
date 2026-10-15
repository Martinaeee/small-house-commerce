import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentMarketingAccount, MarketingGuard } from '../marketing.guard.js';
import type { MarketingAccount } from '../marketing-access.js';
import { CampaignLinksService } from '../campaign-links.service.js';
import { campaignLinkCloneSchema, campaignLinkCreateSchema, campaignLinkQuerySchema, campaignLinkUpdateSchema, campaignLinkVersionSchema, type CampaignLinkCreateInput, type CampaignLinkQuery, type CampaignLinkUpdateInput } from '../dto/campaign-link.dto.js';

@Controller('admin/campaign-links')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class CampaignLinksController {
  constructor(private readonly links: CampaignLinksService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query(new ZodValidationPipe(campaignLinkQuerySchema)) query: CampaignLinkQuery, @CurrentMarketingAccount() account: MarketingAccount) { return this.links.listLinks(query, account); }

  @Post()
  create(@Body(new ZodValidationPipe(campaignLinkCreateSchema)) input: CampaignLinkCreateInput, @CurrentMarketingAccount() account: MarketingAccount) { return this.links.createLink(input, account); }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentMarketingAccount() account: MarketingAccount) { return this.links.getLink(id, account); }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(campaignLinkUpdateSchema)) input: CampaignLinkUpdateInput, @CurrentMarketingAccount() account: MarketingAccount) { return this.links.updateLink(id, input, account); }

  @Post(':id/disable')
  disable(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(campaignLinkVersionSchema)) input: z.infer<typeof campaignLinkVersionSchema>, @CurrentMarketingAccount() account: MarketingAccount) { return this.links.disableLink(id, input.expectedVersion, account); }

  @Post(':id/clone')
  clone(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(campaignLinkCloneSchema)) input: z.infer<typeof campaignLinkCloneSchema>, @CurrentMarketingAccount() account: MarketingAccount) { return this.links.cloneLink(id, input, account); }
}
