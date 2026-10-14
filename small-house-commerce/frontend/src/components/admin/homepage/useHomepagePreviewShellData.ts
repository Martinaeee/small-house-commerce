"use client";

import { useEffect, useState } from "react";

import {
  FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA,
  loadHomepagePreviewShellData,
  type HomepagePreviewShellData,
} from "@/lib/homepage-preview-shell-data";

type HomepagePreviewShellState = HomepagePreviewShellData & {
  loading: boolean;
};

const INITIAL_STATE: HomepagePreviewShellState = {
  ...FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA,
  degraded: false,
  loading: true,
};

let clientRequest: Promise<HomepagePreviewShellData> | null = null;

function clientShellData(): Promise<HomepagePreviewShellData> {
  clientRequest ??= loadHomepagePreviewShellData();
  return clientRequest;
}

export function resetHomepagePreviewShellDataCacheForTests(): void {
  clientRequest = null;
}

export function useHomepagePreviewShellData(): HomepagePreviewShellState {
  const [state, setState] = useState<HomepagePreviewShellState>(INITIAL_STATE);

  useEffect(() => {
    let active = true;
    void clientShellData().then((data) => {
      if (active) setState({ ...data, loading: false });
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
