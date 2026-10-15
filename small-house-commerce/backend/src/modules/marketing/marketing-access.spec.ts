import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertManage,
  assertVisible,
  scopeFor,
  type MarketingAccount,
} from './marketing-access.js';

const optimizer: MarketingAccount = {
  id: 'u1',
  permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'],
};
const admin: MarketingAccount = {
  id: 'u9',
  permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'],
};
const finance: MarketingAccount = { id: 'u5', permissions: ['MARKETING_VIEW_ALL'] };
const unrelated: MarketingAccount = { id: 'u7', permissions: ['ORDER_VIEW_ALL'] };

describe('marketing scope', () => {
  it('limits an optimizer to their own records', () => {
    expect(scopeFor(optimizer)).toMatchObject({ all: false, ownerUserId: 'u1', canManage: true });
  });

  it('lets an all-scope account see everything', () => {
    expect(scopeFor(admin)).toMatchObject({ all: true, ownerUserId: null, canManage: true });
  });

  it('gives a read-only finance account no manage right', () => {
    expect(scopeFor(finance)).toMatchObject({ all: true, ownerUserId: null, canManage: false });
  });

  it('refuses an account with no marketing permission', () => {
    expect(() => scopeFor(unrelated)).toThrow(ForbiddenException);
  });
});

describe('assertVisible', () => {
  it('hides another owner record behind a 404, not a 403', () => {
    const scope = scopeFor(optimizer);
    expect(() => assertVisible(scope, 'u2')).toThrow(NotFoundException);
  });

  it('hides an unassigned legacy record from an optimizer', () => {
    expect(() => assertVisible(scopeFor(optimizer), null)).toThrow(NotFoundException);
  });

  it('allows the owner record', () => {
    expect(() => assertVisible(scopeFor(optimizer), 'u1')).not.toThrow();
  });

  it('allows any record for an all-scope account, including unassigned ones', () => {
    const scope = scopeFor(admin);
    expect(() => assertVisible(scope, 'u2')).not.toThrow();
    expect(() => assertVisible(scope, null)).not.toThrow();
  });
});

describe('manage rights', () => {
  it('does not turn all-owner read permission into all-owner write permission', () => {
    const scope = scopeFor({
      id: 'u1',
      permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_OWN'],
    });
    expect(() => assertVisible(scope, 'u2')).not.toThrow();
    expect(() => assertManage(scope, 'u1')).not.toThrow();
    expect(() => assertManage(scope, 'u2')).toThrow(NotFoundException);
    expect(() => assertManage(scope, null)).toThrow(NotFoundException);
  });

  it('lets an owner manage their own record only', () => {
    const scope = scopeFor(optimizer);
    expect(scope.canManage).toBe(true);
    expect(() => assertManage(scope, 'u1')).not.toThrow();
    expect(() => assertManage(scope, 'u2')).toThrow(NotFoundException);
  });

  it('does not let a read-only finance account manage anything', () => {
    const scope = scopeFor(finance);
    expect(scope.canManage).toBe(false);
    expect(() => assertManage(scope, 'u1')).toThrow(ForbiddenException);
  });

  it('does not let an optimizer manage an unassigned legacy record', () => {
    expect(() => assertManage(scopeFor(optimizer), null)).toThrow(NotFoundException);
  });
});
