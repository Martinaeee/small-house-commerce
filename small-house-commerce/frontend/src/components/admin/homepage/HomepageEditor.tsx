"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { DeviceFrame, type DeviceFrameMetrics } from "@/components/admin/PreviewPane";
import { Button } from "@/components/ui/Button";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { AnnouncementSettings } from "@/components/admin/homepage/AnnouncementSettings";
import { sectionTypeLabelKey } from "@/components/admin/homepage/AddSectionDialog";
import { HomepageDefaultsPanel } from "@/components/admin/homepage/HomepageDefaultsPanel";
import { HomepageLivePreview } from "@/components/admin/homepage/HomepageLivePreview";
import { HeroSettingsPanel } from "@/components/admin/homepage/HeroSettingsPanel";
import {
  ANNOUNCEMENT_SELECTION_ID,
  HOMEPAGE_DEFAULTS_SELECTION_ID,
  ModuleTree,
} from "@/components/admin/homepage/ModuleTree";
import { PublishPanel } from "@/components/admin/homepage/PublishPanel";
import { SectionEditorPanel } from "@/components/admin/homepage/SectionEditorPanel";
import { SectionDisplaySettings } from "@/components/admin/homepage/SectionDisplaySettings";
import { useAdminI18n } from "@/lib/admin-i18n";
import { errorStatus } from "@/lib/admin-auth";
import { adminApi, type HomepageDraftSnapshot } from "@/lib/admin-api";
import studioStyles from "./HomepageStudio.module.css";
import { heroCss } from "@/lib/homepage-styles";
import {
  emptyDocument,
  type HeroElementKey,
  type HomepageDocument,
  type HomepageSection,
} from "@/lib/homepage-document";
import {
  editorReducer,
  initEditorState,
  type EditorAction,
  type EditorState,
} from "@/lib/homepage-editor-state";

/**
 * Homepage builder shell (spec: homepage builder P1, Task 12).
 *
 * Three-pane editor over the single homepage draft document:
 *   - left   Modules  → ModuleTree (Task 13 fills the tree)
 *   - middle Preview  → full-width live preview + `heroCss` + full draft live preview
 *   - right  Settings → SettingsPanel (Task 14 fills the groups)
 *
 * The provider owns the reducer-backed editor state and the shared selection
 * (device, selected section/slide/element, safe-area flags) exposed through
 * `HomepageEditorContext`; the shell owns data loading, autosave, keyboard
 * shortcuts and the status/conflict bars. Both are exported so child specs
 * can compose the provider with their own harness.
 */

const AUTOSAVE_DELAY_MS = 3000;
const SETTINGS_WIDTH_DEFAULT = 360;
const SETTINGS_WIDTH_MIN = 360;
const SETTINGS_WIDTH_MAX = 560;
const SETTINGS_WIDTH_STEP = 16;

function clampSettingsWidth(value: number): number {
  return Math.min(SETTINGS_WIDTH_MAX, Math.max(SETTINGS_WIDTH_MIN, value));
}

export type BuilderDevice = "desktop" | "tablet" | "mobile";

export type SafeAreaFlags = {
  header: boolean;
  text: boolean;
  mobileCrop: boolean;
  mediaCrop: boolean;
  universal: boolean;
};

export type HomepageEditorContextValue = {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  device: BuilderDevice;
  setDevice: Dispatch<SetStateAction<BuilderDevice>>;
  compareCurrentAppearance: boolean;
  setCompareCurrentAppearance: Dispatch<SetStateAction<boolean>>;
  selectedSectionId: string | null;
  setSelectedSectionId: Dispatch<SetStateAction<string | null>>;
  selectedSlideId: string | null;
  setSelectedSlideId: Dispatch<SetStateAction<string | null>>;
  selectedElementKey: HeroElementKey | null;
  setSelectedElementKey: Dispatch<SetStateAction<HeroElementKey | null>>;
  safeAreaFlags: SafeAreaFlags;
  setSafeAreaFlags: Dispatch<SetStateAction<SafeAreaFlags>>;
};

export const HomepageEditorContext =
  createContext<HomepageEditorContextValue | null>(null);

export function useHomepageEditor(): HomepageEditorContextValue {
  const value = useContext(HomepageEditorContext);
  if (!value) {
    throw new Error(
      "useHomepageEditor must be used within HomepageEditorContext",
    );
  }
  return value;
}

const PANES = [
  { id: "modules", labelKey: "homepage_builder_pane_modules" },
  { id: "preview", labelKey: "homepage_builder_pane_preview" },
  { id: "settings", labelKey: "homepage_builder_pane_settings" },
] as const;

type BuilderPane = (typeof PANES)[number]["id"];

const DEVICE_OPTIONS = [
  { id: "desktop", labelKey: "homepage_builder_device_desktop" },
  { id: "tablet", labelKey: "homepage_builder_device_tablet" },
  { id: "mobile", labelKey: "homepage_builder_device_mobile" },
] as const;

const DEVICE_ICONS: Record<BuilderDevice, string> = {
  desktop: "M3 5h18v11H3V5Zm6 14h6m-3-3v3",
  tablet: "M6 3h12v18H6V3Zm4.5 15h3",
  mobile: "M8 3h8v18H8V3Zm3 15h2",
};

type HeroSection = Extract<HomepageSection, { type: "HERO" }>;

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function HomepageEditorProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [state, dispatch] = useReducer(editorReducer, null, () =>
    initEditorState({ document: emptyDocument(), rev: 0, savedAt: null }),
  );
  const [device, setDevice] = useState<BuilderDevice>("desktop");
  const [compareCurrentAppearance, setCompareCurrentAppearance] = useState(false);
  const [selectedSectionId, setSelectedSectionIdState] = useState<string | null>(
    null,
  );
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [selectedElementKey, setSelectedElementKeyState] =
    useState<HeroElementKey | null>(null);
  const heroSectionId =
    state.document.sections.find((section) => section.type === "HERO")?.id ?? null;
  const setSelectedElementKey = useCallback<
    Dispatch<SetStateAction<HeroElementKey | null>>
  >(
    (value) => {
      const nextElementKey =
        typeof value === "function" ? value(selectedElementKey) : value;
      setSelectedElementKeyState(nextElementKey);
      if (nextElementKey !== null && heroSectionId !== null) {
        setSelectedSectionIdState(heroSectionId);
      }
    },
    [heroSectionId, selectedElementKey],
  );
  const setSelectedSectionId = useCallback<
    Dispatch<SetStateAction<string | null>>
  >(
    (value) => {
      const nextSectionId =
        typeof value === "function" ? value(selectedSectionId) : value;
      setSelectedSectionIdState(nextSectionId);
      if (nextSectionId !== heroSectionId) {
        setSelectedSlideId(null);
        setSelectedElementKeyState(null);
      }
    },
    [heroSectionId, selectedSectionId],
  );
  const [safeAreaFlags, setSafeAreaFlags] = useState<SafeAreaFlags>(() => ({
    header: false,
    text: false,
    mobileCrop: false,
    mediaCrop: false,
    universal: false,
  }));

  const value = useMemo<HomepageEditorContextValue>(
    () => ({
      state,
      dispatch,
      device,
      setDevice,
      compareCurrentAppearance,
      setCompareCurrentAppearance,
      selectedSectionId,
      setSelectedSectionId,
      selectedSlideId,
      setSelectedSlideId,
      selectedElementKey,
      setSelectedElementKey,
      safeAreaFlags,
      setSafeAreaFlags,
    }),
    [
      state,
      device,
      compareCurrentAppearance,
      selectedSectionId,
      setSelectedSectionId,
      selectedSlideId,
      selectedElementKey,
      setSelectedElementKey,
      safeAreaFlags,
    ],
  );

  return (
    <HomepageEditorContext.Provider value={value}>
      {children}
    </HomepageEditorContext.Provider>
  );
}

export function HomepageEditorShell(): ReactNode {
  const { t } = useAdminI18n();
  const { status, hasPermission } = useAdminAuth();
  const {
    state,
    dispatch,
    device,
    setDevice,
    selectedSectionId,
    compareCurrentAppearance,
    setCompareCurrentAppearance,
  } = useHomepageEditor();

  const [snapshot, setSnapshot] = useState<HomepageDraftSnapshot | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadNonce, setLoadNonce] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<BuilderPane>("modules");
  const [settingsWidth, setSettingsWidth] = useState(SETTINGS_WIDTH_DEFAULT);
  const [previewMetrics, setPreviewMetrics] = useState<DeviceFrameMetrics>({ width: 1440, height: 900, scale: 0.42 });
  const settingsResizeStart = useRef<{ clientX: number; width: number } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [readyPreview, setReadyPreview] = useState<{ url: string; view: BuilderDevice; document: HomepageDocument; rev: number } | null>(null);
  const previewInFlightRef = useRef(false);
  // A save response can arrive before React commits its revision update.
  const draftOperationRef = useRef(0);

  // Latest committed state for event handlers that outlive a render
  // (keyboard shortcuts, autosave timers).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Ruling 44/①: until the draft has actually loaded, `stateRef` still holds
  // `emptyDocument` at rev 0 — the save path must refuse to PUT that.
  const draftReadyRef = useRef(false);
  // The in-flight save, so a publish flow can join it instead of racing it.
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);

  const canManage = status === "authed" && hasPermission("PRODUCT_MANAGE");

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    draftReadyRef.current = false;
    adminApi
      .getHomepageDraft()
      .then((data) => {
        if (!active) return;
        draftReadyRef.current = true;
        setSnapshot(data);
        setSaveError(null);
        dispatch({
          type: "load",
          document: data.draft,
          rev: data.draftRev,
          savedAt: data.draftUpdatedAt,
        });
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [loadNonce, dispatch, canManage]);

  const save = useCallback(async (): Promise<boolean> => {
    // Ruling 44/①: never save before the draft loaded (see draftReadyRef).
    if (!draftReadyRef.current) return false;
    // Join an in-flight save instead of starting a second PUT: callers get the
    // settled result of the save that is actually running.
    if (saveInFlightRef.current) return saveInFlightRef.current;

    const { document, rev } = stateRef.current;
    draftOperationRef.current += 1;
    dispatch({ type: "saving" });
    // DEFERRED (Task 12 minor ④): a PUT that never settles leaves `saveState`
    // stuck on "saving" (autosave then waits forever). P1 ships without a
    // timeout/abort; the operator can still reload or use Load latest.
    const run = (async (): Promise<boolean> => {
      try {
        const result = await adminApi.saveHomepageDraft(document, rev);
        setSaveError(null);
        dispatch({
          type: "saved",
          rev: result.draftRev,
          savedAt: result.draftUpdatedAt,
        });
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                draftRev: result.draftRev,
                draftUpdatedAt: result.draftUpdatedAt,
              }
            : previous,
        );
        return true;
      } catch (error: unknown) {
        if (errorStatus(error) === 409) {
          dispatch({ type: "conflict" });
          return false;
        }
        setSaveError(error instanceof Error ? error.message : String(error));
        dispatch({ type: "saveError" });
        return false;
      }
    })();
    saveInFlightRef.current = run;
    try {
      return await run;
    } finally {
      saveInFlightRef.current = null;
    }
  }, [dispatch]);

  /**
   * Server-read precondition for publish and token preview: the saved draft must
   * hold the local document. Waits out an in-flight save, saves when dirty, and
   * verifies the saved snapshot is still the live document (the `dirty` flag
   * lags the reducer by one render, so reference equality is the reliable check;
   * one retry covers edits made while the PUT was in flight).
   */
  const saveForPublish = useCallback(async (): Promise<boolean> => {
    if (saveInFlightRef.current) {
      await saveInFlightRef.current;
    }
    if (!draftReadyRef.current) return false;
    if (!stateRef.current.dirty) return true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const document = stateRef.current.document;
      const saved = await save();
      if (!saved) return false;
      if (stateRef.current.document === document) return true;
    }
    return false;
  }, [save]);

  const openPreview = useCallback(async (view: BuilderDevice): Promise<void> => {
    if (previewInFlightRef.current) return;
    previewInFlightRef.current = true;
    setPreviewPending(true);
    setPreviewError(null);
    setReadyPreview(null);
    try {
      if (!(await saveForPublish())) {
        setPreviewError(t("homepage_builder_preview_save_required"));
        return;
      }
      const document = stateRef.current.document;
      const operation = draftOperationRef.current;
      const { token } = await adminApi.createHomepagePreviewToken();
      if (stateRef.current.document !== document || draftOperationRef.current !== operation || stateRef.current.dirty || stateRef.current.conflict) {
        setPreviewError(t("homepage_builder_preview_save_required"));
        return;
      }
      const url = `/preview/homepage?token=${encodeURIComponent(token)}&view=${view}`;
      setReadyPreview({ url, view, document, rev: stateRef.current.rev });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      if (errorStatus(error) === 503) {
        setPreviewDisabled(true);
        return;
      }
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      previewInFlightRef.current = false;
      setPreviewPending(false);
    }
  }, [saveForPublish, t]);

  const handlePublished = useCallback(
    (result: { versionNo: number; publishAt: string }): void => {
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              published: {
                versionNo: result.versionNo,
                publishAt: result.publishAt,
              },
            }
          : previous,
      );
    },
    [],
  );

  // Autosave: 3s debounce after a change. Skipped while a save is in flight
  // and after a failed save or a conflict — both wait for an explicit user
  // action so a 409/error never turns into a retry loop.
  useEffect(() => {
    if (
      !state.dirty ||
      state.saveState === "saving" ||
      state.saveState === "error"
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.dirty, state.saveState, state.document, save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      // Yield inside text fields (ledger Ruling 33): the browser's native
      // text undo/redo and its own save handling must keep working there.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void save();
        return;
      }
      if (key === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [save, dispatch]);

  const loadLatest = useCallback(async (): Promise<void> => {
    draftOperationRef.current += 1;
    try {
      const data = await adminApi.getHomepageDraft();
      setSnapshot(data);
      setSaveError(null);
      dispatch({
        type: "resolveConflict",
        document: data.draft,
        rev: data.draftRev,
        savedAt: data.draftUpdatedAt,
      });
    } catch {
      // Keep the conflict bar so the operator can retry.
    }
  }, [dispatch]);

  // DEFERRED (Task 12 minor ②): "keep mine" fetches the latest rev and
  // immediately re-saves, so a third writer landing between the GET and the PUT
  // loses the race and surfaces a second 409 — acceptable for P1 (the conflict
  // bar simply reappears); a retry loop is deliberately not implemented here.
  const keepMine = useCallback(async (): Promise<void> => {
    draftOperationRef.current += 1;
    const local = stateRef.current.document;
    let latest: HomepageDraftSnapshot;
    try {
      latest = await adminApi.getHomepageDraft();
    } catch {
      return;
    }
    dispatch({ type: "saving" });
    try {
      const result = await adminApi.saveHomepageDraft(local, latest.draftRev);
      setSaveError(null);
      dispatch({
        type: "saved",
        rev: result.draftRev,
        savedAt: result.draftUpdatedAt,
      });
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              draftRev: result.draftRev,
              draftUpdatedAt: result.draftUpdatedAt,
            }
          : previous,
      );
    } catch (error: unknown) {
      if (errorStatus(error) === 409) {
        dispatch({ type: "conflict" });
        return;
      }
      setSaveError(error instanceof Error ? error.message : String(error));
      dispatch({ type: "saveError" });
    }
  }, [dispatch]);

  // Ruling 44/⑦: a direct URL without PRODUCT_MANAGE must show a readable
  // permission message, not the generic draft-load error. While auth is still
  // resolving (or a guest is being bounced by AdminShell) keep the loader so
  // the permission notice never flashes.
  if (status !== "authed") {
    return (
      <div className="px-4 py-6 md:px-8">
        <p className="text-sm text-ink-secondary">
          {t("homepage_builder_loading")}
        </p>
      </div>
    );
  }

  if (!hasPermission("PRODUCT_MANAGE")) {
    return (
      <div className="px-4 py-6 md:px-8">
        <EmptyState
          title={t("homepage_builder_permission_denied")}
          hint={t("homepage_builder_permission_denied_hint")}
        />
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="px-4 py-6 md:px-8">
        <p className="text-sm text-ink-secondary">
          {t("homepage_builder_loading")}
        </p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="px-4 py-6 md:px-8">
        <p className="text-sm text-ink-secondary">
          {t("homepage_builder_load_error")}
        </p>
        <Button
          variant="secondary"
          size="md"
          className="mt-3"
          onClick={() => {
            setLoadState("loading");
            setLoadNonce((nonce) => nonce + 1);
          }}
        >
          {t("common_retry")}
        </Button>
      </div>
    );
  }

  const published = snapshot?.published ?? null;
  const heroSection = state.document.sections.find(
    (section): section is HeroSection => section.type === "HERO",
  );
  const selectedSection = selectedSectionId
    ? state.document.sections.find((section) => section.id === selectedSectionId)
    : undefined;
  const selectedNonHeroSection =
    selectedSection && selectedSection.type !== "HERO" ? selectedSection : null;
  const settingsTitle = selectedSectionId === HOMEPAGE_DEFAULTS_SELECTION_ID
    ? t("homepage_builder_defaults_title")
    : selectedSectionId === ANNOUNCEMENT_SELECTION_ID
      ? t("homepage_builder_announcement_title")
      : selectedNonHeroSection
        ? selectedNonHeroSection.title?.trim() || t(sectionTypeLabelKey(selectedNonHeroSection.type))
        : heroSection?.title?.trim() || "HERO";
  return (
    <div
      data-homepage-editor-shell
      className={studioStyles.studio}
    >
      {/* Status bar */}
      <div
        data-testid="homepage-status-bar"
        className={studioStyles.statusBar}
      >
        <Badge value={t("homepage_builder_draft_badge")} tone="amber" />
        {published ? (
          <Badge value={t("homepage_builder_published_badge")} tone="green" />
        ) : null}
        {state.dirty ? (
          <span
            title={t("homepage_builder_unsaved")}
            className="h-2 w-2 rounded-full bg-admin-warning"
          />
        ) : null}

        <div className="flex min-w-0 flex-col text-xs text-ink-secondary">
          <span>
            {t("homepage_builder_last_saved", {
              time: formatTimestamp(state.lastSavedAt),
            })}
          </span>
          {snapshot?.draftUpdatedById ? (
            <span className="truncate text-ink-muted">
              {snapshot.draftUpdatedById}
            </span>
          ) : null}
        </div>
        {published ? (
          <div className="flex min-w-0 flex-col text-xs text-ink-secondary">
            <span>
              {t("homepage_builder_last_published", {
                time: formatTimestamp(published.publishAt),
              })}
            </span>
            <span className="text-ink-muted">
              {t("homepage_builder_version_label", {
                versionNo: published.versionNo,
              })}
            </span>
          </div>
        ) : null}

        {state.saveState === "saving" ? (
          <span className="text-xs text-ink-muted">
            {t("homepage_builder_saving")}
          </span>
        ) : null}
        {state.saveState === "saved" ? (
          <span className="text-xs text-ink-muted">
            {t("homepage_builder_saved")}
          </span>
        ) : null}
        {state.saveState === "error" && !state.conflict ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-sale">
            <span>{t("homepage_builder_save_failed")}</span>
            {saveError ? (
              <span className="truncate" title={saveError}>
                {saveError}
              </span>
            ) : null}
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="md" disabled={state.past.length === 0}
            onClick={() => dispatch({ type: "undo" })}>
            {t("homepage_builder_undo")}
          </Button>
          <Button variant="secondary" size="md" disabled={state.future.length === 0}
            onClick={() => dispatch({ type: "redo" })}>
            {t("homepage_builder_redo")}
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => void save()}
            disabled={state.saveState === "saving"}
          >
            {t("homepage_builder_save_draft")}
          </Button>
          <Button size="md" onClick={() => setPublishOpen(true)}>
            {t("homepage_builder_publish")}
          </Button>
          <Link
            href="/admin/homepage/versions"
            className="inline-flex h-12 items-center justify-center rounded-lg border border-cta/40 px-6 text-base font-semibold text-cta hover:bg-primary-light/40"
          >
            {t("homepage_builder_versions")}
          </Link>
        </div>
      </div>

      {/* Conflict bar */}
      {state.conflict ? (
        <div
          role="alert"
          className={`${studioStyles.conflictBar} flex flex-wrap items-center gap-3 rounded-xl border border-admin-warning bg-admin-warning-soft px-4 py-3`}
        >
          <div className="flex min-w-0 flex-col">
            <p className="text-sm font-semibold text-ink">
              {t("homepage_builder_conflict_title")}
            </p>
            <p className="text-xs text-ink-secondary">
              {t("homepage_builder_conflict_body")}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => void loadLatest()}
            >
              {t("homepage_builder_conflict_load_latest")}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => void keepMine()}
            >
              {t("homepage_builder_conflict_keep_mine")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Narrow layout: pane switcher (hidden from 1280px up) */}
      <div role="tablist" className={`${studioStyles.workspaceSwitch} flex flex-wrap gap-1`}>
        {PANES.map((pane) => (
          <button
            key={pane.id}
            role="tab"
            type="button"
            aria-selected={activePane === pane.id}
            aria-controls={`homepage-pane-${pane.id}`}
            onClick={() => setActivePane(pane.id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              activePane === pane.id
                ? "bg-cta text-white"
                : "border border-border text-ink-secondary hover:text-cta"
            }`}
          >
            {t(pane.labelKey)}
          </button>
        ))}
      </div>

      {/* Three panes: stacked switcher below 1280px, resizable settings rail above. */}
      <div
        style={{ "--homepage-settings-width": `${settingsWidth}px` } as CSSProperties}
        data-studio-columns
        className={studioStyles.columns}
      >
        <section
          id="homepage-pane-modules"
          data-pane="modules"
          aria-label={t("homepage_builder_pane_modules")}
          data-pane-active={activePane === "modules"}
          className={`${studioStyles.panel} ${activePane !== "modules" ? studioStyles.inactive : ""}`}
        >
          <div data-panel-body="modules" className={`${studioStyles.panelBody} ${studioStyles.moduleBody}`}><ModuleTree /></div>
        </section>

        <section
          id="homepage-pane-preview"
          data-pane="preview"
          aria-label={t("homepage_builder_pane_preview")}
          data-pane-active={activePane === "preview"}
          className={`${studioStyles.panel} ${activePane !== "preview" ? studioStyles.inactive : ""}`}
        >
          <div data-preview-surface className={studioStyles.previewSurface}>
            <div
              role="group"
              data-panel-head="preview"
              aria-label={t("homepage_builder_device_switch")}
              className={studioStyles.previewToolbar}
            >
              <div
                data-device-segments
                className={studioStyles.deviceSegments}
              >
                {DEVICE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={device === option.id}
                    onClick={() => setDevice(option.id)}
                    className={studioStyles.deviceSegment}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0">
                      <path d={DEVICE_ICONS[option.id]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <span data-preview-metrics className={studioStyles.previewMetrics}>
                {t("homepage_builder_preview_scale_label", { width: previewMetrics.width, scale: Math.round(previewMetrics.scale * 100) })}
              </span>
              <Button size="md" className={studioStyles.previewAction}
                disabled={previewDisabled || previewPending} aria-busy={previewPending}
                title={previewDisabled ? t("homepage_builder_preview_unconfigured") : undefined}
                onClick={() => void openPreview(device)}>
                {t("homepage_builder_preview_independent")}
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0">
                  <path d="M7 17 17 7m0 0h-7m7 0v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Button>
              {previewPending ? <span role="status" className="basis-full text-xs text-ink-secondary">{t("homepage_builder_preview_preparing")}</span> : null}
              {previewDisabled ? <span role="status" className="basis-full text-xs text-ink-secondary">{t("homepage_builder_preview_unconfigured")}</span> : null}
              {readyPreview && !state.dirty && !state.conflict && readyPreview.document === state.document && readyPreview.rev === state.rev ? (
                <span className="basis-full text-xs text-ink-secondary">
                  {t("homepage_builder_preview_ready")}{" "}
                  <a href={readyPreview.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                    className="font-semibold text-cta underline">
                    {t("homepage_builder_preview_open")} · {t(readyPreview.view === "mobile" ? "homepage_builder_device_mobile" : readyPreview.view === "tablet" ? "homepage_builder_device_tablet" : "homepage_builder_device_desktop")}
                  </a>
                </span>
              ) : null}
              {previewError ? <span role="alert" className="basis-full text-xs text-sale">{previewError}</span> : null}
              {compareCurrentAppearance && state.document.appearance === "STUDIO_V3" ? (
                <div data-appearance-comparison className="flex basis-full flex-wrap items-center gap-2 text-xs text-ink-secondary">
                  <span role="status">{t("homepage_builder_studio_comparing")}</span>
                  <button type="button" onClick={() => setCompareCurrentAppearance(false)} className="rounded-lg border border-border px-3 py-1.5 text-cta">
                    {t("homepage_builder_studio_compare_stop")}
                  </button>
                </div>
              ) : null}
            </div>
            <div
              data-preview-device={device}
              data-panel-body="preview"
              data-full-width-preview="true"
              className={studioStyles.canvasSlot}
              style={{ width: "100%" }}
            >
              <DeviceFrame
                device={device}
                flat
                scrollable
                fitAvailable
                onMetricsChange={setPreviewMetrics}
              >
                {heroSection ? (
                  <style>{heroCss(heroSection.id, heroSection.payload)}</style>
                ) : null}
                <HomepageLivePreview
                  document={state.document}
                  device={device}
                  selectedSectionId={selectedSectionId}
                  compareCurrentAppearance={compareCurrentAppearance}
                />
              </DeviceFrame>
            </div>
          </div>
        </section>

        <div
          role="separator"
          aria-label={t("homepage_builder_resize_settings")}
          aria-orientation="vertical"
          aria-valuemin={SETTINGS_WIDTH_MIN}
          aria-valuemax={SETTINGS_WIDTH_MAX}
          aria-valuenow={settingsWidth}
          data-pane-resizer="settings"
          tabIndex={0}
          className="hidden min-h-12 cursor-col-resize touch-none items-stretch justify-center rounded-full bg-border/60 outline-none transition-colors hover:bg-cta focus-visible:bg-cta min-[1280px]:flex"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSettingsWidth((value) => clampSettingsWidth(value + SETTINGS_WIDTH_STEP));
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setSettingsWidth((value) => clampSettingsWidth(value - SETTINGS_WIDTH_STEP));
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            settingsResizeStart.current = {
              clientX: event.clientX,
              width: settingsWidth,
            };
          }}
          onPointerMove={(event) => {
            const start = settingsResizeStart.current;
            if (!start) return;
            setSettingsWidth(
              clampSettingsWidth(start.width + start.clientX - event.clientX),
            );
          }}
          onPointerUp={() => {
            settingsResizeStart.current = null;
          }}
          onPointerCancel={() => {
            settingsResizeStart.current = null;
          }}
        />

        <section
          id="homepage-pane-settings"
          data-pane="settings"
          aria-label={t("homepage_builder_pane_settings")}
          data-pane-active={activePane === "settings"}
          className={`${studioStyles.panel} ${activePane !== "settings" ? studioStyles.inactive : ""}`}
        >
          <div data-panel-head="settings" className={`${studioStyles.panelHead} flex items-start justify-between gap-3`}>
            <h2 className="min-w-0 break-words text-sm font-semibold text-ink">{settingsTitle}</h2>
            <span className="shrink-0 text-xs text-ink-muted">{t(`homepage_builder_device_${device}`)}</span>
          </div>
          <div data-homepage-settings-scroll data-panel-body="settings" className={studioStyles.panelBody}>
          {selectedSectionId === HOMEPAGE_DEFAULTS_SELECTION_ID ? (
            <HomepageDefaultsPanel />
          ) : selectedSectionId === ANNOUNCEMENT_SELECTION_ID ? (
            <AnnouncementSettings />
          ) : selectedNonHeroSection ? (
            <>
              <SectionEditorPanel
                key={selectedNonHeroSection.id}
                sectionId={selectedNonHeroSection.id}
              />
              <SectionDisplaySettings />
            </>
          ) : (
            <HeroSettingsPanel />
          )}
          </div>
        </section>
      </div>

      <Dialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={t("homepage_builder_publish_title")}
      >
        <PublishPanel
          onClose={() => setPublishOpen(false)}
          onRevealSettings={() => setActivePane("settings")}
          save={saveForPublish}
          onPublished={handlePublished}
        />
      </Dialog>
    </div>
  );
}

export function HomepageEditor(): ReactNode {
  return (
    <HomepageEditorProvider>
      <HomepageEditorShell />
    </HomepageEditorProvider>
  );
}
