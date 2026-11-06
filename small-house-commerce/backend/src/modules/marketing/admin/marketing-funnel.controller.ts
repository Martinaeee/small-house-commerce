import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentMarketingAccount, MarketingGuard } from '../marketing.guard.js';
import type { MarketingAccount } from '../marketing-access.js';
import { MarketingFunnelService } from '../marketing-funnel.service.js';
import { marketingFunnelQuerySchema,marketingFunnelSessionsQuerySchema,type MarketingFunnelQuery,type MarketingFunnelSessionsQuery } from '../dto/marketing-funnel.dto.js';

@Controller('admin/marketing/funnel')
@UseGuards(JwtAuthGuard,MarketingGuard)
export class MarketingFunnelController {
  constructor(@Inject(MarketingFunnelService) private readonly funnel:MarketingFunnelService) {}
  @Get()
  @Header('Cache-Control','private, no-store')
  list(@Query(new ZodValidationPipe(marketingFunnelQuerySchema)) q:MarketingFunnelQuery,@CurrentMarketingAccount() account:MarketingAccount) {
    return this.funnel.funnel(q,account);
  }
  @Get('sessions')
  @Header('Cache-Control','private, no-store')
  sessions(@Query(new ZodValidationPipe(marketingFunnelSessionsQuerySchema)) q:MarketingFunnelSessionsQuery,@CurrentMarketingAccount() account:MarketingAccount) {
    return this.funnel.sessions(q,account);
  }
  @Get(':productId/detail')
  @Header('Cache-Control','private, no-store')
  detail(@Param('productId',new ParseUUIDPipe()) productId:string,@Query(new ZodValidationPipe(marketingFunnelQuerySchema)) q:MarketingFunnelQuery,@CurrentMarketingAccount() account:MarketingAccount) {
    return this.funnel.detail(productId,q,account);
  }
}
