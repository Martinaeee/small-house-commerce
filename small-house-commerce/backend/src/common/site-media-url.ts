import { z } from 'zod';

/**
 * Admin media URL (images and PDP media blocks).
 *
 * Accepts:
 *   - absolute http(s) URLs — external links and pre-local-upload rows;
 *   - site-relative paths starting with a single "/" — what the local-disk
 *     upload endpoint returns (/uploads/catalog/2026/….jpg).
 *
 * Protocol-relative "//host/x" stays rejected: browsers would interpret it
 * against the page scheme, which reintroduces mixed-content risk on http.
 * Stored verbatim and rendered as-is, so both forms display correctly.
 */
export function siteMediaUrl(max = 2048) {
  return z
    .string()
    .max(max)
    .refine(
      (value) =>
        /^https?:\/\/.+/i.test(value) ||
        (value.startsWith('/') && !value.startsWith('//') && value.length > 1),
      { message: 'Must be an http(s) URL or a site-relative path starting with /' },
    );
}
