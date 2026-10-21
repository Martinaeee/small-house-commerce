import {
  Controller,
  Get,
  Header,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { CurrentMarketingAccount, MarketingGuard } from '../../marketing/marketing.guard.js';
import type { MarketingAccount } from '../../marketing/marketing-access.js';
import { LinkBuilderContextService } from '../link-builder-context.service.js';

@Controller('admin/link-builder')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class AdminLinkBuilderController {
  constructor(private readonly context: LinkBuilderContextService) {}

  @Get('context')
  @Header('Cache-Control', 'private, no-store')
  getContext(@CurrentMarketingAccount() account: MarketingAccount) {
    return this.context.getContext(account);
  }
}
