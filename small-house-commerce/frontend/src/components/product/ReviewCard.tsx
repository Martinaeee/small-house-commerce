// src/components/product/ReviewCard.tsx
"use client";

import { useState, useSyncExternalStore } from "react";
import { api, type Review } from "@/lib/api";
import { RatingStars } from "./RatingStars";

const HELPED_STORAGE_KEY = "rv_helpful_ids";

function readVotedIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HELPED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rememberVote(id: string) {
  try {
    const ids = readVotedIds();
    if (!ids.includes(id)) {
      ids.push(id);
      window.localStorage.setItem(HELPED_STORAGE_KEY, JSON.stringify(ids));
    }
  } catch {
    // Private mode / storage disabled — the server still dedupes by cookie.
  }
}

function formatReviewDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

type HelpfulState = "idle" | "sending" | "voted" | "error";
type ReportState = "idle" | "open" | "sending" | "done" | "error";

function subscribeVotes(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** One storefront review card, Amazon-style: avatar, meta line, variant row. */
export function ReviewCard({ review }: { review: Review }) {
  const [helpfulState, setHelpfulState] = useState<HelpfulState>("idle");
  const [helpfulCount, setHelpfulCount] = useState(review.helpfulCount);
  const [reportState, setReportState] = useState<ReportState>("idle");
  const [reportReason, setReportReason] = useState("");

  // localStorage is client-only; the server snapshot keeps hydration identical.
  const storedVote = useSyncExternalStore(
    subscribeVotes,
    () => readVotedIds().includes(review.id),
    () => false,
  );
  const voted = helpfulState === "voted" || storedVote;

  async function voteHelpful() {
    if (helpfulState === "sending" || voted) return;
    setHelpfulState("sending");
    try {
      const result = await api.markReviewHelpful(review.id);
      setHelpfulCount(result.helpfulCount);
      rememberVote(review.id);
      setHelpfulState("voted");
    } catch {
      setHelpfulState("error");
    }
  }

  async function submitReport() {
    if (reportState === "sending") return;
    setReportState("sending");
    try {
      const reason = reportReason.trim();
      await api.reportReview(review.id, reason || undefined);
      setReportState("done");
    } catch {
      setReportState("error");
    }
  }

  const reviewedLine = `Reviewed${review.location ? ` in ${review.location}` : ""} on ${formatReviewDate(
    review.createdAt,
  )}`;

  return (
    <li className="border-b border-border pb-6 last:border-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0f2f2] text-ink-muted"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.7-9 6.2V22h18v-1.8c0-3.5-4-6.2-9-6.2Z" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-ink">{review.authorName}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <RatingStars value={review.rating} className="text-sm" />
        {review.title && <span className="text-sm font-bold text-ink">{review.title}</span>}
      </div>

      <p className="mt-1 text-sm text-ink-muted">{reviewedLine}</p>

      {(review.variant || review.verifiedPurchase) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
          {review.variant && <span>{review.variant}</span>}
          {review.variant && review.verifiedPurchase && <span aria-hidden>|</span>}
          {review.verifiedPurchase && (
            <span className="font-semibold text-cta">Verified Purchase</span>
          )}
        </p>
      )}

      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
        {review.comment}
      </p>

      {review.photos.length > 0 && (
        <div className="mt-2 flex gap-2">
          {review.photos.map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo}
              src={photo}
              alt="Customer review"
              className="h-16 w-16 rounded-md border border-border object-cover"
              loading="lazy"
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={voteHelpful}
          disabled={voted || helpfulState === "sending"}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors ${
            voted
              ? "cursor-default border-border bg-primary-light/40 text-ink-muted"
              : "border-border text-ink-secondary hover:bg-primary-light/50"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M2 20h3V9H2v11Zm20-10a2 2 0 0 0-2-2h-6.3l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L13.17 1 6.58 7.59A2 2 0 0 0 6 9v9a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1Z" />
          </svg>
          Helpful{helpfulCount > 0 ? ` (${helpfulCount})` : ""}
          {helpfulState === "sending" && "…"}
        </button>
        <span aria-hidden className="text-border">|</span>
        {reportState === "idle" && (
          <button
            type="button"
            onClick={() => setReportState("open")}
            className="text-sm text-ink-secondary hover:text-ink hover:underline"
          >
            Report
          </button>
        )}

        {voted && <span className="text-xs text-ink-muted">Thanks for your feedback.</span>}
        {helpfulState === "error" && (
          <span className="text-xs text-red-600">
            Could not send.{" "}
            <button type="button" className="underline" onClick={voteHelpful}>
              Try again
            </button>
          </span>
        )}
      </div>

      {(reportState === "open" || reportState === "sending" || reportState === "error") && (
        <div className="mt-3 rounded-md border border-border bg-primary-light/30 p-3">
          <label htmlFor={`report-${review.id}`} className="text-sm font-semibold text-ink">
            Report this review
          </label>
          <textarea
            id={`report-${review.id}`}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            maxLength={500}
            rows={2}
            disabled={reportState === "sending"}
            placeholder="Why are you reporting this review? (optional)"
            className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink disabled:opacity-60"
          />
          {reportState === "error" && (
            <p className="mt-1 text-xs text-red-600">Could not send the report. Please try again.</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={submitReport}
              disabled={reportState === "sending"}
              className="rounded-md bg-cta px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {reportState === "sending" ? "Submitting…" : "Submit report"}
            </button>
            <button
              type="button"
              onClick={() => setReportState("idle")}
              disabled={reportState === "sending"}
              className="text-sm text-ink-secondary hover:underline disabled:no-underline disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {reportState === "done" && (
        <p className="mt-3 text-xs text-ink-muted">
          Thanks — our team will review this report.
        </p>
      )}
    </li>
  );
}
