import { describe, expect, it } from 'vitest';
import { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';
import { RBAC_GRANTS, RBAC_PERMISSIONS } from './rbac.js';

describe('RBAC campaign link builder permission', () => {
  it('declares CAMPAIGN_LINK_BUILD as seeded reference data', () => {
    expect(RBAC_PERMISSIONS).toContainEqual({
      code: PermissionCode.CAMPAIGN_LINK_BUILD,
      description: 'Build public product, variant and attribution links.',
    });
  });

  it('grants link building only to the intended roles', () => {
    expect(RBAC_GRANTS[RoleCode.SUPER_ADMIN]).toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.ADMIN]).toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.OPTIMIZER]).toEqual([
      PermissionCode.ORDER_VIEW_OWN,
      PermissionCode.CAMPAIGN_LINK_BUILD,
    ]);
    expect(RBAC_GRANTS[RoleCode.CONFIRMOR]).not.toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.WAREHOUSE]).not.toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
    expect(RBAC_GRANTS[RoleCode.FINANCE]).not.toContain(
      PermissionCode.CAMPAIGN_LINK_BUILD,
    );
  });
});
