#!/usr/bin/env python3
"""Checks that the access report separates our own probe traffic.

The synthetic probes read the storefront every minute. They arrive with the
probe user agent, and if they were counted as human traffic they would inflate
the visitor count and drag the image-cache hit rate down — the report would
describe our own monitoring instead of the shop.

Run it directly:
    python3 deploy/test-access-report-probe.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("luwag-access-report.sh")
PROBE_UA = "LUWAG-Probe/1.0 (+https://luwag.shop)"
VISITOR_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def log_line(uri: str, status: int, ua: str, duration: float = 0.12, cache: str = "HIT") -> str:
    return json.dumps(
        {
            "ts": 1_763_000_000.0,
            "status": status,
            "duration": duration,
            "request": {
                "uri": uri,
                "headers": {"user-agent": ua, "referer": "https://luwag.shop/"},
            },
            "resp_headers": {"x-nextjs-cache": cache},
        }
    )


def run_report(lines: list[str]) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        log = Path(directory) / "access.log"
        log.write_text("\n".join(lines) + "\n", encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--json", "--log", str(log)],
            capture_output=True,
            text=True,
            check=True,
        )
    return json.loads(result.stdout)


def main() -> int:
    report = run_report(
        [
            log_line("/", 200, VISITOR_UA),
            log_line("/collections/all-products", 200, VISITOR_UA),
            log_line("/_next/image?url=%2Fimg%2Fa.webp", 200, VISITOR_UA, cache="HIT"),
            log_line("/_next/image?url=%2Fimg%2Fb.webp", 200, VISITOR_UA, cache="MISS"),
            log_line("/", 200, PROBE_UA),
            log_line("/products/sofa", 200, PROBE_UA),
            log_line("/_next/image?url=%2Fimg%2Fc.webp", 200, PROBE_UA, cache="MISS"),
        ]
    )

    traffic = report["traffic"]
    images = report["images"]

    failures: list[str] = []
    # Two page views and two image requests carry the visitor agent.
    if traffic.get("human") != 4:
        failures.append(f"expected 4 human requests, got {traffic.get('human')}")
    if traffic.get("probe") != 3:
        failures.append(f"expected 3 probe requests, got {traffic.get('probe')}")
    if images.get("requests") != 3:
        failures.append(f"expected 3 image requests, got {images.get('requests')}")
    # The probe requested one image that missed. Counting it would halve the
    # real hit rate, so the probe must be excluded from both sides.
    if images.get("realHitRate") != 50.0:
        failures.append(f"expected a 50% real hit rate, got {images.get('realHitRate')}")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print("PASS: probe traffic is counted separately and does not affect the real hit rate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
