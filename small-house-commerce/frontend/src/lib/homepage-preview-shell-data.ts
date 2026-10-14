import type { Category, Collection } from "./api";
import {
  DEFAULT_SITE_SETTINGS,
  normalizeSiteSettings,
  type SiteSettings,
} from "./site-settings";
import {
  DEFAULT_PUBLIC_STOREFRONT_SHELL,
  materializeDefaultStorefrontShell,
} from "./storefront-shell";
import {
  parsePublicStorefrontShell,
  type PublicStorefrontShell,
} from "./storefront-shell-api";

export type HomepagePreviewShellData = {
  shell: PublicStorefrontShell;
  roots: Category[];
  collections: Collection[];
  settings: SiteSettings;
  degraded: boolean;
};

export const FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA: HomepagePreviewShellData = {
  shell: materializeDefaultStorefrontShell(
    DEFAULT_PUBLIC_STOREFRONT_SHELL,
    [],
    [],
    DEFAULT_SITE_SETTINGS,
  ),
  roots: [],
  collections: [],
  settings: DEFAULT_SITE_SETTINGS,
  degraded: true,
};

type LoadOptions = {
  fetcher?: typeof fetch;
  urlFor?: (path: string) => string;
};

type Result = { ok: true; value: unknown } | { ok: false; value: null };

async function readJson(
  fetcher: typeof fetch,
  url: string,
): Promise<Result> {
  try {
    const response = await fetcher(url, { cache: "no-store" });
    if (!response.ok) return { ok: false, value: null };
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false, value: null };
  }
}

function categoryRoots(value: unknown): Category[] {
  return Array.isArray(value) ? (value as Category[]) : [];
}

function collectionsFrom(value: unknown): Collection[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? (items as Collection[]) : [];
}

export async function loadHomepagePreviewShellData(
  options: LoadOptions = {},
): Promise<HomepagePreviewShellData> {
  const fetcher = options.fetcher ?? fetch;
  const urlFor = options.urlFor ?? ((path: string) => path);
  const [categoriesResult, collectionsResult, settingsResult, shellResult] =
    await Promise.all(
      [
        "/api/v1/storefront/categories",
        "/api/v1/storefront/collections",
        "/api/v1/storefront/settings",
        "/api/v1/storefront/shell",
      ].map((path) => readJson(fetcher, urlFor(path))),
    );

  const roots = categoriesResult.ok
    ? categoryRoots(categoriesResult.value)
    : [];
  const collections = collectionsResult.ok
    ? collectionsFrom(collectionsResult.value)
    : [];
  const settings = settingsResult.ok
    ? normalizeSiteSettings(
        settingsResult.value as Partial<SiteSettings> | null,
      )
    : DEFAULT_SITE_SETTINGS;
  let shell = DEFAULT_PUBLIC_STOREFRONT_SHELL;
  let shellValid = false;
  if (shellResult.ok) {
    try {
      shell = parsePublicStorefrontShell(shellResult.value);
      shellValid = true;
    } catch {
      shellValid = false;
    }
  }
  shell = materializeDefaultStorefrontShell(
    shellValid ? shell : DEFAULT_PUBLIC_STOREFRONT_SHELL,
    roots,
    collections,
    settings,
  );

  return {
    shell,
    roots,
    collections,
    settings,
    degraded:
      !categoriesResult.ok ||
      !collectionsResult.ok ||
      !settingsResult.ok ||
      !shellValid,
  };
}
