import { Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { MarketingGuard } from '../../marketing/marketing.guard.js';
import { shortLinkCreateSchema, type ShortLinkCreateInput } from '../dto/short-link.dto.js';
import { ShortLinksService } from '../short-links.service.js';

@Controller('admin/short-links')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class AdminShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(@Body(new ZodValidationPipe(shortLinkCreateSchema)) input: ShortLinkCreateInput) {
    return this.links.createLink(input.url);
  }
}
