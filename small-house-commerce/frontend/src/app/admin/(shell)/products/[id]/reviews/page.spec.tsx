import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminProductReviewsPage from "./page";

const api = vi.hoisted(() => ({
  getProduct: vi.fn(),
  listProductReviews: vi.fn(),
  createProductReview: vi.fn(),
}));
vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "product-1" }) }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => true }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.getProduct.mockResolvedValue({ id: "product-1", name: "Folding chair" });
  api.listProductReviews.mockResolvedValue([]);
  api.createProductReview.mockResolvedValue({ id: "review-1" });
});

async function submitPhoto(photo: string) {
  render(<AdminProductReviewsPage />);
  await screen.findByRole("heading", { name: /Reviews · Folding chair/ });
  fireEvent.click(screen.getAllByRole("button", { name: "Add review" })[0]);
  const dialog = screen.getByRole("dialog", { name: "Add review" });
  fireEvent.change(within(dialog).getByLabelText("Author name"), { target: { value: "Mara" } });
  fireEvent.change(within(dialog).getByLabelText("Comment"), { target: { value: "Folds neatly after dinner." } });
  fireEvent.change(within(dialog).getByLabelText("Review photo 1 URL"), { target: { value: photo } });
  fireEvent.submit(dialog.querySelector("form")!);
  return dialog;
}

describe("review photo validation", () => {
  it.each(["/uploads/review-photo.webp", "https://cdn.example.test/review-photo.webp"])("saves a supported photo URL %s", async photo => {
    await submitPhoto(photo);
    await waitFor(() => expect(api.createProductReview).toHaveBeenCalledTimes(1));
    expect(api.createProductReview).toHaveBeenCalledWith("product-1", expect.objectContaining({ photos: [photo] }));
  });

  it.each(["//cdn.example.test/photo.webp", "javascript:alert(1)", "data:image/png;base64,AA==", "/"])("rejects unsupported photo URL %s", async photo => {
    const dialog = await submitPhoto(photo);
    expect(api.createProductReview).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Each photo must be a valid URL|Photo URLs must start with/)).toBeInTheDocument();
  });

  it("still rejects an overlong uploaded path", async () => {
    const dialog = await submitPhoto(`/uploads/${"x".repeat(2050)}`);
    expect(api.createProductReview).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Each photo URL must be at most 2,048 characters.")).toBeInTheDocument();
  });
});
