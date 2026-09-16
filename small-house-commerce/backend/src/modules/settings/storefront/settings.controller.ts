import { Controller, Get } from '@nestjs/common';
import { SettingsService } from '../settings.service.js';

/** Public site contact settings; consumed by every storefront page. */
@Controller('storefront/settings')
export class StorefrontSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getPublic();
  }
}
