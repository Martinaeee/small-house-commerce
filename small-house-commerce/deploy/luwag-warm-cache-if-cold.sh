#!/bin/bash
# Warm the image optimizer cache only when it looks cold.
#
# Every `docker compose up -d frontend` recreates the container and starts
# with an empty .next/cache/images. Running the full warm-up on a timer would
# burn CPU for nothing most of the time, so this checks the cached-file count
# first and only pays the transform cost when a deploy just reset it.
#
# Installed as /usr/local/sbin/luwag-warm-cache-if-cold.sh and scheduled from
# /etc/cron.d/luwag-warm-cache every 15 minutes.
set -uo pipefail
LOG=/var/log/luwag-warm-cache.log
CONTAINER=small-house-prod-frontend-1
THRESHOLD=${THRESHOLD:-100}

exec >>"$LOG" 2>&1

count=$(docker exec "$CONTAINER" sh -c \
  'find /app/.next/cache/images -type f 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]')
count=${count:-0}

if [ "$count" -ge "$THRESHOLD" ]; then
  exit 0
fi

echo "=== $(date -Is) cold cache ($count files < $THRESHOLD), warming ==="
/usr/local/sbin/luwag-warm-image-cache.sh
echo "=== $(date -Is) warm finished exit=$? ==="
