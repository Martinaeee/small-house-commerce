import { describe, expect, it } from 'vitest';
import { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';
import { RBAC_GRANTS, RBAC_PERMISSIONS } from './rbac.js';

describe('RBAC newsletter permissions', () => {
  it('declares newsletter read/write and grants both to ADMIN and SUPER_ADMIN', () => {
    expect(RBAC_PERMISSIONS).toEqual(
      expect.arrayContaining([
        {
          code: PermissionCode.NEWSLETTER_READ,
          description: 'View newsletter subscribers.',
        },
        {
          code: PermissionCode.NEWSLETTER_WRITE,
          description: 'Manage newsletter subscribers.',
        },
      ]),
    );

    for (const role of [RoleCode.ADMIN, RoleCode.SUPER_ADMIN]) {
      expect(RBAC_GRANTS[role]).toContain(PermissionCode.NEWSLETTER_READ);
      expect(RBAC_GRANTS[role]).toContain(PermissionCode.NEWSLETTER_WRITE);
    }
  });

  it('does not grant newsletter access to operational roles', () => {
    for (const role of [
      RoleCode.OPTIMIZER,
      RoleCode.CONFIRMOR,
      RoleCode.WAREHOUSE,
      RoleCode.FINANCE,
    ]) {
      expect(RBAC_GRANTS[role]).not.toContain(PermissionCode.NEWSLETTER_READ);
      expect(RBAC_GRANTS[role]).not.toContain(PermissionCode.NEWSLETTER_WRITE);
    }
  });
});

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
      PermissionCode.MARKETING_VIEW_OWN,
      PermissionCode.MARKETING_MANAGE_OWN,
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

describe('RBAC marketing permissions', () => {
  it('declares the four owner-scoped marketing permissions', () => {
    const codes = RBAC_PERMISSIONS.map((permission) => permission.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        PermissionCode.MARKETING_VIEW_OWN,
        PermissionCode.MARKETING_MANAGE_OWN,
        PermissionCode.MARKETING_VIEW_ALL,
        PermissionCode.MARKETING_MANAGE_ALL,
      ]),
    );
  });

  it('keeps every permission described', () => {
    for (const permission of RBAC_PERMISSIONS) {
      expect(permission.description.length).toBeGreaterThan(0);
    }
  });

  it('gives an optimizer own scope but never all scope', () => {
    const optimizer = RBAC_GRANTS[RoleCode.OPTIMIZER];
    expect(optimizer).toContain(PermissionCode.MARKETING_VIEW_OWN);
    expect(optimizer).toContain(PermissionCode.MARKETING_MANAGE_OWN);
    expect(optimizer).not.toContain(PermissionCode.MARKETING_VIEW_ALL);
    expect(optimizer).not.toContain(PermissionCode.MARKETING_MANAGE_ALL);
  });

  it('gives finance read-only all scope, without manage', () => {
    const finance = RBAC_GRANTS[RoleCode.FINANCE];
    expect(finance).toContain(PermissionCode.MARKETING_VIEW_ALL);
    expect(finance).not.toContain(PermissionCode.MARKETING_MANAGE_ALL);
  });

  it('does not leak marketing scope to confirmor or warehouse', () => {
    for (const role of [RoleCode.CONFIRMOR, RoleCode.WAREHOUSE]) {
      const grants = RBAC_GRANTS[role];
      expect(grants).not.toContain(PermissionCode.MARKETING_VIEW_OWN);
      expect(grants).not.toContain(PermissionCode.MARKETING_VIEW_ALL);
    }
  });
});
