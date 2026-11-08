import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImageFormValue } from "@/components/admin/ProductForm";
import { SharedMediaWorkspace } from "./SharedMediaWorkspace";

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));

const noop = vi.fn();

function media(url: string, type: "IMAGE" | "VIDEO", sortOrder: number): ImageFormValue {
  return { url, type, altText: url, sortOrder: String(sortOrder), isScene: false };
}

function renderWorkspace(onReorder = noop) {
  return render(
    <SharedMediaWorkspace
      images={[media("/a.jpg", "IMAGE", 0), media("/b.mp4", "VIDEO", 1), media("/c.mp4", "VIDEO", 2)]}
      pending={false}
      onPatch={noop}
      onMove={noop}
      onReorder={onReorder}
      onSetCover={noop}
      onRemove={noop}
      onAdd={noop}
      onAddMedia={noop}
    />,
  );
}

describe("SharedMediaWorkspace PDP floating video", () => {
  it("badges the first shared video and lets the editor move another video into that slot", () => {
    const onReorder = vi.fn();
    renderWorkspace(onReorder);
    expect(screen.getByText("product_media_floating_hint")).toBeInTheDocument();

    const cards = screen.getAllByRole("listitem");
    // Only the first video by sort order is the floating player's source.
    expect(within(cards[1]).getByText("product_media_floating_badge")).toBeInTheDocument();
    expect(within(cards[2]).queryByText("product_media_floating_badge")).toBeNull();

    // The current source tells the operator it is already live.
    fireEvent.click(cards[1].querySelector("button")!);
    expect(screen.getByText("product_media_floating_current")).toBeInTheDocument();

    fireEvent.click(cards[2].querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: "product_media_floating_action" }));
    expect(onReorder).toHaveBeenCalledWith(2, 1);
  });

  it("explains how to enable the player when the gallery holds no video", () => {
    render(
      <SharedMediaWorkspace
        images={[media("/a.jpg", "IMAGE", 0)]}
        pending={false}
        onPatch={noop}
        onMove={noop}
        onReorder={noop}
        onSetCover={noop}
        onRemove={noop}
        onAdd={noop}
        onAddMedia={noop}
      />,
    );
    expect(screen.getByText("product_media_floating_empty")).toBeInTheDocument();
  });
});
