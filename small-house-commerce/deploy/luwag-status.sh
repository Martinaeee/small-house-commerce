#!/usr/bin/env python3
"""Collect a read-only LUWAG host status snapshot for the admin status page.

Installed at /usr/local/sbin/luwag-status.sh and run by cron every five
minutes as root. Writes /var/lib/luwag/status.json atomically. Contains no
secrets: certificate metadata, container states, disk, backup, database size
and media counts only.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

OUT_DIR = Path("/var/lib/luwag")
OUT_FILE = OUT_DIR / "status.json"
CERT_FILE = Path("/etc/luwag/tls/luwag.shop_bundle.crt")
KEY_FILE = Path("/etc/luwag/tls/luwag.shop.key")
BACKUP_DIR = Path("/var/backups/smallhouse/db")
UPLOADS_DIR = Path("/var/lib/docker/volumes/small-house-prod_uploads_data/_data")
ALERT_LOG = Path("/var/log/luwag-cert-check.log")
CONTAINERS = [
    "small-house-prod-caddy-1",
    "small-house-prod-backend-1",
    "small-house-prod-frontend-1",
    "small-house-prod-db-1",
]


def run(args: list[str], timeout: int = 20) -> str:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
        ).stdout.strip()
    except Exception:
        return ""


def certificate_status() -> dict:
    result: dict = {
        "path": str(CERT_FILE),
        "exists": CERT_FILE.exists(),
        "subject": None,
        "san": [],
        "notAfter": None,
        "daysRemaining": None,
        "keyMatches": None,
        "served": {"reachable": False, "notAfter": None, "daysRemaining": None},
    }
    if not CERT_FILE.exists():
        return result

    subject = run(["openssl", "x509", "-in", str(CERT_FILE), "-noout", "-subject"])
    result["subject"] = subject.split("=", 1)[-1].strip() if subject else None

    end = run(["openssl", "x509", "-in", str(CERT_FILE), "-noout", "-enddate"])
    if "=" in end:
        result["notAfter"] = end.split("=", 1)[1].strip()
        try:
            end_dt = datetime.strptime(
                result["notAfter"], "%b %d %H:%M:%S %Y %Z"
            ).replace(tzinfo=timezone.utc)
            result["daysRemaining"] = int(
                (end_dt - datetime.now(timezone.utc)).total_seconds() // 86400
            )
        except ValueError:
            pass

    text = run(["openssl", "x509", "-in", str(CERT_FILE), "-noout", "-text"])
    san = sorted(set(re.findall(r"DNS:([^\s,]+)", text)))
    if san:
        result["san"] = san

    if KEY_FILE.exists():
        key_pub = run(["openssl", "pkey", "-in", str(KEY_FILE), "-pubout"])
        cert_pub = run(["openssl", "x509", "-in", str(CERT_FILE), "-pubkey", "-noout"])
        result["keyMatches"] = bool(key_pub and key_pub == cert_pub)

    served_end = run(
        ["openssl", "s_client", "-connect", "127.0.0.1:443", "-servername", "luwag.shop"],
        timeout=15,
    )
    # openssl s_client writes the certificate to stdout, so parse it directly.
    match = re.search(r"notAfter=(.+)", served_end)
    if match:
        result["served"]["reachable"] = True
        result["served"]["notAfter"] = match.group(1).strip()
        try:
            end_dt = datetime.strptime(
                result["served"]["notAfter"], "%b %d %H:%M:%S %Y %Z"
            ).replace(tzinfo=timezone.utc)
            result["served"]["daysRemaining"] = int(
                (end_dt - datetime.now(timezone.utc)).total_seconds() // 86400
            )
        except ValueError:
            pass
    return result


def container_statuses() -> list[dict]:
    services = []
    for name in CONTAINERS:
        raw = run(
            [
                "docker",
                "inspect",
                "-f",
                "{{.State.Status}}|{{.RestartCount}}",
                name,
            ]
        )
        if not raw or "|" not in raw:
            services.append({"name": name, "status": "missing", "restarts": 0})
            continue
        status, restarts = raw.split("|", 1)
        services.append(
            {
                "name": name.replace("small-house-prod-", "").replace("-1", ""),
                "status": status.strip(),
                "restarts": int(restarts) if restarts.strip().isdigit() else 0,
            }
        )
    return services


def backup_status() -> dict:
    if not BACKUP_DIR.is_dir():
        return {"latestFile": None, "latestAt": None, "ageHours": None, "ok": False}
    files = sorted(
        BACKUP_DIR.glob("small_house-*.sql.gz"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not files:
        return {"latestFile": None, "latestAt": None, "ageHours": None, "ok": False}
    latest = files[0]
    mtime = latest.stat().st_mtime
    age_hours = round((datetime.now().timestamp() - mtime) / 3600, 1)
    return {
        "latestFile": latest.name,
        "latestAt": datetime.fromtimestamp(mtime).astimezone().isoformat(),
        "ageHours": age_hours,
        "ok": age_hours <= 24,
    }


def database_status() -> dict:
    raw = run(
        [
            "docker",
            "exec",
            "small-house-prod-db-1",
            "sh",
            "-c",
            'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c '
            '"select pg_size_pretty(pg_database_size(current_database())); '
            'select count(*) from _prisma_migrations;"',
        ]
    )
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    return {
        "reachable": bool(lines),
        "sizePretty": lines[0] if lines else None,
        "migrations": int(lines[1]) if len(lines) > 1 and lines[1].isdigit() else None,
    }


def uploads_status() -> dict:
    files = 0
    total = 0
    if UPLOADS_DIR.is_dir():
        for dirpath, _dirnames, filenames in os.walk(UPLOADS_DIR):
            for filename in filenames:
                try:
                    files += 1
                    total += os.path.getsize(os.path.join(dirpath, filename))
                except OSError:
                    pass
    return {
        "files": files,
        "bytes": total,
        "pretty": human_bytes(total),
    }


def alert_status() -> dict:
    if not ALERT_LOG.exists():
        return {"lastCheckAt": None, "lastResult": None}
    lines = [line for line in ALERT_LOG.read_text(errors="ignore").splitlines() if line.strip()]
    if not lines:
        return {"lastCheckAt": None, "lastResult": None}
    last = lines[-1]
    match = re.match(r"\[([^\]]+)\]", last)
    if "OK days=" in last:
        result = "OK"
    elif "CRITICAL" in last:
        result = "CRITICAL"
    elif "WARN" in last:
        result = "WARN"
    elif "ALERT" in last:
        result = "ALERT"
    else:
        result = "UNKNOWN"
    return {
        "lastCheckAt": match.group(1) if match else None,
        "lastResult": result,
    }


def human_bytes(value: int) -> str:
    size = float(value)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit in ("B", "KB") else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def disk_status() -> dict:
    usage = shutil.disk_usage("/")
    return {
        "totalBytes": usage.total,
        "usedBytes": usage.used,
        "availableBytes": usage.free,
        "usedPercent": round(usage.used * 100 / usage.total, 1) if usage.total else None,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(OUT_DIR, 0o755)
    snapshot = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(),
        "hostname": os.uname().nodename,
        "certificate": certificate_status(),
        "services": container_statuses(),
        "disk": disk_status(),
        "backup": backup_status(),
        "database": database_status(),
        "uploads": uploads_status(),
        "alert": alert_status(),
    }
    fd, tmp = tempfile.mkstemp(dir=str(OUT_DIR), prefix=".status-", suffix=".json")
    with os.fdopen(fd, "w") as handle:
        json.dump(snapshot, handle, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUT_FILE)
    os.chmod(OUT_FILE, 0o644)


if __name__ == "__main__":
    main()
