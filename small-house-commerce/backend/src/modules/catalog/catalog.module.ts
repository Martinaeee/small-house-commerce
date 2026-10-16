import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AdminCategoriesController } from './admin/categories.controller.js';
import { AdminLinkBuilderController } from './admin/link-builder.controller.js';
import { AdminProductsController } from './admin/products.controller.js';
import {
  AdminProductReviewsController,
  AdminReviewsController,
} from './admin/reviews.controller.js';
import { AdminSuppliersController } from './admin/suppliers.controller.js';
import {
  AdminLandingPagesController,
  AdminProductLandingPagesController,
} from './landing/admin/landing-pages.controller.js';
import { LandingPagesService } from './landing/landing-pages.service.js';
import { LandingSnapshotService } from './landing/landing-snapshot.service.js';
import { OptimizersService } from '../marketing/optimizers.service.js';
import { MarketingGuard } from '../marketing/marketing.guard.js';
import { CampaignLinksService } from '../marketing/campaign-links.service.js';
import { CampaignLinksController } from '../marketing/admin/campaign-links.controller.js';
import { MarketingReportService } from '../marketing/marketing-report.service.js';
import { MarketingReportController } from '../marketing/admin/marketing-report.controller.js';
import { MarketingPerformanceController } from '../marketing/admin/marketing-performance.controller.js';
import { MarketingPerformanceService } from '../marketing/marketing-performance.service.js';
import { AdCostsService } from '../marketing/ad-costs.service.js';
import { AdCostsController } from '../marketing/admin/ad-costs.controller.js';
import { MarketingTouchService } from '../marketing/marketing-touch.service.js';
import { StorefrontMarketingTouchController } from '../marketing/storefront/marketing-touch.controller.js';
import { AdminSharedFaqController } from './faq/admin/shared-faq.controller.js';
import { AdminSharedFaqPreviewController } from './faq/admin/shared-faq-preview.controller.js';
import { AdminProductFaqController } from './faq/admin/product-faq.controller.js';
import { SharedFaqService } from './faq/shared-faq.service.js';
import { LinkBuilderContextService } from './link-builder-context.service.js';
import { StorefrontLandingPagesController } from './landing/storefront/landing-pages.controller.js';
import { CategoriesService } from './categories.service.js';
import { CatalogGraphService } from './catalog-graph.service.js';
import { ProductsService } from './products.service.js';
import { ReviewsService } from './reviews.service.js';
import { StorefrontCategoriesController } from './storefront/categories.controller.js';
import { StorefrontProductsController } from './storefront/products.controller.js';
import { StorefrontReviewsController } from './storefront/reviews.controller.js';
import { SuppliersService } from './suppliers.service.js';
import { AdminBundlesController } from './admin/bundles.controller.js';
import { BundlesService } from './bundles.service.js';

@Module({
  // AuthModule is imported for its exported JwtModule: the admin guards inject
  // JwtService. Module instances are singletons, so routes are not duplicated.
  imports: [AuthModule, UploadsModule],
  controllers: [
    AdminBundlesController,
    AdminCategoriesController,
    AdminLinkBuilderController,
    AdminProductsController,
    AdminProductReviewsController,
    AdminReviewsController,
    AdminSuppliersController,
    AdminLandingPagesController,
    CampaignLinksController,
    AdCostsController,
    MarketingReportController,
    MarketingPerformanceController,
    StorefrontMarketingTouchController,
    AdminProductLandingPagesController,
    AdminSharedFaqController,
    AdminSharedFaqPreviewController,
    AdminProductFaqController,
    StorefrontCategoriesController,
    StorefrontProductsController,
    StorefrontReviewsController,
    StorefrontLandingPagesController,
  ],
  providers: [
    BundlesService,
    CategoriesService,
    CatalogGraphService,
    LinkBuilderContextService,
    ProductsService,
    ReviewsService,
    SuppliersService,
    LandingPagesService,
    CampaignLinksService,
    AdCostsService,
    MarketingReportService,
    MarketingPerformanceService,
    MarketingTouchService,
    LandingSnapshotService,
    OptimizersService,
    MarketingGuard,
    SharedFaqService,
  ],
  exports: [ReviewsService, ProductsService, SharedFaqService, MarketingTouchService],
})
export class CatalogModule {}
