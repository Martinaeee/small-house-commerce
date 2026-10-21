import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AdminBundlesController } from './bundles.controller.js';
import { CatalogModule } from '../catalog.module.js';
import { BundlesService } from '../bundles.service.js';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';

describe('Bundle admin routing', () => {
  it('registers the guarded controller and provider', () => {
    const reflector = new Reflector();
    expect(reflector.get('controllers', CatalogModule)).toContain(AdminBundlesController);
    expect(reflector.get('providers', CatalogModule)).toContain(BundlesService);
    expect(reflector.get(PERMISSIONS_KEY, AdminBundlesController)).toEqual(['PRODUCT_MANAGE']);
    expect(reflector.get(GUARDS_METADATA, AdminBundlesController)).toEqual([JwtAuthGuard, PermissionsGuard]);
  });
  it('keeps the two-segment SKU search route clear of product :id', () => {
    expect(new Reflector().get(PATH_METADATA, AdminBundlesController.prototype.search)).toBe('bundle/sku-search');
  });
});
