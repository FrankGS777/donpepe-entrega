#!/bin/sh
set -eu
umask 077

# A newly mounted Railway volume is owned by root. Grant access to the
# application's dedicated data directory before dropping privileges.
data_dir="${DONPEPE_DATA_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-/app/v2/data}}"
case "$data_dir" in
  /app/v2/data|/data) ;;
  *) echo 'Mount the database volume at /data or /app/v2/data.' >&2; exit 1 ;;
esac
export DONPEPE_DATA_DIR="$data_dir"
if [ "${DONPEPE_MODE:-cloud}" = cloud ] && ! mountpoint -q "$data_dir"; then
  echo 'Attach a persistent volume before starting in cloud mode.' >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$data_dir"
  chown node:node "$data_dir"
  exec su-exec node:node /usr/local/bin/docker-entrypoint.sh "$@"
fi
exec /usr/local/bin/docker-entrypoint.sh "$@"
