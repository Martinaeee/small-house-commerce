import {
  DEFAULT_HIDDEN_COLUMNS,
  WORKBENCH_COLUMNS,
  type WorkbenchColumnKey,
} from "./columns";

/**
 * Column layout and saved views live in the browser, not on the server: they
 * are a per-operator preference of the workstation, not a business fact.
 */
const COLUMN_PREFS_KEY = "luwag_orders_columns_v1";
const VIEWS_KEY = "luwag_orders_views_v1";

export interface ColumnPrefs {
  hidden: WorkbenchColumnKey[];
  widths: Record<string, number>;
}

export interface SavedView {
  id: string;
  name: string;
  /** The filter parameters of the view (the URL query without `page`). */
  filters: Record<string, string>;
  hidden: WorkbenchColumnKey[];
  widths: Record<string, number>;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const KNOWN_KEYS = new Set<string>(WORKBENCH_COLUMNS.map((column) => column.key));

function sanitizeHidden(value: unknown): WorkbenchColumnKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_HIDDEN_COLUMNS];
  return value.filter(
    (key): key is WorkbenchColumnKey =>
      typeof key === "string" && KNOWN_KEYS.has(key as WorkbenchColumnKey),
  );
}

function sanitizeWidths(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const widths: Record<string, number> = {};
  for (const [key, width] of Object.entries(value as Record<string, unknown>)) {
    if (!KNOWN_KEYS.has(key)) continue;
    const n = typeof width === "number" ? width : Number(width);
    if (!Number.isFinite(n) || n <= 0) continue;
    widths[key] = Math.round(n);
  }
  return widths;
}

export function readColumnPrefs(): ColumnPrefs {
  const storage = safeStorage();
  if (!storage) {
    return { hidden: [...DEFAULT_HIDDEN_COLUMNS], widths: {} };
  }
  try {
    const raw = storage.getItem(COLUMN_PREFS_KEY);
    if (!raw) return { hidden: [...DEFAULT_HIDDEN_COLUMNS], widths: {} };
    const parsed = JSON.parse(raw) as Partial<ColumnPrefs>;
    return {
      hidden: sanitizeHidden(parsed.hidden),
      widths: sanitizeWidths(parsed.widths),
    };
  } catch {
    return { hidden: [...DEFAULT_HIDDEN_COLUMNS], widths: {} };
  }
}

export function writeColumnPrefs(prefs: ColumnPrefs): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(
      COLUMN_PREFS_KEY,
      JSON.stringify({ hidden: prefs.hidden, widths: prefs.widths }),
    );
  } catch {
    // Storage full or blocked: the layout simply is not remembered.
  }
}

export function readViews(): SavedView[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (view): view is SavedView =>
          Boolean(view) && typeof view.name === "string" && typeof view.id === "string",
      )
      .map((view) => ({
        id: view.id,
        name: view.name,
        filters: view.filters && typeof view.filters === "object" ? view.filters : {},
        hidden: sanitizeHidden(view.hidden),
        widths: sanitizeWidths(view.widths),
      }));
  } catch {
    return [];
  }
}

export function writeViews(views: SavedView[]): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Storage blocked: the view is not remembered.
  }
}

export function newViewId(): string {
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
