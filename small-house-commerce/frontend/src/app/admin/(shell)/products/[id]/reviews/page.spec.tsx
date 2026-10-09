import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminReview } from "@/lib/admin-api";
import AdminProductReviewsPage from "./page";

const api = vi.hoisted(() => ({
  getProduct: vi.fn(),
  listProductReviews: vi.fn(),
  createProductReview: vi.fn(),
  updateReview: vi.fn(),
  uploadImage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "product-1" }),
}));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => true }),
}));
vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
vi.mock("./batch-reviews-grid-dialog", () => ({
  BatchReviewsGridDialog: () => null,
}));

const review: AdminReview = {
  id: "review-1",
  productId: "product-1",
  source: "ADMIN",
  authorName: "Reviewer",
  location: null,
  rating: 5,
  title: null,
  comment: "A useful storage cart.",
  variant: null,
  photos: ["/uploads/catalog/2026/review-1.jpg", "/uploads/catalog/2026/review-2.jpg"],
  isVisible: true,
  verifiedOrderItemId: null,
  createdAt: "2026-01-01T00:00:15.000Z",
  updatedAt: "2026-01-01T00:00:15.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getProduct.mockResolvedValue({ id: "product-1", name: "Storage Cart" });
  api.listProductReviews.mockResolvedValue([review]);
  api.createProductReview.mockResolvedValue(review);
  api.updateReview.mockResolvedValue(review);
  api.uploadImage.mockResolvedValue({ url: "/uploads/catalog/2026/new-review.jpg" });
});

describe("review photo validation", () => {
  it("saves an edited review with existing uploaded photos unchanged", async () => {
    const user = userEvent.setup();
    render(<AdminProductReviewsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Comment"));
    await user.type(screen.getByLabelText("Comment"), "Updated review comment.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateReview).toHaveBeenCalledWith(
      review.id,
      expect.objectContaining({ comment: "Updated review comment.", photos: review.photos }),
    ));
    expect(api.updateReview.mock.calls[0][1]).not.toHaveProperty("createdAt");
    expect(screen.queryByRole("dialog", { name: "Edit review" })).not.toBeInTheDocument();
  });

  it("creates a review after uploading a photo that returns a site-relative path", async () => {
    const user = userEvent.setup();
    const { container } = render(<AdminProductReviewsPage />);
    await user.click(await screen.findByRole("button", { name: "Add review" }));
    await user.type(screen.getByLabelText("Author name"), "New reviewer");
    await user.type(screen.getByLabelText("Comment"), "Works well in my kitchen.");
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(["photo"], "review.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByLabelText("Review photo 1 URL"))
      .toHaveValue("/uploads/catalog/2026/new-review.jpg"));
    await user.click(within(screen.getByRole("dialog", { name: "Add review" }))
      .getByRole("button", { name: "Add review" }));

    await waitFor(() => expect(api.createProductReview).toHaveBeenCalledWith(
      "product-1",
      expect.objectContaining({ photos: ["/uploads/catalog/2026/new-review.jpg"] }),
    ));
  });

  it.each(["https://example.com/review.jpg", "http://example.com/review.jpg", ""])(
    "continues to allow an external photo URL or an empty photo row: %s",
    async (photo) => {
      api.listProductReviews.mockResolvedValue([{ ...review, photos: [photo] }]);
      const user = userEvent.setup();
      render(<AdminProductReviewsPage />);
      await user.click(await screen.findByRole("button", { name: "Edit" }));
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(api.updateReview).toHaveBeenCalledWith(
        review.id,
        expect.objectContaining({ photos: photo ? [photo] : [] }),
      ));
    },
  );

  it.each(["//example.com/review.jpg", "/", "not-a-url", "javascript:alert(1)", "data:image/png;base64,abc"])(
    "rejects an invalid photo without submitting: %s",
    async (photo) => {
      api.listProductReviews.mockResolvedValue([{ ...review, photos: [photo] }]);
      const user = userEvent.setup();
      render(<AdminProductReviewsPage />);
      await user.click(await screen.findByRole("button", { name: "Edit" }));
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(screen.getByRole("alert")).toHaveTextContent(/photo.*(valid URL|http:\/\/)/i);
      expect(api.updateReview).not.toHaveBeenCalled();
    },
  );

  it("continues to reject uploaded photo paths over 2,048 characters", async () => {
    api.listProductReviews.mockResolvedValue([{ ...review, photos: [`/uploads/${"a".repeat(2048)}`] }]);
    const user = userEvent.setup();
    render(<AdminProductReviewsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert")).toHaveTextContent("at most 2,048 characters");
    expect(api.updateReview).not.toHaveBeenCalled();
  });
});
