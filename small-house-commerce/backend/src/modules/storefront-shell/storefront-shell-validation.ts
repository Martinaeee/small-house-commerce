import {
  SHELL_LIMITS,
  type FooterColumn,
  type HeaderItem,
  type ShellIssue,
  type StorefrontShellDocument,
} from './storefront-shell-document.js';
import { themePublicationIssues } from './storefront-shell-theme.js';
import { trackOrderResolutionKey, type ResolvedLink } from './storefront-shell-targets.js';

/**
 * Publication gate and public projection (spec §12.2, §12.3, §15.3).
 *
 * Saving stays tolerant — an operator can park an incomplete draft — but
 * publishing is strict: every enabled Header item must resolve, labels and
 * limits must hold, the CONTACT column must be usable, brand assets must be
 * durable and the theme must meet contrast. The public projection then omits
 * whatever became unavailable without dropping its neighbours.
 */

export type ShellAssetRecord = {
  id: string;
  kind: 'HORIZONTAL' | 'SQUARE';
  durable: boolean;
};

export type ShellAssetLookup = {
  horizontalLogo: ShellAssetRecord | null;
  squareMark: ShellAssetRecord | null;
};

export type ShellHeaderResolution = {
  href: string | null;
  categoryId: string | null;
  reason: string | null;
};

export type ShellValidationContext = {
  /** Keyed by header item id; absent means the item is disabled. */
  header: ReadonlyMap<string, ShellHeaderResolution>;
  /** Keyed by footer LINK row id. */
  row: ReadonlyMap<string, ResolvedLink>;
  assets: ShellAssetLookup;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function issue(code: string, path: string[], message: string, itemId?: string): ShellIssue {
  return itemId === undefined ? { code, path, message } : { code, path, message, itemId };
}

function headerLabel(item: HeaderItem): string {
  return item.kind === 'STRUCTURED_LINK' ? item.label : item.labelOverride;
}

/**
 * Strict publication validation. Returns every blocking issue with a stable
 * path so the editor can focus the exact row or field.
 */
export function validateShellForPublish(
  document: StorefrontShellDocument,
  context: ShellValidationContext,
): ShellIssue[] {
  const issues: ShellIssue[] = [];

  validateHeader(document, context, issues);
  validateFooter(document, context, issues);
  validateBrandAssets(document, context, issues);
  issues.push(...themePublicationIssues(document.theme));

  return issues;
}

function validateHeader(
  document: StorefrontShellDocument,
  context: ShellValidationContext,
  issues: ShellIssue[],
): void {
  const enabled = document.header.items.filter((item) => item.enabled);

  if (enabled.length === 0) {
    issues.push(
      issue('SHELL_NO_ENABLED_HEADER_ITEM', ['header', 'items'], 'At least one Header item must be enabled'),
    );
  }
  if (enabled.length > SHELL_LIMITS.maxEnabledHeaderItems) {
    issues.push(
      issue(
        'SHELL_TOO_MANY_ENABLED_HEADER_ITEMS',
        ['header', 'items'],
        `At most ${SHELL_LIMITS.maxEnabledHeaderItems} Header items may be enabled`,
      ),
    );
  }

  const seen = new Set<string>();
  for (const item of document.header.items) {
    if (seen.has(item.id)) {
      issues.push(issue('SHELL_DUPLICATE_ID', ['header', 'items', item.id], 'Duplicate Header item id', item.id));
      continue;
    }
    seen.add(item.id);
  }

  for (const item of enabled) {
    const label = headerLabel(item);
    if (label.length === 0) {
      issues.push(
        issue('SHELL_EMPTY_LABEL', ['header', 'items', item.id, 'label'], 'Header label must not be empty', item.id),
      );
    } else if (label.length > SHELL_LIMITS.label) {
      issues.push(
        issue(
          'SHELL_LABEL_TOO_LONG',
          ['header', 'items', item.id, 'label'],
          `Header label must be at most ${SHELL_LIMITS.label} characters`,
          item.id,
        ),
      );
    }

    const resolution = context.header.get(item.id);
    // A CATEGORY_ROOT resolves to a live category id rather than an href, so
    // the completeness check differs per kind.
    const resolved =
      resolution !== undefined &&
      resolution.reason === null &&
      (item.kind === 'CATEGORY_ROOT' ? resolution.categoryId !== null : resolution.href !== null);

    if (!resolved) {
      const reason = resolution?.reason ?? 'TARGET_UNAVAILABLE';
      issues.push(
        issue(reason, ['header', 'items', item.id], `Header item ${item.id} cannot be published`, item.id),
      );
    }
  }
}

function validateFooter(
  document: StorefrontShellDocument,
  context: ShellValidationContext,
  issues: ShellIssue[],
): void {
  const columns = document.footer.columns;

  if (columns.length > SHELL_LIMITS.maxFooterColumns) {
    issues.push(
      issue(
        'SHELL_TOO_MANY_FOOTER_COLUMNS',
        ['footer', 'columns'],
        `At most ${SHELL_LIMITS.maxFooterColumns} Footer columns are allowed`,
      ),
    );
  }

  const contacts = columns.filter((column) => column.kind === 'CONTACT');
  if (contacts.length > 1) {
    issues.push(
      issue('SHELL_CONTACT_COLUMN_DUPLICATED', ['footer', 'columns'], 'Only one Contact column is allowed'),
    );
  }

  for (const column of columns) {
    validateColumn(column, context, issues);
  }
}

function validateColumn(
  column: FooterColumn,
  context: ShellValidationContext,
  issues: ShellIssue[],
): void {
  if (column.title.length === 0) {
    issues.push(
      issue('SHELL_EMPTY_COLUMN_TITLE', ['footer', 'columns', column.id, 'title'], 'Column title must not be empty'),
    );
  }

  if (column.kind === 'CONTACT') {
    if (!EMAIL_RE.test(column.supportEmail)) {
      issues.push(
        issue(
          'SHELL_INVALID_SUPPORT_EMAIL',
          ['footer', 'columns', column.id, 'supportEmail'],
          'Support email must be a valid address',
        ),
      );
    }
    const trackOrder = context.row.get(trackOrderResolutionKey(column.id));
    if (!trackOrder || !trackOrder.available) {
      issues.push(
        issue(
          trackOrder?.available === false ? trackOrder.reason : 'TARGET_UNAVAILABLE',
          ['footer', 'columns', column.id, 'trackOrderLink'],
          'Track Order link is unavailable',
        ),
      );
    }
    return;
  }

  if (column.rows.length > SHELL_LIMITS.maxFooterRows) {
    issues.push(
      issue(
        'SHELL_TOO_MANY_FOOTER_ROWS',
        ['footer', 'columns', column.id, 'rows'],
        `At most ${SHELL_LIMITS.maxFooterRows} rows are allowed`,
      ),
    );
  }

  for (const row of column.rows) {
    if (row.kind !== 'LINK') continue;
    if (row.label.length === 0) {
      issues.push(
        issue('SHELL_EMPTY_LABEL', ['footer', 'columns', column.id, 'rows', row.id, 'label'], 'Link label must not be empty', row.id),
      );
    }
    const resolved = context.row.get(row.id);
    if (!resolved || !resolved.available) {
      issues.push(
        issue(
          resolved?.available === false ? resolved.reason : 'TARGET_UNAVAILABLE',
          ['footer', 'columns', column.id, 'rows', row.id],
          `Footer row ${row.id} cannot be published`,
          row.id,
        ),
      );
    }
  }
}

function validateBrandAssets(
  document: StorefrontShellDocument,
  context: ShellValidationContext,
  issues: ShellIssue[],
): void {
  const slots: Array<[keyof ShellAssetLookup, 'HORIZONTAL' | 'SQUARE', 'horizontalLogo' | 'squareMark']> = [
    ['horizontalLogo', 'HORIZONTAL', 'horizontalLogo'],
    ['squareMark', 'SQUARE', 'squareMark'],
  ];

  for (const [lookupKey, expectedKind, documentKey] of slots) {
    const ref = document.brand[documentKey];
    if (ref === null) continue;

    const asset = context.assets[lookupKey];
    const path = ['brand', documentKey];

    if (asset === null || asset.id !== ref.assetId) {
      issues.push(issue('SHELL_ASSET_MISSING', path, 'Referenced brand asset does not exist'));
      continue;
    }
    if (asset.kind !== expectedKind) {
      issues.push(issue('SHELL_ASSET_WRONG_KIND', path, `Expected a ${expectedKind} brand asset`));
      continue;
    }
    if (!asset.durable) {
      issues.push(
        issue('SHELL_ASSET_NOT_DURABLE', path, 'Brand asset storage is not durable and cannot be published'),
      );
    }
  }
}

// --- public projection ------------------------------------------------------

export type ResolvedHeaderItem =
  | { id: string; kind: 'CATEGORY_ROOT'; categoryId: string; label: string }
  | { id: string; kind: 'LINK'; label: string; href: string };

export type ResolvedFooterRow =
  | { id: string; kind: 'LINK'; label: string; href: string }
  | { id: string; kind: 'TEXT'; text: string };

export type ResolvedFooterColumn =
  | { id: string; kind: 'LINKS'; title: string; rows: ResolvedFooterRow[] }
  | {
      id: string;
      kind: 'CONTACT';
      title: string;
      supportEmail: string;
      supportHours: string;
      trackOrderLabel: string;
      trackOrderHref: string | null;
    };

export type ResolvedFooterSocial = {
  id: string;
  network: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE';
  href: string;
};

export type ResolvedFooterLegalLink = { id: string; label: string; href: string };

export type ResolvedStorefrontShell = {
  brand: {
    brandName: string;
    horizontalLogo: { id: string; url: string; width: number; height: number } | null;
    squareMark: { id: string; url: string; width: number; height: number } | null;
  };
  header: { items: ResolvedHeaderItem[] };
  footer: {
    tagline: string;
    description: string;
    columns: ResolvedFooterColumn[];
    copyrightBrand: string;
    socials: ResolvedFooterSocial[];
    legal: ResolvedFooterLegalLink[];
    payments: string[];
  };
  theme: StorefrontShellDocument['theme'];
};

export type PublicAssetView = { id: string; url: string; width: number; height: number };

export type ProjectionContext = {
  header: ReadonlyMap<string, ShellHeaderResolution>;
  row: ReadonlyMap<string, ResolvedLink>;
  horizontalLogo: PublicAssetView | null;
  squareMark: PublicAssetView | null;
};

/**
 * Builds the shopper-facing projection: unavailable targets are omitted, valid
 * neighbours survive, and no draft, audit, issue or storage field crosses the
 * boundary.
 */
export function publicProjection(
  document: StorefrontShellDocument,
  context: ProjectionContext,
): ResolvedStorefrontShell {
  const items: ResolvedHeaderItem[] = [];
  for (const item of document.header.items) {
    if (!item.enabled) continue;
    const resolution = context.header.get(item.id);
    if (!resolution || resolution.reason !== null) continue;

    if (item.kind === 'CATEGORY_ROOT') {
      if (resolution.categoryId === null) continue;
      items.push({
        id: item.id,
        kind: 'CATEGORY_ROOT',
        categoryId: resolution.categoryId,
        label: item.labelOverride,
      });
      continue;
    }
    if (resolution.href === null) continue;
    items.push({ id: item.id, kind: 'LINK', label: headerLabel(item), href: resolution.href });
  }

  const columns: ResolvedFooterColumn[] = [];
  for (const column of document.footer.columns) {
    if (column.kind === 'LINKS') {
      const rows: ResolvedFooterRow[] = [];
      for (const row of column.rows) {
        if (row.kind === 'TEXT') {
          rows.push({ id: row.id, kind: 'TEXT', text: row.text });
          continue;
        }
        const resolved = context.row.get(row.id);
        if (!resolved || !resolved.available) continue;
        rows.push({ id: row.id, kind: 'LINK', label: row.label, href: resolved.href });
      }
      columns.push({ id: column.id, kind: 'LINKS', title: column.title, rows });
      continue;
    }

    const trackOrder = context.row.get(trackOrderResolutionKey(column.id));
    columns.push({
      id: column.id,
      kind: 'CONTACT',
      title: column.title,
      supportEmail: column.supportEmail,
      supportHours: column.supportHours,
      trackOrderLabel: column.trackOrderLabel,
      trackOrderHref:
        trackOrder && trackOrder.available ? trackOrder.href : null,
    });
  }

  return {
    brand: {
      brandName: document.brand.brandName,
      horizontalLogo: context.horizontalLogo,
      squareMark: context.squareMark,
    },
    header: { items },
    footer: {
      tagline: document.footer.tagline,
      description: document.footer.description,
      columns,
      copyrightBrand: document.footer.copyrightBrand,
      socials: document.footer.socials.map((social) => ({
        id: social.id,
        network: social.network,
        href: social.url,
      })),
      legal: document.footer.legal.map((link) => ({
        id: link.id,
        label: link.label,
        href: link.href,
      })),
      payments: [...document.footer.payments],
    },
    theme: document.theme,
  };
}
