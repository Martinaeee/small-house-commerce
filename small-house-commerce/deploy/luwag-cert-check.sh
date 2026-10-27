#!/bin/bash
# LUWAG certificate expiry and endpoint check.
# Config: /etc/luwag/alert.env (600)
#   ALERT_WEBHOOK_URL    WeCom or Feishu bot webhook
#   ALERT_FORMAT         wecom | feishu
#   ALERT_FEISHU_SECRET  optional; required only if the Feishu bot enables signature verification
# Test: /usr/local/sbin/luwag-cert-check.sh --test
#
# Alert cadence: operational problems (unreadable cert, key mismatch, TLS
# endpoint down, Caddy down) always alert. The expiry countdown alerts once
# when the band changes (OK -> WARN30 -> WARN14 -> CRITICAL) and then daily
# inside the final week. A renewal that restores the certificate sends one
# recovery notice. The band is persisted in $BAND_STATE.
set -uo pipefail

CERT=${CERT:-/etc/luwag/tls/luwag.shop_bundle.crt}
KEY=${KEY:-/etc/luwag/tls/luwag.shop.key}
TLS_HOST=${TLS_HOST:-luwag.shop}
PORT=${PORT:-443}
STATE_DIR=${STATE_DIR:-/var/lib/luwag}
BAND_STATE=$STATE_DIR/cert-alert-band
LOG=${LOG:-/var/log/luwag-cert-check.log}
ENV_FILE=${ENV_FILE:-/etc/luwag/alert.env}
# Set CADDY_CONTAINER to an empty string to skip the container check.
CADDY_CONTAINER=${CADDY_CONTAINER-small-house-prod-caddy-1}

mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
log(){ echo "[$(date '+%F %T %Z')] $*" >> "$LOG"; }

ALERT_WEBHOOK_URL=""
ALERT_FORMAT="wecom"
ALERT_FEISHU_SECRET=""
if [ -r "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

send_alert(){
  local text="$1" severity="$2"
  if [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
    log "ALERT($severity): $text (webhook not configured)"
    return 2
  fi
  local esc payload
  esc=$(printf '%s' "$text" | sed 's/\\/\\\\/g; s/"/\\"/g')
  case "${ALERT_FORMAT:-wecom}" in
    feishu)
      if [ -n "${ALERT_FEISHU_SECRET:-}" ]; then
        local ts sign
        ts=$(date +%s)
        sign=$(printf '%s\n%s' "$ts" "$ALERT_FEISHU_SECRET" \
               | openssl dgst -sha256 -hmac "$ALERT_FEISHU_SECRET" -binary | base64 | tr -d '\n')
        payload=$(printf '{"timestamp":"%s","sign":"%s","msg_type":"text","content":{"text":"%s"}}' "$ts" "$sign" "$esc")
      else
        payload=$(printf '{"msg_type":"text","content":{"text":"%s"}}' "$esc")
      fi
      ;;
    *)
      payload=$(printf '{"msgtype":"text","text":{"content":"%s"}}' "$esc")
      ;;
  esac
  local resp="/tmp/luwag-alert-resp.$$"
  local code
  code=$(curl -sS -o "$resp" -w '%{http_code}' --max-time 10 \
         -H 'Content-Type: application/json' -d "$payload" "$ALERT_WEBHOOK_URL" 2>/dev/null || echo 000)
  local body; body=$(cat "$resp" 2>/dev/null); rm -f "$resp"
  if [ "$code" != "200" ]; then
    log "ALERT_SEND_FAILED http=$code body=${body:0:300}"
    return 3
  fi
  local ok=0
  case "${ALERT_FORMAT:-wecom}" in
    feishu) echo "$body" | grep -Eq '"(code|StatusCode)"[[:space:]]*:[[:space:]]*0' || ok=1 ;;
    *)      echo "$body" | grep -q '"errcode"[[:space:]]*:[[:space:]]*0' || ok=1 ;;
  esac
  if [ "$ok" -ne 0 ]; then
    log "ALERT_SEND_FAILED http=$code body=${body:0:300}"
    return 3
  fi
  log "ALERT_SENT($severity) http=$code body=${body:0:200}"
  return 0
}

if [ "${1:-}" = "--test" ]; then
  if [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
    echo "TEST_FAILED: webhook not configured in $ENV_FILE"
    exit 2
  fi
  send_alert "[LUWAG TEST] certificate alert channel test $(date '+%F %T %Z')" "TEST"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "TEST_OK: message accepted by ${ALERT_FORMAT} webhook"
  else
    echo "TEST_FAILED: webhook rejected or unreachable; see $LOG"
  fi
  exit "$rc"
fi

problems=(); sev="INFO"
[ -r "$CERT" ] || { problems+=("证书文件不可读"); sev="CRITICAL"; }
[ -r "$KEY" ]  || { problems+=("私钥文件不可读"); sev="CRITICAL"; }

DAYS=""; EXPIRES=""
if [ -r "$CERT" ]; then
  end=$(openssl x509 -in "$CERT" -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$end" ]; then
    end_ts=$(date -d "$end" +%s 2>/dev/null || echo 0)
    now=$(date +%s)
    if [ "$end_ts" -gt 0 ]; then
      DAYS=$(( (end_ts - now) / 86400 ))
      # Format from the epoch, not from the openssl string: the string carries
      # its own zone and would override the TZ prefix.
      expires_pht=$(TZ=Asia/Manila date -d "@${end_ts}" '+%Y-%m-%d %H:%M PHT' 2>/dev/null)
      expires_utc=$(date -u -d "@${end_ts}" '+%Y-%m-%d %H:%M UTC' 2>/dev/null)
      EXPIRES="${expires_pht} / ${expires_utc}"
    fi
  fi
  [ -z "$DAYS" ] && { problems+=("无法读取证书到期日"); sev="CRITICAL"; }
fi

if [ -r "$CERT" ] && [ -r "$KEY" ]; then
  a=$(openssl pkey -in "$KEY" -pubout 2>/dev/null | sha256sum | cut -d' ' -f1)
  b=$(openssl x509 -in "$CERT" -pubkey -noout 2>/dev/null | sha256sum | cut -d' ' -f1)
  [ "$a" = "$b" ] || { problems+=("私钥与证书不匹配"); sev="CRITICAL"; }
fi

served_end=$(echo | timeout 15 openssl s_client -connect "127.0.0.1:${PORT}" -servername "$TLS_HOST" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -z "$served_end" ]; then
  problems+=("线上 TLS 端点无响应或无法读取证书")
  [ "$sev" = "INFO" ] && sev="WARN"
fi

if [ -n "$CADDY_CONTAINER" ] && command -v docker >/dev/null 2>&1; then
  st=$(docker inspect -f '{{.State.Status}}' "$CADDY_CONTAINER" 2>/dev/null || echo missing)
  [ "$st" = "running" ] || { problems+=("Caddy 容器状态=$st"); [ "$sev" = "INFO" ] && sev="WARN"; }
fi

# Expiry band. It drives the countdown wording and the alert cadence, and is
# kept separate from `problems` so a standing countdown does not turn every
# daily run into a new alert.
band="OK"; expiry_note=""
if [ -n "$DAYS" ]; then
  if   [ "$DAYS" -lt 0 ];  then band="EXPIRED";  expiry_note="证书已过期 ${DAYS#-} 天"; sev="CRITICAL"
  elif [ "$DAYS" -le 7 ];  then band="CRITICAL"; expiry_note="证书仅剩 ${DAYS} 天"; sev="CRITICAL"
  elif [ "$DAYS" -le 14 ]; then band="WARN14";   expiry_note="证书剩 ${DAYS} 天"; [ "$sev" = "INFO" ] && sev="WARN"
  elif [ "$DAYS" -le 30 ]; then band="WARN30";   expiry_note="证书剩 ${DAYS} 天"; [ "$sev" = "INFO" ] && sev="WARN"
  fi
fi

joined=""
for problem in "${problems[@]}"; do
  joined="${joined:+${joined}；}${problem}"
done
notes="${expiry_note}"
[ -n "$joined" ] && notes="${notes:+${notes}；}${joined}"

last_band=$(cat "$BAND_STATE" 2>/dev/null || echo "")

if [ -z "$notes" ]; then
  if [ -n "$last_band" ] && [ "$last_band" != "OK" ]; then
    msg="[LUWAG OK] luwag.shop 证书已恢复正常：到期 ${EXPIRES:-未知}，剩余 ${DAYS:-?} 天"
    log "$msg"
    send_alert "$msg" "OK"
  fi
  printf 'OK\n' > "$BAND_STATE"; chmod 600 "$BAND_STATE" 2>/dev/null
  log "OK days=$DAYS expires=$EXPIRES"
  exit 0
fi

# Notify on any operational problem, whenever the expiry band changes, and
# every day inside the final week. Otherwise stay quiet.
notify=0
[ "${#problems[@]}" -gt 0 ] && notify=1
[ "$band" != "$last_band" ] && notify=1
{ [ "$band" = "CRITICAL" ] || [ "$band" = "EXPIRED" ]; } && notify=1

if [ "$notify" -eq 0 ]; then
  printf '%s\n' "$band" > "$BAND_STATE"; chmod 600 "$BAND_STATE" 2>/dev/null
  log "UNCHANGED band=$band days=$DAYS notes=$notes (no new alert)"
  exit 1
fi

msg="[LUWAG ${sev}] luwag.shop 证书检查: ${notes}"
[ -n "$EXPIRES" ] && msg="${msg}（到期 ${EXPIRES}）"
log "$msg"
send_alert "$msg" "$sev"
printf '%s\n' "$band" > "$BAND_STATE"; chmod 600 "$BAND_STATE" 2>/dev/null
exit 1
