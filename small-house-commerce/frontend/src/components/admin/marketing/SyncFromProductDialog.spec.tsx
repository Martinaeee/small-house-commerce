import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncFromProductDialog } from "@/components/admin/marketing/SyncFromProductDialog";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { marketingApi } from "@/lib/marketing-api";
import type { LandingContent } from "@/lib/marketing-content";
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { source: vi.fn() } }));
const source: LandingContent = { schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null, blocks: [
  { id: "hero", type: "hero", sourceKey: "hero:p1", props: { title: "Saved parent", tagline: null, promoHeadline: null, promoSubtext: null } },
  { id: "buy", type: "buy", sourceKey: "buy:p1", props: {} },
] };
const current: LandingContent = { ...source, blocks: [source.blocks[1], { id: "custom", type: "custom", sourceKey: null, props: { html: "Custom copy" } }] };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(marketingApi.source).mockResolvedValue({ content: source, sourceContentHash: "latest", changed: true }); });
describe("selected source synchronization", () => {
  it("requires an explicit insertion position to restore a removed source and submits only selected keys", async () => {
    const sync = vi.fn();
    render(<AdminI18nProvider><SyncFromProductDialog pageId="page-1" content={current} busy={false} onClose={() => {}} onSync={sync} /></AdminI18nProvider>);
    const hero = await screen.findByRole("checkbox", { name: /Saved parent/ });
    fireEvent.click(hero);
    expect(screen.getByRole("button", { name: "同步所选模块" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("恢复模块的位置"), { target: { value: "buy" } });
    fireEvent.click(screen.getByRole("button", { name: "同步所选模块" }));
    await waitFor(() => expect(sync).toHaveBeenCalledWith(["hero:p1"], "buy"));
    expect(marketingApi.source).toHaveBeenCalledWith("page-1");
  });
});
