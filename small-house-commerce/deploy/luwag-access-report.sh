#!/usr/bin/env python3
"""Summarise the Caddy access log: 5xx rate, image-cache hit ratio, slowest paths.

Reads the JSON access log written by the `log` block in deploy/Caddyfile. It
tails the file instead of parsing everything, so a multi-hundred-megabyte log
costs the same as a small one.

The window mixes three kinds of traffic and they must not be averaged
together: real visitors, bots (Facebook previews, search crawlers) and our own
cache warm-up script, whose whole job is to generate MISSes. Each is counted
separately and the "real" hit rate excludes the warm-up.

Usage (on the server):
    luwag-access-report.sh                 # last 20000 lines
    luwag-access-report.sh --lines 50000
    luwag-access-report.sh --json          # machine-readable, for the status page
    luwag-access-report.sh --json --out /var/lib/luwag/access.json

Environment:
    ACCESS_LOG   path to access.log (default: the prod Caddy data volume)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LOG = "/var/lib/docker/volumes/small-house-prod_prod_caddy_data/_data/access.log"

# Substrings that mark automated traffic. Our own warm-up sends
# `Python-urllib/3.x`, which is also how it gets separated out below.
BOT_MARKERS = (
    "bot",
    "crawler",
    "spider",
    "facebookexternalhit",
    "python-urllib",
    "curl/",
    "wget",
    "headlesschrome",
    "google-inspectiontool",
)
WARMUP_MARKER = "python-urllib"

# Paths no real shopper ever opens: vulnerability scanners probing for
# WordPress, git metadata, env files and cloud config. Their user agent is
# often a plain browser string, so the path is the only reliable signal.
SCANNER_PATH_MARKERS = (
    "/wp-",
    "/wordpress",
    "/xmlrpc",
    "/.git",
    "/.env",
    "/.aws",
    "/aws/",
    "/phpmyadmin",
    "/vendor/",
    "/config",
    "/admin.php",
    "/shell",
)


def is_scanner_path(path: str) -> bool:
    lowered = path.lower()
    return any(marker in lowered for marker in SCANNER_PATH_MARKERS)


def classify_ua(ua: str) -> str:
    """Returns 'warmup', 'bot' or 'human'."""
    lowered = ua.lower()
    if WARMUP_MARKER in lowered:
        return "warmup"
    if any(marker in lowered for marker in BOT_MARKERS):
        return "bot"
    return "human"


def tail_lines(path: Path, limit: int) -> list[str]:
    """Return the last `limit` lines without loading the whole file."""
    if not path.exists():
        return []
    chunk = 1 << 20  # 1 MiB
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        data = b""
        pos = size
        while pos > 0 and data.count(b"\n") <= limit:
            read = min(chunk, pos)
            pos -= read
            handle.seek(pos)
            data = handle.read(read) + data
        lines = data.splitlines()
    return [line.decode("utf-8", "replace") for line in lines[-limit:]]


def header_value(headers: dict, name: str) -> str:
    for key, value in headers.items():
        if key.lower() == name.lower():
            if isinstance(value, list):
                return value[0] if value else ""
            return str(value)
    return ""


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lines", type=int, default=20000)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--out", default=None, help="write the JSON report here (atomic)")
    parser.add_argument("--log", default=os.environ.get("ACCESS_LOG", DEFAULT_LOG))
    args = parser.parse_args()

    path = Path(args.log)
    lines = tail_lines(path, args.lines)

    total = errors_5xx = errors_4xx = 0
    first_ts: float | None = None
    last_ts: float | None = None
    traffic = Counter()  # human / bot / warmup
    image_traffic = Counter()
    image_hit = Counter()
    image_miss = Counter()
    slow: list[tuple[float, str, int, str, str, str]] = []
    five_xx_paths: Counter[str] = Counter()
    status_counts: Counter[int] = Counter()
    error_rows: dict[tuple[int, str], dict] = defaultdict(
        lambda: {"count": 0, "firstTs": None, "lastTs": None, "uas": Counter(), "referers": Counter()}
    )

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        request = entry.get("request") or {}
        uri = request.get("uri") or ""
        status = int(entry.get("status") or 0)
        duration = float(entry.get("duration") or 0)
        ts = float(entry.get("ts") or 0)
        headers = request.get("headers") or {}
        ua = header_value(headers, "user-agent")
        referer = header_value(headers, "referer")
        kind = classify_ua(ua)

        total += 1
        traffic[kind] += 1
        status_counts[status] += 1
        if ts:
            first_ts = ts if first_ts is None else min(first_ts, ts)
            last_ts = ts if last_ts is None else max(last_ts, ts)

        if status >= 500:
            errors_5xx += 1
            five_xx_paths[uri.split("?")[0]] += 1
        elif status >= 400:
            errors_4xx += 1

        if status >= 400:
            key = (status, uri.split("?")[0])
            row = error_rows[key]
            row["count"] += 1
            row["firstTs"] = ts if row["firstTs"] is None else min(row["firstTs"], ts)
            row["lastTs"] = ts if row["lastTs"] is None else max(row["lastTs"], ts)
            if ua:
                row["uas"][ua[:120]] += 1
            if referer:
                row["referers"][referer[:200]] += 1

        if "/_next/image" in uri:
            image_traffic[kind] += 1
            cache = header_value(entry.get("resp_headers") or {}, "x-nextjs-cache").upper()
            if cache == "HIT":
                image_hit[kind] += 1
            else:
                image_miss[kind] += 1

        slow.append((duration, uri, status, cache_for(entry), referer, kind))

    slow.sort(reverse=True)

    def rate(hit: int, miss: int) -> float | None:
        denominator = hit + miss
        return round(hit / denominator * 100, 1) if denominator else None

    image_total = sum(image_traffic.values())
    image_hit_total = sum(image_hit.values())
    image_miss_total = sum(image_miss.values())
    # Excludes the warm-up script: its requests exist only to create MISSes.
    real_hit = image_hit["human"] + image_hit["bot"]
    real_miss = image_miss["human"] + image_miss["bot"]

    errors = []
    for (code, path_only), row in sorted(
        error_rows.items(), key=lambda item: (-item[1]["count"], item[0])
    )[:20]:
        top_ua = row["uas"].most_common(1)
        top_ref = row["referers"].most_common(1)
        errors.append(
            {
                "code": code,
                "path": path_only,
                "count": row["count"],
                "firstAt": iso(row["firstTs"]) if row["firstTs"] else None,
                "lastAt": iso(row["lastTs"]) if row["lastTs"] else None,
                "bot": (bool(top_ua) and classify_ua(top_ua[0][0]) != "human")
                or is_scanner_path(path_only),
                "sampleUa": top_ua[0][0] if top_ua else "",
                "sampleReferer": top_ref[0][0] if top_ref else "",
            }
        )

    report = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(),
        "log": str(path),
        "linesRead": len(lines),
        "window": {
            "firstAt": iso(first_ts) if first_ts else None,
            "lastAt": iso(last_ts) if last_ts else None,
        },
        "requests": total,
        "traffic": {
            "human": traffic["human"],
            "bot": traffic["bot"],
            "warmup": traffic["warmup"],
        },
        "status5xx": errors_5xx,
        "status4xx": errors_4xx,
        "errorRate5xx": round(errors_5xx / total * 100, 2) if total else None,
        "images": {
            "requests": image_total,
            "hit": image_hit_total,
            "miss": image_miss_total,
            "hitRate": rate(image_hit_total, image_miss_total),
            "realHitRate": rate(real_hit, real_miss),
            "warmupRequests": image_traffic["warmup"],
        },
        "top5xxPaths": five_xx_paths.most_common(5),
        "errors": errors,
        "slowest": [
            {
                "ms": int(duration * 1000),
                "uri": uri[:400],
                "status": status,
                "cache": cache,
                "referer": referer[:300],
                "traffic": kind,
            }
            for duration, uri, status, cache, referer, kind in slow[:8]
        ],
        "statusCounts": dict(status_counts.most_common(10)),
    }

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(out_path.parent), prefix=".access-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(report, handle, indent=2)
            os.chmod(tmp, 0o644)
            os.replace(tmp, out_path)
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise
        if args.json:
            print(json.dumps(report, indent=2))
        return 0

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    window = report["window"]
    print(f"log: {report['log']} ({len(lines)} lines)")
    print(f"window: {window['firstAt']} .. {window['lastAt']}")
    print(
        f"requests: {total}  human {traffic['human']}  bot {traffic['bot']}  warmup {traffic['warmup']}"
    )
    print(f"5xx: {errors_5xx} ({report['errorRate5xx']}%)  4xx: {errors_4xx}")
    images = report["images"]
    print(
        f"image optimizer: {images['requests']} requests  "
        f"HIT {images['hit']} ({images['hitRate']}%)  MISS {images['miss']}  "
        f"real-rate {images['realHitRate']}%"
    )
    if five_xx_paths:
        print("top 5xx paths:")
        for uri, count in report["top5xxPaths"]:
            print(f"  {count:>4}  {uri}")
    if errors:
        print("errors:")
        for row in errors[:8]:
            flag = "bot" if row["bot"] else "human"
            print(f"  {row['count']:>4}  {row['code']}  {flag:<5}  {row['path'][:80]}")
    if slow:
        print("slowest:")
        for entry in report["slowest"][:8]:
            print(f"  {entry['ms']:>6}ms  {entry['status']}  {entry['cache']:<5}  {entry['uri'][:100]}")
    return 0


def cache_for(entry: dict) -> str:
    value = header_value(entry.get("resp_headers") or {}, "x-nextjs-cache").upper()
    return value or "UNKNOWN"


if __name__ == "__main__":
    sys.exit(main())
