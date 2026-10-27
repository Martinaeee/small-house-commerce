#!/usr/bin/env python3
"""Configure DNSPod records for luwag.shop from an explicit JSON plan.

Credentials come from the environment or an env file:

    DNSPOD_ID=123456
    DNSPOD_TOKEN=xxxxxxxxxxxxxxxx

Nothing is written unless --apply is passed, so a dry run always shows the
exact create/modify/skip decisions first. Existing records are matched by
(name, type); a record is modified only when the plan's value differs, and
nothing is ever deleted.

Plan format (a JSON array):

    [
      {"name": "@", "type": "MX", "value": "mx.zoho.com", "mx": 10, "ttl": 600},
      {"name": "@", "type": "TXT", "value": "v=spf1 include:zoho.com ~all"},
      {"name": "send", "type": "MX", "value": "feedback-smtp.us-east-1.amazonses.com", "mx": 10}
    ]

Usage:
    luwag-dns.py --list
    luwag-dns.py --plan plan.json [--apply] [--env-file PATH] [--domain DOMAIN]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://dnsapi.cn"
DEFAULT_ENV_FILE = os.path.expanduser("~/.config/luwag/dnspod.env")


def load_credentials(env_file: str | None) -> tuple[str, str]:
    identifier = os.environ.get("DNSPOD_ID", "").strip()
    token = os.environ.get("DNSPOD_TOKEN", "").strip()

    if (not identifier or not token) and env_file and os.path.exists(env_file):
        with open(env_file, encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                value = value.strip().strip('"').strip("'")
                if key.strip() == "DNSPOD_ID":
                    identifier = value
                elif key.strip() == "DNSPOD_TOKEN":
                    token = value

    if not identifier or not token:
        sys.exit(
            "Missing DNSPOD_ID / DNSPOD_TOKEN. "
            f"Put them in {DEFAULT_ENV_FILE} (chmod 600) or export them."
        )
    return identifier, token


def call(action: str, identifier: str, token: str, **params: str) -> dict:
    payload = {
        "login_token": f"{identifier},{token}",
        "format": "json",
        "lang": "en",
        **{key: str(value) for key, value in params.items()},
    }
    body = urllib.parse.urlencode(payload).encode()
    request = urllib.request.Request(
        f"{API}/{action}",
        data=body,
        headers={"User-Agent": "LUWAG DNS tool (ops@luwag.shop)"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.loads(response.read().decode())
    code = data.get("status", {}).get("code")
    if code != "1":
        raise RuntimeError(
            f"{action} failed: {data.get('status', {}).get('message')} ({code})"
        )
    return data


def list_records(domain: str, identifier: str, token: str) -> list[dict]:
    data = call("Record.List", identifier, token, domain=domain)
    return [
        {
            "id": str(record.get("id", "")),
            "name": record.get("name", ""),
            "type": record.get("type", ""),
            "value": record.get("value", ""),
            "mx": str(record.get("mx", "") or ""),
            "ttl": str(record.get("ttl", "") or ""),
            "status": record.get("status", ""),
        }
        for record in data.get("records", [])
    ]


def normalise(value: str) -> str:
    """DNS TXT values may come back quoted or chunked; compare the substance."""
    return "".join(value.split()).replace('"', "").lower()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", default=os.environ.get("DOMAIN", "luwag.shop"))
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--list", action="store_true", help="print current records")
    parser.add_argument("--plan", help="JSON plan file")
    parser.add_argument("--apply", action="store_true", help="write changes")
    args = parser.parse_args()

    identifier, token = load_credentials(args.env_file)
    current = list_records(args.domain, identifier, token)

    if args.list or not args.plan:
        for record in current:
            print(
                f'{record["id"]:>10}  {record["name"]:<24} {record["type"]:<6} '
                f'mx={record["mx"] or "-":<4} ttl={record["ttl"]:<6} '
                f'{record["value"]}  [{record["status"]}]'
            )
        if not args.plan:
            return 0

    with open(args.plan, encoding="utf-8") as handle:
        plan = json.load(handle)

    by_key: dict[tuple[str, str], dict] = {}
    for record in current:
        by_key.setdefault((record["name"], record["type"]), record)

    changes: list[tuple[str, dict, dict | None]] = []
    for wanted in plan:
        key = (wanted["name"], wanted["type"])
        existing = by_key.get(key)
        if existing is None:
            changes.append(("CREATE", wanted, None))
        elif normalise(existing["value"]) != normalise(wanted["value"]):
            changes.append(("MODIFY", wanted, existing))
        else:
            changes.append(("SKIP", wanted, existing))

    for action, wanted, existing in changes:
        suffix = f' (was {existing["value"]})' if action == "MODIFY" else ""
        print(f'{action:<6} {wanted["name"]:<24} {wanted["type"]:<6} {wanted["value"]}{suffix}')

    if not args.apply:
        print("\nDry run. Re-run with --apply to write these changes.")
        return 0

    for action, wanted, existing in changes:
        if action == "SKIP":
            continue
        params = {
            "domain": args.domain,
            "sub_domain": wanted["name"],
            "record_type": wanted["type"],
            "record_line": wanted.get("record_line", "默认"),
            "value": wanted["value"],
            "ttl": wanted.get("ttl", 600),
        }
        if wanted.get("mx") is not None:
            params["mx"] = wanted["mx"]
        if action == "CREATE":
            call("Record.Create", identifier, token, **params)
        else:
            call("Record.Modify", identifier, token, record_id=existing["id"], **params)
        print(f'{action} done: {wanted["name"]} {wanted["type"]}')

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
