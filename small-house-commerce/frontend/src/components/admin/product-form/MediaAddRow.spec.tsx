import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("adds the URL on Enter instead of submitting the surrounding product form", async () => {
    const onAddImageUrl = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <AdminI18nProvider><MediaAddRow onAddImageUrl={onAddImageUrl} /></AdminI18nProvider>
        <button type="submit">Save product</button>
      </form>,
    );
    await user.type(screen.getByLabelText("Image URL to add"), "https://cdn.example.com/enter.jpg");
    await user.keyboard("{Enter}");
    expect(onAddImageUrl).toHaveBeenCalledWith("https://cdn.example.com/enter.jpg");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Image URL to add")).toHaveValue("");
  });

  it("shows each file's waiting, uploading and uploaded states", async () => {
    let finishFirst!: (result: { url: string }) => void;
    let finishSecond!: (result: { url: string }) => void;
    uploadImage
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { finishSecond = resolve; }));
    renderRow();
    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [file("a.jpg"), file("b.jpg")] },
    });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    const queue = screen.getByRole("list", { name: "Photo upload queue" });
    const rows = within(queue).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("a.jpg");
    expect(rows[0]).toHaveTextContent("Uploading");
    expect(rows[1]).toHaveTextContent("b.jpg");
    expect(rows[1]).toHaveTextContent("Waiting");
    await act(async () => finishFirst({ url: "/uploads/a.jpg" }));
    await waitFor(() => expect(rows[0]).toHaveTextContent("Uploaded"));
    expect(rows[1]).toHaveTextContent("Uploading");
    await act(async () => finishSecond({ url: "/uploads/b.jpg" }));
    await waitFor(() => expect(rows[1]).toHaveTextContent("Uploaded"));
  });

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

  it("keeps valid files in order around wrong-type and oversized files", async () => {
    uploadImage
      .mockResolvedValueOnce({ url: "/uploads/a.jpg" })
      .mockResolvedValueOnce({ url: "/uploads/b.png" })
      .mockResolvedValueOnce({ url: "/uploads/c.webp" });
    const { onAddImageUrl } = renderRow();
    fireEvent.change(screen.getByLabelText("Choose images to upload"), {
      target: { files: [
        file("a.jpg"),
        file("notes.txt", "text/plain"),
        file("huge.jpg", "image/jpeg", 6 * 1024 * 1024),
        file("b.png", ""),
        file("c.webp", "image/webp"),
      ] },
    });
    await waitFor(() => expect(onAddImageUrl).toHaveBeenCalledTimes(3));
    expect(onAddImageUrl.mock.calls.map((call) => call[0])).toEqual([
      "/uploads/a.jpg", "/uploads/b.png", "/uploads/c.webp",
    ]);
    expect(uploadImage.mock.calls.map((call) => call[1])).toEqual([
      "image/jpeg", "image/png", "image/webp",
    ]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("notes.txt");
    expect(alert).toHaveTextContent("huge.jpg");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(2);
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
