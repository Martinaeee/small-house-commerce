import { describe, expect, it } from "vitest";
import {
  errorClasses,
  overallStatus,
  parseRequest,
  verdictForStatus,
} from "./access-diagnostics";
import type { AdminAccessReport } from "@/lib/admin-api";

describe("parseRequest", () => {
  it("reads the source file and width out of an optimizer URL", () => {
    const parsed = parseRequest(
      "/_next/image?url=%2Fuploads%2Fcatalog%2F2026%2Fabc.png&w=1440&q=75",
    );

    expect(parsed.kind).toBe("image");
    expect(parsed.name).toBe("abc.png");
    expect(parsed.imageWidth).toBe(1440);
    expect(parsed.sourceFile).toBe("abc.png");
  });

  it("classifies API, static and page paths", () => {
    expect(parseRequest("/api/v1/storefront/cart").kind).toBe("api");
    expect(parseRequest("/api/v1/storefront/cart").name).toBe("/storefront/cart");
    expect(parseRequest("/_next/static/chunks/x.js").kind).toBe("static");
    expect(parseRequest("/products/desk").kind).toBe("page");
    expect(parseRequest("/products/desk").name).toBe("/products/desk");
  });

  it("keeps the full URI for the detail panel", () => {
    const uri = "/_next/image?url=%2Fx.png&w=640&q=75";
    expect(parseRequest(uri).uri).toBe(uri);
  });
});

describe("verdictForStatus", () => {
  it("only treats 5xx as a server failure", () => {
    expect(verdictForStatus(500)).toBe("server");
    expect(verdictForStatus(503)).toBe("server");
    expect(verdictForStatus(404)).toBe("client");
    expect(verdictForStatus(429)).toBe("client");
    expect(verdictForStatus(200)).toBe("neutral");
  });
});

describe("errorClasses", () => {
  it("uses the real request count as the denominator", () => {
    const classes = errorClasses({ "404": 5, "500": 5, "200": 90 }, 200);

    expect(classes.map((entry) => entry.code)).toEqual([500, 404]);
    expect(classes[0]).toMatchObject({ count: 5, share: 2.5 });
  });

  it("drops statuses below 400", () => {
    const classes = errorClasses({ "200": 100, "304": 20 }, 120);
    expect(classes).toEqual([]);
  });
});

const base: AdminAccessReport = {
  generatedAt: "2026-11-11T09:00:00.000Z",
  stale: false,
  windowLines: 1000,
  windowFirstAt: "2026-11-11T08:00:00.000Z",
  windowLastAt: "2026-11-11T09:00:00.000Z",
  requests: 1000,
  traffic: { human: 900, bot: 100, warmup: 0 },
  status5xx: 0,
  status4xx: 10,
  errorRate5xx: 0,
  images: {
    requests: 400,
    hit: 380,
    miss: 20,
    hitRate: 95,
    realHitRate: 95,
    warmupRequests: 0,
  },
  top5xxPaths: [],
  errors: [],
  slowest: [],
  statusCounts: { "200": 990, "404": 10 },
};

describe("overallStatus", () => {
  it("is ok with no 5xx and a warm cache", () => {
    expect(overallStatus(base).verdict).toBe("ok");
  });

  it("is critical on any 5xx", () => {
    const status = overallStatus({ ...base, status5xx: 2 });
    expect(status.verdict).toBe("critical");
    expect(status.reasons).toContain("server_errors");
  });

  it("is attention while the cache is still warming", () => {
    const status = overallStatus({
      ...base,
      images: {
        requests: 400,
        hit: 160,
        miss: 240,
        hitRate: 40,
        realHitRate: 40,
        warmupRequests: 0,
      },
    });
    expect(status.verdict).toBe("attention");
    expect(status.reasons).toContain("cache_state");
  });

  it("flags a high 4xx rate without calling it a failure", () => {
    const status = overallStatus({ ...base, status4xx: 80 });
    expect(status.verdict).toBe("attention");
    expect(status.reasons).toContain("4xx_high");
  });
});
