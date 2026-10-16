import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { BundlesService } from '../bundles.service.js';
import { CatalogModule } from '../catalog.module.js';
import { AdminBundlesController } from './bundles.controller.js';

const reflector = new Reflector();

describe('Bundle admin API registration', () => {
  it('registers the Bundle controller and persistence provider in the real catalog module', () => {
    expect(reflector.get('controllers', CatalogModule)).toContain(AdminBundlesController);
    expect(reflector.get('providers', CatalogModule)).toContain(BundlesService);
  });

  it('requires authenticated product-management permission for every Bundle route', () => {
    expect(reflector.get(PATH_METADATA, AdminBundlesController)).toBe('admin/products');
    expect(reflector.get(PERMISSIONS_KEY, AdminBundlesController)).toEqual(['PRODUCT_MANAGE']);
    expect(reflector.get(GUARDS_METADATA, AdminBundlesController)).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('keeps component search separate from the generic single-segment product-id route', () => {
    expect(reflector.get(PATH_METADATA, AdminBundlesController.prototype.search)).toBe('bundle/sku-search');
  });

  it('exposes the approved product-scoped definition read and compare-and-swap write routes', () => {
    expect(reflector.get(PATH_METADATA, AdminBundlesController.prototype.get)).toBe(':productId/bundles/:skuId');
    expect(reflector.get(PATH_METADATA, AdminBundlesController.prototype.set)).toBe(':productId/bundles/:skuId');
  });
});
