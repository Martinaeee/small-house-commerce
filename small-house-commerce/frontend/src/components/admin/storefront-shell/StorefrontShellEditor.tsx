"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { AdminApiError } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  createCurrentLuwagShellDocument,
  type ShellAssetRef,
  type ShellIssue,
  type StorefrontShellDocument,
  type StructuredLink,
} from "@/lib/storefront-shell-document";
import {
  storefrontShellApi,
  type AdminShellAsset,
  type AdminShellSnapshot,
  type AdminShellUploadResult,
  type PublicStorefrontShell,
} from "@/lib/storefront-shell-api";
import { deriveStorefrontTheme } from "@/lib/storefront-theme";
import {
  StorefrontShellPublishBar,
  type StorefrontShellFailure,
} from "./StorefrontShellPublishBar";
import { HeaderContentEditor } from "./HeaderContentEditor";
import { FooterContentEditor } from "./FooterContentEditor";
import { BrandAssetField } from "./BrandAssetField";
import { BrandThemeEditor } from "./BrandThemeEditor";
import { StorefrontShellPreview } from "./StorefrontShellPreview";

type ShellTab = "brand" | "header" | "footer";
type ShellDevice = "desktop" | "tablet" | "mobile";
type UploadSlot = "horizontal" | "square";
type Operation =
  | "load"
  | "save"
  | "validate"
  | "publish"
  | "horizontalUpload"
  | "squareUpload";

type RequestGeneration = Record<Operation, number>;

export type ShellEditorState = {
  actorKey: string;
  load: "loading" | "ready" | "error";
  server: AdminShellSnapshot | null;
  document: StorefrontShellDocument | null;
  tab: ShellTab;
  device: ShellDevice;
  pendingUploads: Set<UploadSlot>;
  saving: boolean;
  validating: boolean;
  publishing: boolean;
  conflict: { currentVersion?: number } | null;
  requestGeneration: RequestGeneration;
  documentGeneration: number;
  issues: ShellIssue[];
  failure: StorefrontShellFailure | null;
};

const DEFAULT_EDITOR_DOCUMENT = createCurrentLuwagShellDocument({
  rootCategories: [],
  navigationCollections: [],
  supportEmail: "hello@luwag.shop",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
});

function emptyGenerations(): RequestGeneration {
  return {
    load: 0,
    save: 0,
    validate: 0,
    publish: 0,
    horizontalUpload: 0,
    squareUpload: 0,
  };
}

function initialState(actorKey: string, tab: ShellTab): ShellEditorState {
  return {
    actorKey,
    load: "loading",
    server: null,
    document: null,
    tab,
    device: "desktop",
    pendingUploads: new Set(),
    saving: false,
    validating: false,
    publishing: false,
    conflict: null,
    requestGeneration: emptyGenerations(),
    documentGeneration: 0,
    issues: [],
    failure: null,
  };
}

type Action =
  | {
      type: "load-start";
      actorKey: string;
      tab: ShellTab;
      generation: number;
    }
  | {
      type: "actor-reset";
      actorKey: string;
      tab: ShellTab;
    }
  | {
      type: "load-success";
      actorKey: string;
      generation: number;
      snapshot: AdminShellSnapshot;
    }
  | {
      type: "load-failure";
      actorKey: string;
      generation: number;
      message: string;
    }
  | {
      type: "set-document";
      actorKey: string;
      document: StorefrontShellDocument;
    }
  | { type: "set-tab"; actorKey: string; tab: ShellTab }
  | { type: "set-device"; actorKey: string; device: ShellDevice }
  | {
      type: "set-upload-pending";
      actorKey: string;
      slot: UploadSlot;
      pending: boolean;
    }
  | {
      type: "operation-start";
      actorKey: string;
      operation: Exclude<Operation, "load">;
      generation: number;
      slot?: UploadSlot;
    }
  | {
      type: "operation-failure";
      actorKey: string;
      operation: Exclude<Operation, "load">;
      generation: number;
      initiatingVersion: number;
      message: string;
      conflict?: { currentVersion?: number };
      slot?: UploadSlot;
    }
  | {
      type: "save-success";
      actorKey: string;
      generation: number;
      initiatingVersion: number;
      initiatingDocumentGeneration: number;
      snapshot: AdminShellSnapshot;
    }
  | {
      type: "publish-success";
      actorKey: string;
      generation: number;
      initiatingVersion: number;
      initiatingDocumentGeneration: number;
      snapshot: AdminShellSnapshot;
    }
  | {
      type: "validation-success";
      actorKey: string;
      generation: number;
      initiatingVersion: number;
      initiatingDocumentGeneration: number;
      responseVersion: number;
      issues: ShellIssue[];
    }
  | {
      type: "upload-success";
      actorKey: string;
      operation: "horizontalUpload" | "squareUpload";
      generation: number;
      initiatingVersion: number;
      slot: UploadSlot;
      responseVersion: number;
      issues: ShellIssue[];
      asset: AdminShellAsset;
    };

function operationMatches(
  state: ShellEditorState,
  action: {
    actorKey: string;
    operation: Operation;
    generation: number;
    initiatingVersion?: number;
  },
): boolean {
  return (
    state.actorKey === action.actorKey &&
    state.requestGeneration[action.operation] === action.generation &&
    (action.initiatingVersion === undefined ||
      state.server?.version === action.initiatingVersion)
  );
}

function clearOperation(
  state: ShellEditorState,
  operation: Exclude<Operation, "load">,
  slot?: UploadSlot,
): Pick<
  ShellEditorState,
  "saving" | "validating" | "publishing" | "pendingUploads"
> {
  const pendingUploads = new Set(state.pendingUploads);
  if (slot) pendingUploads.delete(slot);
  return {
    saving: operation === "save" ? false : state.saving,
    validating: operation === "validate" ? false : state.validating,
    publishing: operation === "publish" ? false : state.publishing,
    pendingUploads,
  };
}

function reducer(state: ShellEditorState, action: Action): ShellEditorState {
  switch (action.type) {
    case "actor-reset":
      return initialState(action.actorKey, action.tab);
    case "load-start": {
      const next = initialState(action.actorKey, action.tab);
      next.requestGeneration.load = action.generation;
      return next;
    }
    case "load-success":
      if (
        state.actorKey !== action.actorKey ||
        state.requestGeneration.load !== action.generation
      ) {
        return state;
      }
      return {
        ...state,
        load: "ready",
        server: action.snapshot,
        document: action.snapshot.document,
        issues: action.snapshot.issues,
        failure: null,
      };
    case "load-failure":
      if (
        state.actorKey !== action.actorKey ||
        state.requestGeneration.load !== action.generation
      ) {
        return state;
      }
      return {
        ...state,
        load: "error",
        failure: { operation: "load", message: action.message },
      };
    case "set-document":
      if (state.actorKey !== action.actorKey || state.load !== "ready") {
        return state;
      }
      return {
        ...state,
        document: action.document,
        documentGeneration: state.documentGeneration + 1,
        conflict: null,
        failure: null,
      };
    case "set-tab":
      return state.actorKey === action.actorKey
        ? { ...state, tab: action.tab }
        : state;
    case "set-device":
      return state.actorKey === action.actorKey
        ? { ...state, device: action.device }
        : state;
    case "set-upload-pending": {
      if (state.actorKey !== action.actorKey) return state;
      const pendingUploads = new Set(state.pendingUploads);
      if (action.pending) pendingUploads.add(action.slot);
      else pendingUploads.delete(action.slot);
      return { ...state, pendingUploads };
    }
    case "operation-start": {
      if (state.actorKey !== action.actorKey || state.load !== "ready") {
        return state;
      }
      const pendingUploads = new Set(state.pendingUploads);
      if (action.slot) pendingUploads.add(action.slot);
      return {
        ...state,
        requestGeneration: {
          ...state.requestGeneration,
          [action.operation]: action.generation,
        },
        saving: action.operation === "save" ? true : state.saving,
        validating:
          action.operation === "validate" ? true : state.validating,
        publishing:
          action.operation === "publish" ? true : state.publishing,
        pendingUploads,
        conflict: null,
        failure: null,
      };
    }
    case "operation-failure":
      if (!operationMatches(state, action)) return state;
      return {
        ...state,
        ...clearOperation(state, action.operation, action.slot),
        conflict: action.conflict ?? null,
        failure: {
          operation:
            action.operation === "horizontalUpload" ||
            action.operation === "squareUpload"
              ? "upload"
              : action.operation,
          message: action.message,
        },
      };
    case "save-success":
      if (!operationMatches(state, { ...action, operation: "save" })) {
        return state;
      }
      return {
        ...state,
        ...clearOperation(state, "save"),
        server: action.snapshot,
        document:
          state.documentGeneration === action.initiatingDocumentGeneration
            ? action.snapshot.document
            : state.document,
        issues: action.snapshot.issues,
        conflict: null,
        failure: null,
      };
    case "publish-success":
      if (!operationMatches(state, { ...action, operation: "publish" })) {
        return state;
      }
      return {
        ...state,
        ...clearOperation(state, "publish"),
        server: action.snapshot,
        document:
          state.documentGeneration === action.initiatingDocumentGeneration
            ? action.snapshot.document
            : state.document,
        issues: action.snapshot.issues,
        conflict: null,
        failure: null,
      };
    case "validation-success": {
      if (!operationMatches(state, {
        actorKey: action.actorKey,
        operation: "validate",
        generation: action.generation,
      })) return state;
      const settled = { ...state, ...clearOperation(state, "validate") };
      if (
        state.server?.version !== action.initiatingVersion ||
        state.documentGeneration !== action.initiatingDocumentGeneration ||
        action.responseVersion !== action.initiatingVersion
      ) return settled;
      return { ...settled, issues: action.issues, failure: null };
    }
    case "upload-success":
      if (
        !operationMatches(state, action) ||
        action.responseVersion !== action.initiatingVersion ||
        !state.server
      ) return state;
      return {
        ...state,
        ...clearOperation(state, action.operation, action.slot),
        server: {
          ...state.server,
          assets: { ...state.server.assets, [action.asset.id]: action.asset },
        },
        issues: action.issues,
        failure: null,
      };
  }
}

function canonical(value: unknown): string {  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function versionConflict(
  error: unknown,
): { currentVersion?: number } | null {
  if (!(error instanceof AdminApiError) || error.status !== 409) return null;
  const body = error.body;
  if (!body || typeof body !== "object") return {};
  const currentVersion = (body as { currentVersion?: unknown }).currentVersion;
  return typeof currentVersion === "number" ? { currentVersion } : {};
}

export type StorefrontShellEditorContextValue = {
  state: ShellEditorState;
  document: StorefrontShellDocument;
  server: AdminShellSnapshot;
  unsaved: boolean;
  issues: ShellIssue[];
  updateDocument: (
    update: (
      document: StorefrontShellDocument,
    ) => StorefrontShellDocument,
  ) => void;
  setTab: (tab: ShellTab) => void;
  setDevice: (device: ShellDevice) => void;
  save: () => Promise<void>;
  validate: () => Promise<void>;
  publish: () => Promise<void>;
  reload: () => void;
  restoreDefaults: () => void;
  upload: (
    file: File,
    slot: UploadSlot,
  ) => Promise<AdminShellUploadResult | null>;
};

const StorefrontShellEditorContext =
  createContext<StorefrontShellEditorContextValue | null>(null);

export function useStorefrontShellEditor(): StorefrontShellEditorContextValue {
  const value = useContext(StorefrontShellEditorContext);
  if (!value) {
    throw new Error(
      "useStorefrontShellEditor must be used inside StorefrontShellEditor",
    );
  }
  return value;
}

/** Resolves a draft asset reference against the server-projected asset map. */
function assetFor(
  assets: Record<string, AdminShellAsset>,
  ref: ShellAssetRef,
): AdminShellAsset | undefined {
  return ref === null ? undefined : assets[ref.assetId];
}

function hrefForLink(link: StructuredLink): string {
  switch (link.type) {
    case "INTERNAL":
      return link.path;
    case "EXTERNAL":
      return link.url;
    case "PRODUCT":
      return `/products/${link.id}`;
    case "COLLECTION":
      return `/collections/${link.id}`;
    case "CATEGORY":
      return `/category/${link.id}`;
    case "LANDING":
      return `/lp/${link.id}`;
  }
}

/**
 * Local projection of the in-editor draft. The admin preview never resolves
 * targets server-side, so unavailable links fall back to `#` and the preview
 * stays fully inert.
 */
function previewShell(
  document: StorefrontShellDocument,
  assets: Record<string, AdminShellAsset>,
): PublicStorefrontShell {
  const brandAsset = (ref: ShellAssetRef) => {
    const asset = assetFor(assets, ref);
    return asset
      ? {
          id: asset.id,
          url: asset.url,
          width: asset.width,
          height: asset.height,
        }
      : null;
  };

  return {
    publishedRevision: 0,
    brand: {
      brandName: document.brand.brandName,
      horizontalLogo: brandAsset(document.brand.horizontalLogo),
      squareMark: brandAsset(document.brand.squareMark),
    },
    header: {
      items: document.header.items.map((item) =>
        item.kind === "STRUCTURED_LINK"
          ? { id: item.id, kind: "LINK" as const, label: item.label, href: hrefForLink(item.link) }
          : {
              id: item.id,
              kind: "CATEGORY_ROOT" as const,
              categoryId: item.targetId,
              label: item.labelOverride || item.targetId,
            },
      ),
    },
    footer: {
      tagline: document.footer.tagline,
      description: document.footer.description,
      columns: document.footer.columns.map((column) =>
        column.kind === "LINKS"
          ? {
              id: column.id,
              kind: "LINKS" as const,
              title: column.title,
              rows: column.rows.map((row) =>
                row.kind === "LINK"
                  ? {
                      id: row.id,
                      kind: "LINK" as const,
                      label: row.label,
                      href: hrefForLink(row.link),
                    }
                  : { id: row.id, kind: "TEXT" as const, text: row.text },
              ),
            }
          : {
              id: column.id,
              kind: "CONTACT" as const,
              title: column.title,
              supportEmail: column.supportEmail,
              supportHours: column.supportHours,
              codText: column.codText,
              trackOrderLabel: column.trackOrderLabel,
              trackOrderHref: hrefForLink(column.trackOrderLink),
            },
      ),
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
    derivedTheme: deriveStorefrontTheme(document.theme),
  };
}

export function StorefrontShellEditor({ children }: { children?: ReactNode }) {
  const { status, admin, hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: ShellTab =
    tabParam === "header" ? "header" : tabParam === "footer" ? "footer" : "brand";
  const canManage =
    status === "authed" &&
    admin !== null &&
    hasPermission("STOREFRONT_SHELL_MANAGE");
  const permissionFingerprint = [...(admin?.permissions ?? [])].sort().join(",");
  const actorKey = `${status}:${admin?.id ?? "none"}:${permissionFingerprint}:${
    canManage ? "manage" : "denied"
  }`;

  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => initialState(actorKey, initialTab),
  );
  const stateRef = useRef(state);
  const actorRef = useRef(actorKey);
  const generationsRef = useRef<RequestGeneration>(emptyGenerations());
  const saveFlightRef = useRef<{
    actorKey: string;
    promise: Promise<void>;
  } | null>(null);
  const publishFlightRef = useRef<{
    actorKey: string;
    promise: Promise<void>;
  } | null>(null);
  const uploadFlightRef = useRef<
    Partial<
      Record<
        UploadSlot,
        { actorKey: string; promise: Promise<AdminShellUploadResult | null> }
      >
    >
  >({});
  const lastUploadRef = useRef<{
    actorKey: string;
    file: File;
    slot: UploadSlot;
  } | null>(null);
  const validationTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    stateRef.current = state;
    actorRef.current = actorKey;
  }, [actorKey, state]);

  const nextGeneration = useCallback((operation: Operation): number => {
    generationsRef.current[operation] += 1;
    return generationsRef.current[operation];
  }, []);

  const stillActive = useCallback(
    (operation: Operation, generation: number, initiatingActor: string) =>
      actorRef.current === initiatingActor &&
      generationsRef.current[operation] === generation,
    [],
  );

  const load = useCallback(async () => {
    if (!canManage || actorRef.current !== actorKey) return;
    const initiatingActor = actorKey;
    const generation = nextGeneration("load");
    dispatch({
      type: "load-start",
      actorKey: initiatingActor,
      tab: initialTab,
      generation,
    });
    try {
      const loaded = await storefrontShellApi.get();
      if (!stillActive("load", generation, initiatingActor)) return;
      dispatch({
        type: "load-success",
        actorKey: initiatingActor,
        generation,
        snapshot: loaded,
      });
    } catch (error) {
      if (!stillActive("load", generation, initiatingActor)) return;
      dispatch({
        type: "load-failure",
        actorKey: initiatingActor,
        generation,
        message: errorMessage(error),
      });
    }
  }, [actorKey, canManage, initialTab, nextGeneration, stillActive]);

  useEffect(() => {
    if (!canManage) {
      dispatch({ type: "actor-reset", actorKey, tab: initialTab });
      return;
    }
    void load();
  }, [actorKey, canManage, initialTab, load]);

  const updateDocument = useCallback(
    (
      update: (
        document: StorefrontShellDocument,
      ) => StorefrontShellDocument,
    ) => {
      const current = stateRef.current;
      if (
        actorRef.current !== actorKey ||
        current.actorKey !== actorKey ||
        current.load !== "ready" ||
        !current.document
      ) {
        return;
      }
      dispatch({
        type: "set-document",
        actorKey,
        document: update(current.document),
      });
    },
    [actorKey],
  );

  const unsaved =
    state.actorKey === actorKey && state.server && state.document
      ? canonical(state.server.document) !== canonical(state.document)
      : false;

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  const save = useCallback((): Promise<void> => {
    if (saveFlightRef.current?.actorKey === actorKey) {
      return saveFlightRef.current.promise;
    }
    const current = stateRef.current;
    if (
      actorRef.current !== actorKey ||
      current.actorKey !== actorKey ||
      current.load !== "ready" ||
      !current.server ||
      !current.document ||
      current.pendingUploads.size > 0
    ) {
      return Promise.resolve();
    }
    if (canonical(current.server.document) === canonical(current.document)) {
      return Promise.resolve();
    }

    const initiatingActor = actorKey;
    const initiatingVersion = current.server.version;
    const initiatingDocumentGeneration = current.documentGeneration;
    const document = current.document;
    const generation = nextGeneration("save");
    dispatch({
      type: "operation-start",
      actorKey: initiatingActor,
      operation: "save",
      generation,
    });

    const request = (async () => {
      try {
        const response = await storefrontShellApi.save(
          document,
          initiatingVersion,
        );
        if (!stillActive("save", generation, initiatingActor)) return;
        dispatch({
          type: "save-success",
          actorKey: initiatingActor,
          generation,
          initiatingVersion,
          initiatingDocumentGeneration,
          snapshot: response,
        });
      } catch (error) {
        if (!stillActive("save", generation, initiatingActor)) return;
        dispatch({
          type: "operation-failure",
          actorKey: initiatingActor,
          operation: "save",
          generation,
          initiatingVersion,
          message: errorMessage(error),
          conflict: versionConflict(error) ?? undefined,
        });
      }
    })();
    saveFlightRef.current = { actorKey: initiatingActor, promise: request };
    void request.finally(() => {
      if (saveFlightRef.current?.promise === request) {
        saveFlightRef.current = null;
      }
    });
    return request;
  }, [actorKey, nextGeneration, stillActive]);

  const runValidation = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (
      actorRef.current !== actorKey ||
      current.actorKey !== actorKey ||
      current.load !== "ready" ||
      !current.server ||
      !current.document
    ) {
      return;
    }
    const initiatingActor = actorKey;
    const initiatingVersion = current.server.version;
    const initiatingDocumentGeneration = current.documentGeneration;
    const document = current.document;
    const generation = nextGeneration("validate");
    dispatch({
      type: "operation-start",
      actorKey: initiatingActor,
      operation: "validate",
      generation,
    });
    try {
      const response = await storefrontShellApi.validate(document);
      if (!stillActive("validate", generation, initiatingActor)) return;
      dispatch({
        type: "validation-success",
        actorKey: initiatingActor,
        generation,
        initiatingVersion,
        initiatingDocumentGeneration,
        responseVersion: response.version,
        issues: response.issues,
      });
    } catch (error) {
      if (!stillActive("validate", generation, initiatingActor)) return;
      dispatch({
        type: "operation-failure",
        actorKey: initiatingActor,
        operation: "validate",
        generation,
        initiatingVersion,
        message: errorMessage(error),
      });
    }
  }, [actorKey, nextGeneration, stillActive]);

  const validate = useCallback((): Promise<void> => {
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
    }
    return runValidation();
  }, [runValidation]);

  useEffect(() => {
    if (!unsaved || state.actorKey !== actorKey || state.load !== "ready") {
      return;
    }
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current);
    }
    validationTimerRef.current = window.setTimeout(() => {
      validationTimerRef.current = null;
      void runValidation();
    }, 300);
    return () => {
      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current);
        validationTimerRef.current = null;
      }
    };
  }, [actorKey, runValidation, state.actorKey, state.documentGeneration, state.load, unsaved]);

  const publish = useCallback((): Promise<void> => {
    if (publishFlightRef.current?.actorKey === actorKey) {
      return publishFlightRef.current.promise;
    }
    const current = stateRef.current;
    if (
      actorRef.current !== actorKey ||
      current.actorKey !== actorKey ||
      current.load !== "ready" ||
      !current.server ||
      !current.document ||
      canonical(current.server.document) !== canonical(current.document) ||
      current.pendingUploads.size > 0 ||
      current.saving ||
      !current.server.hasUnpublishedChanges
    ) {
      return Promise.resolve();
    }

    const initiatingActor = actorKey;
    const initiatingVersion = current.server.version;
    const initiatingDocumentGeneration = current.documentGeneration;
    const generation = nextGeneration("publish");
    dispatch({
      type: "operation-start",
      actorKey: initiatingActor,
      operation: "publish",
      generation,
    });

    const request = (async () => {
      try {
        const response = await storefrontShellApi.publish(initiatingVersion);
        if (!stillActive("publish", generation, initiatingActor)) return;
        dispatch({
          type: "publish-success",
          actorKey: initiatingActor,
          generation,
          initiatingVersion,
          initiatingDocumentGeneration,
          snapshot: response,
        });
      } catch (error) {
        if (!stillActive("publish", generation, initiatingActor)) return;
        dispatch({
          type: "operation-failure",
          actorKey: initiatingActor,
          operation: "publish",
          generation,
          initiatingVersion,
          message: errorMessage(error),
          conflict: versionConflict(error) ?? undefined,
        });
      }
    })();
    publishFlightRef.current = {
      actorKey: initiatingActor,
      promise: request,
    };
    void request.finally(() => {
      if (publishFlightRef.current?.promise === request) {
        publishFlightRef.current = null;
      }
    });
    return request;
  }, [actorKey, nextGeneration, stillActive]);

  const upload = useCallback(
    (
      file: File,
      slot: UploadSlot,
    ): Promise<AdminShellUploadResult | null> => {
      const existing = uploadFlightRef.current[slot];
      if (existing?.actorKey === actorKey) return existing.promise;
      const current = stateRef.current;
      if (
        actorRef.current !== actorKey ||
        current.actorKey !== actorKey ||
        current.load !== "ready" ||
        !current.server
      ) {
        return Promise.resolve(null);
      }
      const initiatingActor = actorKey;
      const initiatingVersion = current.server.version;
      const operation =
        slot === "horizontal" ? "horizontalUpload" : "squareUpload";
      const generation = nextGeneration(operation);
      lastUploadRef.current = { actorKey: initiatingActor, file, slot };
      dispatch({
        type: "operation-start",
        actorKey: initiatingActor,
        operation,
        generation,
        slot,
      });

      const request = (async () => {
        try {
          const response = await storefrontShellApi.upload(file, slot);
          if (
            !stillActive(operation, generation, initiatingActor) ||
            stateRef.current.server?.version !== initiatingVersion ||
            response.version !== initiatingVersion
          ) {
            return null;
          }
          dispatch({
            type: "upload-success",
            actorKey: initiatingActor,
            operation,
            generation,
            initiatingVersion,
            slot,
            responseVersion: response.version,
            issues: response.issues,
            asset: response.asset,
          });
          return response;
        } catch (error) {
          if (!stillActive(operation, generation, initiatingActor)) return null;
          dispatch({
            type: "operation-failure",
            actorKey: initiatingActor,
            operation,
            generation,
            initiatingVersion,
            message: errorMessage(error),
            slot,
          });
          return null;
        }
      })();
      uploadFlightRef.current[slot] = {
        actorKey: initiatingActor,
        promise: request,
      };
      void request.finally(() => {
        if (uploadFlightRef.current[slot]?.promise === request) {
          delete uploadFlightRef.current[slot];
        }
      });
      return request;
    },
    [actorKey, nextGeneration, stillActive],
  );

  const setTab = useCallback(
    (tab: ShellTab) => dispatch({ type: "set-tab", actorKey, tab }),
    [actorKey],
  );
  const setDevice = useCallback(
    (device: ShellDevice) =>
      dispatch({ type: "set-device", actorKey, device }),
    [actorKey],
  );
  const uploadFor = useCallback(
    async (slot: UploadSlot, file: File): Promise<AdminShellAsset> => {
      dispatch({ type: "set-upload-pending", actorKey, slot, pending: true });
      try {
        const result = await upload(file, slot);
        if (!result) throw new Error("storefront_shell_upload_failed");
        return result.asset;
      } finally {
        dispatch({ type: "set-upload-pending", actorKey, slot, pending: false });
      }
    },
    [actorKey, upload],
  );
  const restoreDefaults = useCallback(() => {
    updateDocument(() => structuredClone(DEFAULT_EDITOR_DOCUMENT));
  }, [updateDocument]);

  const retry = useCallback(() => {
    const operation = stateRef.current.failure?.operation;
    if (operation === "load") void load();
    else if (operation === "save") void save();
    else if (operation === "validate") void validate();
    else if (operation === "publish") void publish();
    else if (
      operation === "upload" &&
      lastUploadRef.current?.actorKey === actorKey
    ) {
      const { file, slot } = lastUploadRef.current;
      void upload(file, slot);
    }
  }, [actorKey, load, publish, save, upload, validate]);

  if (status === "loading") {
    return <EditorLoading label={t("storefront_shell_loading")} />;
  }
  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-xl border border-admin-error bg-admin-error-soft p-6">
          <h1 className="text-lg font-semibold text-admin-error">
            {t("storefront_shell_permission_denied")}
          </h1>
        </div>
      </div>
    );
  }
  if (state.actorKey !== actorKey || state.load === "loading") {
    return <EditorLoading label={t("storefront_shell_loading")} />;
  }
  if (state.load === "error" || !state.server || !state.document) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div role="alert" className="rounded-xl border border-admin-error bg-admin-error-soft p-6">
          <p className="font-semibold text-admin-error">
            {t("storefront_shell_load_error")}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white"
          >
            {t("storefront_shell_retry")}
          </button>
        </div>
      </div>
    );
  }

  const contextValue: StorefrontShellEditorContextValue = {
    state,
    document: state.document,
    server: state.server,
    unsaved,
    issues: state.issues,
    updateDocument,
    setTab,
    setDevice,
    save,
    validate,
    publish,
    reload: () => void load(),
    restoreDefaults,
    upload,
  };

  return (
    <StorefrontShellEditorContext.Provider value={contextValue}>
      <div className="min-h-[calc(100vh-3.5rem)] bg-admin-canvas">
        <div className="w-full max-w-none px-4 pb-4 pt-6 sm:px-6">
          <h1 className="text-2xl font-bold text-ink">
            {t("storefront_shell_title")}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {t("storefront_shell_subtitle")}
          </p>
        </div>

        <StorefrontShellPublishBar
          version={state.server.version}
          unsaved={unsaved}
          hasUnpublishedChanges={state.server.hasUnpublishedChanges}
          pendingUploads={state.pendingUploads}
          saving={state.saving}
          validating={state.validating}
          publishing={state.publishing}
          publishedRevision={state.server.publishedRevision}
          publishedAt={state.server.publishedAt}
          updatedAt={state.server.updatedAt}
          conflict={state.conflict}
          failure={state.failure}
          onSave={() => void save()}
          onPublish={() => void publish()}
          onReload={() => void load()}
          onRetry={retry}
          onRestoreDefaults={restoreDefaults}
        />

        <div className="w-full max-w-none px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div role="group" aria-label={t("storefront_shell_tabs")} className="flex flex-wrap gap-2">
              {(["brand", "header", "footer"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={state.tab === tab}
                  onClick={() => setTab(tab)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap ${
                    state.tab === tab
                      ? "bg-admin-primary text-white"
                      : "border border-admin-border bg-admin-surface text-ink"
                  }`}
                >
                  {t(
                    tab === "brand"
                      ? "storefront_shell_tab_brand"
                      : tab === "header"
                        ? "storefront_shell_tab_header"
                        : "storefront_shell_tab_footer",
                  )}
                </button>
              ))}
            </div>

            <div role="group" aria-label={t("storefront_shell_preview_devices")} className="flex gap-1">
              {(["desktop", "tablet", "mobile"] as const).map((device) => (
                <button
                  key={device}
                  type="button"
                  aria-pressed={state.device === device}
                  onClick={() => setDevice(device)}
                  className="rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-ink"
                >
                  {t(`storefront_shell_device_${device}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="min-w-0">
              {state.tab === "brand" ? (
                <div data-testid="shell-brand-panel">
                  <section className="rounded-xl border border-admin-border bg-admin-surface p-5">
                    <label className="block text-sm font-medium text-ink">
                      {t("storefront_shell_brand_name")}
                      <input
                        value={state.document.brand.brandName}
                        onChange={(event) =>
                          updateDocument((document) => ({
                            ...document,
                            brand: {
                              ...document.brand,
                              brandName: event.target.value,
                            },
                          }))
                        }
                        className="mt-1 block w-full max-w-md rounded-lg border border-admin-border px-3 py-2"
                      />
                    </label>
                  </section>

                  <section className="mt-6" aria-labelledby="storefront-shell-brand-marks">
                    <h2
                      id="storefront-shell-brand-marks"
                      className="text-lg font-semibold text-ink"
                    >
                      {t("storefront_shell_brand_heading")}
                    </h2>
                    <div className="mt-4 space-y-4">
                      <BrandAssetField
                        labelKey="storefront_shell_brand_horizontal"
                        hintKey="storefront_shell_brand_horizontal_hint"
                        assetRef={state.document.brand.horizontalLogo}
                        asset={assetFor(state.server.assets, state.document.brand.horizontalLogo)}
                        onAssetRefChange={(assetRef) =>
                          updateDocument((document) => ({
                            ...document,
                            brand: { ...document.brand, horizontalLogo: assetRef },
                          }))
                        }
                        onUpload={(file) => uploadFor("horizontal", file)}
                        disabled={state.pendingUploads.size > 0}
                      />
                      <BrandAssetField
                        labelKey="storefront_shell_brand_square"
                        hintKey="storefront_shell_brand_square_hint"
                        assetRef={state.document.brand.squareMark}
                        asset={assetFor(state.server.assets, state.document.brand.squareMark)}
                        onAssetRefChange={(assetRef) =>
                          updateDocument((document) => ({
                            ...document,
                            brand: { ...document.brand, squareMark: assetRef },
                          }))
                        }
                        onUpload={(file) => uploadFor("square", file)}
                        disabled={state.pendingUploads.size > 0}
                      />
                    </div>
                  </section>

                  <section className="mt-6">
                    <BrandThemeEditor
                      theme={state.document.theme}
                      onChange={(theme) =>
                        updateDocument((document) => ({ ...document, theme }))
                      }
                    />
                  </section>
                </div>
              ) : null}

              {state.tab === "header" ? (
                <div data-testid="shell-header-panel">
                  <HeaderContentEditor
                    items={state.document.header.items}
                    onChange={(items) =>
                      updateDocument((document) => ({
                        ...document,
                        header: { ...document.header, items },
                      }))
                    }
                    pendingUploads={state.pendingUploads}
                    issues={state.issues}
                  />
                </div>
              ) : null}

              {state.tab === "footer" ? (
                <div data-testid="shell-footer-panel">
                  <FooterContentEditor
                    tagline={state.document.footer.tagline}
                    description={state.document.footer.description}
                    columns={state.document.footer.columns}
                    copyrightBrand={state.document.footer.copyrightBrand}
                    socials={state.document.footer.socials}
                    legal={state.document.footer.legal}
                    payments={state.document.footer.payments}
                    pendingUploads={state.pendingUploads}
                    issues={state.issues}
                    onChange={(next) =>
                      updateDocument((document) => ({
                        ...document,
                        footer: { ...document.footer, ...next },
                      }))
                    }
                  />
                </div>
              ) : null}
            </div>

            <aside className="min-w-0 xl:sticky xl:top-[8.5rem] xl:self-start">
              <StorefrontShellPreview
                shell={previewShell(state.document, state.server.assets)}
                device={state.device}
                parts={state.tab === "brand" ? "full" : state.tab}
                bounded
              />
            </aside>
          </div>

          {state.issues.length > 0 ? (
            <div role="status" className="mt-4 rounded-lg border border-admin-warning bg-admin-warning-soft p-3 text-sm">
              {t("storefront_shell_validation_issues", {
                count: state.issues.length,
              })}
            </div>
          ) : null}

          {children}
        </div>
      </div>
    </StorefrontShellEditorContext.Provider>
  );
}

function EditorLoading({ label }: { label: string }) {
  return (
    <div className="w-full max-w-none p-8" aria-busy="true">
      <p className="sr-only">{label}</p>
      <div className="h-8 w-64 animate-pulse rounded bg-admin-border" />
      <div className="mt-4 h-40 animate-pulse rounded-xl bg-admin-surface" />
    </div>
  );
}
