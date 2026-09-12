"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import {
  ProductForm,
  emptyProductFormValue,
  serializeFormValue,
  type ProductFormValue,
} from "@/components/admin/ProductForm";
import { Button } from "@/components/ui/Button";
import { adminApi, type AdminCategoryNode } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

export default function NewProductPage(): ReactNode {
  const router = useRouter();

  const [initial] = useState<ProductFormValue>(() =>
    emptyProductFormValue(),
  );
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .listCategories()
      .then((res) => {
        if (active) {
          setCategories(res);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCategories([]);
        setLoadError(
          err instanceof Error
            ? err.message
            : "Couldn't load categories.",
        );
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  // Reset lives in the event handler (not the effect body, which would
  // cascade-render): retry flips back to the skeleton then refetches.
  const retryLoad = (): void => {
    setCategories(null);
    setLoadError(null);
    setNonce((n) => n + 1);
  };

  const handleSubmit = (v: ProductFormValue): void => {
    // The form already validated; serialize is pure, so re-running it here
    // cannot fail — it yields the CreateProductInput payload.
    const result = serializeFormValue(v);
    if (!result.ok) return;
    setPending(true);
    setError(null);
    adminApi
      .createProduct(result.value)
      .then((created) => {
        // Task 9 lands on the edit route (ships Task 10); today that 404s,
        // which is expected — the product row already exists server-side.
        router.push(`/admin/products/${created.id}/edit`);
      })
      .catch((err: unknown) => {
        // POST /admin/products 409s (products.service rethrowKnown, Prisma
        // P2002): the unique violation here is the typed slug, so spec §8.7
        // maps 409 to the slug-specific alert; other messages stay verbatim.
        setError(
          errorStatus(err) === 409
            ? "A product with this slug already exists."
            : err instanceof Error
              ? err.message
              : "Failed to create product.",
        );
        setPending(false);
      });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title="New product"
        actions={
          <Link
            href="/admin/products"
            className="text-sm font-semibold text-cta hover:underline"
          >
            Back to products
          </Link>
        }
      />

      {loadError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-border bg-card p-6"
        >
          <p className="text-sm font-semibold text-ink">
            Couldn&apos;t load categories.
          </p>
          <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
          <Button
            variant="secondary"
            size="md"
            onClick={retryLoad}
            className="mt-4"
          >
            Retry
          </Button>
        </div>
      ) : categories === null ? (
        <div className="mt-4 space-y-4" aria-hidden>
          <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      ) : categories.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No categories yet."
            hint="Every product needs a category — create one before adding products."
            action={
              <Link
                href="/admin/categories"
                className="inline-flex h-12 min-w-[140px] items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
              >
                Go to categories
              </Link>
            }
          />
        </div>
      ) : (
        <ProductForm
          initial={initial}
          categories={categories}
          onSubmit={handleSubmit}
          submitLabel="Create product"
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}
