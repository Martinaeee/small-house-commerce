import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminCategoriesController } from './admin/categories.controller.js';
import { AdminProductsController } from './admin/products.controller.js';
import {
  AdminProductReviewsController,
  AdminReviewsController,
} from './admin/reviews.controller.js';
import { AdminSuppliersController } from './admin/suppliers.controller.js';
import { CategoriesService } from './categories.service.js';
import { ProductsService } from './products.service.js';
import { ReviewsService } from './reviews.service.js';
import { StorefrontCategoriesController } from './storefront/categories.controller.js';
import { StorefrontProductsController } from './storefront/products.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  // AuthModule is imported for its exported JwtModule: the admin guards inject
  // JwtService. Module instances are singletons, so routes are not duplicated.
  imports: [AuthModule],
  controllers: [
    AdminCategoriesController,
    AdminProductsController,
    AdminProductReviewsController,
    AdminReviewsController,
    AdminSuppliersController,
    StorefrontCategoriesController,
    StorefrontProductsController,
  ],
  providers: [CategoriesService, ProductsService, ReviewsService, SuppliersService],
})
export class CatalogModule {}
