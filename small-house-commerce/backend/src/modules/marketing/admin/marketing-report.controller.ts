import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentMarketingAccount, MarketingGuard } from '../marketing.guard.js';
import type { MarketingAccount } from '../marketing-access.js';
import { MarketingReportService } from '../marketing-report.service.js';
import { marketingReportQuerySchema, type MarketingReportQuery } from '../dto/marketing-report.dto.js';

@Controller('admin/marketing/reports')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class MarketingReportController {
  constructor(@Inject(MarketingReportService) private readonly reports: MarketingReportService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  report(@Query(new ZodValidationPipe(marketingReportQuerySchema)) query: MarketingReportQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.reports.report(query, account);
  }
}
