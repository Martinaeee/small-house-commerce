import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AdCostsService } from '../ad-costs.service.js';
import { CurrentMarketingAccount, MarketingGuard } from '../marketing.guard.js';
import type { MarketingAccount } from '../marketing-access.js';
import { adCostInputSchema, adCostQuerySchema, adCostVersionSchema, type AdCostInput, type AdCostQuery } from '../dto/ad-cost.dto.js';

@Controller('admin/marketing/costs')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class AdCostsController {
  constructor(@Inject(AdCostsService) private readonly costs: AdCostsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query(new ZodValidationPipe(adCostQuerySchema)) query: AdCostQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.costs.listCosts(query, account);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  save(@Body(new ZodValidationPipe(adCostInputSchema)) input: AdCostInput, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.costs.upsertCost(input, account);
  }

  @Post(':id/void')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  void(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(adCostVersionSchema)) input: z.infer<typeof adCostVersionSchema>, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.costs.voidCost(id, input.expectedVersion, account);
  }

  @Get(':id/audit')
  @Header('Cache-Control', 'private, no-store')
  history(@Param('id', new ParseUUIDPipe()) id: string, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.costs.auditHistory(id, account);
  }
}
