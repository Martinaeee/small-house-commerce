"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput, Textarea } from "@/components/admin/Field";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { BatchReviewsGridDialog } from "./batch-reviews-grid-dialog";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  type AdminProduct,
  type AdminReview,
  type CreateAdminReviewInput,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

/**
 * Admin per-product review management (/admin/products/:id/reviews).
 * Backend: GET/POST /admin/products/:id/reviews, PATCH/DELETE /admin/reviews/:id
 * (all PRODUCT_MANAGE). Cold-start reviews are admin-authored; hidden reviews
 * stay out of the storefront aggregates.
 */

type FormState = {
  authorName: string;
  location: string;
  rating: number;
  title: string;
  comment: string;
  photos: string[];
  isVisible: boolean;
};

type FormErrors = Partial<Record<keyof FormState | "photos" | "form", string>>;

const EMPTY_FORM: FormState = {
  authorName: "",
  location: "",
  rating: 5,
  title: "",
  comment: "",
  photos: [""],
  isVisible: true,
};

function reviewToForm(review: AdminReview): FormState {
  return {
    authorName: review.authorName,
    location: review.location ?? "",
    rating: review.rating,
    title: review.title ?? "",
    comment: review.comment,
    // Always keep one editable row, even for a review with zero photos.
    photos: review.photos.length > 0 ? [...review.photos] : [""],
    isVisible: review.isVisible,
  };
}

// Client mirror of createAdminReviewSchema (review.dto.ts).
function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const authorName = form.authorName.trim();
  const location = form.location.trim();
  const title = form.title.trim();
  const comment = form.comment.trim();
  const photos = form.photos.map((p) => p.trim()).filter(Boolean);

  if (authorName.length < 1) errors.authorName = "Author name is required.";
  else if (authorName.length > 120) errors.authorName = "Maximum 120 characters.";
  if (location.length > 120) errors.location = "Maximum 120 characters.";
  if (title.length > 200) errors.title = "Maximum 200 characters.";
  if (comment.length < 1) errors.comment = "Comment is required.";
  else if (comment.length > 5000) errors.comment = "Maximum 5,000 characters.";
  if (photos.length > 6) errors.photos = "Up to 6 photos.";
  for (const photo of photos) {
    if (photo.length > 2048) {
      errors.photos = "Each photo URL must be at most 2,048 characters.";
      break;
    }
    try {
      const url = new URL(photo);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.photos = "Photo URLs must start with http:// or https://.";
        break;
      }
    } catch {
      errors.photos = "Each photo must be a valid URL.";
      break;
    }
  }
  return errors;
}

function ProductReviewsContent({ productId }: { productId: string }) {
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [reviews, setReviews] = useState<AdminReview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    // Fresh mount per product id (key on the wrapper), so no reset needed.
    Promise.allSettled([
      adminApi.getProduct(productId),
      adminApi.listProductReviews(productId),
    ]).then(([productResult, reviewsResult]) => {
      if (!active) return;
      if (productResult.status === "fulfilled") {
        setProduct(productResult.value);
        setLoadError(null);
      } else {
        if (errorStatus(productResult.reason) === 404) {
          setNotFound(true);
        } else {
          setLoadError(
            productResult.reason instanceof Error
              ? productResult.reason.message
              : "Failed to load product.",
          );
        }
      }
      if (reviewsResult.status === "fulfilled") {
        setReviews(reviewsResult.value);
      } else if (errorStatus(reviewsResult.reason) !== 404) {
        // A 403 ("Missing required permission") on either call is the
        // RBAC message the page surfaces verbatim.
        setLoadError((prev) =>
          prev ??
            (reviewsResult.reason instanceof Error
              ? reviewsResult.reason.message
              : "Failed to load reviews."),
        );
      }
    });
    return () => {
      active = false;
    };
  }, [productId, nonce]);

  // --- create/edit dialog ----------------------------------------------------

  const [editing, setEditing] = useState<AdminReview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((review: AdminReview) => {
    setEditing(review);
    setForm(reviewToForm(review));
    setErrors({});
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    if (pending) return;
    setDialogOpen(false);
  }, [pending]);

  const patchForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const setPhoto = useCallback((index: number, value: string) => {
    setForm((prev) => ({
      ...prev,
      photos: prev.photos.map((photo, i) => (i === index ? value : photo)),
    }));
  }, []);

  const addPhotoRow = useCallback(() => {
    setForm((prev) =>
      prev.photos.length >= 6 ? prev : { ...prev, photos: [...prev.photos, ""] },
    );
  }, []);

  const removePhotoRow = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      photos:
        prev.photos.length > 1
          ? prev.photos.filter((_, i) => i !== index)
          : [""],
    }));
  }, []);

  const submitForm = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const validation = validate(form);
      if (Object.keys(validation).length > 0) {
        setErrors(validation);
        return;
      }
      const payload: CreateAdminReviewInput = {
        authorName: form.authorName.trim(),
        location: form.location.trim() || undefined,
        rating: form.rating,
        title: form.title.trim() || undefined,
        comment: form.comment.trim(),
        photos: form.photos.map((p) => p.trim()).filter(Boolean),
        isVisible: form.isVisible,
      };
      setPending(true);
      setErrors({});
      try {
        if (editing) {
          // Edit sends the full content set; "" optional text clears (null).
          await adminApi.updateReview(editing.id, {
            ...payload,
            location: form.location.trim() || null,
            title: form.title.trim() || null,
          });
        } else {
          await adminApi.createProductReview(productId, payload);
        }
        setDialogOpen(false);
        setNonce((n) => n + 1);
      } catch (err) {
        setErrors({
          form: err instanceof Error ? err.message : "Could not save review.",
        });
      } finally {
        setPending(false);
      }
    },
    [editing, form, productId],
  );

  // --- visibility toggle + delete -------------------------------------------

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminReview | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const closeDelete = useCallback(() => {
    if (deletePending) return;
    setDeleteTarget(null);
  }, [deletePending]);

  const toggleVisible = useCallback(
    async (review: AdminReview) => {
      setBusyId(review.id);
      setActionError(null);
      try {
        await adminApi.updateReview(review.id, { isVisible: !review.isVisible });
        setNonce((n) => n + 1);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Could not update visibility.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const submitDelete = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const target = deleteTarget;
      if (!target) return;
      setDeletePending(true);
      setActionError(null);
      try {
        await adminApi.deleteReview(target.id);
        setDeleteTarget(null);
        setNonce((n) => n + 1);
      } catch (err) {
        // Keep the dialog open with the verbatim backend message.
        setActionError(
          err instanceof Error ? err.message : "Could not delete review.",
        );
      } finally {
        setDeletePending(false);
      }
    },
    [deleteTarget],
  );

  const visibleCount = useMemo(
    () => reviews?.filter((r) => r.isVisible).length ?? 0,
    [reviews],
  );

  // --- render states ---------------------------------------------------------

  if (notFound) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <EmptyState
          title="Product not found."
          hint="It may have been deleted."
          action={
            <Link
              href="/admin/products"
              className="text-sm font-semibold text-cta hover:underline"
            >
              Back to products
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title={product ? `Reviews · ${product.name}` : "Reviews"}
        count={reviews?.length}
        actions={
          <>
            <Link
              href={`/admin/products/${productId}/edit`}
              className="inline-flex h-12 items-center justify-center rounded-lg border border-border px-4 text-base font-semibold text-ink-secondary hover:border-primary"
            >
              Back to product
            </Link>
            {canManage ? (
              <Button variant="secondary" size="md" onClick={() => setBatchOpen(true)}>
                批量导入
              </Button>
            ) : null}
            {canManage ? (
              <Button size="md" onClick={openCreate}>
                Add review
              </Button>
            ) : null}
          </>
        }
      />

      {reviews && reviews.length > 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          {visibleCount} {visibleCount === 1 ? "review is" : "reviews are"} visible on the
          storefront.
        </p>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          {actionError}
        </div>
      ) : null}

      <div className="mt-4">
        {loadError ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm font-semibold text-ink">Couldn&apos;t load reviews.</p>
            <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
            <Button variant="secondary" size="md" onClick={reload} className="mt-4">
              Retry
            </Button>
          </div>
        ) : reviews === null ? (
          <TableSkeleton rows={5} cols={7} />
        ) : reviews.length === 0 ? (
          <EmptyState
            title="No reviews yet."
            hint="Add the first review to give buyers social proof. Only visible reviews appear on the storefront."
            action={
              canManage ? (
                <Button size="md" onClick={openCreate}>
                  Add review
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">Product reviews</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-3">Reviewer</th>
                  <th scope="col" className="px-4 py-3">Rating</th>
                  <th scope="col" className="px-4 py-3">Review</th>
                  <th scope="col" className="px-4 py-3">Photos</th>
                  <th scope="col" className="px-4 py-3">Visible</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{review.authorName}</p>
                      {review.location ? (
                        <p className="text-xs text-ink-muted">{review.location}</p>
                      ) : null}
                      {review.source === "ADMIN" ? (
                        <p className="mt-0.5 text-xs text-ink-muted">Merchant-authored</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">
                      {review.rating}
                      <span className="font-normal text-ink-muted"> / 5</span>
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      {review.title ? (
                        <p className="font-medium text-ink">{review.title}</p>
                      ) : null}
                      <p className="line-clamp-3 whitespace-pre-line text-ink-secondary">
                        {review.comment}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {review.photos.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {review.photos.map((photo) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={photo}
                              src={photo}
                              alt="Review attachment"
                              className="h-10 w-10 rounded-md border border-border object-cover"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        value={review.isVisible ? "Visible" : "Hidden"}
                        tone={review.isVisible ? "green" : "neutral"}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                      {new Date(review.createdAt).toLocaleString("en-PH", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => openEdit(review)}
                            className="text-sm font-semibold text-cta hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleVisible(review)}
                            disabled={busyId === review.id}
                            className="text-sm font-semibold text-ink-secondary hover:underline disabled:text-ink-muted disabled:no-underline"
                          >
                            {review.isVisible ? "Hide" : "Show"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setDeleteTarget(review);
                            }}
                            className="text-sm font-semibold text-red-700 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / edit */}
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? "Edit review" : "Add review"}
        width="md"
      >
        <form onSubmit={submitForm} noValidate>
          <div className="flex flex-col gap-4">
            <Field label="Author name" htmlFor="review-author" error={errors.authorName}>
              <TextInput
                id="review-author"
                value={form.authorName}
                maxLength={120}
                onChange={(e) => patchForm({ authorName: e.target.value })}
              />
            </Field>
            <Field label="Location (optional)" htmlFor="review-location" error={errors.location}>
              <TextInput
                id="review-location"
                value={form.location}
                maxLength={120}
                placeholder="e.g. Metro Manila"
                onChange={(e) => patchForm({ location: e.target.value })}
              />
            </Field>
            <Field label="Rating" htmlFor="review-rating">
              <Select
                id="review-rating"
                value={form.rating}
                onChange={(e) => patchForm({ rating: Number(e.target.value) })}
              >
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {`${value} star${value === 1 ? "" : "s"}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title (optional)" htmlFor="review-title" error={errors.title}>
              <TextInput
                id="review-title"
                value={form.title}
                maxLength={200}
                onChange={(e) => patchForm({ title: e.target.value })}
              />
            </Field>
            <Field label="Comment" htmlFor="review-comment" error={errors.comment}>
              <Textarea
                id="review-comment"
                rows={5}
                value={form.comment}
                maxLength={5000}
                className="resize-y"
                onChange={(e) => patchForm({ comment: e.target.value })}
              />
            </Field>
            <div>
              <p className="mb-1 text-sm font-medium text-ink">
                Photo URLs (optional, up to 6)
              </p>
              <div className="flex flex-col gap-2">
                {form.photos.map((photo, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <ImageUrlInput
                        ariaLabel={`Review photo ${index + 1} URL`}
                        value={photo}
                        onChange={(url) => setPhoto(index, url)}
                        disabled={pending}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePhotoRow(index)}
                      aria-label={`Remove photo ${index + 1}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted hover:text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {form.photos.length < 6 ? (
                <button
                  type="button"
                  onClick={addPhotoRow}
                  className="mt-2 text-sm font-semibold text-cta hover:underline"
                >
                  + Add photo URL
                </button>
              ) : null}
              {errors.photos ? (
                <p className="mt-1 text-xs text-red-700" role="alert">
                  {errors.photos}
                </p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={form.isVisible}
                onChange={(e) => patchForm({ isVisible: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-cta"
              />
              Visible on storefront
            </label>
            {errors.form ? (
              <p className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700" role="alert">
                {errors.form}
              </p>
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" size="md" onClick={closeDialog} disabled={pending}>
              Back
            </Button>
            <Button type="submit" size="md" disabled={pending} aria-busy={pending}>
              {pending ? "Working…" : editing ? "Save changes" : "Add review"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteTarget !== null} onClose={closeDelete} title="Delete review" width="sm">
        {deleteTarget ? (
          <form onSubmit={submitDelete}>
            <p className="text-sm text-ink-secondary">
              {`Delete the ${deleteTarget.rating}-star review by ${deleteTarget.authorName}? This cannot be undone.`}
            </p>
            {actionError ? (
              <p className="mt-3 rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={closeDelete}
                disabled={deletePending}
              >
                Back
              </Button>
              <Button
                type="submit"
                size="md"
                disabled={deletePending}
                aria-busy={deletePending}
                className="bg-red-600 hover:bg-red-700 active:bg-red-700"
              >
                {deletePending ? "Working…" : "Delete"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <BatchReviewsGridDialog
        productId={productId}
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onImported={reload}
      />
    </div>
  );
}

export default function AdminProductReviewsPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  return <ProductReviewsContent key={productId} productId={productId} />;
}
