#!/bin/bash
# One-shot Ubuntu security update for LUWAG.
# Scheduled by /etc/cron.d/luwag-update at 02:00 Asia/Manila; removes its own
# cron entry so it never runs twice. Aborts without rebooting on failure.
set -uo pipefail
LOG=/var/log/luwag-update.log
exec >>"$LOG" 2>&1

echo "=== $(date -Is) update start ==="
rm -f /etc/cron.d/luwag-update

ALERT_WEBHOOK_URL=""
ALERT_FORMAT="wecom"
if [ -r /etc/luwag/alert.env ]; then
  # shellcheck disable=SC1090
  . /etc/luwag/alert.env
fi

notify() {
  local message="$1"
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  local payload
  if [ "${ALERT_FORMAT:-wecom}" = "feishu" ]; then
    payload=$(printf '{"msg_type":"text","content":{"text":"%s"}}' "$message")
  else
    payload=$(printf '{"msgtype":"text","text":{"content":"%s"}}' "$message")
  fi
  curl -sS --max-time 10 -H 'Content-Type: application/json' \
    -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}

notify "LUWAG: Ubuntu update starting. The site will be briefly unavailable."

echo "=== BACKUP ==="
/usr/local/sbin/smallhouse-backup.sh
backup_exit=$?
echo "backup_exit=$backup_exit"
if [ "$backup_exit" -ne 0 ]; then
  notify "LUWAG: update aborted because the pre-update database backup failed."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "=== APT UPDATE ==="
apt-get update
update_exit=$?
echo "apt_update_exit=$update_exit"
if [ "$update_exit" -ne 0 ]; then
  notify "LUWAG: update aborted because apt-get update failed."
  exit 1
fi

echo "=== DIST-UPGRADE ==="
apt-get -y \
  -o Dpkg::Options::="--force-confdef" \
  -o Dpkg::Options::="--force-confold" \
  dist-upgrade
upgrade_exit=$?
echo "dist_upgrade_exit=$upgrade_exit"
if [ "$upgrade_exit" -ne 0 ]; then
  notify "LUWAG: Ubuntu update failed (exit $upgrade_exit); not rebooting."
  exit 1
fi

cat > /etc/cron.d/luwag-post-update <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
@reboot root /usr/local/sbin/luwag-post-update.sh
CRON
chmod 644 /etc/cron.d/luwag-post-update

notify "LUWAG: Ubuntu update finished successfully. Rebooting now; the site will return shortly."
sync
reboot
