import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";

const uploadImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { uploadImage } }));

function file(name: string, type = "image/jpeg", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function renderRow(onAddImageUrl = vi.fn()) {
  const view = render(
    <AdminI18nProvider>
      <MediaAddRow onAddImageUrl={onAddImageUrl} />
    </AdminI18nProvider>,
  );
  return { ...view, onAddImageUrl };
}

beforeEach(() => {
  setAdminLang("en");
  uploadImage.mockReset();
});

describe("MediaAddRow", () => {
  it("uploads several files in picker order and appends each URL", async () => {
    uploadImage
      .mockResolvedValueOnce({ url: "/uploads/a.jpg" })
      .mockResolvedValueOnce({ url: "/uploads/b.jpg" })
      .mockResolvedValueOnce({ url: "/uploads/c.jpg" });
    const { onAddImageUrl } = renderRow();

    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [file("a.jpg"), file("b.jpg"), file("c.jpg")] },
    });

    await waitFor(() => expect(onAddImageUrl).toHaveBeenCalledTimes(3));
    expect(uploadImage).toHaveBeenNthCalledWith(1, expect.any(File), "image/jpeg");
    expect(onAddImageUrl.mock.calls.map((call) => call[0])).toEqual([
      "/uploads/a.jpg",
      "/uploads/b.jpg",
      "/uploads/c.jpg",
    ]);
  });

  it("reports one failed file and still appends the others", async () => {
    uploadImage
      .mockResolvedValueOnce({ url: "/uploads/ok-1.jpg" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ url: "/uploads/ok-2.jpg" });
    const { onAddImageUrl } = renderRow();

    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [file("ok-1.jpg"), file("bad.jpg"), file("ok-2.jpg")] },
    });

    await waitFor(() => expect(onAddImageUrl).toHaveBeenCalledTimes(2));
    expect(onAddImageUrl.mock.calls.map((call) => call[0])).toEqual([
      "/uploads/ok-1.jpg",
      "/uploads/ok-2.jpg",
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("bad.jpg");
  });

  it("rejects an oversized file without calling the upload endpoint", async () => {
    const { onAddImageUrl } = renderRow();

    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [file("huge.jpg", "image/jpeg", 6 * 1024 * 1024)] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("huge.jpg");
    expect(uploadImage).not.toHaveBeenCalled();
    expect(onAddImageUrl).not.toHaveBeenCalled();
  });

  it("adds a pasted image URL and clears the draft", () => {
    const { onAddImageUrl } = renderRow();

    const urlInput = screen.getByLabelText("Image URL to add");
    fireEvent.change(urlInput, {
      target: { value: "https://cdn.example.com/x.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));

    expect(onAddImageUrl).toHaveBeenCalledWith("https://cdn.example.com/x.jpg");
    expect(urlInput).toHaveValue("");
  });

  it("disables both add paths while editing is pending", () => {
    render(
      <AdminI18nProvider>
        <MediaAddRow disabled onAddImageUrl={vi.fn()} />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Upload photos" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add URL" })).toBeDisabled();
    expect(screen.getByLabelText("Choose images to upload")).toBeDisabled();
  });
});
