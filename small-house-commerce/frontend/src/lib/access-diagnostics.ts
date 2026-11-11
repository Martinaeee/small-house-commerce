import type { AdminAccessReport } from "@/lib/admin-api";

export type RequestKind = "image" | "api" | "page" | "static" | "other";

export interface ParsedRequest {
  kind: RequestKind;
  /** Human-readable resource name derived from the URL, never invented. */
  name: string;
  /** Full URI as logged. */
  uri: string;
  /** The width the image optimizer was asked for, when present. */
  imageWidth: number | null;
  /** The underlying uploaded file name behind `/_next/image?url=...`. */
  sourceFile: string | null;
}

/**
 * Classifies a logged URI. Everything here is derived from the URL alone; we
 * never guess which page a resource belongs to, because the access log does
 * not record a referer we can trust.
 */
export function parseRequest(uri: string): ParsedRequest {
  let pathname = uri;
  let query = "";
  const q = uri.indexOf("?");
  if (q >= 0) {
    pathname = uri.slice(0, q);
    query = uri.slice(q + 1);
  }

  if (pathname === "/_next/image") {
    const params = new URLSearchParams(query);
    const source = params.get("url") ?? "";
    const width = Number(params.get("w"));
    return {
      kind: "image",
      name: source ? source.split("/").pop() || source : "image",
      uri,
      imageWidth: Number.isFinite(width) ? width : null,
      sourceFile: source ? source.split("/").pop() || source : null,
    };
  }

  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/")) {
    return {
      kind: "static",
      name: pathname.split("/").pop() || pathname,
      uri,
      imageWidth: null,
      sourceFile: null,
    };
  }

  if (pathname.startsWith("/api/")) {
    return {
      kind: "api",
      name: pathname.replace(/^\/api\/v\d+/, "") || pathname,
      uri,
      imageWidth: null,
      sourceFile: null,
    };
  }

  return {
    kind: "page",
    name: pathname === "/" ? "/" : pathname,
    uri,
    imageWidth: null,
    sourceFile: null,
  };
}

export type ErrorVerdict = "server" | "client" | "neutral";

export interface ErrorClass {
  code: number;
  verdict: ErrorVerdict;
  count: number;
  /** Share of all requests in the window, 0-100 with one decimal. */
  share: number;
}

/**
 * A 4xx is the client asking for something that is not there or is not
 * allowed; it is not a server failure. Only 5xx means the site is broken.
 */
export function verdictForStatus(code: number): ErrorVerdict {
  if (code >= 500) return "server";
  if (code >= 400) return "client";
  return "neutral";
}

/** Turns the status histogram into a sorted list with real denominators. */
export function errorClasses(
  statusCounts: Record<string, number>,
  totalRequests: number,
): ErrorClass[] {
  const denominator = totalRequests > 0 ? totalRequests : 0;
  return Object.entries(statusCounts)
    .map(([raw, count]) => {
      const code = Number(raw);
      return {
        code,
        verdict: verdictForStatus(code),
        count,
        share: denominator ? Math.round((count / denominator) * 1000) / 10 : 0,
      };
    })
    .filter((entry) => entry.code >= 400)
    .sort((a, b) => {
      // Server failures first, then by count.
      if (a.verdict !== b.verdict) {
        if (a.verdict === "server") return -1;
        if (b.verdict === "server") return 1;
      }
      return b.count - a.count;
    });
}

export type OverallVerdict = "ok" | "attention" | "critical";

export interface OverallStatus {
  verdict: OverallVerdict;
  /** Concrete reasons behind the verdict, already translated by the caller. */
  reasons: ("server_errors" | "hit_rate_low" | "hit_rate_warming" | "4xx_high")[];
}

/** The three questions the page exists to answer, in one call. */
export function overallStatus(report: AdminAccessReport): OverallStatus {
  const reasons: OverallStatus["reasons"] = [];
  if (report.status5xx > 0) reasons.push("server_errors");

  const hitRate = report.images.hitRate;
  if (hitRate !== null) {
    if (hitRate < 50) reasons.push("hit_rate_low");
    else if (hitRate < 90) reasons.push("hit_rate_warming");
  }

  const rate4xx =
    report.requests > 0
      ? Math.round((report.status4xx / report.requests) * 1000) / 10
      : 0;
  if (rate4xx >= 5) reasons.push("4xx_high");

  if (reasons.includes("server_errors")) return { verdict: "critical", reasons };
  if (reasons.length > 0) return { verdict: "attention", reasons };
  return { verdict: "ok", reasons };
}

/** Cache state is only known when the collector records it per request. */
export function cacheStateLabel(known: boolean): "hit" | "miss" | "unknown" {
  return known ? "hit" : "unknown";
}
