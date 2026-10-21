import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentMarketingAccount, MarketingGuard } from '../marketing.guard.js';
import type { MarketingAccount } from '../marketing-access.js';
import { MarketingPerformanceService } from '../marketing-performance.service.js';
import { marketingPerformanceOptionsQuerySchema, marketingPerformanceQuerySchema, type MarketingPerformanceOptionsQuery, type MarketingPerformanceQuery } from '../dto/marketing-performance.dto.js';

@Controller('admin/marketing/performance')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class MarketingPerformanceController {
  constructor(@Inject(MarketingPerformanceService) private readonly performanceService: MarketingPerformanceService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  performance(@Query(new ZodValidationPipe(marketingPerformanceQuerySchema)) query: MarketingPerformanceQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.performanceService.performance(query, account);
  }

  @Get('options')
  @Header('Cache-Control', 'private, no-store')
  options(@Query(new ZodValidationPipe(marketingPerformanceOptionsQuerySchema)) query: MarketingPerformanceOptionsQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.performanceService.options(query, account);
  }
}
