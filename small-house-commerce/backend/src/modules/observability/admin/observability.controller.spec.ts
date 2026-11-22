import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { AdminObservabilityController } from './observability.controller.js';

/**
 * Permission reverse tests for the P1 observability endpoints: every read
 * route must be gated by OBSERVABILITY_VIEW at the handler (class) level, so an
 * account without the permission receives 403 before any query runs.
 */
describe('AdminObservabilityController permissions', () => {
  const controller = AdminObservabilityController;

  it('requires OBSERVABILITY_VIEW on the controller (guarded by PermissionsGuard)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller)).toEqual(['OBSERVABILITY_VIEW']);
  });

  it('requires SYSTEM_SETTINGS_EDIT to change an alert state', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.prototype.updateAlert)).toEqual([
      'SYSTEM_SETTINGS_EDIT',
    ]);
  });

  it('exposes exactly the read-only endpoints plus alert status updates', () => {
    const routes = Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor' && name !== 'account')
      .sort();
    expect(routes).toEqual([
      'alertIssues',
      'apiDiagnostics',
      'availability',
      'health',
      'requestTrace',
      'updateAlert',
    ]);
  });

  it('does not expose any other mutation endpoint', () => {
    const proto = controller.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name === 'account') continue;
      expect(typeof proto[name]).toBe('function');
      // The route decorator metadata is checked by route tests; this asserts
      // the surface deliberately stays limited to alert status updates.
      expect(name).toMatch(/^(alertIssues|apiDiagnostics|availability|health|requestTrace|updateAlert)$/);
    }
  });
});
