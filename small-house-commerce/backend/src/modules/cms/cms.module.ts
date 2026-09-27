import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AdminHomepageController } from './admin/homepage.controller.js';
import { DOCUMENT_VALIDATOR } from './homepage-document.js';
import { HomepageDocumentService } from './homepage-document.service.js';
import { PrismaLinkLookup } from './homepage-link-lookup.js';
import { HomepageValidator } from './homepage-validation.js';
import { HomepageService } from './homepage.service.js';
import { StorefrontHomepageController } from './storefront/homepage.controller.js';

@Module({
  // AuthModule for JWT guards; CatalogModule exports ProductsService (shared
  // sellability/rating pipeline).
  imports: [AuthModule, CatalogModule],
  controllers: [StorefrontHomepageController, AdminHomepageController],
  providers: [
    HomepageService,
    HomepageDocumentService,
    PrismaLinkLookup,
    {
      provide: HomepageValidator,
      useFactory: (lookup: PrismaLinkLookup) => new HomepageValidator(lookup),
      inject: [PrismaLinkLookup],
    },
    { provide: DOCUMENT_VALIDATOR, useExisting: HomepageValidator },
  ],
})
export class CmsModule {}
