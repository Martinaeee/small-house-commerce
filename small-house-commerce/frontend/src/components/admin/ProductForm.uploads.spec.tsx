import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductForm, emptyProductFormValue } from "@/components/admin/ProductForm";
import { adminApi } from "@/lib/admin-api";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

function deferredUpload() {
  let resolve!: (result: { url: string; key: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ url: string; key: string }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function renderForm() {
  const onSubmit = vi.fn();
  const view = render(
    <AdminI18nProvider>
      <ProductForm
        initial={{
          ...emptyProductFormValue(),
          name: "Chair",
          slug: "chair",
          categoryId: "018f0000-0000-7000-8000-000000000000",
          graphTyped: false,
        }}
        categories={[]}
        onSubmit={onSubmit}
        pending={false}
        error={null}
        savedPreview={null}
      />
    </AdminI18nProvider>,
  );
  return { ...view, onSubmit };
}

function pickFiles() {
  fireEvent.change(within(screen.getByRole("heading", { name: "Shared product gallery" }).closest("section")!).getByLabelText("Choose media to upload"), {
    target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })] },
  });
}

beforeEach(() => setAdminLang("en"));
afterEach(() => vi.restoreAllMocks());

describe("ProductForm upload lifecycle", () => {
  it("saves a mixed gallery in picker order with the detected media types", async () => {
    vi.spyOn(adminApi, "uploadImage")
      .mockResolvedValueOnce({ url: "/uploads/a.jpg", key: "a" })
      .mockResolvedValueOnce({ url: "/uploads/demo.mp4", key: "demo" })
      .mockResolvedValueOnce({ url: "/uploads/clip.mov", key: "clip" });
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.click(screen.getByRole("tab", { name: "Media" }));
    fireEvent.change(within(screen.getByRole("heading", { name: "Shared product gallery" }).closest("section")!).getByLabelText(/Choose (images|media) to upload/), {
      target: { files: [
        new File(["a"], "a.jpg", { type: "image/jpeg" }),
        new File(["demo"], "demo.mp4", { type: "video/mp4" }),
        new File(["clip"], "clip.MOV", { type: "" }),
      ] },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].images).toEqual([
      { url: "/uploads/a.jpg", type: "IMAGE", altText: "", sortOrder: "0" },
      { url: "/uploads/demo.mp4", type: "VIDEO", altText: "", sortOrder: "1" },
      { url: "/uploads/clip.mov", type: "VIDEO", altText: "", sortOrder: "2" },
    ]);
  });

  it("blocks button and direct form submission until the complete batch settles", async () => {
    const first = deferredUpload();
    const second = deferredUpload();
    const upload = vi.spyOn(adminApi, "uploadImage")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    const { container, onSubmit } = renderForm();
    await user.click(screen.getByRole("tab", { name: "Media" }));
    pickFiles();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => first.resolve({ url: "/uploads/a.jpg", key: "a" }));
    await waitFor(() => expect(screen.getByText("Rows 1")).toBeInTheDocument());
    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
    await act(async () => second.resolve({ url: "/uploads/b.jpg", key: "b" }));
    await waitFor(() => expect(screen.getByText("Rows 2")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].images.map((image: { url: string }) => image.url)).toEqual([
      "/uploads/a.jpg", "/uploads/b.jpg",
    ]);
  });

  it("preserves the same task and its results across tab changes", async () => {
    const second = deferredUpload();
    const upload = vi.spyOn(adminApi, "uploadImage")
      .mockResolvedValueOnce({ url: "/uploads/a.jpg", key: "a" })
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Media" }));
    pickFiles();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("tab", { name: "Basic Info" }));
    await user.click(screen.getByRole("tab", { name: "Media" }));

    expect(within(screen.getByRole("heading", { name: "Shared product gallery" }).closest("section")!).getByLabelText("Choose media to upload")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 2/2 · b.jpg");
    await user.click(screen.getByText("View details"));
    expect(screen.getByRole("list", { name: "Media upload queue" })).toHaveTextContent("a.jpg");
    await act(async () => second.reject(new Error("deliberate failure")));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("b.jpg"));
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getByRole("alert")).toHaveTextContent("b.jpg");
    expect(screen.getByText("Rows 1")).toBeInTheDocument();
  });

  it("stops the remaining queue when the form is disposed", async () => {
    const first = deferredUpload();
    const upload = vi.spyOn(adminApi, "uploadImage")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ url: "/uploads/b.jpg", key: "b" });
    const user = userEvent.setup();
    const { unmount } = renderForm();
    await user.click(screen.getByRole("tab", { name: "Media" }));
    pickFiles();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => first.resolve({ url: "/uploads/a.jpg", key: "a" }));
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
