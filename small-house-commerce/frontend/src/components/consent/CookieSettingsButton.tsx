"use client";

import { openConsentSettings } from "@/lib/consent";

/** Footer / privacy-page control that reopens the consent bar. */
export function CookieSettingsButton({
  className,
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openConsentSettings()}
      className={className}
    >
      Cookie Settings
    </button>
  );
}
