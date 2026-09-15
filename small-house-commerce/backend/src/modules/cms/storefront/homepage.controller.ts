import { Controller, Get } from '@nestjs/common';
import { HomepageService } from '../homepage.service.js';

/** Public homepage composition endpoint. Anonymous; data is whitelisted in the service. */
@Controller('storefront/homepage')
export class StorefrontHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get()
  get() {
    return this.homepage.storefrontGet();
  }
}
