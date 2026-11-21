#!/usr/bin/env python3
"""Warm the Next.js image optimizer cache after a deploy.

Every `docker compose up -d frontend` recreates the container and drops
`.next/cache/images`, so the first visitors after a deploy each pay the
1-6s sharp transform per image. This script fetches the storefront pages,
collects every `/_next/image` URL they reference (src and srcset alike) and
requests them ahead of real traffic.

Rendered HTML does not list every rendition a PDP can request: the detail
deck only renders its first modules eagerly, so the remaining detail images
have no `/_next/image` URL in the document. Those are built from the
product API instead, at the widths real traffic requests.

Read-only: it only GETs public pages and images. No database or container
writes. Safe to run repeatedly; already-cached URLs return `HIT` and cost
almost nothing.

Usage (on the server, after `up -d frontend` is healthy):
    luwag-warm-image-cache.sh

Environment:
    BASE              storefront origin (default https://luwag.shop)
    PRODUCT_LIMIT     how many product pages to warm (default 48, the API cap
                      and every active product today)
    CONCURRENCY       parallel image requests (default 2, keep the box calm)
    MAX_IMAGES        safety cap on distinct image URLs (default 3000)
    TIMEOUT           per-request timeout in seconds (default 60)
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get("BASE", "https://luwag.shop").rstrip("/")
PRODUCT_LIMIT = int(os.environ.get("PRODUCT_LIMIT", "48"))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "3"))
MAX_IMAGES = int(os.environ.get("MAX_IMAGES", "3000"))
TIMEOUT = int(os.environ.get("TIMEOUT", "60"))

# The optimizer caches one entry per output format, so a warm request must
# advertise WebP exactly like a browser does. `Accept: image/*` falls back to
# PNG and fills the cache with entries real visitors never read.
BROWSER_IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"

# Warm every width the storefront emits. 96px thumbnails are the single most
# requested rendition and 750px is what DPR-2 phones pick, so leaving them out
# meant the busiest variants still missed for the first visitor after a deploy.
SKIP_WIDTHS = {"16", "32", "48", "64", "128"}

# The widths real traffic requests (measured in the production access log:
# 1280 dominates, then 96, 640, 1440, 384). Used when building optimizer URLs
# from the product API instead of from rendered HTML.
OPTIMIZER_WIDTHS = ("96", "384", "640", "1280", "1440")

IMAGE_RE = re.compile(r'/_next/image\?[^"\'<>\s\\]+')
PRODUCT_RE = re.compile(r'href="(/products/[^"?#]+)')


def optimizer_url(src: str, width: str) -> str:
    """The URL the storefront itself would request for this upload."""
    return "/_next/image?url=%s&w=%s&q=75" % (
        urllib.parse.quote(src, safe=""),
        width,
    )


def http_get(path: str, accept: str = "text/html") -> tuple[int, bytes, dict]:
    url = path if path.startswith("http") else BASE + path
    req = urllib.request.Request(url, headers={"Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, b"", dict(exc.headers or {})
    except Exception as exc:  # noqa: BLE001 - a warm run must never abort the deploy
        return 0, str(exc).encode(), {}


def http_get_with_retry(path: str, accept: str = "text/html") -> tuple[int, bytes, dict]:
    result = http_get(path, accept)
    if result[0] == 0:
        time.sleep(1)
        result = http_get(path, accept)
    return result



def collect_pages() -> list[str]:
    pages = ["/", "/collections/all-products"]
    status, body, _ = http_get_with_retry("/api/v1/storefront/products?pageSize=%d" % PRODUCT_LIMIT)
    if status == 200:
        try:
            data = json.loads(body)
            for item in (data.get("items") or [])[:PRODUCT_LIMIT]:
                slug = item.get("slug")
                if slug:
                    pages.append(f"/products/{slug}")
        except (ValueError, AttributeError):
            pass
    return pages


def collect_image_urls(pages: list[str]) -> tuple[set[str], list[str]]:
    urls: set[str] = set()
    failed_pages: list[str] = []
    for page in pages:
        status, body, _ = http_get_with_retry(page)
        if status != 200:
            failed_pages.append(f"{page} -> {status or 'error'}")
            continue
        html = body.decode("utf-8", "replace")
        # `&amp;` comes from HTML attributes, `&` from the RSC payload
        # embedded in the same document.
        html = html.replace("&amp;", "&").replace("\\u0026", "&")
        for match in IMAGE_RE.finditer(html):
            url = match.group(0)
            width = re.search(r"[?&]w=(\d+)", url)
            if width and width.group(1) in SKIP_WIDTHS:
                continue
            urls.add(url)
    return urls, failed_pages


def collect_api_media_urls(pages: list[str]) -> tuple[set[str], list[str]]:
    """Optimizer URLs for every product image a PDP can show.

    The detail deck renders only its first few modules eagerly, so the rest
    of the detail images never appear as `/_next/image` URLs in the HTML —
    scraping alone missed 9 of 13 detail images on a freshly published
    product, and the first phone paid the cold transforms for them. The
    product API carries the full list, so build the renditions from it.
    """
    urls: set[str] = set()
    warnings: list[str] = []
    for page in pages:
        if not page.startswith("/products/"):
            continue
        status, body, _ = http_get_with_retry("/api/v1/storefront" + page)
        if status != 200:
            warnings.append(f"api {page} -> {status or 'error'}")
            continue
        try:
            product = json.loads(body)
        except ValueError:
            warnings.append(f"api {page} -> invalid JSON")
            continue
        for row in list(product.get("images") or []) + list(
            product.get("detailBlocks") or []
        ):
            if row.get("type") != "IMAGE":
                continue
            src = (row.get("url") or "").strip()
            if not src.startswith("/uploads/"):
                continue
            for width in OPTIMIZER_WIDTHS:
                urls.add(optimizer_url(src, width))
    return urls, warnings


def warm(url: str) -> tuple[str, str, int, int]:
    started = time.time()
    status, body, headers = http_get_with_retry(url, accept=BROWSER_IMAGE_ACCEPT)
    elapsed = int((time.time() - started) * 1000)
    cache = headers.get("x-nextjs-cache") or headers.get("X-Nextjs-Cache") or "-"
    return url, cache, status, elapsed if status == 200 else elapsed


def main() -> int:
    started = time.time()
    print(f"warm: base={BASE} products={PRODUCT_LIMIT} concurrency={CONCURRENCY}")

    pages = collect_pages()
    urls, failed_pages = collect_image_urls(pages)
    api_urls, api_warnings = collect_api_media_urls(pages)
    urls |= api_urls
    if len(urls) > MAX_IMAGES:
        urls = set(list(urls)[:MAX_IMAGES])
    print(f"warm: pages={len(pages)} images={len(urls)}")
    for failure in failed_pages:
        print(f"warm: page failed {failure}")
    for warning in api_warnings:
        print(f"warm: api warning {warning}")

    hits = misses = errors = 0
    slowest: list[tuple[int, str]] = []
    with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as pool:
        for url, cache, status, elapsed in pool.map(warm, sorted(urls)):
            if status != 200:
                errors += 1
                print(f"warm: ERROR {status} {url[:120]}")
                continue
            if cache.upper() == "HIT":
                hits += 1
            else:
                misses += 1
            slowest.append((elapsed, url))

    slowest.sort(reverse=True)
    print(f"warm: hits={hits} misses={misses} errors={errors} in {int(time.time()-started)}s")
    for elapsed, url in slowest[:5]:
        print(f"warm: slowest {elapsed}ms {url[:120]}")

    # A few failed images is normal (a product may have been removed between
    # the HTML render and this run); only page-level failures are worth a
    # non-zero exit so a deploy hook can notice a broken storefront.
    return 1 if failed_pages else 0


if __name__ == "__main__":
    sys.exit(main())
