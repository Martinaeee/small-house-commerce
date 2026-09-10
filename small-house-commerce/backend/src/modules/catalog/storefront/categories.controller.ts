import { Controller, Get } from '@nestjs/common';
import { CategoriesService } from '../categories.service.js';

/** Public storefront category tree (ACTIVE categories only). */
@Controller('storefront/categories')
export class StorefrontCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  tree() {
    return this.categories.storefrontTree();
  }
}
