import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Owner-scoped marketing access.
 *
 * An optimizer only ever sees the landing pages, links, spend and reports they
 * own; an administrator sees everything. Two rules matter for safety:
 *
 *   - A record owned by someone else is reported as *not found*, never as
 *     forbidden, so list totals and 403s cannot be used to discover that
 *     another optimizer's record exists.
 *   - A legacy record with no owner is invisible to optimizers. "Historical,
 *     unassigned" is an administrator-only state, not a shared one.
 */
export const MARKETING_PERMISSIONS = {
  VIEW_OWN: 'MARKETING_VIEW_OWN',
  MANAGE_OWN: 'MARKETING_MANAGE_OWN',
  VIEW_ALL: 'MARKETING_VIEW_ALL',
  MANAGE_ALL: 'MARKETING_MANAGE_ALL',
} as const;

export interface MarketingAccount {
  id: string;
  permissions: string[];
}

export interface MarketingScope {
  /** True when the account may read every owner's records. */
  all: boolean;
  /** The only owner the account may read when `all` is false. */
  ownerUserId: string | null;
  /** True when the account may create, edit, publish or disable records. */
  canManage: boolean;
}

function has(account: MarketingAccount, code: string): boolean {
  return account.permissions.includes(code);
}

/** Resolves an account's marketing scope, or refuses an unrelated account. */
export function scopeFor(account: MarketingAccount): MarketingScope {
  const all = has(account, MARKETING_PERMISSIONS.VIEW_ALL);
  const own = has(account, MARKETING_PERMISSIONS.VIEW_OWN);
  if (!all && !own) {
    throw new ForbiddenException('Missing required permission');
  }
  return {
    all,
    ownerUserId: all ? null : account.id,
    canManage:
      has(account, MARKETING_PERMISSIONS.MANAGE_ALL) ||
      has(account, MARKETING_PERMISSIONS.MANAGE_OWN),
  };
}

/** Throws unless the scope may read the record owned by `recordOwnerId`. */
export function assertVisible(
  scope: MarketingScope,
  recordOwnerId: string | null,
): void {
  if (scope.all) return;
  if (recordOwnerId !== null && recordOwnerId === scope.ownerUserId) return;
  throw new NotFoundException('Marketing record not found.');
}

/** Throws unless the scope may write the record owned by `recordOwnerId`. */
export function assertManage(
  scope: MarketingScope,
  recordOwnerId: string | null,
): void {
  if (!scope.canManage) {
    throw new ForbiddenException('Missing required permission');
  }
  if (scope.all) return;
  if (recordOwnerId !== null && recordOwnerId === scope.ownerUserId) return;
  throw new NotFoundException('Marketing record not found.');
}
