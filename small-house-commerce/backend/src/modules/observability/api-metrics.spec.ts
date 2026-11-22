import { describe, expect, it } from 'vitest';
import {
  exceedsBudget,
  routeGroupOf,
  sanitizedPath,
} from './api-metrics.js';

describe('P3 route classification', () => {
  it('classifies storefront routes, strips the API prefix and query string', () => {
    expect(routeGroupOf('/api/v1/storefront/orders')).toBe('orders');
    expect(routeGroupOf('/api/v1/storefront/orders/attempt-status')).toBe('orders');
    expect(routeGroupOf('/api/v1/storefront/products/example?x=1')).toBe('product');
    expect(routeGroupOf('/api/v1/storefront/collections/all-products')).toBe('catalog');
    expect(routeGroupOf('/api/v1/storefront/categories/tables')).toBe('catalog');
    expect(routeGroupOf('/api/v1/storefront/cart/items')).toBe('cart');
    expect(routeGroupOf('/api/v1/storefront/checkout/promo-code')).toBe('cart');
    expect(routeGroupOf('/api/v1/storefront/newsletter')).toBe('newsletter');
    expect(routeGroupOf('/api/v1/storefront/events/batch')).toBe('analytics');
    expect(routeGroupOf('/api/v1/storefront/homepage')).toBe('content');
    expect(routeGroupOf('/api/v1/storefront/marketing-touch')).toBe('content');
    expect(routeGroupOf('/api/v1/storefront/unmapped')).toBe('other');
  });

  it('skips admin, external and health routes', () => {
    expect(routeGroupOf('/api/v1/admin/observability/api')).toBeNull();
    expect(routeGroupOf('/api/v1/external/probes')).toBeNull();
    expect(routeGroupOf('/api/v1/health')).toBeNull();
  });

  it('keeps only the path and truncates to the column width', () => {
    expect(sanitizedPath('/api/v1/storefront/products/a?utm=x')).toBe('/api/v1/storefront/products/a');
    expect(sanitizedPath(`/${'x'.repeat(700)}`).length).toBe(512);
    expect(sanitizedPath('')).toBe('/');
  });

  it('applies per-group response budgets', () => {
    expect(exceedsBudget(2500, 'orders')).toBe(true);
    expect(exceedsBudget(1500, 'orders')).toBe(false);
    expect(exceedsBudget(1200, 'cart')).toBe(true);
    expect(exceedsBudget(400, 'analytics')).toBe(false);
  });
});
