import { Body, Controller, Get, Param, Put, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  saveHomepageSectionsSchema,
  setHomepageProductsSchema,
  type SaveHomepageSectionsInput,
  type SetHomepageProductsInput,
} from '../dto/homepage-section.dto.js';
import { HomepageService } from '../homepage.service.js';

/**
 * Homepage CMS admin routes. Reuses PRODUCT_MANAGE: no dedicated content
 * permission exists in V1 (spec §4.4 decision).
 */
@Controller('admin/homepage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get('sections')
  list() {
    return this.homepage.adminList();
  }

  @Patch('sections')
  save(
    @Body(new ZodValidationPipe(saveHomepageSectionsSchema)) input: SaveHomepageSectionsInput,
  ) {
    return this.homepage.saveSections(input);
  }

  @Put('sections/:id/products')
  setProducts(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setHomepageProductsSchema)) input: SetHomepageProductsInput,
  ) {
    return this.homepage.setSectionProducts(id, input);
  }
}
