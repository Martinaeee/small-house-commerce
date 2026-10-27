#!/bin/bash
# Post-reboot verification for the one-shot LUWAG Ubuntu update.
# Installed as an @reboot cron entry by luwag-update.sh and removes itself.
set -uo pipefail
LOG=/var/log/luwag-post-update.log
exec >>"$LOG" 2>&1

echo "=== $(date -Is) post-boot ==="
rm -f /etc/cron.d/luwag-post-update

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

sleep 60

echo "=== CONTAINERS ==="
docker ps --format '{{.Names}} {{.Status}}'

echo "=== LOCAL HTTPS ==="
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
  --resolve luwag.shop:443:127.0.0.1 \
  --cacert /etc/luwag/tls/luwag.shop_bundle.crt \
  https://luwag.shop/)
echo "local_https=$code"

echo "=== STATUS SNAPSHOT ==="
/usr/local/sbin/luwag-status.sh
echo "status_exit=$?"

if [ "$code" = "200" ]; then
  notify "LUWAG: server back online after the Ubuntu update; local HTTPS 200."
else
  notify "LUWAG: server restarted after the Ubuntu update but local HTTPS returned $code. Check /admin/status."
fi
