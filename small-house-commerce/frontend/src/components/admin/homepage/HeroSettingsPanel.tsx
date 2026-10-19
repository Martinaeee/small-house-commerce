"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { HeroElementKey } from "@/lib/homepage-document";
import { useHomepageEditor } from "./HomepageEditor";
import { SectionDisplaySettings } from "./SectionDisplaySettings";
import { HeroStyleSettings } from "./HeroStyleSettings";
import { HeroMediaSettings } from "./HeroMediaSettings";
import { SettingsPanel } from "./SettingsPanel";
import styles from "./HomepageStudio.module.css";

const ELEMENT_LABELS: Record<HeroElementKey, TKey> = {
  eyebrow: "homepage_builder_element_eyebrow",
  heading: "homepage_builder_element_heading",
  subheading: "homepage_builder_element_subheading",
  offer: "homepage_builder_element_offer",
  countdown: "homepage_builder_element_countdown",
  ctaPrimary: "homepage_builder_element_ctaPrimary",
  ctaSecondary: "homepage_builder_element_ctaSecondary",
};
const GROUPS = ["layout", "text", "buttons", "media", "overlay", "behavior", "advanced"] as const;
type SettingsGroup = (typeof GROUPS)[number];
const SHORTCUTS = ["layout", "text", "buttons", "media"] as const;
const GROUP_LABELS: Record<SettingsGroup, TKey> = {
  layout: "homepage_builder_studio_layout",
  text: "homepage_builder_studio_text",
  buttons: "homepage_builder_studio_buttons",
  media: "homepage_builder_studio_media",
  overlay: "homepage_builder_studio_overlay",
  behavior: "homepage_builder_studio_behavior",
  advanced: "homepage_builder_studio_advanced",
};
const SHORTCUT_ICONS = {
  layout: "M3 3h18v18H3zM9 3v18M3 9h18",
  text: "M5 5h14M12 5v14M8 19h8",
  buttons: "M10 14l4-4M9 7l2-2a4 4 0 0 1 6 6l-2 2M15 17l-2 2a4 4 0 0 1-6-6l2-2",
  media: "M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M16 7h1",
};
const TEXT_ELEMENTS: HeroElementKey[] = ["eyebrow", "heading", "subheading", "offer", "countdown"];
const BUTTON_ELEMENTS: HeroElementKey[] = ["ctaPrimary", "ctaSecondary"];

export function HeroSettingsPanel(): ReactNode {
  const { t } = useAdminI18n();
  const { state, device, selectedSlideId, selectedElementKey } = useHomepageEditor();
  const [textChoice, setTextChoice] = useState<{ key: HeroElementKey; selection: HeroElementKey | null }>({ key: "heading", selection: null });
  const textElement = textChoice.selection === selectedElementKey ? textChoice.key
    : selectedElementKey && TEXT_ELEMENTS.includes(selectedElementKey) ? selectedElementKey : "heading";
  const root = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const hero = state.document.sections.find((section) => section.type === "HERO");
  const slide = hero?.type === "HERO"
    ? hero.payload.slides.find((item) => item.id === selectedSlideId) ?? hero.payload.slides[0]
    : undefined;
  const deviceLabels: Record<typeof device, TKey> = {
    desktop: "homepage_builder_device_desktop",
    tablet: "homepage_builder_device_tablet",
    mobile: "homepage_builder_device_mobile",
  };

  const reveal = useCallback((group: SettingsGroup, element?: HeroElementKey): void => {
    const details = root.current?.querySelector<HTMLDetailsElement>(`[data-settings-group="${group}"]`);
    if (!details) return;
    details.open = true;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const container = root.current?.closest<HTMLElement>("[data-homepage-settings-scroll]");
      const target = element ? details.querySelector<HTMLElement>(`[data-hero-element="${element}"]`) : details;
      if (!container || !target) return;
      const headerHeight = root.current?.querySelector("header")?.getBoundingClientRect().height ?? 0;
      const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - headerHeight - 16;
      container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    const layout = root.current?.querySelector<HTMLDetailsElement>('[data-settings-group="layout"]');
    if (layout) layout.open = true;
    return () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, []);

  useEffect(() => {
    if (selectedElementKey) {
      reveal(BUTTON_ELEMENTS.includes(selectedElementKey) ? "buttons" : "text", selectedElementKey);
    } else if (selectedSlideId) {
      reveal("media");
    }
  }, [selectedElementKey, selectedSlideId, device, reveal]);

  const elements = (keys: HeroElementKey[]): ReactNode => keys.map((elementKey) => (
    <fieldset key={elementKey} data-hero-element={elementKey}
      hidden={TEXT_ELEMENTS.includes(elementKey) && textElement !== elementKey}
      className={styles.elementSettings}>
      <legend>{t(ELEMENT_LABELS[elementKey])}</legend>
      <SettingsPanel elementKey={elementKey} embedded />
    </fieldset>
  ));

  return <div ref={root} data-panel="hero-settings" className={styles.heroSettings}>
    <header className={styles.settingsHeader}>
      <div className={styles.settingsHeading}>
        <h2>{t("homepage_builder_studio_hero")}</h2>
        <span>{t(deviceLabels[device])}</span>
      </div>
      <p data-hero-settings-context>{slide?.name}{selectedElementKey ? ` · ${t(ELEMENT_LABELS[selectedElementKey])}` : ""} · {t(deviceLabels[device])}</p>
      <nav aria-label={t("homepage_builder_studio_shortcuts")} className={styles.settingsShortcuts}>
        {SHORTCUTS.map((group) => <button key={group} type="button" onClick={() => reveal(group)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={SHORTCUT_ICONS[group]} /></svg>
          {t(GROUP_LABELS[group])}
        </button>)}
      </nav>
    </header>
    <p className={styles.settingsScope}>{t("homepage_builder_studio_scope_note")}</p>
    {GROUPS.map((group) => <details key={group} data-settings-group={group} className={styles.settingsGroup}>
      <summary>{t(GROUP_LABELS[group])}</summary>
      <div className={styles.settingsGroupBody}>
        {group === "layout" ? <>
          <SectionDisplaySettings view="layout" />
          <HeroMediaSettings embedded view="display" />
        </> : group === "text" ? <>
          <div role="group" aria-label={t("homepage_builder_studio_text_elements")} className={styles.elementPicker}>
            {TEXT_ELEMENTS.map(key => <button key={key} type="button" aria-pressed={textElement === key}
              onClick={() => setTextChoice({ key, selection: selectedElementKey })}>{t(ELEMENT_LABELS[key])}</button>)}
          </div>
          {elements(TEXT_ELEMENTS)}
        </> : group === "buttons" ? elements(BUTTON_ELEMENTS)
          : group === "media" ? <HeroMediaSettings embedded view="media" />
            : group === "overlay" ? <HeroStyleSettings embedded group="overlay" />
              : group === "behavior" ? <HeroStyleSettings embedded group="behavior" />
                : <SectionDisplaySettings view="spacing" />}
      </div>
    </details>)}
  </div>;
}
