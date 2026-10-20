"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, type Product, type ProductFaqItem } from "@/lib/api";
import { RatingStars } from "./RatingStars";
import { ReviewCard } from "./ReviewCard";
import { ProductFaqAnswer } from "./ProductFaqSection";

type FeedbackTab = "reviews" | "qa";

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The answer text used for keyword search, flattened from the stored blocks. */
function faqItemText(item: ProductFaqItem): string {
  const parts = item.answer.flatMap((block) =>
    block.kind === "paragraph" ? [block.text] : block.items,
  );
  return `${item.title} ${parts.join(" ")}`.toLowerCase();
}

/**
 * PDP feedback block: customer reviews and the product Q&A share one section
 * and switch by tab.
 *
 * Q&A reads the same resolved FAQ list the FAQ section used to render; asking
 * a question only writes to the operator inbox, so nothing appears publicly
 * until an operator answers and publishes it.
 */
export function ProductFeedback({
  product,
  supportEmail,
  supportHours,
}: {
  product: Product;
  supportEmail: string;
  supportHours: string;
}): ReactNode {
  const [tab, setTab] = useState<FeedbackTab>("reviews");
  const [search, setSearch] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const reviews = product.reviews ?? [];
  const reviewCount = product.reviewCount ?? 0;
  const average = product.ratingAverage;

  const qaItems = useMemo(
    () =>
      (product.effectiveFaq ?? [])
        .filter((item) => item.enabled)
        .sort((left, right) => left.position - right.position),
    [product.effectiveFaq],
  );
  const query = search.trim().toLowerCase();
  const visibleQa = query
    ? qaItems.filter((item) => faqItemText(item).includes(query))
    : qaItems;

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const trimmed = question.trim();
    if (trimmed.length < 5) {
      setError("Please write at least 5 characters so we can answer properly.");
      return;
    }
    setSubmitting(true);
    try {
      await api.askProductQuestion(product.slug, {
        question: trimmed,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      setQuestion("");
      setName("");
      setEmail("");
      setAskOpen(false);
      setNotice("Thanks! Your question is with us — we'll answer it after review.");
    } catch {
      setError("Sorry, we couldn't send your question. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
      active
        ? "border-cta text-ink"
        : "border-transparent text-ink-secondary hover:text-cta"
    }`;

  return (
    <section id="reviews" className="scroll-mt-28 rounded-lg border border-border bg-card p-6">
      <div
        role="tablist"
        aria-label="Product feedback"
        className="mb-5 flex items-end gap-6 border-b border-border"
      >
        <button
          type="button"
          role="tab"
          id="feedback-tab-reviews"
          aria-selected={tab === "reviews"}
          aria-controls="feedback-panel-reviews"
          onClick={() => setTab("reviews")}
          className={tabClass(tab === "reviews")}
        >
          Reviews ({reviewCount})
        </button>
        <button
          type="button"
          role="tab"
          id="feedback-tab-qa"
          aria-selected={tab === "qa"}
          aria-controls="feedback-panel-qa"
          onClick={() => setTab("qa")}
          className={tabClass(tab === "qa")}
        >
          Q&amp;A ({qaItems.length})
        </button>
      </div>

      {tab === "reviews" ? (
        <div
          role="tabpanel"
          id="feedback-panel-reviews"
          aria-labelledby="feedback-tab-reviews"
        >
          {reviewCount === 0 || average === null ? (
            <p className="text-sm text-ink-muted">No reviews yet</p>
          ) : (
            <>
              <div className="mb-6 flex items-center gap-3">
                <RatingStars value={average} className="text-lg" />
                <span className="text-sm font-semibold text-ink">
                  {average.toFixed(1)}
                </span>
                <span className="text-sm text-ink-secondary">
                  · {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
                </span>
              </div>
              <ul className="flex flex-col gap-6">
                {reviews.map((review) => (
                  <ReviewCard key={review.id} review={review} />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="feedback-panel-qa"
          aria-labelledby="feedback-tab-qa"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <span className="sr-only">Search questions</span>
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-ink-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="9" cy="9" r="6" />
                <path d="m14 14 4 4" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                data-testid="qa-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search questions"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              />
            </label>
            <button
              type="button"
              data-testid="qa-ask-toggle"
              aria-expanded={askOpen}
              onClick={() => {
                setAskOpen((open) => !open);
                setError(null);
                setNotice(null);
              }}
              className="shrink-0 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-cta transition hover:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
            >
              {askOpen ? "Close" : "Ask a question"}
            </button>
          </div>

          {notice ? (
            <p
              role="status"
              data-testid="qa-notice"
              className="rounded-lg border border-primary bg-primary-light/40 px-3 py-2 text-sm text-cta"
            >
              {notice}
            </p>
          ) : null}

          {askOpen ? (
            <form
              data-testid="qa-ask-form"
              onSubmit={submitQuestion}
              className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
            >
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Your question
                <textarea
                  data-testid="qa-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={3}
                  maxLength={500}
                  required
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-cta"
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink">
                  Name (optional)
                  <input
                    data-testid="qa-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-cta"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink">
                  Email (optional, never shown)
                  <input
                    data-testid="qa-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={255}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-cta"
                  />
                </label>
              </div>
              {error ? (
                <p role="alert" data-testid="qa-error" className="text-sm text-sale">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                data-testid="qa-submit"
                disabled={submitting}
                className="self-start rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-cta-foreground transition hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
              >
                {submitting ? "Sending…" : "Submit question"}
              </button>
              <p className="text-xs text-ink-muted">
                Questions are reviewed before they appear here.
              </p>
            </form>
          ) : null}

          {visibleQa.length === 0 ? (
            <p className="text-sm text-ink-muted" data-testid="qa-empty">
              {query
                ? "No questions match your search."
                : "No questions yet — ask us anything about this product."}
            </p>
          ) : (
            <ul className="flex flex-col">
              {visibleQa.map((item) => (
                <li key={item.id}>
                  {/* Answers stay folded until the shopper opens them. */}
                  <details className="group border-b border-border last:border-0">
                    <summary
                      data-testid="qa-item"
                      className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden"
                    >
                      {item.title}
                      <Chevron />
                    </summary>
                    <div className="pb-5 text-sm leading-relaxed text-ink-secondary">
                      <ProductFaqAnswer
                        blocks={item.answer}
                        idPrefix={`qa:${item.id}`}
                        supportEmail={supportEmail}
                        supportHours={supportHours}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
