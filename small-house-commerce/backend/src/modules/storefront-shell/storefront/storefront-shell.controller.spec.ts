import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { StorefrontShellController } from './storefront-shell.controller.js';

const derivedTheme = {
  primaryDark: '#b8946a',
  primaryLight: '#e8dccb',
  actionHover: '#5a4130',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#e8e2d9',
  focus: '#6b4f3a',
  disabled: '#999999',
  actionForeground: '#ffffff',
};

function shell(items = [
  { id: 'one', kind: 'LINK' as const, label: 'One', href: '/one' },
  { id: 'two', kind: 'LINK' as const, label: 'Two', href: '/two' },
]) {
  return {
    publishedRevision: 7,
    brand: { brandName: 'LUWAG', horizontalLogo: null, squareMark: null },
    header: { items },
    footer: {
      tagline: 'Small-space furniture, made roomy',
      description: 'Furniture for Filipino condos and rentals.',
      columns: [],
      copyrightBrand: 'LUWAG Living',
    },
    theme: {
      primary: '#c9a77b',
      action: '#6b4f3a',
      background: '#faf8f5',
      surface: '#ffffff',
      text: '#222222',
      headingFont: 'SYSTEM' as const,
      bodyFont: 'SYSTEM' as const,
    },
    derivedTheme,
  };
}

function response() {
  const headers = new Map<string, string>();
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return res;
    }),
    status: vi.fn(() => res),
  };
  return { res, headers };
}

describe('StorefrontShellController', () => {
  it('exposes the anonymous GET /storefront/shell route', () => {
    const handler = StorefrontShellController.prototype.get;
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontShellController)).toBe(
      'storefront',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('shell');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it('returns the whitelisted public projection with revision, cache headers and a weak ETag', async () => {
    const publicShell = shell();
    const service = { getPublic: vi.fn(async () => publicShell) };
    const controller = new StorefrontShellController(service as never);
    const { res, headers } = response();

    const result = await controller.get(undefined, res as never);

    expect(result).toBe(publicShell);
    expect(headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(headers.get('etag')).toMatch(/^W\/"shell-7-[0-9a-f]{16}"$/);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('draftDocument');
    expect(serialized).not.toContain('publishedByUserId');
    expect(serialized).not.toContain('storageKey');
  });

  it('changes the ETag when a linked target disappears without a revision bump', async () => {
    const service = {
      getPublic: vi
        .fn()
        .mockResolvedValueOnce(shell())
        .mockResolvedValueOnce(shell([
          { id: 'two', kind: 'LINK' as const, label: 'Two', href: '/two' },
        ])),
    };
    const controller = new StorefrontShellController(service as never);
    const first = response();
    const second = response();

    await controller.get(undefined, first.res as never);
    await controller.get(undefined, second.res as never);

    expect(first.headers.get('etag')).not.toBe(second.headers.get('etag'));
    expect(first.headers.get('etag')).toContain('shell-7-');
    expect(second.headers.get('etag')).toContain('shell-7-');
  });

  it('returns 304 only for the full current revision plus projection validator', async () => {
    const service = { getPublic: vi.fn(async () => shell()) };
    const controller = new StorefrontShellController(service as never);
    const first = response();
    await controller.get(undefined, first.res as never);
    const currentEtag = first.headers.get('etag')!;

    const matching = response();
    await expect(
      controller.get(currentEtag, matching.res as never),
    ).resolves.toBeUndefined();
    expect(matching.res.status).toHaveBeenCalledWith(304);

    const stale = response();
    await expect(
      controller.get('W/"shell-7-deadbeefdeadbeef"', stale.res as never),
    ).resolves.toEqual(shell());
    expect(stale.res.status).not.toHaveBeenCalled();
  });

  it('canonicalizes object keys so equivalent projections share one validator', async () => {
    const original = shell();
    const reordered = {
      derivedTheme: original.derivedTheme,
      theme: original.theme,
      footer: original.footer,
      header: original.header,
      brand: original.brand,
      publishedRevision: original.publishedRevision,
    };
    const service = {
      getPublic: vi
        .fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(reordered),
    };
    const controller = new StorefrontShellController(service as never);
    const first = response();
    const second = response();

    await controller.get(undefined, first.res as never);
    await controller.get(undefined, second.res as never);

    expect(first.headers.get('etag')).toBe(second.headers.get('etag'));
  });
});
