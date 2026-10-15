import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminApi } from "@/lib/admin-api";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { MediaAddRow } from "./MediaAddRow";
import { useMediaBatchUpload, type UploadedMedia } from "./useMediaBatchUpload";

function Harness({ available }: { available: boolean }) {
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const batch = useMediaBatchUpload({ isTargetAvailable: () => available });
  return <><MediaAddRow targetKey="value:red" batchUpload={batch} onAddMedia={(row) => setMedia((previous) => [...previous, row])} /><output data-testid="media">{JSON.stringify(media)}</output></>;
}
function ScopedHarness({ uploader, onUploadingChange }: { uploader: (file: File, contentType: string) => Promise<{ url: string }>; onUploadingChange?: (pending: boolean) => void }) {
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const batch = useMediaBatchUpload({ uploader, onUploadingChange });
  return <><MediaAddRow targetKey="page:gallery" batchUpload={batch} onAddMedia={item => setMedia(previous => [...previous, item])} /><output data-testid="media">{JSON.stringify(media)}</output></>;
}

it("uses the scoped uploader with the same resolved MIME policy instead of product management", async () => {
  setAdminLang("en");
  const productUpload = vi.spyOn(adminApi, "uploadImage").mockResolvedValue({ url: "/uploads/product.jpg", key: "product" });
  const uploader = vi.fn().mockResolvedValue({ url: "/uploads/marketing.jpg" });
  render(<AdminI18nProvider><ScopedHarness uploader={uploader} /></AdminI18nProvider>);
  const file = new File(["a"], "a.jpg", { type: "" });
  fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId("media")).toHaveTextContent('/uploads/marketing.jpg'));
  expect(uploader).toHaveBeenCalledWith(file, "image/jpeg");
  expect(productUpload).not.toHaveBeenCalled();
});

it("reports pending synchronously and releases it even when the original canvas unmounts", async () => {
  setAdminLang("en");
  let finish!: (value: { url: string; key: string }) => void;
  const uploader = vi.fn(() => new Promise<{ url: string; key: string }>(resolve => { finish = resolve; }));
  const notify = vi.fn();
  vi.spyOn(adminApi, "uploadImage").mockImplementation(uploader);
  const view = render(<AdminI18nProvider><ScopedHarness uploader={uploader} onUploadingChange={notify} /></AdminI18nProvider>);
  fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" })] } });
  expect(notify.mock.calls).toEqual([[true]]);
  await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => finish({ url: "/uploads/late.jpg", key: "late" }));
  expect(notify.mock.calls).toEqual([[true], [false]]);
});

beforeEach(() => setAdminLang("en"));
afterEach(() => vi.restoreAllMocks());

it("does not append or continue uploading after the original target disappears", async () => {
  let finish!: (value: { url: string; key: string }) => void;
  const upload = vi.spyOn(adminApi, "uploadImage")
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue({ url: "/uploads/b.jpg", key: "b" });
  const view = render(<AdminI18nProvider><Harness available /></AdminI18nProvider>);
  fireEvent.change(screen.getByLabelText("Choose media to upload"), { target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  view.rerender(<AdminI18nProvider><Harness available={false} /></AdminI18nProvider>);
  await act(async () => finish({ url: "/uploads/a.jpg", key: "a" }));
  expect(screen.getByTestId("media")).toHaveTextContent("[]");
  expect(screen.getByRole("alert")).toHaveTextContent("Upload target no longer exists");
  expect(screen.getByRole("alert")).toHaveTextContent("a.jpg");
  expect(screen.getByRole("alert")).toHaveTextContent("b.jpg");
  expect(upload).toHaveBeenCalledTimes(1);
});
