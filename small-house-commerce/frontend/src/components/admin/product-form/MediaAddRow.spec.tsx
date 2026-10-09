import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";

const uploadImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { uploadImage } }));

function file(name: string, type = "image/jpeg", size = 1024): File {
  const result = new File(["media"], name, { type });
  Object.defineProperty(result, "size", { value: size });
  return result;
}

function renderRow(onAddMedia = vi.fn()) {
  const view = render(<AdminI18nProvider><MediaAddRow onAddMedia={onAddMedia} /></AdminI18nProvider>);
  return { ...view, onAddMedia };
}

beforeEach(() => {
  setAdminLang("en");
  uploadImage.mockReset();
});

describe("MediaAddRow", () => {
  it("accepts JPEG filenames with no MIME and advertises extension-based video picking", async () => {
    const { onAddMedia } = renderRow();
    uploadImage.mockResolvedValueOnce({ url: "/uploads/photo.jpeg" });
    const input = screen.getByLabelText("Choose media to upload");
    fireEvent.change(input, { target: { files: [file("photo.JPEG", "")] } });
    await waitFor(() => expect(onAddMedia).toHaveBeenCalledWith({ url: "/uploads/photo.jpeg", type: "IMAGE" }));
    expect(input.getAttribute("accept")).toContain(".mov");
  });

  it("collapses completed filenames behind a dismissible receipt", async () => {
    const user = userEvent.setup();
    uploadImage.mockResolvedValueOnce({ url: "/uploads/a.jpg" }).mockResolvedValueOnce({ url: "/uploads/b.jpg" });
    const { onAddMedia } = renderRow();
    fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [file("a.jpg"), file("b.jpg")] } });
    await waitFor(() => expect(onAddMedia).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("Added 2 items");
    expect(screen.queryByRole("list", { name: "Media upload queue" })).not.toBeInTheDocument();
    await user.click(screen.getByText("View details"));
    expect(screen.getByRole("list", { name: "Media upload queue" })).toHaveTextContent("a.jpg");
    expect(screen.getByRole("list", { name: "Media upload queue" })).toHaveTextContent("b.jpg");
    await user.click(screen.getByRole("button", { name: "Dismiss upload receipt" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onAddMedia).toHaveBeenCalledTimes(2);
  });

  it("adds the URL on Enter instead of submitting the surrounding product form", async () => {
    const onAddMedia = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    const user = userEvent.setup();
    render(<form onSubmit={onSubmit}><AdminI18nProvider><MediaAddRow onAddMedia={onAddMedia} /></AdminI18nProvider><button type="submit">Save product</button></form>);
    await user.type(screen.getByLabelText("Media URL to add"), "https://cdn.example.com/enter.jpg");
    await user.keyboard("{Enter}");
    expect(onAddMedia).toHaveBeenCalledWith({ url: "https://cdn.example.com/enter.jpg", type: "IMAGE" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Media URL to add")).toHaveValue("");
  });

  it("shows per-file progress only when details are requested", async () => {
    let finishFirst!: (result: { url: string }) => void;
    let finishSecond!: (result: { url: string }) => void;
    uploadImage.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; })).mockReturnValueOnce(new Promise((resolve) => { finishSecond = resolve; }));
    renderRow();
    fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [file("a.jpg"), file("b.jpg")] } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading 1/2 · a.jpg"));
    expect(screen.queryByRole("list", { name: "Media upload queue" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("View details"));
    const rows = within(screen.getByRole("list", { name: "Media upload queue" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("a.jpg");
    expect(rows[0]).toHaveTextContent("Uploading");
    expect(rows[1]).toHaveTextContent("b.jpg");
    expect(rows[1]).toHaveTextContent("Waiting");
    await act(async () => finishFirst({ url: "/uploads/a.jpg" }));
    await waitFor(() => expect(rows[0]).toHaveTextContent("Uploaded"));
    expect(rows[1]).toHaveTextContent("Uploading");
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 2/2 · b.jpg");
    await act(async () => finishSecond({ url: "/uploads/b.jpg" }));
    await waitFor(() => expect(rows[1]).toHaveTextContent("Uploaded"));
  });

  it("uploads mixed files in picker order with per-kind limits and MIME fallback", async () => {
    uploadImage.mockResolvedValueOnce({ url: "/uploads/a.jpg" }).mockResolvedValueOnce({ url: "/uploads/b.mp4" }).mockResolvedValueOnce({ url: "/uploads/c.mov" }).mockResolvedValueOnce({ url: "/uploads/d.webp" });
    const { onAddMedia } = renderRow();
    fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [
      file("a.jpg"), file("huge.jpg", "image/jpeg", 5 * 1024 * 1024 + 1),
      file("b.mp4", "video/mp4", 100 * 1024 * 1024), file("notes.txt", "text/plain"),
      file("huge.mp4", "video/mp4", 100 * 1024 * 1024 + 1), file("c.MOV", ""), file("d.webp", "image/webp"),
    ] } });
    await waitFor(() => expect(onAddMedia).toHaveBeenCalledTimes(4));
    expect(onAddMedia.mock.calls.map((call) => call[0])).toEqual([
      { url: "/uploads/a.jpg", type: "IMAGE" }, { url: "/uploads/b.mp4", type: "VIDEO" },
      { url: "/uploads/c.mov", type: "VIDEO" }, { url: "/uploads/d.webp", type: "IMAGE" },
    ]);
    expect(uploadImage.mock.calls.map((call) => call[1])).toEqual(["image/jpeg", "video/mp4", "video/quicktime", "image/webp"]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("huge.jpg: Images must be 5MB or smaller");
    expect(alert).toHaveTextContent("huge.mp4: Videos must be 100MB or smaller");
    expect(alert).toHaveTextContent("notes.txt");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("Added 4 items, 3 failed");
  });

  it("reports one failed file without repeating successes and continues", async () => {
    uploadImage.mockResolvedValueOnce({ url: "/uploads/ok-1.jpg" }).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ url: "/uploads/ok-2.jpg" });
    const { onAddMedia } = renderRow();
    fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [file("ok-1.jpg"), file("bad.jpg"), file("ok-2.jpg")] } });
    await waitFor(() => expect(onAddMedia).toHaveBeenCalledTimes(2));
    expect(onAddMedia.mock.calls.map((call) => call[0])).toEqual([{ url: "/uploads/ok-1.jpg", type: "IMAGE" }, { url: "/uploads/ok-2.jpg", type: "IMAGE" }]);
    expect(screen.getByRole("alert")).toHaveTextContent("bad.jpg");
    expect(screen.queryByText("ok-1.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("ok-2.jpg")).not.toBeInTheDocument();
  });

  it("rejects an oversized file without calling the upload endpoint", async () => {
    const { onAddMedia } = renderRow();
    fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [file("huge.jpg", "image/jpeg", 6 * 1024 * 1024)] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("huge.jpg");
    expect(uploadImage).not.toHaveBeenCalled();
    expect(onAddMedia).not.toHaveBeenCalled();
  });

  it("adds a pasted video URL with its selected type and clears the draft", async () => {
    const { onAddMedia } = renderRow();
    await userEvent.selectOptions(screen.getByLabelText("New media type"), "VIDEO");
    const urlInput = screen.getByLabelText("Media URL to add");
    fireEvent.change(urlInput, { target: { value: "https://cdn.example.com/x.mp4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));
    expect(onAddMedia).toHaveBeenCalledWith({ url: "https://cdn.example.com/x.mp4", type: "VIDEO" });
    expect(urlInput).toHaveValue("");
  });

  it("disables both add paths while editing is pending", () => {
    render(<AdminI18nProvider><MediaAddRow disabled onAddMedia={vi.fn()} /></AdminI18nProvider>);
    expect(screen.getByRole("button", { name: "Upload images / videos (multiple)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add URL" })).toBeDisabled();
    expect(screen.getByLabelText("Choose media to upload")).toBeDisabled();
  });
});
