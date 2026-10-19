import type { ReactNode } from "react";
import type { HomepageAppearance as Appearance, HomepageDevice } from "@/lib/homepage-document";
import styles from "./HomepageAppearance.module.css";

export function HomepageAppearance({ appearance, previewDevice, children }: {
  appearance?: Appearance;
  previewDevice?: HomepageDevice;
  children: ReactNode;
}) {
  if (appearance !== "STUDIO_V3") return <>{children}</>;
  return <div className={styles.root} data-homepage-appearance="STUDIO_V3" data-homepage-device={previewDevice}>{children}</div>;
}
