#!/bin/bash
# Warm the image optimizer cache only when it looks cold.
#
# The optimizer cache lives on a named volume so deploys keep it, but a fresh
# volume (first install, volume reset) starts empty and the first visitors all
# pay the sharp transform. This checks the cached-file count on a timer and
# only warms when the cache is genuinely cold.
#
# Installed as /usr/local/sbin/luwag-warm-cache-if-cold.sh and scheduled from
# /etc/cron.d/luwag-warm-cache every 15 minutes.
set -uo pipefail
LOG=/var/log/luwag-warm-cache.log
CONTAINER=small-house-prod-frontend-1
THRESHOLD=${THRESHOLD:-100}

exec >>"$LOG" 2>&1

# The cache now lives on a named volume. Docker seeds a fresh volume with the
# image's `.next/cache/images`, which is root-owned, while the server runs as
# node — Next then silently skips writing and every request stays a MISS.
if ! docker exec "$CONTAINER" sh -c 'test -w /app/.next/cache && test -w /app/.next/cache/images' 2>/dev/null; then
  echo "=== $(date -Is) cache dir not writable, fixing ownership ==="
  docker exec -u 0 "$CONTAINER" chown -R 1000:1000 /app/.next/cache 2>/dev/null || true
fi

count=$(docker exec "$CONTAINER" sh -c \
  'find /app/.next/cache/images -type f 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]')
count=${count:-0}

if [ "$count" -ge "$THRESHOLD" ]; then
  exit 0
fi

echo "=== $(date -Is) cold cache ($count files < $THRESHOLD), warming ==="
/usr/local/sbin/luwag-warm-image-cache.sh
echo "=== $(date -Is) warm finished exit=$? ==="
