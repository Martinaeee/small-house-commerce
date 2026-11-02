import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { ShortLinksService } from '../short-links.service.js';

@Controller('storefront/short-links')
export class StorefrontShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  @Get(':code')
  @Header('Cache-Control', 'no-store')
  async resolve(@Param('code') code: string): Promise<{ target: string }> {
    const link = await this.links.resolve(code);
    if (!link) throw new NotFoundException();
    return link;
  }
}
