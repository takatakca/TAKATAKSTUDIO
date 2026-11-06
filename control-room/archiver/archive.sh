#!/bin/sh
# TAKATAK Control Room — recordings older than RETENTION_DAYS go to Google
# Drive, then leave the server. `rclone move` deletes a file only after its
# upload is verified. Without a configured Drive remote nothing is deleted.
set -u
RETENTION_DAYS="${RETENTION_DAYS:-30}"
REMOTE="${ARCHIVE_REMOTE:-gdrive:TAKATAK-Salle-de-controle}"
INTERVAL="${ARCHIVE_INTERVAL_SECONDS:-86400}"

while true; do
  if rclone listremotes 2>/dev/null | grep -q "^${REMOTE%%:*}:$"; then
    echo "[archiver] $(date -u +%FT%TZ) moving recordings older than ${RETENTION_DAYS} days to ${REMOTE}"
    rclone move /recordings "$REMOTE" \
      --min-age "${RETENTION_DAYS}d" \
      --include "screens/**" --include "webcam/**" \
      --delete-empty-src-dirs --checksum --log-level INFO \
      || echo "[archiver] move failed; files stay on the server and are retried next run"
  else
    echo "[archiver] $(date -u +%FT%TZ) no Drive remote '${REMOTE%%:*}' configured: nothing archived or deleted"
  fi
  sleep "$INTERVAL"
done
