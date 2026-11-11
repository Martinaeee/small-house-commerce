#!/usr/bin/env python3
"""Summarise the Caddy access log: 5xx rate, image-cache hit ratio, slowest paths.

Reads the JSON access log written by the `log` block in deploy/Caddyfile. It
tails the file instead of parsing everything, so a multi-hundred-megabyte log
costs the same as a small one.

Usage (on the server):
    luwag-access-report.sh                 # last 20000 lines
    luwag-access-report.sh --lines 50000
    luwag-access-report.sh --json          # machine-readable, for the status page

Environment:
    ACCESS_LOG   path to access.log (default: the prod Caddy data volume)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

DEFAULT_LOG = "/var/lib/docker/volumes/small-house-prod_prod_caddy_data/_data/access.log"


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lines", type=int, default=20000)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--log", default=os.environ.get("ACCESS_LOG", DEFAULT_LOG))
    args = parser.parse_args()

    path = Path(args.log)
    lines = tail_lines(path, args.lines)

    total = errors_5xx = errors_4xx = 0
    image_total = image_hit = image_miss = 0
    slow: list[tuple[float, str, int]] = []
    five_xx_paths: Counter[str] = Counter()
    status_counts: Counter[int] = Counter()

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

        total += 1
        status_counts[status] += 1
        if status >= 500:
            errors_5xx += 1
            five_xx_paths[uri.split("?")[0]] += 1
        elif status >= 400:
            errors_4xx += 1

        if "/_next/image" in uri:
            image_total += 1
            cache = header_value(entry.get("resp_headers") or {}, "x-nextjs-cache").upper()
            if cache == "HIT":
                image_hit += 1
            else:
                image_miss += 1

        slow.append((duration, uri, status))

    slow.sort(reverse=True)
    report = {
        "log": str(path),
        "linesRead": len(lines),
        "requests": total,
        "status5xx": errors_5xx,
        "status4xx": errors_4xx,
        "errorRate5xx": round(errors_5xx / total * 100, 2) if total else None,
        "images": {
            "requests": image_total,
            "hit": image_hit,
            "miss": image_miss,
            "hitRate": round(image_hit / image_total * 100, 1) if image_total else None,
        },
        "top5xxPaths": five_xx_paths.most_common(5),
        "slowest": [
            {"ms": int(duration * 1000), "uri": uri[:160], "status": status}
            for duration, uri, status in slow[:8]
        ],
        "statusCounts": dict(status_counts.most_common(10)),
    }

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    print(f"log: {report['log']} ({len(lines)} lines)")
    print(f"requests: {total}  5xx: {errors_5xx} ({report['errorRate5xx']}%)  4xx: {errors_4xx}")
    images = report["images"]
    print(
        f"image optimizer: {images['requests']} requests  "
        f"HIT {images['hit']} ({images['hitRate']}%)  MISS {images['miss']}"
    )
    if five_xx_paths:
        print("top 5xx paths:")
        for uri, count in report["top5xxPaths"]:
            print(f"  {count:>4}  {uri}")
    if slow:
        print("slowest:")
        for duration, uri, status in slow[:8]:
            print(f"  {int(duration*1000):>6}ms  {status}  {uri[:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
